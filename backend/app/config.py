"""Application settings and domain constants.

Everything that defines *what* the product analyses lives here, so the scope of
the pilot (January 2026 purchase decisions, national wind only) is explicit and
reviewable in one place.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from pathlib import Path

UK_TZ = "Europe/London"

# --- Pilot scope ---------------------------------------------------------------
# Day-ahead purchases for delivery day D are decided on D-1. Decisions made in
# January 2026 therefore cover delivery days 2 Jan .. 1 Feb 2026. We load
# 1 Jan .. 1 Feb so the fixed-horizon view can also include 1 Jan.
DELIVERY_FIRST_DAY = date(2026, 1, 1)
DELIVERY_LAST_DAY = date(2026, 2, 1)
DEFAULT_RANGE = (date(2026, 1, 2), date(2026, 2, 1))  # decisions made 1..31 Jan

# Forecast runs published up to 48h before the earliest target are needed.
FORECAST_PUBLISH_FROM = datetime(2025, 12, 29, tzinfo=UTC)
FORECAST_PUBLISH_TO = datetime(2026, 2, 2, tzinfo=UTC)
ACTUALS_SETTLEMENT_FROM = date(2025, 12, 31)
ACTUALS_SETTLEMENT_TO = date(2026, 2, 2)

# WINDFOR forecasts are only considered up to this lead time.
MAX_HORIZON_HOURS = 48.0
MIN_HORIZON_HOURS = 0.0

# Default decision time (UK local) on D-1. Configurable in the UI so the desk can
# match its own internal deadline / auction gate closure.
DEFAULT_DECISION_TIME = time(9, 0)

SETTLEMENT_PERIOD_HOURS = 0.5

# Lead times (hours) used for the "accuracy vs horizon" curve.
# fmt: off
HORIZON_GRID: tuple[float, ...] = (
    0.5, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 45,
)
# fmt: on


@dataclass(frozen=True)
class Settings:
    elexon_base_url: str = field(
        default_factory=lambda: os.getenv(
            "ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1"
        )
    )
    # auto     -> use bundled snapshot if present, else fetch live from Elexon
    # snapshot -> bundled snapshot only (fail fast if missing)
    # live     -> always fetch from Elexon (cached on disk afterwards)
    data_mode: str = field(default_factory=lambda: os.getenv("DATA_MODE", "auto"))
    snapshot_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("SNAPSHOT_DIR", Path(__file__).resolve().parent.parent / "data")
        )
    )
    cache_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("CACHE_DIR", Path(tempfile.gettempdir()) / "windsight-cache")
        )
    )
    http_timeout_s: float = field(default_factory=lambda: float(os.getenv("HTTP_TIMEOUT_S", "30")))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:8080").split(
                ","
            )
            if o.strip()
        )
    )


def get_settings() -> Settings:
    return Settings()
