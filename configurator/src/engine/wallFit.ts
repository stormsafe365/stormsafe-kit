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
 * (`rawCenter`), a whole-inch gap to its nearest neighbour (snapGapInto; the
 * program stores the drag on the same 1/8" grid, so the stored spot is valid too). No valid spot on the
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
  // Whole-inch GAP to the nearest neighbour (owner 10/6/26 — see snapGapInto).
  const best = snapGapInto(ivs, rawCenter - w / 2, w, len, siblings);
  return best === null ? currentCenter : best + w / 2;
}

/**
 * Where a dragged opening's LEFT EDGE settles inside the allowed intervals
 * `ivs`: the edge facing its NEAREST neighbour (another opening, or the wall
 * end) sits a WHOLE INCH from it (owner 10/6/26: "still showing 8' 11.75
 * instead of 9'"). Snapping the left edge to the inch from the wall start
 * (as before) left a fractional gap beside any opening whose width isn't a
 * whole inch (a 36¼" window): the 3D said 9' while every printout said
 * 8'11.75". Rule bounds (1' from a corner / a sibling) are whole-inch gaps
 * themselves, so a spot is always found when the interval is an inch wide.
 * Every edge in the program is on the 1/8" grid, so the result is too.
 * null = no allowed spot.
 */
export function snapGapInto(ivs: Array<[number, number]>, rawX: number, w: number, len: number, siblings: WallSpan[]): number | null {
  const T = 1e-6;
  const sib = siblings.filter((s) => s.width > 0);
  const facingRight = [0, ...sib.map((s) => s.offset + s.width / 2)]; // edges a gap to our LEFT is measured from
  const facingLeft = [len, ...sib.map((s) => s.offset - s.width / 2)]; // edges a gap to our RIGHT is measured from
  const snapIn = (x: number, p: number, q: number): number | null => {
    const eL = Math.max(...facingRight.filter((a) => a <= x + T), -Infinity);
    const eR = Math.min(...facingLeft.filter((a) => a >= x + w - T), Infinity);
    const useL = isFinite(eL) && (!isFinite(eR) || x - eL <= eR - (x + w));
    if (!useL && !isFinite(eR)) return null;
    const g = useL ? (x - eL) * 12 : (eR - x - w) * 12;
    const at = (gi: number) => (useL ? eL + gi / 12 : eR - w - gi / 12);
    for (const gi of [Math.round(g), Math.floor(g + T), Math.ceil(g - T)]) {
      const c = at(gi);
      if (c >= p - T && c <= q + T) return c;
    }
    // An allowed stretch narrower than an inch: the nearest 1/8" spot in it.
    const lo8 = Math.ceil((p - T) * 96) / 96;
    const hi8 = Math.floor((q + T) * 96) / 96;
    return lo8 <= hi8 + T ? Math.min(hi8, Math.max(lo8, Math.round(x * 96) / 96)) : null;
  };
  let best: number | null = null;
  let bestD = Infinity;
  for (const [p, q] of ivs) {
    if (q < p - 1e-9) continue;
    for (const c0 of [Math.max(p, Math.min(q, rawX)), p, q]) {
      const c = snapIn(c0, p, q);
      if (c === null) continue;
      const d = Math.abs(c - rawX);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/**
 * 3D picking where openings overlap (an old saved quote, or a typed spot the
 * program flags): a press is handed to the SMALLER opening under the pointer —
 * the window inside a framed opening — instead of whichever mesh happens to sit
 * in front (owner 10/5/26: "i cant even click the window because it keeps
 * clicking on the frame out"). `along` / `y` are the press point on the wall
 * (along = the store's offset frame, y = height above the floor). True = `self`
 * should let the press pass on (no stopPropagation) so that smaller opening,
 * which the same ray also hits, takes it.
 */
export interface PickRect {
  /** Centre along the wall (ft). */
  offset: number;
  width: number;
  /** Bottom edge above the floor (ft). */
  sill: number;
  height: number;
}

export function pressBelongsToSmaller(self: PickRect, along: number, y: number, siblings: PickRect[]): boolean {
  if (!isFinite(along) || !isFinite(y)) return false;
  const area = self.width * self.height;
  return siblings.some(
    (s) =>
      s.width > 0 &&
      s.height > 0 &&
      s.width * s.height < area - 1e-9 &&
      along >= s.offset - s.width / 2 &&
      along <= s.offset + s.width / 2 &&
      y >= s.sill &&
      y <= s.sill + s.height,
  );
}

/** Key the 3D puts on each opening's root group (userData) so a press can tell which openings its ray went through. */
export const OPENING_ID_KEY = 'ssOpeningId';

interface PickedObject {
  userData: Record<string, unknown>;
  parent: PickedObject | null;
}

/**
 * Ids of the openings a press's ray actually went through (R3F `e.intersections`):
 * only those can take a press handed on by pressBelongsToSmaller — an opened
 * window's sash that slid out of the way, for one, is not under the pointer.
 */
export function openingIdsUnder(hits: ReadonlyArray<{ object: PickedObject }>): Set<string> {
  const ids = new Set<string>();
  for (const h of hits) {
    for (let o: PickedObject | null = h.object; o; o = o.parent) {
      const id = o.userData?.[OPENING_ID_KEY];
      if (typeof id === 'string') {
        ids.add(id);
        break;
      }
    }
  }
  return ids;
}
