/**
 * VIEW-ONLY de-overlap of auto-placed openings on one wall (3D drawing only).
 *
 * The pricing program centres every row's auto-placed items on their wall on
 * their own (getPosItems spaces a row's items evenly, ignoring every other
 * row), so a roll-up and a walk door added to the same wall without typed
 * positions land on the same spot and the 3D drew one inside the other.
 *
 * This moves such an item, in the 3D only, to the nearest spot on the wall
 * that keeps `gapFt` (1', a jamb post) clear of every other opening — never
 * the program, its fields, prices or PDFs' wording. Only items flagged
 * `movable` move: an item with a typed position stays exactly where it was
 * typed, and so does an auto item whose spot the program prices (a walk door
 * / window / framed opening on an EAVE wall auto-sets its side frames from
 * that spot — moving it would draw it where it was not priced). Items of the
 * same `group` (one program row) are never checked against each other: the
 * program already spaces a row's own items. When no spot fits, the item stays.
 */
export interface SpreadItem {
  /** Centerline along the wall (ft, wall-local). */
  offset: number;
  width: number;
  /** Same group = same program row (its own items are spaced by the program). */
  group: unknown;
  /** Auto-placed and its spot feeds no price: may be moved off an overlap. */
  movable: boolean;
}

export const AUTO_SPREAD_GAP_FT = 1;

/** New centerlines, in input order (unchanged unless an item had to move). */
export function spreadAutoOverlaps(items: SpreadItem[], spanFt: number, gapFt = AUTO_SPREAD_GAP_FT): number[] {
  const out = items.map((it) => it.offset);
  if (items.length < 2 || !(spanFt > 0)) return out;
  const EPS = 1e-6;
  const placed: Array<{ l: number; r: number; group: unknown }> = [];
  const put = (i: number) => placed.push({ l: out[i] - items[i].width / 2, r: out[i] + items[i].width / 2, group: items[i].group });
  // Fixed items first (typed or priced spots), then the movable ones in order.
  items.forEach((it, i) => {
    if (!it.movable) put(i);
  });
  items.forEach((it, i) => {
    if (!it.movable) return;
    const w = it.width;
    const l = out[i] - w / 2;
    const r = out[i] + w / 2;
    const clash = placed.some((p) => p.group !== it.group && l < p.r + gapFt - EPS && r > p.l - gapFt + EPS);
    if (clash) {
      const best = nearestFreeSpot(out[i], w, spanFt, placed, gapFt);
      if (best !== null) out[i] = best;
    }
    put(i);
  });
  return out;
}

/**
 * Centerline closest to `want` where an item of width `w` keeps `gapFt` clear
 * of every placed opening and stays on the wall (1' off each end when there is
 * room, else right up to it). Ties: the roomier gap, then the lower offset.
 * null = nowhere fits.
 */
function nearestFreeSpot(
  want: number,
  w: number,
  spanFt: number,
  placed: Array<{ l: number; r: number }>,
  gapFt: number,
): number | null {
  const EPS = 1e-6;
  const blocks = placed
    .map((p) => [p.l - gapFt, p.r + gapFt] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const tryMargin = (m: number): number | null => {
    const lo = Math.min(m, spanFt / 2);
    const hi = spanFt - lo;
    // free intervals inside [lo, hi] between the blocked ranges
    const free: Array<[number, number]> = [];
    let cur = lo;
    for (const [a, b] of blocks) {
      if (b <= cur) continue;
      if (a > cur) free.push([cur, Math.min(a, hi)]);
      cur = Math.max(cur, b);
      if (cur >= hi) break;
    }
    if (cur < hi) free.push([cur, hi]);
    let best: { c: number; d: number; room: number } | null = null;
    for (const [a, b] of free) {
      const room = b - a;
      if (room + EPS < w) continue;
      const c = Math.min(Math.max(want, a + w / 2), b - w / 2);
      const d = Math.abs(c - want);
      if (!best || d < best.d - EPS || (Math.abs(d - best.d) <= EPS && (room > best.room + EPS || (Math.abs(room - best.room) <= EPS && c < best.c)))) {
        best = { c, d, room };
      }
    }
    return best ? Math.round(best.c * 1000) / 1000 : null;
  };
  return tryMargin(gapFt) ?? tryMargin(0);
}
