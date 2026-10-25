const UK = "Europe/London";

const n0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export const mw = (v: number | null | undefined) => (v == null ? "–" : `${n0.format(v)} MW`);
export const gw = (v: number | null | undefined) => (v == null ? "–" : `${n1.format(v / 1000)} GW`);
export const gwh = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${n1.format(mwh / 1000)} GWh`;
export const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? "–" : `${v.toFixed(digits)}%`;
export const signedMw = (v: number | null | undefined) =>
  v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${n0.format(Math.abs(v))} MW`;
export const hours = (v: number | null | undefined) =>
  v == null ? "–" : `${n1.format(v)} h`;

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: UK, ...opts });

const timeF = fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayF = fmt({ weekday: "short", day: "numeric", month: "short" });
const longDayF = fmt({ weekday: "long", day: "numeric", month: "long" });
const dateTimeF = fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "14:30" in UK local time */
export const ukTime = (iso: string) => timeF.format(new Date(iso));
/** "Thu 15 Jan" */
export const ukDay = (iso: string) => dayF.format(new Date(iso));
/** "Thursday 15 January" for a YYYY-MM-DD delivery day */
export const longDay = (ymd: string) => longDayF.format(new Date(`${ymd}T12:00:00Z`));
export const shortDay = (ymd: string) => dayF.format(new Date(`${ymd}T12:00:00Z`));
/** "Wed 14 Jan, 08:30" */
export const ukDateTime = (iso: string) => dateTimeF.format(new Date(iso));

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const clampDay = (ymd: string, lo: string, hi: string) =>
  ymd < lo ? lo : ymd > hi ? hi : ymd;

/** Half-hour options for the decision-time picker: "00:00" .. "23:30". */
export const HALF_HOURS = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

/** "2–4 GW" for a range given in MW. */
export const gwRange = (fromMw: number, toMw: number) =>
  `${n1.format(fromMw / 1000)}–${n1.format(toMw / 1000)} GW`;
