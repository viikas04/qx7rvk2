import { useMemo, useState } from "react";
import {
  Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type AnalysisParams } from "../api/client";
import { useAnalysis, useHorizonCurve } from "../api/hooks";
import type { LevelStat, Meta, Mode } from "../api/types";
import { planReserve, type ReservePlan } from "../lib/stats";
import { DayPicker, ErrorNote, Legend, Loading, Panel, Stat, StatStrip } from "../components/ui";
import {
  gw, HALF_HOURS, hours, mw, pct, shortDay, signedMw, ukDateTime, ukDay, ukTime,
} from "../lib/format";

interface Props {
  meta: Meta;
  params: AnalysisParams;
  onChange: (patch: Partial<{ start: string; end: string; mode: Mode; dt: string; h: string; view: string; day: string }>) => void;
}

const axis = { tick: { fill: "var(--ink-2)", fontSize: 12 }, stroke: "var(--rule)" } as const;
const HORIZONS = [1, 2, 4, 6, 8, 12, 16, 20, 24, 30, 36, 42, 48];

export default function Accuracy({ meta, params, onChange }: Props) {
  const q = useAnalysis(params);
  const hq = useHorizonCurve(params.start, params.end);
  const d = q.data;
  const s = d?.summary;

  const [cover, setCover] = useState(90);
  const errorsSorted = useMemo(
    () =>
      (d?.series ?? [])
        .filter((p) => p.forecast != null && p.actual != null)
        .map((p) => p.forecast! - p.actual!)
        .sort((x, y) => x - y),
    [d],
  );
  const plan = useMemo(() => planReserve(errorsSorted, cover / 100), [errorsSorted, cover]);
  const reserve = plan?.reserveMw ?? 0;
  const series = useMemo(
    () =>
      d?.series.map((p) => ({
        ...p,
        plan: p.forecast != null ? Math.max(p.forecast - reserve, 0) : null,
      })) ?? [],
    [d, reserve],
  );

  return (
    <div className="view">
      <div className="lede">
        <p className="lede-sentence">
          Score the forecast the desk would have used{" "}
          <span className="segmented" role="radiogroup" aria-label="Decision rule">
            <button role="radio" aria-checked={params.mode === "day_ahead"}
              onClick={() => onChange({ mode: "day_ahead" })}>the day before</button>
            <button role="radio" aria-checked={params.mode === "horizon"}
              onClick={() => onChange({ mode: "horizon" })}>a fixed time ahead</button>
          </span>{" "}
          {params.mode === "day_ahead" ? (
            <>
              at{" "}
              <select className="inline-select" aria-label="Decision time (UK)" value={params.decisionTime}
                onChange={(e) => onChange({ dt: e.target.value })}>
                {HALF_HOURS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </>
          ) : (
            <>
              of{" "}
              <select className="inline-select" aria-label="Forecast lead time" value={params.horizonHours}
                onChange={(e) => onChange({ h: e.target.value })}>
                {HORIZONS.map((h) => <option key={h} value={h}>{h} h</option>)}
              </select>
            </>
          )}
          , for deliveries from{" "}
          <DayPicker label="First delivery day" value={params.start} min={meta.delivery_first_day}
            max={params.end} format={shortDay} onChange={(v) => onChange({ start: v })} />{" "}
          to{" "}
          <DayPicker label="Last delivery day" value={params.end} min={params.start}
            max={meta.delivery_last_day} format={shortDay} onChange={(v) => onChange({ end: v })} />.
        </p>
        {s && (
          <ReservePlanner cover={cover} setCover={setCover} plan={plan} />
        )}
      </div>

      {q.isError ? <ErrorNote error={q.error} onRetry={() => q.refetch()} /> : !d || !s ? <Loading /> : (
        <>
          <StatStrip busy={q.isFetching}>
            <Stat label="Typical miss (MAE)" value={mw(s.mae_mw)}
              note={`${pct(s.wape_pct)} of wind delivered`} />
            <Stat label="Large-miss error (RMSE)" value={mw(s.rmse_mw)} note="Weights big misses more" />
            <Stat label="Bias" value={signedMw(s.bias_mw)} tone={!s.bias_mw ? undefined : s.bias_mw > 0 ? "short" : "surplus"}
              note={s.bias_mw && s.bias_mw > 0 ? "Forecast tends to run high" : "Forecast tends to run low"} />
            <Stat label="Within 1 GW" value={pct(s.within_1gw_pct, 0)} note="Share of half hours" />
            <Stat label="Coverage" value={pct(s.coverage_pct)}
              note={`${s.paired_periods.toLocaleString("en-GB")} of ${s.periods.toLocaleString("en-GB")} half hours, average lead ${hours(s.mean_lead_h)}`} />
          </StatStrip>

          <Panel wide title="Forecast against actual"
            note="Drag the handles under the chart to zoom into any stretch of days."
            actions={<a className="btn" href={api.csvUrl(params)} download>Download CSV</a>}>
            <Legend items={[
              { label: "Actual generation", kind: "actual" },
              { label: "Forecast available at decision time", kind: "forecast" },
              { label: `Planning level: forecast minus ${mw(reserve)} backup`, kind: "plan" },
            ]} />
            <div className="chart chart-tall">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="var(--rule)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={ukDay} minTickGap={48} {...axis} />
                  <YAxis tickFormatter={(v) => gw(v)} width={72} {...axis} />
                  <Tooltip content={<SeriesTip />} />
                  <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  <Line dataKey="plan" stroke="var(--ink-2)" strokeWidth={1.25} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="actual" stroke="var(--actual)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Brush dataKey="t" height={28} stroke="var(--ink-2)" fill="var(--paper)" travellerWidth={10}
                    tickFormatter={ukDay} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <LevelPanel levels={d.by_level} />

          <div className="grid">
            <Panel title="Error grows with lead time"
              note="Typical and 1-in-10 miss when the forecast is taken a fixed number of hours ahead.">
              {hq.isError ? <ErrorNote error={hq.error} /> : !hq.data ? <Loading /> : (
                <>
                  <Legend items={[{ label: "Typical miss (MAE)", kind: "forecast" }, { label: "1-in-10 miss (P90)", kind: "short" }]} />
                  <div className="chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={hq.data.points.filter((pt) => (pt.coverage_pct ?? 0) >= 90)} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                        <CartesianGrid stroke="var(--rule)" vertical={false} />
                        <XAxis dataKey="horizon_h" type="number" domain={[0, 48]} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]}
                          tickFormatter={(v) => `${v}h`} {...axis} />
                        <YAxis tickFormatter={(v) => gw(v)} width={72} {...axis} />
                        <Tooltip formatter={(v) => mw(v as number)} labelFormatter={(v) => `${v} h ahead`}
                          contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)" }} />
                        {s.mean_lead_h != null && (
                          <ReferenceLine x={s.mean_lead_h} stroke="var(--ink-2)" strokeDasharray="3 3"
                            label={{ value: "Your rule", position: "insideTopRight", fill: "var(--ink-2)", fontSize: 12 }} />
                        )}
                        <Line dataKey="mae_mw" name="Typical miss" stroke="var(--forecast)" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
                        <Line dataKey="p90_abs_error_mw" name="1-in-10 miss" stroke="var(--short)" strokeWidth={1.75} dot={{ r: 2 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </Panel>

            <Panel title="How big the misses are"
              note="Share of half hours by error. Red bars: wind came in below forecast and the desk was short.">
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.histogram} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap={1}>
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="from_mw" tickFormatter={(v) => gw(v)} minTickGap={24} {...axis} />
                    <YAxis tickFormatter={(v) => `${v}%`} width={44} {...axis} />
                    <Tooltip cursor={{ fill: "var(--rule)", opacity: 0.4 }}
                      formatter={(v) => `${(v as number).toFixed(1)}% of half hours`}
                      labelFormatter={(v, items) => `Forecast − actual: ${signedMw(v as number)} to ${signedMw(items?.[0]?.payload?.to_mw ?? null)}`}
                      contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)" }} />
                    <Bar dataKey="pct" isAnimationActive={false}>
                      {d.histogram.map((b) => (
                        <Cell key={b.from_mw} fill={b.from_mw >= 0 ? "var(--short)" : "var(--surplus)"} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="When in the day it misses" note="Typical miss by hour of delivery (UK time), with bias as a line.">
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.by_hour} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} interval={2} {...axis} />
                    <YAxis tickFormatter={(v) => gw(v)} width={72} {...axis} />
                    <Tooltip formatter={(v, n) => [n === "Bias" ? signedMw(v as number) : mw(v as number), n]}
                      labelFormatter={(h) => `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`}
                      contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)" }} />
                    <ReferenceLine y={0} stroke="var(--ink-2)" />
                    <Bar dataKey="mae_mw" name="Typical miss" fill="var(--forecast)" fillOpacity={0.7} isAnimationActive={false} />
                    <Line dataKey="bias_mw" name="Bias" stroke="var(--actual)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Day by day" note="Typical miss for each delivery day. Click a bar to open that day.">
              <div className="chart chart-clickable">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.daily} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDay} minTickGap={30} {...axis} />
                    <YAxis tickFormatter={(v) => gw(v)} width={72} {...axis} />
                    <Tooltip formatter={(v) => mw(v as number)} labelFormatter={(v) => shortDay(v as string)}
                      cursor={{ fill: "var(--rule)", opacity: 0.4 }}
                      contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)" }} />
                    <Bar dataKey="mae_mw" name="Typical miss" fill="var(--actual)" fillOpacity={0.75} isAnimationActive={false}
                      onClick={(bar) => {
                        const day = (bar as { payload?: { date?: string } }).payload?.date;
                        if (day) onChange({ view: "day", day });
                      }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function SeriesTip({ active, payload, label }: {
  active?: boolean; label?: string;
  payload?: { dataKey: string; value: number | null; payload: { publish_time: string | null; lead_h: number | null } }[];
}) {
  if (!active || !payload?.length || !label) return null;
  const a = payload.find((p) => p.dataKey === "actual")?.value ?? null;
  const f = payload.find((p) => p.dataKey === "forecast")?.value ?? null;
  const meta = payload[0].payload;
  return (
    <div className="tip">
      <p className="tip-time">{ukDay(label)}, {ukTime(label)}</p>
      <p><span className="swatch swatch-actual" />Actual <b>{mw(a)}</b></p>
      <p><span className="swatch swatch-forecast" />Forecast <b>{mw(f)}</b></p>
      {a != null && f != null && (
        <p className={f - a > 0 ? "tone-short" : "tone-surplus"}>{f - a > 0 ? "Short by" : "Over by"} <b>{mw(Math.abs(f - a))}</b></p>
      )}
      {meta.publish_time && <p className="tip-muted">Forecast from {ukDateTime(meta.publish_time)} ({hours(meta.lead_h)} ahead)</p>}
    </div>
  );
}

function LevelPanel({ levels }: { levels: LevelStat[] }) {
  const rows = levels.filter((l) => l.n >= 10);
  const worst = rows.reduce<LevelStat | null>(
    (best, l) => (l.bias_mw != null && (best?.bias_mw == null || l.bias_mw > best.bias_mw) ? l : best),
    null,
  );
  const calmest = rows.reduce<LevelStat | null>(
    (best, l) => (l.mae_mw != null && (best?.mae_mw == null || l.mae_mw < best.mae_mw) ? l : best),
    null,
  );
  const label = (l: LevelStat) => `${gw(l.from_mw)}–${gw(l.to_mw)}`.replace(" GW–", "–");
  return (
    <Panel wide title="Misses by how much wind was forecast"
      note={worst && calmest ? (
        <>Average forecast and actual wind for each forecast level. The forecast ran furthest above reality when{" "}
          {label(worst)} was forecast (by {mw(worst.bias_mw)} on average), and was closest at {label(calmest)}.</>
      ) : "Average forecast and actual wind for each forecast level."}>
      <Legend items={[{ label: "Average forecast", kind: "forecast" }, { label: "Average actual", kind: "actual" }]} />
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barGap={2}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="from_mw" tickFormatter={(v) => label(rows.find((r) => r.from_mw === v)!)} {...axis} />
            <YAxis tickFormatter={(v) => gw(v)} width={72} {...axis} />
            <Tooltip content={<LevelTip />} cursor={{ fill: "var(--rule)", opacity: 0.4 }} />
            <Bar dataKey="mean_forecast_mw" name="Average forecast" fill="var(--forecast)" isAnimationActive={false} />
            <Bar dataKey="mean_actual_mw" name="Average actual" fill="var(--actual)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function LevelTip({ active, payload }: { active?: boolean; payload?: { payload: LevelStat }[] }) {
  if (!active || !payload?.length) return null;
  const l = payload[0].payload;
  return (
    <div className="tip">
      <p className="tip-time">Forecast {gw(l.from_mw)} to {gw(l.to_mw)}</p>
      <p><span className="swatch swatch-forecast" />Average forecast <b>{mw(l.mean_forecast_mw)}</b></p>
      <p><span className="swatch swatch-actual" />Average actual <b>{mw(l.mean_actual_mw)}</b></p>
      <p>Typical miss <b>{mw(l.mae_mw)}</b></p>
      <p className="tip-muted">{pct(l.share_pct)} of half hours ({l.n})</p>
    </div>
  );
}

function ReservePlanner({ cover, setCover, plan }: {
  cover: number; setCover: (v: number) => void; plan: ReservePlan | null;
}) {
  return (
    <div className="planner">
      <p className="lede-answer" aria-live="polite">
        To be covered in <strong>{cover}%</strong> of half hours, hold{" "}
        <strong>{plan ? mw(plan.reserveMw) : "–"}</strong> of backup above the forecast.
        {plan && (
          <> Over this period that would have left the desk short in {plan.shortPeriods.toLocaleString("en-GB")} of{" "}
            {plan.totalPeriods.toLocaleString("en-GB")} half hours, by at most {mw(plan.worstUncoveredMw)}.</>
        )}
      </p>
      <label className="planner-slider">
        <span>Cover</span>
        <input type="range" min={50} max={99} step={1} value={cover}
          aria-label="Share of half hours to cover"
          onChange={(e) => setCover(Number(e.target.value))} />
        <span className="planner-scale" aria-hidden><span>50%</span><span>99%</span></span>
      </label>
    </div>
  );
}
