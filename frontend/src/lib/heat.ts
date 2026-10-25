/** Colour helpers for the forecast-evolution grid (pure, unit-tested). */

export type RGB = [number, number, number];

export function parseColor(css: string): RGB {
  const c = css.trim();
  const hex = c.startsWith("#") ? c.slice(1) : null;
  if (hex && (hex.length === 6 || hex.length === 3)) {
    const full = hex.length === 3 ? hex.split("").map((h) => h + h).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
  }
  const m = c.match(/\d+(\.\d+)?/g);
  if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
  return [128, 128, 128];
}

export const mix = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

export const rgb = ([r, g, b]: RGB) => `rgb(${r}, ${g}, ${b})`;

/**
 * Error (forecast - actual, MW) -> colour. Positive (desk short) blends toward
 * `short`, negative toward `surplus`; |error| >= scale is full strength.
 * A square-root curve keeps small errors visible.
 */
export function errorColor(
  error: number,
  scale: number,
  palette: { neutral: RGB; short: RGB; surplus: RGB },
): RGB {
  const t = Math.min(Math.abs(error) / scale, 1);
  const eased = Math.sqrt(t);
  return mix(palette.neutral, error >= 0 ? palette.short : palette.surplus, eased);
}
