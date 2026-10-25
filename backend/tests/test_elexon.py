import asyncio
from datetime import UTC, date, datetime

import httpx
import pytest

from app.elexon import ElexonClient, ElexonError, _date_windows, _datetime_windows


def test_windows_cover_range_without_gaps():
    w = _date_windows(date(2026, 1, 1), date(2026, 1, 20), days=7)
    assert w[0] == (date(2026, 1, 1), date(2026, 1, 7))
    assert w[-1] == (date(2026, 1, 15), date(2026, 1, 20))
    dw = _datetime_windows(
        datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 4, 12, tzinfo=UTC), hours=72
    )
    assert len(dw) == 2 and dw[0][1] == dw[1][0]


def test_fuelhh_filters_wind_and_sends_params():
    seen = []

    def handler(request: httpx.Request):
        seen.append(dict(request.url.params))
        return httpx.Response(
            200,
            json=[
                {"startTime": "2026-01-01T00:00:00Z", "fuelType": "WIND", "generation": 1},
                {"startTime": "2026-01-01T00:00:00Z", "fuelType": "CCGT", "generation": 2},
            ],
        )

    c = ElexonClient("https://x.test", transport=httpx.MockTransport(handler))
    rows = asyncio.run(c.fetch_wind_actuals(date(2026, 1, 1), date(2026, 1, 3)))
    assert [r["fuelType"] for r in rows] == ["WIND"]
    assert seen[0]["fuelType"] == "WIND" and seen[0]["settlementDateFrom"] == "2026-01-01"


def test_retries_transient_errors_then_succeeds(monkeypatch):
    monkeypatch.setattr("app.elexon.asyncio.sleep", _no_sleep)  # keep the test fast
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"data": [{"publishTime": "x"}]})

    c = ElexonClient("https://x.test", transport=httpx.MockTransport(handler))
    rows = asyncio.run(
        c.fetch_wind_forecasts(datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 2, tzinfo=UTC))
    )
    assert rows == [{"publishTime": "x"}] and calls["n"] == 3


def test_client_errors_are_not_retried():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(400, json={"error": "bad"})

    c = ElexonClient("https://x.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ElexonError):
        asyncio.run(c.fetch_wind_actuals(date(2026, 1, 1), date(2026, 1, 1)))
    assert calls["n"] == 1


async def _no_sleep(*_args):
    return None
