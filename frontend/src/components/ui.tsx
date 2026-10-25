import type { ReactNode } from "react";
import { ApiError } from "../api/client";

export function Stat({ label, value, note, tone }: {
  label: string; value: string; note?: string; tone?: "short" | "surplus";
}) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className={tone ? `tone-${tone}` : undefined}>{value}</dd>
      {note && <p className="stat-note">{note}</p>}
    </div>
  );
}

export function StatStrip({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return <dl className="stats" aria-busy={busy}>{children}</dl>;
}

export function Panel({ title, note, children, wide, actions }: {
  title: string; note?: ReactNode; children: ReactNode; wide?: boolean; actions?: ReactNode;
}) {
  return (
    <section className={`panel${wide ? " panel-wide" : ""}`}>
      <header className="panel-head">
        <div>
          <h3>{title}</h3>
          {note && <p className="panel-note">{note}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; kind: string }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}><span className={`swatch swatch-${i.kind}`} aria-hidden />{i.label}</li>
      ))}
    </ul>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="error" role="alert">
      <p><strong>Couldn't load this view.</strong> {msg}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Loading({ label = "Loading data" }: { label?: string }) {
  return <div className="loading" role="status"><span className="pulse" aria-hidden />{label}…</div>;
}

/** A date input that reads as text in the sentence ("Thu 15 Jan") but opens the native picker. */
export function DayPicker({ value, min, max, label, onChange, format }: {
  value: string; min: string; max: string; label: string;
  onChange: (v: string) => void; format: (v: string) => string;
}) {
  return (
    <span className="day-pick">
      <span className="day-pick-text" aria-hidden>{format(value)}</span>
      <input type="date" aria-label={label} value={value} min={min} max={max}
        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } }}
        onChange={(e) => e.target.value && onChange(e.target.value)} />
    </span>
  );
}
