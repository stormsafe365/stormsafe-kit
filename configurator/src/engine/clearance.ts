// CCI interior CENTER clearance (Dealer Handbook p7 "Center Clearance" chart —
// "These heights are to the center braces in the carports. All figures are
// approximate."), in inches ABOVE the leg height. Regular vs Boxed Eave/Vertical
// differ. 12' and 18'-30' wide only (the chart has no 14'/16' rows and no wide
// spans — nothing is shown for those rather than guessing). Same numbers as the
// pricing program's CCI_CLEAR (quote-builder.html), which prints them on the
// spacing sheet.
export const CCI_CENTER_CLEAR_IN: Record<'Regular' | 'Boxed', Record<number, number>> = {
  Regular: { 12: 27, 18: 33, 20: 32, 22: 32, 24: 37, 26: 29, 28: 28, 30: 28 },
  Boxed: { 12: 19, 18: 32, 20: 30, 22: 29, 24: 31, 26: 15, 28: 14, 30: 14 },
};

/** Height (ft, from the slab) to the underside of the center braces, or null when not charted / not CCI. */
export function cciCenterClearanceFt(
  mfr: 'CCI' | 'CA' | undefined,
  roofStyle: 'Regular' | 'Boxed Eave' | 'Vertical' | undefined,
  widthFt: number,
  legHeightFt: number,
): number | null {
  if (mfr !== 'CCI') return null;
  const t = CCI_CENTER_CLEAR_IN[roofStyle === 'Regular' ? 'Regular' : 'Boxed'];
  const inches = t[Math.round(widthFt)];
  return inches == null ? null : legHeightFt + inches / 12;
}
