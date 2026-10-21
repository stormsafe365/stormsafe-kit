/**
 * V2 (round 2, owner 10/20/26): "How many" for doors / windows on a LEAN-TO wall, the lean-to twin of
 * addMany.ts. The maximum is how many really fit with the page's own no-overlap rule for lean-to walls
 * (positions.fitLeanToPos -> engine/wallFit: 1′ from each corner = OPENING_CORNER_CLEAR_FT, 1′ between
 * openings = OPENING_GAP_FT), never past the page's 12 doors / windows per lean-to (MAX_LEANTO_OPENINGS).
 * Spots are spread evenly along the wall, like the main walls.
 */
import type { LeanToWall, WebDesign, WebLeanTo, WebLeanToOpening } from './design';
import { MAX_LEANTO_OPENINGS } from './normalize';
import { fitLeanToPos, q8 } from './positions';
import { CORNER_CLEAR, GAP, leanToWallLength } from './rules';

type D = Pick<WebDesign, 'width' | 'length'>;

function placeAll(d: D, lt: WebLeanTo, wall: LeanToWall, w: number, wants: Array<(prev: number | null) => number>): number[] | null {
  const work: WebLeanTo = { ...lt, openings: lt.openings.slice() };
  const out: number[] = [];
  for (let k = 0; k < wants.length; k++) {
    const want = Math.max(0, wants[k](out.length ? out[out.length - 1] : null));
    const p = fitLeanToPos(d, work, wall, w, want, null);
    if (p === null) return null;
    out.push(p);
    work.openings.push({ id: `__new${k}`, kind: 'frame', wall, w, h: 1, sill: 0, pos: p } as WebLeanToOpening);
  }
  return out;
}

/** Spots (offset from the left end of the lean-to wall) for `qty` new openings `w` wide; null = they do not all fit. */
export function spreadLeanTo(d: D, lt: WebLeanTo, wall: LeanToWall, w: number, qty: number): number[] | null {
  if (qty < 1) return [];
  const len = leanToWallLength(d, lt, wall);
  const empty = !lt.openings.some((o) => o.wall === wall);
  if (empty) {
    const gap = (len - qty * w) / (qty + 1);
    if (gap >= Math.max(CORNER_CLEAR, GAP) - 1e-9) {
      const even = placeAll(d, lt, wall, w, Array.from({ length: qty }, (_, k) => () => q8(gap + k * (w + gap))));
      if (even) return even;
    }
  }
  let k = 0;
  const nudged = placeAll(d, lt, wall, w, Array.from({ length: qty }, () => () => (len * ++k) / (qty + 1) - w / 2));
  if (nudged) return nudged;
  return placeAll(d, lt, wall, w, Array.from({ length: qty }, () => (prev: number | null) => (prev === null ? 0 : prev + w + GAP)));
}

/** How many more `w` wide fit on that lean-to wall (0 = none), within the page's per-lean-to limit. */
export function maxLeanToQty(d: D, lt: WebLeanTo, wall: LeanToWall, w: number): number {
  const limit = MAX_LEANTO_OPENINGS - lt.openings.length;
  let best = 0;
  for (let q = 1; q <= limit; q++) {
    if (!spreadLeanTo(d, lt, wall, w, q)) break;
    best = q;
  }
  return best;
}
