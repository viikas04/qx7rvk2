"""Which forecast would the buyer actually have had?

This is the heart of the product. For every settlement period we want the most
recent WINDFOR value that was *already published* at the moment the purchase
decision had to be made. Using any later run would leak information from the
future and make the forecast look better than it really was.

Two decision policies are supported:

* DayAheadPolicy(decision_time)  - the decision for delivery day D is taken on
  D-1 at a fixed UK local time (default 09:00). This mirrors how a day-ahead
  desk works: one cut-off for the whole delivery day.
* HorizonPolicy(hours)           - a fixed lead time before each period
  (cut-off = start_time - hours). Useful to see how accuracy decays with lead.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time
from typing import Protocol

import pandas as pd

from .config import UK_TZ


class DecisionPolicy(Protocol):
    def cutoffs(self, start_times: pd.Series) -> pd.Series: ...
    def describe(self) -> dict: ...


@dataclass(frozen=True)
class DayAheadPolicy:
    decision_time: time

    def cutoffs(self, start_times: pd.Series) -> pd.Series:
        # Work in UK wall-clock time so "the day before at 09:00" stays 09:00
        # even across a clock change.
        local_wall = start_times.dt.tz_convert(UK_TZ).dt.tz_localize(None)
        delivery_day = local_wall.dt.normalize()
        offset = pd.Timedelta(hours=self.decision_time.hour, minutes=self.decision_time.minute)
        naive = delivery_day - pd.Timedelta(days=1) + offset
        return (
            naive.dt.tz_localize(UK_TZ, ambiguous="NaT", nonexistent="shift_forward")
            .dt.tz_convert("UTC")
            .dt.as_unit("ns")
        )

    def describe(self) -> dict:
        return {
            "mode": "day_ahead",
            "decision_time": self.decision_time.strftime("%H:%M"),
            "label": (
                f"Latest forecast published before {self.decision_time:%H:%M} "
                "UK time on the day before delivery"
            ),
        }


@dataclass(frozen=True)
class HorizonPolicy:
    hours: float

    def cutoffs(self, start_times: pd.Series) -> pd.Series:
        return (start_times - pd.Timedelta(hours=self.hours)).dt.as_unit("ns")

    def describe(self) -> dict:
        return {
            "mode": "horizon",
            "horizon_hours": self.hours,
            "label": f"Latest forecast published at least {self.hours:g}h before each period",
        }


def select_forecasts(
    actuals: pd.DataFrame, forecasts: pd.DataFrame, policy: DecisionPolicy
) -> pd.DataFrame:
    """Pair each actual period with the forecast available at its cut-off.

    Returns one row per period in `actuals` with columns:
    start_time, actual_mw, cutoff, publish_time, forecast_mw, lead_h, interpolated.
    Periods with no eligible forecast keep NaN forecast values.
    """
    left = actuals[["start_time", "actual_mw"]].copy()
    left["start_time"] = left["start_time"].dt.as_unit("ns")
    left["cutoff"] = policy.cutoffs(left["start_time"])
    left = left.dropna(subset=["cutoff"]).sort_values("cutoff")

    right = forecasts[["publish_time", "start_time", "forecast_mw", "interpolated"]].copy()
    for col in ("publish_time", "start_time"):
        right[col] = right[col].dt.as_unit("ns")
    right = right.sort_values("publish_time")

    merged = pd.merge_asof(
        left,
        right,
        left_on="cutoff",
        right_on="publish_time",
        by="start_time",
        direction="backward",  # publish_time <= cutoff  -> never uses the future
        allow_exact_matches=True,
    )
    merged["lead_h"] = (merged["start_time"] - merged["publish_time"]).dt.total_seconds() / 3600.0
    return merged.sort_values("start_time").reset_index(drop=True)[
        [
            "start_time",
            "actual_mw",
            "cutoff",
            "publish_time",
            "forecast_mw",
            "lead_h",
            "interpolated",
        ]
    ]


def runs_for_day(
    forecasts: pd.DataFrame, day_start_utc: pd.Timestamp, day_end_utc: pd.Timestamp
) -> pd.DataFrame:
    """All forecast points that target [day_start, day_end)."""
    mask = (forecasts["start_time"] >= day_start_utc) & (forecasts["start_time"] < day_end_utc)
    return forecasts[mask]
