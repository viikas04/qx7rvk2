import { useEffect, useMemo, useRef, useState } from "react";
import type { Run, SeriesPoint } from "../api/types";
import { mw, ukDateTime, ukTime } from "../lib/format";
import { errorColor, parseColor, rgb, type RGB } from "../lib/heat";

/**
 * Forecast-evolution grid, drawn on <canvas>.
 *
 * Rows    = every forecast run for the day (oldest at the top)
 * Columns = half-hour settlement periods of the delivery day
 * Colour  = that run's error against the actual outcome
 *
 * A dashed rule separates runs available at decision time from later ones,
 * and the run the desk actually used is outlined.
 */

interface Props {
  runs: Run[];
  series: SeriesPoint[];
  cutoff: string | null;
  selected: string | null;
}

const LABEL_W = 132;
const AXIS_H = 26;
const ROW_H = 18;
const SCALE_MW = 3000;

interface Hover { row: number; col: number; x: number; y: number }

export default function ForecastEvolution({ runs, series, cutoff, selected }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  const cols = useMemo(() => series.map((p) => p.t), [series]);
  const actualByT = useMemo(() => new Map(series.map((p) => [p.t, p.actual])), [series]);
  const grid = useMemo(
    () => runs.map((r) => {
      const byT = new Map(r.points.map((p) => [p.t, p.forecast]));
      return cols.map((t) => byT.get(t) ?? null);
    }),
    [runs, cols],
  );
  const cutRow = useMemo(
    () => (cutoff ? runs.filter((r) => r.publish_time <= cutoff).length : runs.length),
    [runs, cutoff],
  );
  const height = runs.length * ROW_H + AXIS_H;

  // Track container width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw when the colour scheme flips.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setThemeTick((n) => n + 1);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const narrow = width < 560;
  const labelW = narrow ? 64 : LABEL_W;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !cols.length) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name);
    const palette = {
      neutral: parseColor(v("--paper")),
      short: parseColor(v("--short")),
      surplus: parseColor(v("--surplus")),
    };
    const ink = v("--ink").trim();
    const ink2 = v("--ink-2").trim();
    const rule = v("--rule").trim();
    const font = getComputedStyle(document.body).fontFamily;

    ctx.clearRect(0, 0, width, height);
    const cellW = (width - labelW) / cols.length;

    // Cells
    grid.forEach((row, r) => {
      row.forEach((f, c) => {
        const a = actualByT.get(cols[c]);
        const x = labelW + c * cellW;
        const y = r * ROW_H;
        if (f == null || a == null) {
          ctx.fillStyle = rule;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x, y + 1, Math.ceil(cellW), ROW_H - 2);
          ctx.globalAlpha = 1;
          return;
        }
        const color: RGB = errorColor(f - a, SCALE_MW, palette);
        ctx.fillStyle = rgb(color);
        ctx.fillRect(x, y + 1, Math.ceil(cellW), ROW_H - 2);
      });
    });

    // Row labels
    ctx.font = `12px ${font}`;
    ctx.textBaseline = "middle";
    runs.forEach((run, r) => {
      ctx.fillStyle = run.publish_time === selected ? ink : ink2;
      ctx.font = `${run.publish_time === selected ? 600 : 400} 12px ${font}`;
      const label = narrow ? ukTime(run.publish_time) : ukDateTime(run.publish_time);
      ctx.fillText(label, 0, r * ROW_H + ROW_H / 2);
    });

    // Selected run outline
    const sel = runs.findIndex((r) => r.publish_time === selected);
    if (sel >= 0) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(labelW + 1, sel * ROW_H + 1, width - labelW - 2, ROW_H - 2);
    }

    // Decision rule
    if (cutRow > 0 && cutRow < runs.length) {
      const y = cutRow * ROW_H;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Time axis
    ctx.fillStyle = ink2;
    ctx.font = `12px ${font}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const every = narrow ? 12 : 6;
    cols.forEach((t, c) => {
      if (c % every) return;
      ctx.fillText(ukTime(t), labelW + c * cellW + cellW / 2, runs.length * ROW_H + 8);
    });
    ctx.textAlign = "left";
  }, [width, height, grid, cols, actualByT, runs, selected, cutRow, labelW, narrow, themeTick]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cellW = (width - labelW) / cols.length;
    const col = Math.floor((x - labelW) / cellW);
    const row = Math.floor(y / ROW_H);
    if (col < 0 || col >= cols.length || row < 0 || row >= runs.length) return setHover(null);
    setHover({ row, col, x, y });
  }

  const tip = hover && (() => {
    const run = runs[hover.row];
    const t = cols[hover.col];
    const f = grid[hover.row][hover.col];
    const a = actualByT.get(t) ?? null;
    return { run, t, f, a, late: hover.row >= cutRow };
  })();

  const summary = `${runs.length} forecast runs for this day, ${cutRow} published before the decision.`;

  return (
    <div className="evo">
      <div className="evo-legend" aria-hidden>
        <span>Forecast too low</span>
        <span className="evo-scale" />
        <span>Forecast too high</span>
        <span className="evo-key"><span className="evo-dash" />Decision moment</span>
        <span className="evo-key"><span className="evo-box" />Run the desk used</span>
      </div>
      <div ref={wrapRef} className="evo-canvas-wrap" onMouseLeave={() => setHover(null)}>
        <canvas ref={canvasRef} role="img" aria-label={summary} onMouseMove={onMove} />
        {tip && (
          <div className="tip evo-tip" style={{
            left: Math.min(hover!.x + 14, Math.max(width - 240, 0)),
            top: hover!.y + 14,
          }}>
            <p className="tip-time">{ukTime(tip.t)} on delivery day</p>
            <p className="tip-muted">Run published {ukDateTime(tip.run.publish_time)}{tip.late ? " (after the decision)" : ""}</p>
            <p>Forecast <b>{mw(tip.f)}</b></p>
            <p>Actual <b>{mw(tip.a)}</b></p>
            {tip.f != null && tip.a != null && (
              <p className={tip.f - tip.a > 0 ? "tone-short" : "tone-surplus"}>
                {tip.f - tip.a > 0 ? "Too high by" : "Too low by"} <b>{mw(Math.abs(tip.f - tip.a))}</b>
              </p>
            )}
          </div>
        )}
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  );
}
