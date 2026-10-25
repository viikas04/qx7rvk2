/** Linear-interpolated quantile of an ascending-sorted array (same rule as numpy's default). */
export function quantileSorted(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface ReservePlan {
  reserveMw: number;
  shortPeriods: number;
  totalPeriods: number;
  worstUncoveredMw: number;
}

/**
 * Backup needed so that (forecast - actual) <= backup in `cover` share of periods.
 * `errors` are forecast - actual in MW, sorted ascending.
 */
export function planReserve(errorsSorted: number[], cover: number): ReservePlan | null {
  const q = quantileSorted(errorsSorted, cover);
  if (q == null) return null;
  const reserveMw = Math.max(q, 0);
  let shortPeriods = 0;
  let worst = 0;
  for (const e of errorsSorted) {
    if (e > reserveMw) {
      shortPeriods += 1;
      worst = Math.max(worst, e - reserveMw);
    }
  }
  return { reserveMw, shortPeriods, totalPeriods: errorsSorted.length, worstUncoveredMw: worst };
}
