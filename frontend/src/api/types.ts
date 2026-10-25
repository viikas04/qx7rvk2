// Mirrors backend/app/schemas.py. Keep the two in sync.

export type Mode = "day_ahead" | "horizon";

export interface Summary {
  periods: number;
  paired_periods: number;
  coverage_pct: number | null;
  mae_mw: number | null;
  rmse_mw: number | null;
  bias_mw: number | null;
  median_abs_error_mw: number | null;
  p90_abs_error_mw: number | null;
  wape_pct: number | null;
  correlation: number | null;
  max_shortfall_mw: number | null;
  max_surplus_mw: number | null;
  reserve_p90_mw: number | null;
  reserve_p95_mw: number | null;
  mean_actual_mw: number | null;
  mean_forecast_mw: number | null;
  mean_lead_h: number | null;
  within_1gw_pct: number | null;
}

export interface SeriesPoint {
  t: string;
  actual: number | null;
  forecast: number | null;
  publish_time: string | null;
  lead_h: number | null;
  interpolated?: boolean;
}

export interface HistBin { from_mw: number; to_mw: number; count: number; pct: number }
export interface HourStat { hour: number; mae_mw: number | null; bias_mw: number | null; n: number }
export interface DayStat {
  date: string;
  actual_mwh: number | null;
  forecast_mwh: number | null;
  mae_mw: number | null;
  bias_mw: number | null;
  paired_periods: number;
  periods: number;
}

export interface LevelStat {
  from_mw: number;
  to_mw: number;
  n: number;
  share_pct: number;
  mae_mw: number | null;
  bias_mw: number | null;
  mean_actual_mw: number | null;
  mean_forecast_mw: number | null;
}

export interface Policy { mode: Mode; label: string; decision_time?: string | null; horizon_hours?: number | null }

export interface AnalysisResponse {
  range: { start: string; end: string };
  policy: Policy;
  summary: Summary;
  histogram: HistBin[];
  by_hour: HourStat[];
  daily: DayStat[];
  by_level: LevelStat[];
  series: SeriesPoint[];
}

export interface HorizonPoint {
  horizon_h: number;
  mae_mw: number | null;
  rmse_mw: number | null;
  bias_mw: number | null;
  p90_abs_error_mw: number | null;
  coverage_pct: number | null;
}
export interface HorizonResponse { range: { start: string; end: string }; points: HorizonPoint[] }

export interface Run {
  publish_time: string;
  hours_before_delivery: number | null;
  points: { t: string; forecast: number | null }[];
}

export interface DecisionDayResponse {
  date: string;
  decision_time: string;
  cutoff: string | null;
  selected_publish_time: string | null;
  runs_available_at_decision: number;
  summary: Summary;
  energy: { actual_mwh: number | null; forecast_mwh: number | null };
  series: SeriesPoint[];
  earlier_runs: Run[];
  later_runs: Run[];
  all_runs: Run[];
}

export interface Meta {
  product: string;
  api_version: string;
  data_source: string;
  delivery_first_day: string;
  delivery_last_day: string;
  default_range: { start: string; end: string };
  default_decision_time: string;
  max_horizon_hours: number;
  horizon_grid: number[];
  actual_periods: number;
  forecast_runs: number;
  forecast_points: number;
  first_publish_time: string | null;
  last_publish_time: string | null;
}
