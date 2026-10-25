import { useMemo } from "react";
import type { AnalysisParams } from "../api/client";
import { useAnalysis, useHorizonCurve } from "../api/hooks";
import type { Meta } from "../api/types";
import { ErrorNote, Loading } from "../components/ui";
import { gw, gwRange, longDay, mw, pct, shortDay } from "../lib/format";

interface Props {
  meta: Meta;
  go: (patch: Record<string, string>) => void;
}

/** The pitch: what the pilot found, in a few plain statements, each linked to the evidence. */
export default function Summary({ meta, go }: Props) {
  const params: AnalysisParams = useMemo(
    () => ({
      start: meta.default_range.start,
      end: meta.default_range.end,
      mode: "day_ahead",
      decisionTime: meta.default_decision_time,
      horizonHours: 24,
    }),
    [meta],
  );
  const q = useAnalysis(params);
  const hq = useHorizonCurve(params.start, params.end);
  const d = q.data;

  const facts = useMemo(() => {
    if (!d) return null;
    const paired = d.series.filter((p) => p.actual != null && p.forecast != null);
    const highShare = paired.length
      ? (100 * paired.filter((p) => p.forecast! > p.actual!).length) / paired.length
      : null;
    const levels = d.by_level.filter((l) => l.n >= 10 && l.bias_mw != null);
    const windiest = levels.length ? levels[levels.length - 1] : null;
    const calm = levels.reduce<(typeof levels)[number] | null>(
      (best, l) => (best == null || Math.abs(l.bias_mw!) < Math.abs(best.bias_mw!) ? l : best),
      null,
    );
    const days = d.daily.filter((x) => x.mae_mw != null);
    const worst = days.reduce<(typeof days)[number] | null>(
      (b, x) => (b == null || x.mae_mw! > b.mae_mw! ? x : b),
      null,
    );
    const best = days.reduce<(typeof days)[number] | null>(
      (b, x) => (b == null || x.mae_mw! < b.mae_mw! ? x : b),
      null,
    );
    return { highShare, windiest, calm, worst, best };
  }, [d]);

  const lead = useMemo(() => {
    const pts = hq.data?.points.filter((p) => (p.coverage_pct ?? 0) >= 90 && p.mae_mw != null) ?? [];
    const near = pts.find((p) => p.horizon_h <= 1) ?? pts[0];
    const dayAhead = pts.find((p) => p.horizon_h === 24);
    return near && dayAhead ? { near, dayAhead } : null;
  }, [hq.data]);

  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  if (!d || !facts) return <Loading label="Preparing the pilot summary" />;
  const s = d.summary;
  const runsHigh = (s.bias_mw ?? 0) > 0;

  return (
    <div className="view">
      <div className="lede">
        <h2 className="summary-lede">
          {runsHigh ? (
            <>In January 2026 the day-ahead forecast promised <strong>{gw(s.bias_mw)}</strong> more wind than arrived, on average.</>
          ) : (
            <>In January 2026 the day-ahead forecast came in {gw(Math.abs(s.bias_mw ?? 0))} below the wind that arrived, on average.</>
          )}
        </h2>
        <p className="summary-sub">
          Pilot results for {longDay(params.start)} to {longDay(params.end)}: every half hour scored
          against the newest forecast published by {params.decisionTime} UK time the day before.
          {facts.highShare != null && runsHigh && (
            <> The forecast was too high in {pct(facts.highShare, 0)} of half hours, leaving the desk short.</>
          )}
        </p>
      </div>

      <ol className="findings">
        <li className="finding">
          <div className="finding-figure">
            {mw(s.reserve_p90_mw)}
            <small>backup to hold above the forecast</small>
          </div>
          <div>
            <h3>Plan for the shortfall, not the forecast</h3>
            <p>
              Holding this much above the forecast would have covered the gap in 9 of every 10 half
              hours. For 19 in 20 it rises to {mw(s.reserve_p95_mw)}. The typical miss was{" "}
              {mw(s.mae_mw)}.
            </p>
          </div>
          <button className="linkish" onClick={() => go({ view: "accuracy" })}>Try other cover levels</button>
        </li>

        {facts.windiest && facts.calm && (
          <li className="finding">
            <div className="finding-figure">
              {gw(facts.windiest.bias_mw)}
              <small>too high when {gwRange(facts.windiest.from_mw, facts.windiest.to_mw)} was forecast</small>
            </div>
            <div>
              <h3>Windy days are where the forecast overshoots</h3>
              <p>
                When little wind was expected the forecast was close (about {mw(Math.abs(facts.calm.bias_mw!))} out
                when {gwRange(facts.calm.from_mw, facts.calm.to_mw)} was forecast). The gap widens steadily as the forecast
                rises. On windy days, treat the forecast as a ceiling rather than a central estimate.
              </p>
            </div>
            <button className="linkish" onClick={() => go({ view: "accuracy" })}>See the breakdown</button>
          </li>
        )}

        {lead && (
          <li className="finding">
            <div className="finding-figure">
              {gw(lead.near.mae_mw)}
              <small>typical miss even {lead.near.horizon_h} h ahead</small>
            </div>
            <div>
              {lead.near.mae_mw! > 0.75 * lead.dayAhead.mae_mw! ? (
                <>
                  <h3>A fresher forecast helps less than you would think</h3>
                  <p>
                    The typical miss is {mw(lead.dayAhead.mae_mw)} a day ahead and still {mw(lead.near.mae_mw)}{" "}
                    {lead.near.horizon_h} h ahead. Most of the error is a steady gap rather than late weather
                    changes, so waiting for the next forecast run is not a substitute for holding backup.
                  </p>
                </>
              ) : (
                <>
                  <h3>Fresher forecasts are clearly better</h3>
                  <p>
                    The typical miss falls from {mw(lead.dayAhead.mae_mw)} a day ahead to{" "}
                    {mw(lead.near.mae_mw)} {lead.near.horizon_h} h ahead, so late forecast runs are worth
                    watching for intraday adjustments.
                  </p>
                </>
              )}
            </div>
            <button className="linkish" onClick={() => go({ view: "accuracy", mode: "horizon" })}>Compare lead times</button>
          </li>
        )}

        {facts.worst && facts.best && (
          <li className="finding">
            <div className="finding-figure">
              {mw(facts.worst.mae_mw)}
              <small>typical miss on {shortDay(facts.worst.date)}, the hardest day</small>
            </div>
            <div>
              <h3>Some days are much harder than others</h3>
              <p>
                The calmest day for the forecast was {longDay(facts.best.date)}, with a typical miss of{" "}
                {mw(facts.best.mae_mw)}. Replaying the hardest day shows what the desk could see at the
                time and how later forecasts moved.
              </p>
            </div>
            <button className="linkish" onClick={() => go({ view: "day", day: facts.worst!.date })}>
              Replay {shortDay(facts.worst.date)}
            </button>
          </li>
        )}
      </ol>

      <p className="summary-foot">
        Figures use only Elexon's national wind data (FUELHH actuals and WINDFOR forecasts). The data
        cannot say why the forecast runs high on windy days; one possible reason is that wind farms are
        sometimes turned down when the grid is congested, which a forecast of available wind would not
        reflect.
      </p>
    </div>
  );
}
