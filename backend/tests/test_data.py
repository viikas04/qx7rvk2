import pandas as pd

from app.data import clean_actuals, clean_forecasts


def test_actuals_keep_latest_revision_and_drop_invalid():
    raw = pd.DataFrame(
        [
            {
                "startTime": "2026-01-05T10:00:00Z",
                "publishTime": "2026-01-05T10:35:00Z",
                "generation": 100,
            },
            {
                "startTime": "2026-01-05T10:00:00Z",
                "publishTime": "2026-01-05T12:00:00Z",
                "generation": 120,
            },
            {
                "startTime": "2026-01-05T10:30:00Z",
                "publishTime": "2026-01-05T11:05:00Z",
                "generation": None,
            },
            {"startTime": "not-a-date", "publishTime": "2026-01-05T11:05:00Z", "generation": 5},
        ]
    )
    df, q = clean_actuals(raw)
    assert len(df) == 1
    assert df.loc[0, "actual_mw"] == 120
    assert q["dropped_revisions"] == 1
    assert q["dropped_invalid"] == 2


def test_forecasts_outside_horizon_are_dropped():
    raw = pd.DataFrame(
        [
            {
                "publishTime": "2026-01-05T10:00:00Z",
                "startTime": "2026-01-05T09:30:00Z",
                "generation": 1,
            },  # past
            {
                "publishTime": "2026-01-05T10:00:00Z",
                "startTime": "2026-01-05T10:00:00Z",
                "generation": 2,
            },  # 0h
            {
                "publishTime": "2026-01-05T10:00:00Z",
                "startTime": "2026-01-07T10:00:00Z",
                "generation": 3,
            },  # 48h
            {
                "publishTime": "2026-01-05T10:00:00Z",
                "startTime": "2026-01-07T10:30:00Z",
                "generation": 4,
            },  # >48h
        ]
    )
    df, q = clean_forecasts(raw)
    assert sorted(df.loc[~df["interpolated"], "forecast_mw"]) == [2, 3]
    assert q["dropped_outside_horizon"] == 2


def test_hourly_runs_are_filled_to_half_hours_but_big_gaps_are_not():
    pub = "2026-01-05T00:00:00Z"
    raw = pd.DataFrame(
        [
            {"publishTime": pub, "startTime": "2026-01-05T01:00:00Z", "generation": 100},
            {"publishTime": pub, "startTime": "2026-01-05T02:00:00Z", "generation": 200},
            # 3-hour gap: must NOT be invented
            {"publishTime": pub, "startTime": "2026-01-05T05:00:00Z", "generation": 500},
        ]
    )
    df, _ = clean_forecasts(raw)
    by_t = df.set_index(df["start_time"].dt.strftime("%H:%M"))
    assert by_t.loc["01:30", "forecast_mw"] == 150
    assert bool(by_t.loc["01:30", "interpolated"]) is True
    assert bool(by_t.loc["01:00", "interpolated"]) is False
    assert "03:00" not in by_t.index and "04:00" not in by_t.index
