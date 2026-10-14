/**
 * KNEE BRACES (leg-to-rafter "corner / leg braces") sized by the MANUFACTURER —
 * DRAWING ONLY (owner 10/14/26; the quote never prices a brace, the frame
 * price includes them). Replaces the old generic min(3', 0.45·H) drop.
 *
 * Sources:
 *  CCI — Dealer Handbook p.30 "Corner/Leg Braces and Peak Braces":
 *    For non-certified units up to 7' tall: 12'-18' wide = 2' corner-leg
 *    braces, 20' = 2', 22'-24' = 4'. 26'-60' wide in all states = 4' braces on
 *    8'+ structures; "Braces are included on certified carports 8' or taller".
 *    Units with a gable end or an end enclosed: no corner braces on those end
 *    legs.
 *    The handbook gives NO length for a certified (or taller) unit 24' wide
 *    or less; StormSafe sells certified FL buildings, so we keep the closest
 *    documented rule: over 7' tall = 4' (the 8'+ rule, also the 22'-24'
 *    figure), up to 7' tall = the table above. Every bent is braced (the
 *    certified-carport sentence), not only the four corner legs of the
 *    non-certified table.
 *  CA  — engineering sheet CA-2 (FL generic enclosed set): knee brace minimum
 *    24" on posts up to 7', minimum 48" on posts over 7', 45°-60° from
 *    horizontal, EXCLUDE END-WALLS.
 *  Unset manufacturer follows CA (as legStyleFor / trussStyleFor do).
 *
 * Geometry: `lengthFt` IS the member length, drawn at 45° from horizontal
 * (both sources allow / imply it): it springs from the leg and lands on the
 * rafter `reach` = L/√2 in from the leg. Ladder legs keep no brace (unchanged).
 */
export function kneeBraceFt(mfr: 'CCI' | 'CA' | undefined, widthFt: number, legHeightFt: number): number {
  if (mfr === 'CCI') {
    if (legHeightFt > 7) return 4;
    return widthFt >= 22 ? 4 : 2;
  }
  return legHeightFt > 7 ? 4 : 2;
}

/** A drawn knee brace in its bent: foot on the leg, tip on the rafter (world X / Y). */
export interface KneeBraceGeom {
  /** Member length as drawn (ft) — shorter than the rule only when a truss chord stops it. */
  lengthFt: number;
  /** The manufacturer rule's length (ft). */
  ruleFt: number;
  /** Horizontal reach from the leg centreline to the tip (ft). */
  reachFt: number;
  /** Height of the brace foot on the leg = the clear height at the wall under the brace (ft). */
  footY: number;
  /** Height of the tip on the rafter (ft). */
  tipY: number;
  /** How far below the eave (the rafter at the leg) the foot is (ft). */
  dropFt: number;
}

/**
 * The 45° brace of length `L` at eave side `sx` (world X of the leg), its tip
 * on the rafter line `roofAt` `L/√2` inboard (`inb` = ±1 toward the middle).
 */
export function kneeBrace45(L: number, sx: number, inb: number, roofAt: (x: number) => number): { foot: [number, number]; tip: [number, number] } {
  const r = L / Math.SQRT2;
  const tx = sx + inb * r;
  const ty = roofAt(tx);
  return { foot: [sx, ty - r], tip: [tx, ty] };
}
