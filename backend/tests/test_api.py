import pytest
from fastapi.testclient import TestClient

from app import config
from app.data import DataStore, save_raw
from app.main import app, get_store

from .factories import make_raw


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    folder = tmp_path_factory.mktemp("snap")
    save_raw(*make_raw(), folder)
    store = DataStore(config.Settings(data_mode="snapshot", snapshot_dir=folder))
    app.dependency_overrides[get_store] = lambda: store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_meta(client):
    r = client.get("/api/v1/meta")
    assert r.status_code == 200
    body = r.json()
    assert body["data_source"] == "snapshot"
    assert body["forecast_runs"] > 700


def test_analysis_day_ahead(client):
    r = client.get("/api/v1/analysis", params={"start": "2026-01-02", "end": "2026-02-01"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["series"]) == 31 * 48
    assert body["summary"]["coverage_pct"] == 100
    assert body["summary"]["mae_mw"] > 0
    assert "s-maxage" in r.headers["cache-control"]


def test_analysis_horizon_mode(client):
    r = client.get(
        "/api/v1/analysis",
        params={"start": "2026-01-10", "end": "2026-01-12", "mode": "horizon", "horizon_hours": 6},
    )
    assert r.status_code == 200
    assert all(p["lead_h"] >= 6 for p in r.json()["series"] if p["lead_h"] is not None)


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2025-12-01", "end": "2026-01-05"},  # outside pilot scope
        {"start": "2026-01-10", "end": "2026-01-05"},  # reversed
        {"decision_time": "25:00"},
        {"decision_time": "09:15"},
        {"mode": "horizon", "horizon_hours": 100},
        {"mode": "nonsense"},
    ],
)
def test_analysis_rejects_bad_input(client, params):
    assert client.get("/api/v1/analysis", params=params).status_code == 422


def test_horizon_curve_error_grows_with_lead(client):
    pts = client.get("/api/v1/horizon-curve").json()["points"]
    assert pts[0]["horizon_h"] == 0.5
    assert pts[-1]["mae_mw"] > pts[0]["mae_mw"]


def test_decision_day(client):
    r = client.get("/api/v1/decision-day", params={"date": "2026-01-15", "decision_time": "09:00"})
    assert r.status_code == 200
    body = r.json()
    assert body["cutoff"] == "2026-01-14T09:00:00Z"
    assert body["selected_publish_time"] <= body["cutoff"]
    assert all(run["publish_time"] > body["cutoff"] for run in body["later_runs"])
    assert all(run["publish_time"] <= body["cutoff"] for run in body["earlier_runs"])
    assert len(body["series"]) == 48
    pubs = [run["publish_time"] for run in body["all_runs"]]
    assert pubs == sorted(pubs) and body["selected_publish_time"] in pubs


def test_csv_export(client):
    r = client.get("/api/v1/analysis.csv", params={"start": "2026-01-10", "end": "2026-01-10"})
    assert r.status_code == 200
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("start_time_utc,actual_mw,forecast_mw,error_mw")
    assert len(lines) == 49


def test_decision_day_hides_runs_identical_to_the_chosen_one(tmp_path):
    from datetime import time as t

    import pandas as pd

    from app.analysis import Analyzer
    from app.data import DataBundle

    starts = pd.date_range("2026-01-15", periods=48, freq="30min", tz="UTC")
    actuals = pd.DataFrame({"start_time": starts, "actual_mw": 1000.0})
    rows = []
    # 3 runs before the 09:00 cut-off: two identical, one different
    for pub, level in [
        ("2026-01-13T21:00Z", 2000.0),
        ("2026-01-14T03:00Z", 1500.0),
        ("2026-01-14T06:00Z", 1500.0),
    ]:
        for s in starts:
            rows.append((pd.Timestamp(pub), s, level, False))
    forecasts = pd.DataFrame(
        rows, columns=["publish_time", "start_time", "forecast_mw", "interpolated"]
    )
    forecasts["lead_h"] = 0.0
    a = Analyzer(DataBundle(actuals, forecasts, "test", 0, {}))
    out = a.decision_day(pd.Timestamp("2026-01-15").date(), t(9, 0))
    assert out["selected_publish_time"] == "2026-01-14T06:00:00Z"
    assert [r["publish_time"] for r in out["earlier_runs"]] == ["2026-01-13T21:00:00Z"]
