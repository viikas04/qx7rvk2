import { lazy, Suspense, useEffect, useMemo } from "react";
import { useMeta } from "./api/hooks";
import type { Mode } from "./api/types";
import { ErrorNote, Loading } from "./components/ui";
import { clampDay } from "./lib/format";
import { useUrlState } from "./lib/useUrlState";
import DecisionDay from "./views/DecisionDay";

const Accuracy = lazy(() => import("./views/Accuracy"));
const Summary = lazy(() => import("./views/Summary"));
const Method = lazy(() => import("./views/Method"));

const VIEWS = [
  { id: "summary", label: "Summary" },
  { id: "day", label: "Decision day" },
  { id: "accuracy", label: "Forecast accuracy" },
  { id: "method", label: "How it works" },
] as const;

const DEFAULTS = {
  view: "summary",
  day: "2026-01-15",
  dt: "09:00",
  start: "2026-01-02",
  end: "2026-02-01",
  mode: "day_ahead",
  h: "24",
};

export default function App() {
  const meta = useMeta();
  const [s, set] = useUrlState(DEFAULTS);
  const m = meta.data;

  // Start each screen at the top, e.g. after clicking a day in the accuracy view.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [s.view]);

  const params = useMemo(() => {
    if (!m) return null;
    const lo = m.delivery_first_day;
    const hi = m.delivery_last_day;
    const start = clampDay(s.start, lo, hi);
    const end = clampDay(s.end, start, hi);
    return {
      start,
      end,
      mode: (s.mode === "horizon" ? "horizon" : "day_ahead") as Mode,
      decisionTime: s.dt,
      horizonHours: Math.min(Math.max(Number(s.h) || 24, 0.5), m.max_horizon_hours),
    };
  }, [m, s]);

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <svg viewBox="0 0 32 32" className="mark" aria-hidden>
            <circle cx="16" cy="16" r="2.4" />
            <path d="M16 13.6 L14.6 2.5 Q16 1.5 17.4 2.5 Z" />
            <path d="M18.1 17.2 L28.4 21.6 Q28.2 23.4 26.8 23.9 Z" />
            <path d="M13.9 17.2 L5.2 24.1 Q3.7 23.2 3.9 21.5 Z" />
          </svg>
          <div>
            <h1>WindSight</h1>
            <p>GB wind forecasts for day-ahead buying</p>
          </div>
        </div>
        <nav aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v.id} aria-current={s.view === v.id ? "page" : undefined}
              onClick={() => set({ view: v.id })}>{v.label}</button>
          ))}
        </nav>
      </header>

      <main>
        {meta.isError ? <ErrorNote error={meta.error} onRetry={() => meta.refetch()} />
          : !m || !params ? <Loading label="Loading Elexon data" /> : (
          <Suspense fallback={<Loading />}>
            {s.view === "summary" ? (
              <Summary meta={m} go={(patch) => { set(patch); window.scrollTo({ top: 0 }); }} />
            ) : s.view === "accuracy" ? (
              <Accuracy meta={m} params={params} onChange={set} />
            ) : s.view === "method" ? (
              <Method meta={m} />
            ) : (
              <DecisionDay meta={m} day={clampDay(s.day, m.delivery_first_day, m.delivery_last_day)}
                decisionTime={s.dt} onChange={set} />
            )}
          </Suspense>
        )}
      </main>

      <footer className="foot">
        <p>
          Data: Elexon BMRS, datasets FUELHH (wind) and WINDFOR
          {m && <>. Served from {m.data_source === "snapshot" ? "a stored snapshot" : "a live Elexon fetch"}</>}.
          Pilot scope: purchase decisions made in January 2026.
        </p>
      </footer>
    </div>
  );
}
