/**
 * Adding several doors / windows at once (owner 10/16/26: "There is no quantity
 * drop down available for the components ... you should add that" - Josh tried
 * two 10×10s on the front end). Spots are spread evenly along the wall and keep
 * the no-overlap rule (1′ from each corner and every other opening), the same
 * fitMainPos the drag and the cards use.
 */
import type { WebDesign, WebOpening, WebWall } from './design';
import { fitMainPos } from './positions';
import { GAP, rollupFits, wallLength } from './rules';

type D = Pick<WebDesign, 'type' | 'width' | 'length' | 'height' | 'enclosedLength' | 'openings'>;

/** Spots (typed positions) for `qty` new openings `w` wide on `wall`; null = they do not all fit. */
export function spreadPositions(d: D, wall: WebWall, w: number, qty: number): number[] | null {
  if (qty < 1) return [];
  const face = wallLength(d, wall);
  const place = (wants: (prev: number | null) => number, n: number): number[] | null => {
    const work: D = { ...d, openings: d.openings.slice() };
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const want = Math.max(0, wants(out.length ? out[out.length - 1] : null));
      const p = fitMainPos(work, wall, w, want, null);
      if (p === null) return null;
      out.push(p);
      work.openings.push({ id: `__new${k}`, kind: 'frame', wall, w, h: 1, sill: 0, pos: p } as WebOpening);
    }
    return out;
  };
  // 1) evenly along the wall
  let k = 0;
  const even = place(() => (face * ++k) / (qty + 1) - w / 2, qty);
  if (even) return even;
  // 2) packed from one end, each next to the last one
  return place((prev) => (prev === null ? 0 : prev + w + GAP), qty);
}

/** How many more of this part fit on that wall (roll-ups: also the door-height rule for 2+ doors on an end). */
export function maxQty(d: D, wall: WebWall, kind: WebOpening['kind'], w: number, h: number, cap = 12): number {
  const rollupsThere = d.openings.filter((o) => o.wall === wall && o.kind === 'rollup').length;
  let best = 0;
  for (let q = 1; q <= cap; q++) {
    if (kind === 'rollup' && !rollupFits(d, wall, w, h, rollupsThere + q)) break;
    if (!spreadPositions(d, wall, w, q)) break;
    best = q;
  }
  return best;
}
