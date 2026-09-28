/**
 * Text for the on-model dimension labels (placement guides and the Spacing
 * overlay). Pure functions, so vitest can lock them.
 */

/** Feet (decimal) → feet-inches string, e.g. 4.75 → 4'9". */
export function ftIn(ft: number): string {
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return i ? `${f}'${i}"` : `${f}'`;
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
