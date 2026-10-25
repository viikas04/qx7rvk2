"""Typed response contracts (also drive the OpenAPI docs at /api/docs)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Summary(BaseModel):
    periods: int = Field(description="Half-hour periods with an actual value")
    paired_periods: int = Field(description="Periods that also had an eligible forecast")
    coverage_pct: float | None
    mae_mw: float | None = Field(None, description="Mean absolute error")
    rmse_mw: float | None = None
    bias_mw: float | None = Field(None, description="Mean of forecast - actual")
    median_abs_error_mw: float | None = None
    p90_abs_error_mw: float | None = None
    wape_pct: float | None = Field(None, description="Sum|error| / sum actual")
    correlation: float | None = None
    max_shortfall_mw: float | None = None
    max_surplus_mw: float | None = None
    reserve_p90_mw: float | None = Field(
        None, description="Extra MW that covers the shortfall in 90% of periods"
    )
    reserve_p95_mw: float | None = None
    mean_actual_mw: float | None = None
    mean_forecast_mw: float | None = None
    mean_lead_h: float | None = None
    within_1gw_pct: float | None = None


class Policy(BaseModel):
    mode: str
    label: str
    decision_time: str | None = None
    horizon_hours: float | None = None


class SeriesPoint(BaseModel):
    t: str
    actual: float | None
    forecast: float | None
    publish_time: str | None
    lead_h: float | None
    interpolated: bool = False


class HistBin(BaseModel):
    from_mw: float
    to_mw: float
    count: int
    pct: float


class HourStat(BaseModel):
    hour: int
    mae_mw: float | None
    bias_mw: float | None
    n: int


class DayStat(BaseModel):
    date: str
    actual_mwh: float | None
    forecast_mwh: float | None
    mae_mw: float | None
    bias_mw: float | None
    paired_periods: int
    periods: int


class LevelStat(BaseModel):
    from_mw: float
    to_mw: float
    n: int
    share_pct: float
    mae_mw: float | None
    bias_mw: float | None
    mean_actual_mw: float | None
    mean_forecast_mw: float | None


class DateRange(BaseModel):
    start: str
    end: str


class AnalysisResponse(BaseModel):
    range: DateRange
    policy: Policy
    summary: Summary
    histogram: list[HistBin]
    by_hour: list[HourStat]
    daily: list[DayStat]
    by_level: list[LevelStat]
    series: list[SeriesPoint]


class HorizonPoint(BaseModel):
    horizon_h: float
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None
    p90_abs_error_mw: float | None
    coverage_pct: float | None


class HorizonResponse(BaseModel):
    range: DateRange
    points: list[HorizonPoint]


class RunPoint(BaseModel):
    t: str
    forecast: float | None


class Run(BaseModel):
    publish_time: str
    hours_before_delivery: float | None
    points: list[RunPoint]


class Energy(BaseModel):
    actual_mwh: float | None
    forecast_mwh: float | None


class DecisionDayResponse(BaseModel):
    date: str
    decision_time: str
    cutoff: str | None
    selected_publish_time: str | None
    runs_available_at_decision: int
    summary: Summary
    energy: Energy
    series: list[SeriesPoint]
    earlier_runs: list[Run]
    later_runs: list[Run]
    all_runs: list[Run]


class Meta(BaseModel):
    product: str
    api_version: str
    data_source: str
    delivery_first_day: str
    delivery_last_day: str
    default_range: DateRange
    default_decision_time: str
    max_horizon_hours: float
    horizon_grid: list[float]
    actual_periods: int
    forecast_runs: int
    forecast_points: int
    first_publish_time: str | None
    last_publish_time: str | None
    data_quality: dict
