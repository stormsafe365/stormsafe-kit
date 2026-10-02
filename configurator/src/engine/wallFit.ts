import { OPENING_CORNER_CLEAR_FT as CLR, OPENING_EPS_FT as EPS, OPENING_GAP_FT as GAP } from '@/config/constants';

/**
 * No-overlap rule in the 3D (owner 10/2/26: "Components & framed openings cant
 * overlap so our program shouldn't even allow them to overlap"). The pricing
 * program owns the rule and the layout (quote-builder.html ovlModel: 1' clear of
 * each corner post, 1' between openings — its LT_PART_* numbers); the 3D draws
 * the spots it computes. Here the 3D only REFUSES to drag an opening into a spot
 * that breaks the rule, on any wall (main gable / eave / partition, lean-to
 * outer / end walls). The lean-to storage partition keeps its own stricter
 * clamp (partitionFit.ts — it adds the sloped-header rule).
 *
 * Offsets are opening CENTRES along the wall, measured from the wall's start
 * (the store's frame); `len` is the wall's length.
 */
export interface WallSpan {
  /** Centre of the opening along the wall (ft). */
  offset: number;
  /** Opening width (ft). */
  width: number;
}

/** Does an opening `width` wide centred at `center` keep 1' from the corners and every sibling? */
export function wallSpotOk(center: number, width: number, len: number, siblings: WallSpan[]): boolean {
  const x = center - width / 2;
  if (x < CLR - EPS || x + width > len - CLR + EPS) return false;
  for (const s of siblings) {
    if (!(s.width > 0)) continue;
    const sL = s.offset - s.width / 2;
    const sR = s.offset + s.width / 2;
    if (x + width > sL - GAP + EPS && x < sR + GAP - EPS) return false;
  }
  return true;
}

/**
 * Where a DRAGGED opening may go: the valid spot nearest the pointer
 * (`rawCenter`), its left edge on a whole inch (the program stores a drag as the
 * nearest-inch left edge, so the stored spot is valid too). No valid spot on the
 * wall -> stays at `currentCenter` (nothing moves, nothing is written back).
 */
export function clampWallCenter(rawCenter: number, width: number, len: number, siblings: WallSpan[], currentCenter: number): number {
  const w = width;
  // Allowed LEFT-EDGE intervals: the corner posts first, then 1' from each sibling.
  let ivs: Array<[number, number]> = [];
  const lo = CLR - EPS;
  const hi = len - CLR - w + EPS;
  if (hi >= lo - 1e-9) ivs.push([lo, hi]);
  for (const s of siblings) {
    if (!(s.width > 0)) continue;
    const a = s.offset - s.width / 2 - GAP - w + EPS; // our right edge stays <= sibling left - GAP
    const b = s.offset + s.width / 2 + GAP - EPS; // or our left edge >= sibling right + GAP
    const next: Array<[number, number]> = [];
    for (const [p, q] of ivs) {
      if (q <= a || p >= b) next.push([p, q]);
      else {
        if (p <= a) next.push([p, a]);
        if (q >= b) next.push([b, q]);
      }
    }
    ivs = next;
  }
  // Whole inches, rounded INTO each interval.
  const snapped = ivs
    .map(([p, q]) => [Math.ceil(p * 12 - 1e-6) / 12, Math.floor(q * 12 + 1e-6) / 12] as [number, number])
    .filter(([p, q]) => q >= p - 1e-9);
  if (!snapped.length) return currentCenter;
  const rawX = rawCenter - w / 2;
  const want = Math.round(rawX * 12) / 12;
  let best = snapped[0][0];
  let bestD = Infinity;
  for (const [p, q] of snapped) {
    const x = Math.max(p, Math.min(q, want));
    const d = Math.abs(x - rawX);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = x;
    }
  }
  return best + w / 2;
}
