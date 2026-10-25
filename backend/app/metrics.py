"""Accuracy statistics, expressed in terms a buyer can act on.

Sign convention (used everywhere in the product):

    error = forecast - actual   [MW]

* error > 0  -> wind came in BELOW forecast -> the desk is short and must
                cover the gap (the costly side for a buyer)
* error < 0  -> wind came in ABOVE forecast -> the desk bought too much
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .config import SETTLEMENT_PERIOD_HOURS, UK_TZ


def _f(x) -> float | None:
    """JSON-safe float (None instead of NaN/inf)."""
    if x is None:
        return None
    x = float(x)
    return None if math.isnan(x) or math.isinf(x) else round(x, 3)


def paired(selection: pd.DataFrame) -> pd.DataFrame:
    p = selection.dropna(subset=["actual_mw", "forecast_mw"]).copy()
    p["error_mw"] = p["forecast_mw"] - p["actual_mw"]
    return p


def summary(selection: pd.DataFrame) -> dict:
    p = paired(selection)
    total = int(selection["actual_mw"].notna().sum())
    n = int(len(p))
    base = {
        "periods": total,
        "paired_periods": n,
        "coverage_pct": _f(100.0 * n / total) if total else None,
    }
    if n == 0:
        return base | {
            k: None
            for k in (
                "mae_mw",
                "rmse_mw",
                "bias_mw",
                "median_abs_error_mw",
                "p90_abs_error_mw",
                "wape_pct",
                "correlation",
                "max_shortfall_mw",
                "max_surplus_mw",
                "reserve_p90_mw",
                "reserve_p95_mw",
                "mean_actual_mw",
                "mean_forecast_mw",
                "mean_lead_h",
                "within_1gw_pct",
            )
        }

    e = p["error_mw"].to_numpy()
    a = p["actual_mw"].to_numpy()
    f = p["forecast_mw"].to_numpy()
    abs_e = np.abs(e)
    corr = float(np.corrcoef(a, f)[0, 1]) if n > 2 and a.std() > 0 and f.std() > 0 else None
    return base | {
        "mae_mw": _f(abs_e.mean()),
        "rmse_mw": _f(np.sqrt((e**2).mean())),
        "bias_mw": _f(e.mean()),
        "median_abs_error_mw": _f(np.median(abs_e)),
        "p90_abs_error_mw": _f(np.quantile(abs_e, 0.9)),
        # Weighted absolute % error: robust when actual wind is near zero.
        "wape_pct": _f(100.0 * abs_e.sum() / a.sum()) if a.sum() > 0 else None,
        "correlation": _f(corr),
        "max_shortfall_mw": _f(max(e.max(), 0.0)),
        "max_surplus_mw": _f(max(-e.min(), 0.0)),
        # Extra MW to hold so the shortfall is covered in 90% / 95% of periods.
        "reserve_p90_mw": _f(max(np.quantile(e, 0.90), 0.0)),
        "reserve_p95_mw": _f(max(np.quantile(e, 0.95), 0.0)),
        "mean_actual_mw": _f(a.mean()),
        "mean_forecast_mw": _f(f.mean()),
        "mean_lead_h": _f(p["lead_h"].mean()),
        "within_1gw_pct": _f(100.0 * (abs_e <= 1000).mean()),
    }


def error_histogram(selection: pd.DataFrame, bin_mw: float = 500.0) -> list[dict]:
    p = paired(selection)
    if p.empty:
        return []
    e = p["error_mw"]
    lo = math.floor(e.min() / bin_mw) * bin_mw
    hi = math.ceil(e.max() / bin_mw) * bin_mw
    if hi == lo:
        hi = lo + bin_mw
    edges = np.arange(lo, hi + bin_mw, bin_mw)
    counts, edges = np.histogram(e, bins=edges)
    n = len(e)
    return [
        {
            "from_mw": _f(edges[i]),
            "to_mw": _f(edges[i + 1]),
            "count": int(c),
            "pct": _f(100.0 * c / n),
        }
        for i, c in enumerate(counts)
    ]


def by_hour_of_day(selection: pd.DataFrame) -> list[dict]:
    p = paired(selection)
    if p.empty:
        return []
    p["hour"] = p["start_time"].dt.tz_convert(UK_TZ).dt.hour
    g = p.groupby("hour")["error_mw"]
    stats = pd.DataFrame(
        {
            "mae_mw": g.apply(lambda s: s.abs().mean()),
            "bias_mw": g.mean(),
            "n": g.size(),
        }
    )
    return [
        {"hour": int(h), "mae_mw": _f(r.mae_mw), "bias_mw": _f(r.bias_mw), "n": int(r.n)}
        for h, r in stats.iterrows()
    ]


def daily(selection: pd.DataFrame) -> list[dict]:
    """Per delivery day (UK local): energy in MWh and daily MAE."""
    s = selection.copy()
    s["day"] = s["start_time"].dt.tz_convert(UK_TZ).dt.date
    out = []
    for day, grp in s.groupby("day"):
        p = paired(grp)
        out.append(
            {
                "date": day.isoformat(),
                "actual_mwh": _f(grp["actual_mw"].sum() * SETTLEMENT_PERIOD_HOURS),
                "forecast_mwh": _f(p["forecast_mw"].sum() * SETTLEMENT_PERIOD_HOURS)
                if not p.empty
                else None,
                "mae_mw": _f(p["error_mw"].abs().mean()) if not p.empty else None,
                "bias_mw": _f(p["error_mw"].mean()) if not p.empty else None,
                "paired_periods": int(len(p)),
                "periods": int(grp["actual_mw"].notna().sum()),
            }
        )
    return out


def by_forecast_level(selection: pd.DataFrame, bucket_mw: float = 2000.0) -> list[dict]:
    """Error grouped by how much wind was forecast (e.g. 0-2 GW, 2-4 GW, ...).

    Shows whether the forecast is less reliable when strong wind is expected.
    """
    p = paired(selection)
    if p.empty:
        return []
    p["bucket"] = (p["forecast_mw"].clip(lower=0) // bucket_mw).astype(int)
    out = []
    for b, grp in p.groupby("bucket"):
        e = grp["error_mw"]
        out.append(
            {
                "from_mw": _f(b * bucket_mw),
                "to_mw": _f((b + 1) * bucket_mw),
                "n": int(len(grp)),
                "share_pct": _f(100.0 * len(grp) / len(p)),
                "mae_mw": _f(e.abs().mean()),
                "bias_mw": _f(e.mean()),
                "mean_actual_mw": _f(grp["actual_mw"].mean()),
                "mean_forecast_mw": _f(grp["forecast_mw"].mean()),
            }
        )
    return out
