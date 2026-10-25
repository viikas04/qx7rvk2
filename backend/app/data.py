"""Loading, cleaning and caching of the two datasets.

The rest of the app only ever sees two tidy DataFrames:

actuals   : start_time (UTC) | actual_mw
forecasts : publish_time (UTC) | start_time (UTC) | forecast_mw | lead_h | interpolated

Data sources, in order of preference (DATA_MODE=auto):
1. a bundled snapshot in backend/data (reproducible, no network at runtime)
2. a disk cache written by a previous live fetch
3. a live fetch from Elexon
"""

from __future__ import annotations

import asyncio
import logging
import time as _time
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from . import config
from .elexon import ElexonClient

log = logging.getLogger(__name__)

ACTUALS_FILE = "fuelhh_wind.csv.gz"
FORECASTS_FILE = "windfor.csv.gz"


class DataUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class DataBundle:
    actuals: pd.DataFrame
    forecasts: pd.DataFrame
    source: str  # "snapshot" | "cache" | "live"
    loaded_at: float
    quality: dict


# --- Cleaning -------------------------------------------------------------------


def _to_utc(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, utc=True, errors="coerce").dt.as_unit("ns")


def clean_actuals(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Normalise FUELHH WIND rows.

    * parse timestamps as UTC
    * drop rows with missing time / generation
    * if a period was re-published, keep the most recent publication
    """
    q: dict = {"raw_rows": int(len(raw))}
    if raw.empty:
        return pd.DataFrame(columns=["start_time", "actual_mw"]), q | {"rows": 0}

    df = pd.DataFrame(
        {
            "start_time": _to_utc(raw["startTime"]),
            "publish_time": _to_utc(raw["publishTime"]) if "publishTime" in raw else pd.NaT,
            "actual_mw": pd.to_numeric(raw["generation"], errors="coerce"),
        }
    )
    before = len(df)
    df = df.dropna(subset=["start_time", "actual_mw"])
    q["dropped_invalid"] = int(before - len(df))

    before = len(df)
    df = df.sort_values(["start_time", "publish_time"]).drop_duplicates("start_time", keep="last")
    q["dropped_revisions"] = int(before - len(df))

    df = df[["start_time", "actual_mw"]].reset_index(drop=True)
    q["rows"] = int(len(df))
    return df, q


def clean_forecasts(
    raw: pd.DataFrame, max_horizon_h: float = config.MAX_HORIZON_HOURS
) -> tuple[pd.DataFrame, dict]:
    """Normalise WINDFOR rows.

    * parse timestamps as UTC, drop invalid rows and exact duplicates
    * keep only genuine forecasts: 0 <= (startTime - publishTime) <= max_horizon_h
    * if a run is coarser than half-hourly, fill the single missing half-hour
      between two forecast points by linear interpolation (flagged), so every
      settlement period can be compared. Larger gaps are never filled.
    """
    cols = ["publish_time", "start_time", "forecast_mw", "lead_h", "interpolated"]
    q: dict = {"raw_rows": int(len(raw))}
    if raw.empty:
        return pd.DataFrame(columns=cols), q | {"rows": 0, "runs": 0}

    df = pd.DataFrame(
        {
            "publish_time": _to_utc(raw["publishTime"]),
            "start_time": _to_utc(raw["startTime"]),
            "forecast_mw": pd.to_numeric(raw["generation"], errors="coerce"),
        }
    )
    before = len(df)
    df = df.dropna()
    q["dropped_invalid"] = int(before - len(df))

    before = len(df)
    df = df.drop_duplicates(["publish_time", "start_time"], keep="last")
    q["dropped_duplicates"] = int(before - len(df))

    lead_h = (df["start_time"] - df["publish_time"]).dt.total_seconds() / 3600.0
    in_window = (lead_h >= 0) & (lead_h <= max_horizon_h)
    q["dropped_outside_horizon"] = int((~in_window).sum())
    df = df[in_window]

    df = _fill_half_hours(df)
    df["lead_h"] = (df["start_time"] - df["publish_time"]).dt.total_seconds() / 3600.0
    df = df.sort_values(["publish_time", "start_time"]).reset_index(drop=True)
    q["interpolated_points"] = int(df["interpolated"].sum())
    q["rows"] = int(len(df))
    q["runs"] = int(df["publish_time"].nunique())
    return df[cols], q


def _fill_half_hours(df: pd.DataFrame) -> pd.DataFrame:
    step = pd.Timedelta(minutes=30)
    out = []
    for publish_time, run in df.groupby("publish_time", sort=False):
        run = run.set_index("start_time").sort_index()
        full = pd.date_range(run.index.min(), run.index.max(), freq=step)
        if len(full) == len(run):
            run = run.assign(interpolated=False)
        else:
            observed = run.index
            run = run.reindex(full)
            run["forecast_mw"] = run["forecast_mw"].interpolate(
                method="time", limit=1, limit_area="inside"
            )
            run["interpolated"] = ~run.index.isin(observed)
            run = run.dropna(subset=["forecast_mw"])
            run["publish_time"] = publish_time
        run.index.name = "start_time"
        out.append(run.reset_index())
    return pd.concat(out, ignore_index=True)


def records_to_frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame.from_records(rows) if rows else pd.DataFrame()


# --- Persistence ------------------------------------------------------------------


def save_raw(rows_actuals: list[dict], rows_forecasts: list[dict], folder: Path) -> None:
    """Store raw API rows (only the fields we use) as compressed CSV."""
    folder.mkdir(parents=True, exist_ok=True)
    a = records_to_frame(rows_actuals)
    f = records_to_frame(rows_forecasts)
    keep_a = [c for c in ("startTime", "publishTime", "fuelType", "generation") if c in a]
    keep_f = [c for c in ("startTime", "publishTime", "generation") if c in f]
    a[keep_a].to_csv(folder / ACTUALS_FILE, index=False)
    f[keep_f].to_csv(folder / FORECASTS_FILE, index=False)


def _read_raw(folder: Path) -> tuple[pd.DataFrame, pd.DataFrame] | None:
    a, f = folder / ACTUALS_FILE, folder / FORECASTS_FILE
    if a.exists() and f.exists():
        return pd.read_csv(a), pd.read_csv(f)
    return None


# --- Store ------------------------------------------------------------------------


class DataStore:
    """Loads the data once per process and hands out the cleaned bundle."""

    def __init__(self, settings: config.Settings, client: ElexonClient | None = None):
        self._settings = settings
        self._client = client or ElexonClient(
            settings.elexon_base_url, timeout_s=settings.http_timeout_s
        )
        self._bundle: DataBundle | None = None
        self._lock = asyncio.Lock()

    async def get(self) -> DataBundle:
        if self._bundle is None:
            async with self._lock:
                if self._bundle is None:
                    self._bundle = await self._load()
        return self._bundle

    async def _load(self) -> DataBundle:
        t0 = _time.perf_counter()
        mode = self._settings.data_mode
        raw, source = None, None

        if mode in ("auto", "snapshot"):
            raw = _read_raw(self._settings.snapshot_dir)
            source = "snapshot" if raw is not None else None
            if raw is None and mode == "snapshot":
                raise DataUnavailable(
                    f"No snapshot found in {self._settings.snapshot_dir}. "
                    "Run `python -m scripts.fetch_snapshot` first."
                )
        if raw is None:
            raw = _read_raw(self._settings.cache_dir)
            source = "cache" if raw is not None else None
        if raw is None:
            raw = await self._fetch_live()
            source = "live"

        actuals, qa = clean_actuals(raw[0])
        forecasts, qf = clean_forecasts(raw[1])
        if actuals.empty or forecasts.empty:
            raise DataUnavailable("Elexon returned no usable wind data for the pilot window.")

        log.info(
            "data loaded",
            extra={
                "source": source,
                "actual_rows": len(actuals),
                "forecast_rows": len(forecasts),
                "seconds": round(_time.perf_counter() - t0, 2),
            },
        )
        return DataBundle(
            actuals=actuals,
            forecasts=forecasts,
            source=source,
            loaded_at=_time.time(),
            quality={"actuals": qa, "forecasts": qf},
        )

    async def _fetch_live(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        actual_rows, forecast_rows = await asyncio.gather(
            self._client.fetch_wind_actuals(
                config.ACTUALS_SETTLEMENT_FROM, config.ACTUALS_SETTLEMENT_TO
            ),
            self._client.fetch_wind_forecasts(
                config.FORECAST_PUBLISH_FROM, config.FORECAST_PUBLISH_TO
            ),
        )
        try:
            save_raw(actual_rows, forecast_rows, self._settings.cache_dir)
        except OSError as exc:  # read-only FS etc. - caching is best effort
            log.warning("could not write cache", extra={"error": str(exc)})
        return records_to_frame(actual_rows), records_to_frame(forecast_rows)
