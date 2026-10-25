"""Synthetic Elexon-shaped data for tests (never shipped as real data)."""

from __future__ import annotations

import numpy as np
import pandas as pd


def iso(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_raw(
    start="2025-12-29T00:00Z",
    end="2026-02-02T00:00Z",
    run_every_h: int = 1,
    horizon_h: int = 48,
    forecast_step_min: int = 30,
    seed: int = 0,
):
    """Return (actual_rows, forecast_rows) like the Elexon stream endpoints.

    Actual wind is a smooth signal; each forecast run sees the truth plus noise
    that grows with lead time, so accuracy realistically decays with horizon.
    """
    rng = np.random.default_rng(seed)
    times = pd.date_range(start, end, freq="30min", inclusive="left")
    hours = np.arange(len(times)) / 2
    truth = 9000 + 5000 * np.sin(hours / 30) + 2000 * np.sin(hours / 5)
    truth = np.clip(truth, 200, None)
    actual_rows = [
        {
            "dataset": "FUELHH",
            "publishTime": iso(t + pd.Timedelta(minutes=35)),
            "startTime": iso(t),
            "fuelType": "WIND",
            "generation": float(round(v)),
        }
        for t, v in zip(times, truth, strict=True)
    ]
    lookup = dict(zip(times, truth, strict=True))
    forecast_rows = []
    for pub in pd.date_range(start, end, freq=f"{run_every_h}h", inclusive="left"):
        targets = pd.date_range(
            pub.ceil(f"{forecast_step_min}min"),
            pub + pd.Timedelta(hours=horizon_h),
            freq=f"{forecast_step_min}min",
        )
        for t in targets:
            if t not in lookup:
                continue
            lead = (t - pub).total_seconds() / 3600
            noise = rng.normal(150 + 25 * lead, 60 + 30 * lead)
            forecast_rows.append(
                {
                    "dataset": "WINDFOR",
                    "publishTime": iso(pub),
                    "startTime": iso(t),
                    "generation": float(round(lookup[t] + noise)),
                }
            )
    return actual_rows, forecast_rows
