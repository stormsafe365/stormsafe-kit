/**
 * Adding several doors / windows at once (owner 10/16/26: "There is no quantity
 * drop down available for the components ... you should add that" - Josh tried
 * two 10×10s on the front end). Spots are spread evenly along the wall and keep
 * the no-overlap rule (1′ from each corner and every other opening), checked
 * with the same fitMainPos the drag and the cards use.
 */
import type { WebDesign, WebOpening, WebWall } from './design';
import { MAX_OPENINGS } from './normalize';
import { fitMainPos, q8 } from './positions';
import { comboBlockedFromFront, CORNER_CLEAR, GAP, rollupFits, wallLength } from './rules';

type D = Pick<WebDesign, 'type' | 'width' | 'length' | 'height' | 'enclosedLength' | 'openings'>;

/** Place `wants` one after another (each checked against the ones before); null = one does not fit. */
function placeAll(d: D, wall: WebWall, w: number, wants: Array<(prev: number | null) => number>): number[] | null {
  const work: D = { ...d, openings: d.openings.slice() };
  const out: number[] = [];
  for (let k = 0; k < wants.length; k++) {
    const want = Math.max(0, wants[k](out.length ? out[out.length - 1] : null));
    const p = fitMainPos(work, wall, w, want, null);
    if (p === null) return null;
    out.push(p);
    work.openings.push({ id: `__new${k}`, kind: 'frame', wall, w, h: 1, sill: 0, pos: p } as WebOpening);
  }
  return out;
}

/** Spots (typed positions) for `qty` new openings `w` wide on `wall`; null = they do not all fit. */
export function spreadPositions(d: D, wall: WebWall, w: number, qty: number): number[] | null {
  if (qty < 1) return [];
  const face = wallLength(d, wall);
  const empty = !d.openings.some((o) => o.wall === wall);
  if (empty) {
    // An empty wall: equal gaps between the doors and at both ends (from the divider post on a
    // Garage + Carport side), at least the 1′ corner / opening clearance.
    const start = comboBlockedFromFront(d, wall) ?? 0;
    const gap = (face - start - qty * w) / (qty + 1);
    if (gap >= Math.max(CORNER_CLEAR, GAP) - 1e-9) {
      const even = placeAll(d, wall, w, Array.from({ length: qty }, (_, k) => () => q8(start + gap + k * (w + gap))));
      if (even) return even;
    }
  }
  // Doors already there (or a tight wall): even targets, nudged clear of the others ...
  let k = 0;
  const nudged = placeAll(d, wall, w, Array.from({ length: qty }, () => () => (face * ++k) / (qty + 1) - w / 2));
  if (nudged) return nudged;
  // ... else packed from one end, each next to the last one.
  return placeAll(d, wall, w, Array.from({ length: qty }, () => (prev: number | null) => (prev === null ? 0 : prev + w + GAP)));
}

/**
 * Adding more of a part to a wall that has ONLY that same part (same kind, same width) - e.g. one
 * 10′ door sitting in the middle of the front end, then "Add" again (owner's mom 10/16/26 got "no
 * room" although two fit): all of them are spread evenly again. The ids already there (left to
 * right) take the first spots, the new ones the rest. null = they do not all fit, or something else
 * is on that wall (those are never moved by an add).
 */
export function respaceWithSame(d: D, wall: WebWall, kind: WebOpening['kind'], w: number, qty: number): { existing: string[]; spots: number[] } | null {
  const onWall = d.openings.filter((o) => o.wall === wall);
  if (!onWall.length || qty < 1) return null;
  if (!onWall.every((o) => o.kind === kind && Math.abs(o.w - w) < 1e-6)) return null;
  const spots = spreadPositions({ ...d, openings: d.openings.filter((o) => o.wall !== wall) }, wall, w, onWall.length + qty);
  if (!spots) return null;
  return { existing: [...onWall].sort((a, b) => a.pos - b.pos).map((o) => o.id), spots };
}

/** They fit: in the free room left, or by spreading them out with the same parts already there. */
const fitsSomehow = (d: D, wall: WebWall, kind: WebOpening['kind'], w: number, q: number) =>
  spreadPositions(d, wall, w, q) !== null || respaceWithSame(d, wall, kind, w, q) !== null;

/**
 * How many more of this part fit on that wall. Roll-ups also keep the program's
 * height rule (2+ doors on an end wall: at most H − 1) for the NEW doors AND the
 * ones already there - a count that would shrink a door already on the wall is
 * not offered (see whyNoMore). Never past the page's 40 doors / windows.
 */
export function maxQty(d: D, wall: WebWall, kind: WebOpening['kind'], w: number, h: number, cap = 12): number {
  const there = d.openings.filter((o) => o.wall === wall && o.kind === 'rollup');
  const limit = Math.min(cap, MAX_OPENINGS - d.openings.length);
  let best = 0;
  for (let q = 1; q <= limit; q++) {
    if (kind === 'rollup') {
      const n = there.length + q;
      if (!rollupFits(d, wall, w, h, n)) break;
      if (there.some((o) => !rollupFits(d, wall, o.w, o.h, n))) break;
    }
    if (!fitsSomehow(d, wall, kind, w, q)) break;
    best = q;
  }
  return best;
}

/**
 * Why more doors of this size cannot go on the wall, in the customer's words.
 * null = it is just space (the plain "no room" message). A height reason is only
 * given when the doors would otherwise fit - so its advice actually helps.
 */
export function whyNoMore(d: D, wall: WebWall, kind: WebOpening['kind'], w: number, h: number, wantQty: number, wallLabel = 'wall'): string | null {
  if (MAX_OPENINGS - d.openings.length < wantQty) return `A design can hold up to ${MAX_OPENINGS} doors and windows.`;
  if (kind !== 'rollup') return null;
  if (!fitsSomehow(d, wall, kind, w, wantQty)) return null; // no room anyway: a lower door would not help
  const there = d.openings.filter((o) => o.wall === wall && o.kind === 'rollup');
  const n = there.length + wantQty;
  const maxH = d.height - 1; // the program's rule for 2+ roll-ups on an end / divider wall
  const lowest = 6; // the smallest roll-up height (catalog)
  const taller = maxH < lowest ? `make the walls at least ${lowest + 1}′ tall (Size step)` : 'make the walls taller (Size step)';
  if (n > 1 && !rollupFits(d, wall, w, h, n)) {
    return maxH < lowest
      ? `Two or more garage doors on the ${wallLabel} need walls at least ${lowest + 1}′ tall: ${taller}.`
      : `With 2 or more garage doors on the ${wallLabel}, each can be up to ${maxH}′ tall on this building. Pick ${maxH}′ or less, or ${taller}.`;
  }
  const tall = there.find((o) => !rollupFits(d, wall, o.w, o.h, n));
  if (tall) {
    return maxH < lowest
      ? `Another garage door on the ${wallLabel} needs walls at least ${lowest + 1}′ tall: ${taller}.`
      : `The ${tall.h}′ tall garage door already on the ${wallLabel} would have to be ${maxH}′ or less with another door there.`;
  }
  return null;
}
