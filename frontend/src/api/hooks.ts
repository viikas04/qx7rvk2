import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type AnalysisParams } from "./client";

// January 2026 is history: results never change, so cache them for the session.
const forever = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: api.meta, ...forever });

export const useAnalysis = (p: AnalysisParams) =>
  useQuery({
    queryKey: ["analysis", p],
    queryFn: () => api.analysis(p),
    placeholderData: keepPreviousData, // keep the old chart while the new one loads
    ...forever,
  });

export const useHorizonCurve = (start: string, end: string) =>
  useQuery({
    queryKey: ["horizon", start, end],
    queryFn: () => api.horizonCurve(start, end),
    placeholderData: keepPreviousData,
    ...forever,
  });

export const useDecisionDay = (date: string, decisionTime: string) =>
  useQuery({
    queryKey: ["decision-day", date, decisionTime],
    queryFn: () => api.decisionDay(date, decisionTime),
    placeholderData: keepPreviousData,
    ...forever,
  });
