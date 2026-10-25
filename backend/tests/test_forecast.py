from datetime import time

import numpy as np
import pandas as pd
import pytest

from app.data import clean_actuals, clean_forecasts, records_to_frame
from app.forecast import DayAheadPolicy, HorizonPolicy, select_forecasts

from .factories import make_raw


def ts(s):
    return pd.Timestamp(s, tz="UTC")


@pytest.fixture(scope="module")
def data():
    a, f = make_raw(start="2026-01-01T00:00Z", end="2026-01-06T00:00Z", run_every_h=3)
    actuals, _ = clean_actuals(records_to_frame(a))
    forecasts, _ = clean_forecasts(records_to_frame(f))
    return actuals, forecasts


@pytest.mark.parametrize("hours", [0.5, 4, 12, 24, 40])
def test_horizon_policy_never_uses_the_future(data, hours):
    actuals, forecasts = data
    sel = select_forecasts(actuals, forecasts, HorizonPolicy(hours)).dropna(subset=["forecast_mw"])
    assert not sel.empty
    assert (sel["publish_time"] <= sel["cutoff"]).all()
    assert (sel["lead_h"] >= hours - 1e-9).all()


def test_horizon_policy_picks_the_latest_eligible_run(data):
    actuals, forecasts = data
    sel = select_forecasts(actuals, forecasts, HorizonPolicy(4)).dropna(subset=["forecast_mw"])
    # runs every 3h, so the chosen run is at most 3h older than the cut-off
    assert ((sel["cutoff"] - sel["publish_time"]) < pd.Timedelta(hours=3)).all()


def test_no_eligible_forecast_gives_nan():
    actuals = pd.DataFrame({"start_time": [ts("2026-01-05T12:00")], "actual_mw": [100.0]})
    forecasts = pd.DataFrame(
        {
            "publish_time": [ts("2026-01-05T11:00")],  # only 1h before
            "start_time": [ts("2026-01-05T12:00")],
            "forecast_mw": [90.0],
            "interpolated": [False],
        }
    )
    sel = select_forecasts(actuals, forecasts, HorizonPolicy(4))
    assert np.isnan(sel.loc[0, "forecast_mw"])
    sel = select_forecasts(actuals, forecasts, HorizonPolicy(1))
    assert sel.loc[0, "forecast_mw"] == 90.0


def test_exact_cutoff_is_allowed():
    actuals = pd.DataFrame({"start_time": [ts("2026-01-05T12:00")], "actual_mw": [100.0]})
    forecasts = pd.DataFrame(
        {
            "publish_time": [ts("2026-01-05T08:00"), ts("2026-01-05T08:30")],
            "start_time": [ts("2026-01-05T12:00")] * 2,
            "forecast_mw": [80.0, 95.0],
            "interpolated": [False, False],
        }
    )
    sel = select_forecasts(actuals, forecasts, HorizonPolicy(4))
    assert sel.loc[0, "forecast_mw"] == 80.0  # 08:30 run is after the 08:00 cut-off


@pytest.mark.parametrize(
    "period, expected_cutoff",
    [
        # winter (GMT = UTC): any period of 15 Jan -> 14 Jan 09:00 UTC
        ("2026-01-15T00:00", "2026-01-14T09:00"),
        ("2026-01-15T23:30", "2026-01-14T09:00"),
        # summer (BST = UTC+1): 23:30 UTC on 10 Jun is 00:30 on 11 Jun locally
        ("2026-06-10T23:30", "2026-06-10T08:00"),
        # first day after clocks go forward (29 Mar 2026): cut-off 29 Mar 09:00 BST
        ("2026-03-30T12:00", "2026-03-29T08:00"),
    ],
)
def test_day_ahead_cutoff_is_previous_day_uk_time(period, expected_cutoff):
    policy = DayAheadPolicy(time(9, 0))
    got = policy.cutoffs(pd.Series([ts(period)]).dt.as_unit("ns"))[0]
    assert got == ts(expected_cutoff)


def test_day_ahead_uses_one_cutoff_for_the_whole_day(data):
    actuals, forecasts = data
    sel = select_forecasts(actuals, forecasts, DayAheadPolicy(time(9, 0)))
    day = sel[sel["start_time"].dt.date == pd.Timestamp("2026-01-04").date()]
    assert day["cutoff"].nunique() == 1
    assert (day["publish_time"] <= day["cutoff"]).all()
