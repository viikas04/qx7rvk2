"""Thin async client for the two Elexon BMRS datasets we use.

* FUELHH  - half-hourly outturn generation by fuel type (we keep fuelType=WIND)
* WINDFOR - national wind generation forecasts, one "run" per publishTime

Requests are split into small date windows (the stream endpoints return every
row in one response, so smaller windows keep each response fast and make a
retry cheap), run with bounded concurrency, and retried with backoff on
transient errors.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any

import httpx

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}


class ElexonError(RuntimeError):
    """Raised when Elexon cannot be reached or returns an unexpected payload."""


def _date_windows(start: date, end: date, days: int) -> list[tuple[date, date]]:
    """Inclusive [start, end] split into consecutive windows of <= `days` days."""
    out: list[tuple[date, date]] = []
    cur = start
    while cur <= end:
        stop = min(cur + timedelta(days=days - 1), end)
        out.append((cur, stop))
        cur = stop + timedelta(days=1)
    return out


def _datetime_windows(
    start: datetime, end: datetime, hours: int
) -> list[tuple[datetime, datetime]]:
    """Half-open [start, end) split into windows of <= `hours` hours."""
    out: list[tuple[datetime, datetime]] = []
    cur = start
    while cur < end:
        stop = min(cur + timedelta(hours=hours), end)
        out.append((cur, stop))
        cur = stop
    return out


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class ElexonClient:
    def __init__(
        self,
        base_url: str,
        timeout_s: float = 30.0,
        max_concurrency: int = 4,
        max_retries: int = 3,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_s
        self._sem = asyncio.Semaphore(max_concurrency)
        self._max_retries = max_retries
        self._transport = transport

    async def _get(
        self, client: httpx.AsyncClient, path: str, params: list[tuple[str, str]]
    ) -> list[dict[str, Any]]:
        url = f"{self._base_url}{path}"
        attempt = 0
        while True:
            attempt += 1
            try:
                async with self._sem:
                    resp = await client.get(url, params=params)
                if resp.status_code in RETRY_STATUSES and attempt <= self._max_retries:
                    raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
                resp.raise_for_status()
                payload = resp.json()
                # Stream endpoints return a bare list; non-stream ones wrap in {"data": []}.
                if isinstance(payload, dict):
                    payload = payload.get("data", [])
                if not isinstance(payload, list):
                    raise ElexonError(f"Unexpected payload type from {path}")
                return payload
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                retryable = status is None or status in RETRY_STATUSES
                if not retryable or attempt > self._max_retries:
                    raise ElexonError(f"Elexon request failed for {path}: {exc}") from exc
                backoff = 0.5 * 2 ** (attempt - 1)
                log.warning(
                    "elexon retry", extra={"path": path, "attempt": attempt, "status": status}
                )
                await asyncio.sleep(backoff)

    async def _gather(
        self, path: str, param_sets: Iterable[list[tuple[str, str]]]
    ) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(
            timeout=self._timeout,
            transport=self._transport,
            headers={"Accept": "application/json"},
        ) as client:
            chunks = await asyncio.gather(*(self._get(client, path, p) for p in param_sets))
        rows = [row for chunk in chunks for row in chunk]
        log.info("elexon fetched", extra={"path": path, "rows": len(rows)})
        return rows

    async def fetch_wind_actuals(self, settlement_from: date, settlement_to: date):
        """FUELHH rows for fuelType=WIND, settlement dates inclusive."""
        params = [
            [
                ("settlementDateFrom", a.isoformat()),
                ("settlementDateTo", b.isoformat()),
                ("fuelType", "WIND"),
            ]
            for a, b in _date_windows(settlement_from, settlement_to, days=7)
        ]
        rows = await self._gather("/datasets/FUELHH/stream", params)
        # Defensive: keep WIND only even if the filter is ignored upstream.
        return [r for r in rows if str(r.get("fuelType", "")).upper() == "WIND"]

    async def fetch_wind_forecasts(self, publish_from: datetime, publish_to: datetime):
        """WINDFOR rows whose publishTime falls in [publish_from, publish_to)."""
        params = [
            [("publishDateTimeFrom", _iso(a)), ("publishDateTimeTo", _iso(b))]
            for a, b in _datetime_windows(publish_from, publish_to, hours=72)
        ]
        return await self._gather("/datasets/WINDFOR/stream", params)
