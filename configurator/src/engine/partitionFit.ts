import type { LeanToOpening } from '@/types/building';
import type { LeanToStructure } from './geometry';
import {
  LT_PARTITION_CORNER_CLEAR_FT as CLR,
  LT_PARTITION_GAP_FT as GAP,
  LT_PARTITION_DOOR_HEADER_FT as DOOR_HDR,
  LT_PARTITION_WINDOW_HEADER_FT as WIN_HDR,
  LT_PARTITION_EPS_FT as EPS,
} from '@/config/constants';
import { snapGapInto } from './wallFit';

/**
 * Lean-to STORAGE PARTITION fit rules in the 3D (owner 9/30/26: "same spacing
 * rules ... as the gable end requires on the main building"). The pricing
 * program owns the rules (quote-builder.html LT_PART_* / ltPartItemIssue): it
 * filters the sizes it offers, flags and blocks printing. The 3D only has to
 * REFUSE to drag a partition opening into a spot that breaks them, so this
 * mirrors the program's checks exactly:
 *   - 1' clear of each corner post (main gable: door width <= W - 2);
 *   - a door's top + 1' header fits under the sloped partition at the door's
 *     LOW (outer) jamb; a window's top fits there (no header);
 *   - 1' between openings on the partition.
 * Offsets run like an end wall's: from the partition's min-coordinate end
 * (LeanToSiding dragInfo / leanToShell: minA + offset), so the outer (low) post
 * is at 0 when the outer edge has the smaller coordinate (Right Eave / Front
 * Gable lean-tos) and at the far end otherwise.
 */
export interface PartitionGeom {
  /** Partition length (ft) = lean-to width. */
  len: number;
  /** Wall height at the outer (low) post = the lean-to's low leg. */
  low: number;
  /**
   * Rise per ft toward the building (= pitch / 12) — flatter when the pitch
   * would put the connection point above the main eave (see partitionGeom).
   */
  slope: number;
  /** True when the outer (low) post sits at offset 0. */
  lowAtZero: boolean;
}

export function partitionGeom(
  lt: Pick<LeanToStructure, 'attachedSide' | 'widthFt' | 'lowLegHeightFt' | 'peakHeightFt' | 'inner' | 'outer'>,
  /**
   * Main building eave height (ft) — the program's bh (store legHeight). When
   * low leg + rise would put the connection point above it (the program's
   * "Main eave ... too short" case), the rafter runs from the low leg to the
   * main eave (geometry.ts connH = min(H, lh + rise)), so the partition is that
   * much flatter — the program's ltPartGeom does the same.
   */
  mainEaveFt?: number,
): PartitionGeom {
  const eave = lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
  const inner = eave ? lt.inner.x : lt.inner.z;
  const outer = eave ? lt.outer.x : lt.outer.z;
  const len = lt.widthFt;
  const conn = mainEaveFt !== undefined && mainEaveFt > 0 && lt.peakHeightFt > mainEaveFt ? mainEaveFt : lt.peakHeightFt;
  return {
    len,
    low: lt.lowLegHeightFt,
    slope: len > 0 ? Math.max(0, (conn - lt.lowLegHeightFt) / len) : 0,
    lowAtZero: outer < inner,
  };
}

/** Partition wall height (ft) at `x` ft from its offset-0 end. */
export function partitionWallHeightAt(g: PartitionGeom, x: number): number {
  const d = g.lowAtZero ? x : g.len - x;
  return g.low + Math.max(0, Math.min(g.len, d)) * g.slope;
}

/**
 * Wall height an opening needs at its low jamb: top of the opening + the
 * header. Windows and sill-raised (window-type) frame-outs take no header;
 * doors, walk doors and floor frame-outs take the gable end's 1'. (A
 * window-type frame-out typed down to a 0 sill reads as a door here — the 3D is
 * then 1' stricter than the program, never looser.)
 */
export function partitionNeedFt(o: Pick<LeanToOpening, 'type' | 'heightFt' | 'sillFt'>): number {
  const isWin = o.type === 'window' || (o.type === 'frameOut' && o.sillFt > 0);
  return (o.sillFt || 0) + o.heightFt + (isWin ? WIN_HDR : DOOR_HDR);
}

/** Does an opening (centre `center`) keep every rule, siblings included? */
export function partitionSpotOk(
  center: number,
  o: Pick<LeanToOpening, 'type' | 'widthFt' | 'heightFt' | 'sillFt'>,
  g: PartitionGeom,
  siblings: Array<Pick<LeanToOpening, 'offsetFt' | 'widthFt'>>,
): boolean {
  const x = center - o.widthFt / 2;
  if (x < CLR - EPS || x + o.widthFt > g.len - CLR + EPS) return false;
  const lowX = g.lowAtZero ? x : x + o.widthFt;
  if (partitionNeedFt(o) > partitionWallHeightAt(g, lowX) + EPS) return false;
  for (const s of siblings) {
    const sL = s.offsetFt - s.widthFt / 2;
    const sR = s.offsetFt + s.widthFt / 2;
    if (x + o.widthFt > sL - GAP + EPS && x < sR + GAP - EPS) return false;
  }
  return true;
}

/**
 * Where a DRAGGED partition opening may go: the valid spot nearest the pointer
 * (`rawCenter`), a whole-inch gap to its nearest neighbour (wallFit
 * snapGapInto; the program stores the drag on the same 1/8" grid). No
 * valid spot on the whole partition -> stays at `currentCenter` (the program
 * already flags that opening).
 */
export function clampPartitionCenter(
  rawCenter: number,
  o: Pick<LeanToOpening, 'type' | 'widthFt' | 'heightFt' | 'sillFt'>,
  g: PartitionGeom,
  siblings: Array<Pick<LeanToOpening, 'offsetFt' | 'widthFt'>>,
  currentCenter: number,
): number {
  const w = o.widthFt;
  // Allowed LEFT-EDGE interval: corner posts, then the height at the low jamb
  // (same EPS tolerance as partitionSpotOk / the program).
  let lo = CLR - EPS;
  let hi = g.len - CLR - w + EPS;
  const need = partitionNeedFt(o);
  if (need > g.low + EPS) {
    if (!(g.slope > 0)) return currentCenter;
    const dMin = (need - EPS - g.low) / g.slope; // the low jamb must be this far in from the outer post
    if (g.lowAtZero) lo = Math.max(lo, dMin);
    else hi = Math.min(hi, g.len - dMin - w);
  }
  let ivs: Array<[number, number]> = hi >= lo - 1e-9 ? [[lo, hi]] : [];
  // Keep 1' from every other partition opening.
  for (const s of siblings) {
    const a = s.offsetFt - s.widthFt / 2 - GAP - w + EPS; // our right edge must stay <= sibling left - GAP
    const b = s.offsetFt + s.widthFt / 2 + GAP - EPS; // or our left edge >= sibling right + GAP
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
  // Whole-inch GAP to the nearest neighbour (wallFit snapGapInto, owner 10/6/26).
  const best = snapGapInto(ivs, rawCenter - w / 2, w, g.len, siblings.map((s) => ({ offset: s.offsetFt, width: s.widthFt })));
  return best === null ? currentCenter : best + w / 2;
}
