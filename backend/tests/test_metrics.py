import pandas as pd
import pytest

from app import metrics


def sel(actual, forecast):
    n = len(actual)
    return pd.DataFrame(
        {
            "start_time": pd.date_range("2026-01-10", periods=n, freq="30min", tz="UTC"),
            "actual_mw": actual,
            "forecast_mw": forecast,
            "lead_h": [24.0] * n,
        }
    )


def test_summary_known_values():
    s = metrics.summary(sel([100, 200, 300, 400], [110, 180, 330, 400]))
    # errors: +10, -20, +30, 0
    assert s["mae_mw"] == pytest.approx(15.0)
    assert s["bias_mw"] == pytest.approx(5.0)
    assert s["rmse_mw"] == pytest.approx((1400 / 4) ** 0.5, rel=1e-3)
    assert s["wape_pct"] == pytest.approx(100 * 60 / 1000)
    assert s["max_shortfall_mw"] == 30
    assert s["max_surplus_mw"] == 20
    assert s["coverage_pct"] == 100


def test_missing_forecasts_reduce_coverage_not_accuracy():
    s = metrics.summary(sel([100, 200], [110, None]))
    assert s["paired_periods"] == 1
    assert s["coverage_pct"] == 50
    assert s["mae_mw"] == 10


def test_reserve_is_never_negative():
    s = metrics.summary(sel([100, 200, 300], [50, 150, 250]))  # always over-delivers
    assert s["reserve_p90_mw"] == 0


def test_empty_selection_is_safe():
    s = metrics.summary(sel([100], [None]))
    assert s["mae_mw"] is None and s["paired_periods"] == 0
    assert metrics.error_histogram(sel([100], [None])) == []


def test_histogram_counts_everything():
    df = sel(
        list(range(0, 2000, 100)),
        [v + (i * 97) % 1300 - 600 for i, v in enumerate(range(0, 2000, 100))],
    )
    bins = metrics.error_histogram(df, bin_mw=250)
    assert sum(b["count"] for b in bins) == len(df)
    assert sum(b["pct"] for b in bins) == pytest.approx(100, abs=0.1)


def test_by_forecast_level_groups_by_forecast_size():
    df = sel([1000, 1500, 9000, 7000], [1200, 1300, 11000, 10000])
    levels = metrics.by_forecast_level(df, bucket_mw=2000)
    assert [lv["from_mw"] for lv in levels] == [0, 10000]
    low, high = levels
    assert low["n"] == 2 and low["mae_mw"] == 200 and low["bias_mw"] == 0
    assert high["mae_mw"] == 2500 and high["bias_mw"] == 2500
