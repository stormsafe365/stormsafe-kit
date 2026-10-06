/**
 * Text for the on-model dimension labels (placement guides and the Spacing
 * overlay). Pure functions, so vitest can lock them.
 *
 * ONE formatter for every printed dimension (owner 10/6/26: "still showing
 * 8' 11.75 instead of 9' ... we need to be dialed in on every quote, contract,
 * layout"): feet-inches to the nearest 1/8", the fraction as a glyph
 * (3'0¼", 5'2¼"), never decimals; exact values print clean (6'8", 4'2", 9').
 * The program (public/quote-builder.html _dimFtIn) uses the same rule.
 */

/** 1/8" fraction glyphs, index = eighths (0..7). */
export const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];

/** Feet → whole eighths of an inch (the one dimension grid: 1/8"). */
export function eighthsOf(ft: number): number {
  return Math.round(ft * 96 + 0) || 0;
}

/** Feet snapped to the 1/8" grid (feet). */
export function dimQ(ft: number): number {
  return eighthsOf(ft) / 96;
}

/** Feet (decimal) → feet-inches string to the nearest 1/8", e.g. 4.75 → 4'9", 3.0208 → 3'0¼". */
export function ftIn(ft: number): string {
  const e = eighthsOf(ft);
  const neg = e < 0;
  const a = Math.abs(e);
  const f = Math.floor(a / 96);
  const r = a - f * 96;
  const i = Math.floor(r / 8);
  const fr = EIGHTHS[r % 8];
  return (neg ? '−' : '') + (r ? `${f}'${i}${fr}"` : `${f}'`);
}

/** Feet → inches string to the nearest 1/8", e.g. 3.0208 → 36¼", 6.6667 → 80". */
export function inchLabel(ft: number): string {
  const e = eighthsOf(ft);
  const neg = e < 0;
  const a = Math.abs(e);
  return `${neg ? '−' : ''}${Math.floor(a / 8)}${EIGHTHS[a % 8]}"`;
}

/**
 * Roof length along a sidewall: the wall span plus the overhang past EACH end.
 * The overhang is structure.roofOverhangFt (0.5 standard, 1.0 when the quote
 * picks the 12" overhang). Never hardcode 0.5: a 50' wall is a 51' roof at 6"
 * and a 52' roof at 12".
 */
export function roofLengthFt(spanFt: number, overhangFt: number): number {
  return spanFt + 2 * overhangFt;
}

/** Spacing overlay roof-line label, e.g. "51' roof". */
export function roofLengthLabel(spanFt: number, overhangFt: number): string {
  return `${ftIn(roofLengthFt(spanFt, overhangFt))} roof`;
}
