import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useDecisionDay } from "../api/hooks";
import type { DecisionDayResponse, Meta } from "../api/types";
import ForecastEvolution from "../components/ForecastEvolution";
import { DayPicker, ErrorNote, Legend, Loading, Panel, Stat, StatStrip } from "../components/ui";
import {
  addDays, gw, gwh, HALF_HOURS, hours, longDay, mw, shortDay, ukDateTime, ukTime,
} from "../lib/format";

interface Props {
  meta: Meta;
  day: string;
  decisionTime: string;
  onChange: (patch: { day?: string; dt?: string }) => void;
}

type Row = Record<string, number | string | null>;

function buildRows(d: DecisionDayResponse): Row[] {
  const rows = new Map<string, Row>();
  for (const p of d.series) rows.set(p.t, { t: p.t, actual: p.actual, forecast: p.forecast });
  d.earlier_runs.forEach((run, i) =>
    run.points.forEach((p) => {
      const r = rows.get(p.t);
      if (r) r[`e${i}`] = p.forecast;
    }),
  );
  d.later_runs.forEach((run, i) =>
    run.points.forEach((p) => {
      const r = rows.get(p.t);
      if (r) r[`l${i}`] = p.forecast;
    }),
  );
  return [...rows.values()];
}

export default function DecisionDay({ meta, day, decisionTime, onChange }: Props) {
  const q = useDecisionDay(day, decisionTime);
  const [showLater, setShowLater] = useState(false);
  const d = q.data;
  const rows = useMemo(() => (d ? buildRows(d) : []), [d]);
  const first = meta.delivery_first_day;
  const last = meta.delivery_last_day;

  // Left / right arrow keys step through delivery days (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowLeft" && day > first) onChange({ day: addDays(day, -1) });
      if (e.key === "ArrowRight" && day < last) onChange({ day: addDays(day, 1) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [day, first, last, onChange]);
  const decisionDay = addDays(day, -1);
  const firstPeriod = d?.series[0]?.t;
  const leadAtStart = d?.selected_publish_time && firstPeriod
    ? (new Date(firstPeriod).getTime() - new Date(d.selected_publish_time).getTime()) / 36e5
    : null;
  const energyGap = d?.energy.forecast_mwh != null && d.energy.actual_mwh != null
    ? d.energy.actual_mwh - d.energy.forecast_mwh
    : null;
  const s = d?.summary;

  return (
    <div className="view">
      <div className="lede">
        <p className="lede-sentence">
          For delivery on{" "}
          <span className="inline-control">
            <button className="step" aria-label="Previous day" disabled={day <= first}
              onClick={() => onChange({ day: addDays(day, -1) })}>‹</button>
            <DayPicker label="Delivery day" value={day} min={first} max={last} format={shortDay}
              onChange={(v) => onChange({ day: v })} />
            <button className="step" aria-label="Next day" disabled={day >= last}
              onClick={() => onChange({ day: addDays(day, 1) })}>›</button>
          </span>
          , the desk buys at{" "}
          <select className="inline-select" aria-label="Decision time (UK)" value={decisionTime}
            onChange={(e) => onChange({ dt: e.target.value })}>
            {HALF_HOURS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>{" "}
          on {shortDay(decisionDay)}.
        </p>
        <p className="lede-answer" aria-live="polite">
          {!d ? " " : d.selected_publish_time ? (
            <>
              The newest wind forecast at that moment was published{" "}
              <strong>{ukDateTime(d.selected_publish_time)}</strong>, {hours(leadAtStart)} before
              delivery starts. {d.runs_available_at_decision} forecast runs for this day existed by then.
            </>
          ) : (
            <>No forecast for this day had been published by the decision time. Try a later time.</>
          )}
        </p>
      </div>

      {q.isError ? <ErrorNote error={q.error} onRetry={() => q.refetch()} /> : !d ? <Loading /> : (
        <>
          <StatStrip busy={q.isFetching}>
            <Stat label="Wind energy forecast" value={gwh(d.energy.forecast_mwh)} note="Over the delivery day" />
            <Stat label="Wind energy delivered" value={gwh(d.energy.actual_mwh)}
              tone={energyGap == null ? undefined : energyGap < 0 ? "short" : "surplus"}
              note={energyGap == null ? undefined
                : `${energyGap < 0 ? "−" : "+"}${gwh(Math.abs(energyGap))} against the forecast`} />
            <Stat label="Typical miss" value={mw(s?.mae_mw)} note="Mean absolute error per half hour" />
            <Stat label="Largest shortfall" value={mw(s?.max_shortfall_mw)} tone="short"
              note="Wind below forecast, worst half hour" />
            <Stat label="Largest surplus" value={s?.max_surplus_mw ? mw(s.max_surplus_mw) : "None"}
              tone={s?.max_surplus_mw ? "surplus" : undefined}
              note={s?.max_surplus_mw ? "Wind above forecast, worst half hour" : "Wind never beat the forecast this day"} />
          </StatStrip>

          <Panel
            wide
            title={`Wind generation on ${longDay(day)}`}
            note="UK local time. The thick amber line is what the desk could act on. Use the ← and → keys to step through days."
            actions={
              <label className="toggle">
                <input type="checkbox" checked={showLater} onChange={(e) => setShowLater(e.target.checked)}
                  disabled={!d.later_runs.length} />
                Show forecasts published after the decision
              </label>
            }
          >
            <Legend items={[
              { label: "Actual generation", kind: "actual" },
              { label: "Forecast used for the decision", kind: "forecast" },
              { label: "Older forecasts", kind: "earlier" },
              ...(showLater ? [{ label: "Later forecasts (not available yet)", kind: "later" }] : []),
            ]} />
            <div className="chart chart-tall">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="var(--rule)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={ukTime} minTickGap={40} tick={{ fill: "var(--ink-2)", fontSize: 12 }}
                    stroke="var(--rule)" />
                  <YAxis tickFormatter={(v) => gw(v)} width={72} tick={{ fill: "var(--ink-2)", fontSize: 12 }}
                    stroke="var(--rule)" />
                  <Tooltip content={<DayTooltip runs={d} showLater={showLater} />} />
                  {d.earlier_runs.map((r, i) => (
                    <Line key={r.publish_time} dataKey={`e${i}`} stroke="var(--forecast)" strokeOpacity={0.7}
                      strokeDasharray="1 4" strokeLinecap="round" strokeWidth={2.25} dot={false}
                      isAnimationActive={false} connectNulls />
                  ))}
                  {showLater && d.later_runs.map((r, i) => (
                    <Line key={r.publish_time} dataKey={`l${i}`} stroke="var(--later)" strokeDasharray="4 4"
                      strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
                  ))}
                  <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={3} dot={false}
                    isAnimationActive={false} />
                  <Line dataKey="actual" stroke="var(--actual)" strokeWidth={2} dot={false}
                    isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel
            wide
            title="How the forecast for this day evolved"
            note={<>Each row is one forecast run, oldest at the top. Colour shows how far it was from what actually
              happened. Runs below the dashed line came too late for the {decisionTime} decision.</>}
          >
            <ForecastEvolution runs={d.all_runs} series={d.series} cutoff={d.cutoff}
              selected={d.selected_publish_time} />
          </Panel>
        </>
      )}
    </div>
  );
}

function DayTooltip({ active, payload, label, runs, showLater }: {
  active?: boolean; payload?: { dataKey: string; value: number | null }[]; label?: string;
  runs: DecisionDayResponse; showLater: boolean;
}) {
  if (!active || !payload?.length || !label) return null;
  const val = (k: string) => payload.find((p) => p.dataKey === k)?.value ?? null;
  const a = val("actual");
  const f = val("forecast");
  return (
    <div className="tip">
      <p className="tip-time">{ukTime(label)}–{ukTime(new Date(new Date(label).getTime() + 30 * 60e3).toISOString())}</p>
      <p><span className="swatch swatch-actual" />Actual <b>{mw(a)}</b></p>
      <p><span className="swatch swatch-forecast" />Forecast <b>{mw(f)}</b></p>
      {a != null && f != null && (
        <p className={f - a > 0 ? "tone-short" : "tone-surplus"}>
          {f - a > 0 ? "Short by" : "Over by"} <b>{mw(Math.abs(f - a))}</b>
        </p>
      )}
      {runs.earlier_runs.map((r, i) => {
        const v = val(`e${i}`);
        return v == null ? null : (
          <p key={r.publish_time} className="tip-muted">Older forecast ({ukDateTime(r.publish_time)}) <b>{mw(v)}</b></p>
        );
      })}
      {showLater && runs.later_runs.length > 0 && (
        <p className="tip-muted">Last pre-delivery forecast: {mw(val(`l${runs.later_runs.length - 1}`))}</p>
      )}
    </div>
  );
}
