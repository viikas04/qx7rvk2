import type { AnalysisResponse, DecisionDayResponse, HorizonResponse, Meta, Mode } from "./types";

const BASE = (import.meta.env.VITE_API_BASE ?? "") + "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "Can't reach the WindSight server. Check your connection and try again.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export interface AnalysisParams {
  start: string;
  end: string;
  mode: Mode;
  decisionTime: string;
  horizonHours: number;
}

const analysisQuery = (p: AnalysisParams) => ({
  start: p.start,
  end: p.end,
  mode: p.mode,
  decision_time: p.decisionTime,
  horizon_hours: p.horizonHours,
});

export const api = {
  meta: () => get<Meta>("/meta"),
  analysis: (p: AnalysisParams) => get<AnalysisResponse>("/analysis", analysisQuery(p)),
  horizonCurve: (start: string, end: string) => get<HorizonResponse>("/horizon-curve", { start, end }),
  decisionDay: (date: string, decisionTime: string) =>
    get<DecisionDayResponse>("/decision-day", { date, decision_time: decisionTime }),
  csvUrl: (p: AnalysisParams) =>
    `${BASE}/analysis.csv?${new URLSearchParams(
      Object.entries(analysisQuery(p)).map(([k, v]) => [k, String(v)]),
    )}`,
};
