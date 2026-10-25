"""Use-case layer: turns a request (date range + decision policy) into results.

Kept free of HTTP concerns so it can be unit-tested directly and reused by
scripts. Results are memoised per data bundle because January 2026 is history:
the same question always has the same answer.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from functools import lru_cache

import pandas as pd

from . import config, metrics
from .data import DataBundle
from .forecast import DayAheadPolicy, DecisionPolicy, HorizonPolicy, select_forecasts


def day_bounds_utc(first: date, last: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UK local delivery days [first, last] -> half-open UTC interval."""
    start = pd.Timestamp(datetime.combine(first, time()), tz=config.UK_TZ)
    end = pd.Timestamp(datetime.combine(last + timedelta(days=1), time()), tz=config.UK_TZ)
    return start.tz_convert("UTC"), end.tz_convert("UTC")


def _iso(ts) -> str | None:
    if ts is None or pd.isna(ts):
        return None
    return pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(x) -> float | None:
    return None if x is None or pd.isna(x) else round(float(x), 2)


class Analyzer:
    def __init__(self, bundle: DataBundle):
        self.bundle = bundle

    # -- helpers ------------------------------------------------------------------
    def _actuals_in(self, first: date, last: date) -> pd.DataFrame:
        a = self.bundle.actuals
        lo, hi = day_bounds_utc(first, last)
        return a[(a["start_time"] >= lo) & (a["start_time"] < hi)]

    @lru_cache(maxsize=256)  # noqa: B019 - one Analyzer per data bundle
    def selection(self, first: date, last: date, policy: DecisionPolicy) -> pd.DataFrame:
        return select_forecasts(self._actuals_in(first, last), self.bundle.forecasts, policy)

    # -- use cases ----------------------------------------------------------------
    @lru_cache(maxsize=256)  # noqa: B019
    def analysis(self, first: date, last: date, policy: DecisionPolicy) -> dict:
        sel = self.selection(first, last, policy)
        return {
            "range": {"start": first.isoformat(), "end": last.isoformat()},
            "policy": policy.describe(),
            "summary": metrics.summary(sel),
            "histogram": metrics.error_histogram(sel),
            "by_hour": metrics.by_hour_of_day(sel),
            "daily": metrics.daily(sel),
            "by_level": metrics.by_forecast_level(sel),
            "series": [
                {
                    "t": _iso(r.start_time),
                    "actual": _num(r.actual_mw),
                    "forecast": _num(r.forecast_mw),
                    "publish_time": _iso(r.publish_time),
                    "lead_h": _num(r.lead_h),
                    "interpolated": bool(r.interpolated) if pd.notna(r.interpolated) else False,
                }
                for r in sel.itertuples(index=False)
            ],
        }

    @lru_cache(maxsize=64)  # noqa: B019
    def horizon_curve(self, first: date, last: date) -> list[dict]:
        out = []
        for h in config.HORIZON_GRID:
            s = metrics.summary(self.selection(first, last, HorizonPolicy(float(h))))
            out.append(
                {
                    "horizon_h": h,
                    "mae_mw": s["mae_mw"],
                    "rmse_mw": s["rmse_mw"],
                    "bias_mw": s["bias_mw"],
                    "p90_abs_error_mw": s["p90_abs_error_mw"],
                    "coverage_pct": s["coverage_pct"],
                }
            )
        return out

    @lru_cache(maxsize=128)  # noqa: B019
    def decision_day(
        self,
        day: date,
        decision_time: time,
        max_other_runs: int = 4,
        min_change_mw: float = 50.0,
    ) -> dict:
        policy = DayAheadPolicy(decision_time)
        sel = self.selection(day, day, policy)
        lo, hi = day_bounds_utc(day, day)
        cutoff = policy.cutoffs(pd.Series([lo]))[0]

        f = self.bundle.forecasts
        day_f = f[(f["start_time"] >= lo) & (f["start_time"] < hi)]
        publish_times = sorted(day_f["publish_time"].unique())
        chosen = sel["publish_time"].dropna()
        chosen_run = chosen.mode().iloc[0] if not chosen.empty else None

        before = [
            p for p in publish_times if p <= cutoff and (chosen_run is None or p < chosen_run)
        ]
        after = [p for p in publish_times if p > cutoff and p < hi]

        def values(pt) -> pd.Series:
            run = day_f[day_f["publish_time"] == pt]
            return run.set_index("start_time")["forecast_mw"].sort_index()

        def differs(a: pd.Series, b: pd.Series) -> bool:
            common = a.index.intersection(b.index)
            if common.empty:
                return True
            return float((a[common] - b[common]).abs().mean()) >= min_change_mw

        def curve(pt) -> dict:
            v = values(pt)
            return {
                "publish_time": _iso(pt),
                "hours_before_delivery": _num((lo - pd.Timestamp(pt)).total_seconds() / 3600),
                "points": [{"t": _iso(t), "forecast": _num(x)} for t, x in v.items()],
            }

        # Consecutive WINDFOR runs are often identical (the numbers only move when a
        # new weather model run arrives), so only show runs that actually changed.
        reference = [values(chosen_run)] if chosen_run is not None else []
        earlier: list = []
        for pt in reversed(before):
            v = values(pt)
            if all(differs(v, r) for r in reference):
                earlier.append(pt)
                reference.append(v)
            if len(earlier) == max_other_runs:
                break
        earlier.reverse()

        later_distinct: list = []
        last = values(chosen_run) if chosen_run is not None else None
        for pt in after:
            v = values(pt)
            if last is None or differs(v, last):
                later_distinct.append(pt)
                last = v

        def spread(items: list, k: int) -> list:
            if len(items) <= k:
                return items
            idx = sorted({round(i * (len(items) - 1) / (k - 1)) for i in range(k)})
            return [items[i] for i in idx]

        s = metrics.summary(sel)
        p = metrics.paired(sel)
        return {
            "date": day.isoformat(),
            "decision_time": decision_time.strftime("%H:%M"),
            "cutoff": _iso(cutoff),
            "selected_publish_time": _iso(chosen_run),
            "summary": s,
            "energy": {
                "actual_mwh": _num(sel["actual_mw"].sum() * config.SETTLEMENT_PERIOD_HOURS),
                "forecast_mwh": _num(p["forecast_mw"].sum() * config.SETTLEMENT_PERIOD_HOURS)
                if not p.empty
                else None,
            },
            "series": [
                {
                    "t": _iso(r.start_time),
                    "actual": _num(r.actual_mw),
                    "forecast": _num(r.forecast_mw),
                    "publish_time": _iso(r.publish_time),
                    "lead_h": _num(r.lead_h),
                }
                for r in sel.itertuples(index=False)
            ],
            "earlier_runs": [curve(pt) for pt in earlier],
            "later_runs": [curve(pt) for pt in spread(later_distinct, max_other_runs)],
            "runs_available_at_decision": len([p for p in publish_times if p <= cutoff]),
            # Every run that forecast this day, oldest first (drives the evolution grid).
            "all_runs": [curve(pt) for pt in publish_times if pt < hi],
        }


def parse_policy(mode: str, decision_time: time, horizon_hours: float) -> DecisionPolicy:
    if mode == "day_ahead":
        return DayAheadPolicy(decision_time)
    if mode == "horizon":
        return HorizonPolicy(float(horizon_hours))
    raise ValueError(f"Unknown mode {mode!r}")
