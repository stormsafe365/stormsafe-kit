import type { EndSheeting, FoundationType, FramingGauge } from '@/types/building';
import type { LeanToStructure, Member, StructureModel } from '@/engine/geometry';
import { FRAME_PROFILES, RAIL_VISUAL_FT } from '@/config/materials';
import { leanToWallSettings } from '@/engine/leanToFixtures';
import { siteRects, type Footprint } from './enhanced/look';

/**
 * FOUNDATION / ANCHORING drawing (owner 9/29/26: "make the concrete slab look
 * more accurate and show the connection points to the footers, like the
 * anchors"). DRAWING ONLY — nothing here is priced; the quote's Foundation Type
 * (#foundation) reaches the 3D as the view-only BuildingConfig.foundation.
 * Each manufacturer's OWN details (owner 9/30/26: CA builds use CA's plans,
 * CCI builds keep CCI's); the quote's manufacturer is view-only too.
 *
 * CCI — "FOUNDATION/ANCHORING RECOMMENDATIONS (FL ONLY)" (3 pages):
 *  - 1A  12'-30' wide, ENCLOSED or partially enclosed: 4" min slab with a
 *        MONOLITHIC thickened-edge footing under the base rail, 12" min wide,
 *        12" min below the adjacent ground + 2" above it (14" total), 2 #5
 *        continuous; wedge/expansion anchor through the rail, >= 2-1/2"
 *        embedment, >= 3" from the slab edge.
 *  - 1B  OPEN carports only (roof only, no side walls): plain continuous 4"
 *        slab, anchor >= 2-1/2" embedment, >= 6" from the edge. No footing.
 *  - 1   32'-60' (commercial): footing 18" wide x 16" (14" below ground + 2"),
 *        3 #5 continuous; TWO anchors side by side at each (doubled) leg, one
 *        through each base rail.
 *  - Base Rail Anchorage (ground / asphalt): helical ground anchor at each leg.
 * CA — "Enclosed Generic Engineering" sheet CA-1 (FL, PE-stamped 3/1/19):
 *  - Concrete Foundation / Base Rail Anchor Detail (new slab): 4" slab with a
 *    thickened edge 12" wide x 12" deep (from the slab top), (2) #5 @ 6" O.C.
 *    continuous; its inner face rises 4" before a 45 degree haunch to the slab
 *    underside; 1/2" x 5-1/2" expansion anchor within 6" of each post / truss
 *    ALONG THE SIDES and at EVERY OTHER END-WALL post.
 *  - Concrete Foundation / Base Rail Anchor Detail (EXISTING slab): plain
 *    slab, wedge anchor >= 2-1/2" embedment — drawn for an OPEN carport /
 *    open lean-to (no thickened edge), like CCI 1B.
 *  - Ground Anchor Base Rail Detail: 30" earth-auger ground anchor, 1/2" x
 *    30" with a double 4" helix, within 6" of each post, 2" washers.
 * Both makers' ground / gravel / asphalt anchor is drawn the way the OWNER
 * ruled (9/30/26: "ontop the baserail, like in your shared photo" — the wedge
 * anchor close-up): the anchor rod comes up THROUGH the base rail and is
 * fastened on top with a 2" washer + nut. (Both plans draw it beside the rail
 * with a horizontal bolt; the owner chose the on-top look.)
 * Lean-to END lines of an enclosed / partially enclosed lean-to get the
 * maker's thickened edge too (a drawing-only strip: the frame has no end rail).
 * Pure: a function of the derived StructureModel (members, lean-tos,
 * enclosure), the foundation type, the framing gauge (rail tube size) and the
 * manufacturer ('CCI', else CA — as the program's ACTIVE_MFR maps it).
 */

export type FoundationMaker = 'CCI' | 'CA';

export const FOUNDATION = {
  /** Slab thickness (4" minimum, CCI 1A / 1B, CA-1). The slab TOP stays at y = 0. */
  slabT: 4 / 12,
  /** Slab / footing top sits 2" above the adjacent ground (1A, 1). */
  grade: 2 / 12,
  /** Slab edge this far past the base rail's OUTER face (anchor >= 3" / >= 6" from the edge). */
  edgePastRail: 0.5,
  /**
   * Thickened-edge footing sections: bottom width, total depth from the slab
   * top, #5 bars; optional `step` (the inner face rises this far before the 45
   * degree haunch), `barSpacing` (bars on center, centered in the width) and
   * `barUp` (bar center above the bottom).
   */
  sections: {
    /** CCI 1A: 12'-30' wide — 12" wide, 14" deep total, 2 #5 continuous. */
    residential: { width: 1, depth: 14 / 12, bars: 2 },
    /** CCI 1: 32'-60' wide commercial — 18" wide, 16" deep total, 3 #5 continuous. */
    commercial: { width: 1.5, depth: 16 / 12, bars: 3 },
    /**
     * CA-1 (every CA width — the only CA footing detail): 12" wide x 12" deep,
     * (2) #5 @ 6" O.C. 3" up from the bottom; inner face 4" vertical, then a
     * 4" x 4" haunch to the 4" slab.
     */
    ca: { width: 1, depth: 1, bars: 2, step: 4 / 12, barSpacing: 0.5, barUp: 0.25 },
  },
  /** CCI main-building width from which detail 1 (commercial section + paired anchors) applies. */
  commercialMinWidth: 32,
  /** #5 rebar diameter (5/8") and its concrete cover. */
  barDia: 5 / 8 / 12,
  barCover: 3 / 12,
  /** Anchor distance along the rail from the leg's center (clear of the leg tube; both makers: within 6"). */
  anchorAlongRail: 0.33,
  /** Wedge / expansion anchor embedment below the concrete surface: CCI >= 2-1/2" (drawn 3"); CA 1/2" x 5-1/2", 2-1/2". */
  wedgeEmbed: { CCI: 3 / 12, CA: 2.5 / 12 },
  /**
   * Helical ground anchor (ground / gravel / asphalt), through the base rail:
   * auger tip depth below the surface, helix plate radius, plate heights above
   * the tip. CCI as drawn before (3 ft, 6" plates); CA-1: 30" earth auger with
   * a double 4" helix (~2" of the 30" rod is the rail + nut above the surface).
   */
  helical: {
    CCI: { depth: 3, helixR: 0.25, helixAt: [0.35, 0.8] },
    CA: { depth: 28 / 12, helixR: 2 / 12, helixAt: [0.25, 0.6] },
  },
  /** Gravel / asphalt / dirt pad: this far past the footprint. */
  padMargin: 2,
  /** Saw-cut control joints: panels no longer than this (ft). */
  jointMaxFt: 12,
} as const;

/** A thickened-edge footing strip under one base-rail line. */
export interface FootingStrip {
  /** Axis the strip (and its rail) runs along. */
  run: 'x' | 'z';
  /** Across coordinate of the rail centerline (x for run 'z', z for run 'x'). */
  c: number;
  /** Across direction from the rail to the strip's outer face (the slab edge). */
  out: 1 | -1;
  /** Across coordinate of the outer (slab-edge) face. */
  outer: number;
  /** Run extent. */
  r0: number;
  r1: number;
  /** Bottom width (ft), measured inward from the outer face. */
  width: number;
  /** Total depth below the slab / footing top (y = 0). */
  depth: number;
  /** #5 continuous bars. */
  bars: number;
  /** Inner face rises this far vertically before the 45 degree haunch (CA 4"; 0 = haunch from the bottom corner, CCI). */
  step: number;
  /** Bars this far apart on center, centered in the width (CA 6" O.C.); null = spread across the width at 3" cover (CCI). */
  barSpacing: number | null;
  /** Bar center height above the bottom (CA 3"); null = 3" cover + the bar radius (CCI). */
  barUp: number | null;
  /**
   * The strip meets a perpendicular strip at its r0 / r1 end: that end is
   * MITERED on the 45 degree plane through the slab corner (the thickened
   * edge turns the corner; its bars meet as an L) instead of a flat cap.
   */
  miter0: boolean;
  miter1: boolean;
}

/** One anchor: the bolt position on a base rail next to a leg / post. */
export interface AnchorSpot {
  x: number;
  z: number;
  /** Axis the rail runs along at this anchor. */
  run: 'x' | 'z';
  /** Rail centerline across coordinate. */
  c: number;
  /** Across direction toward the building interior. */
  inward: 1 | -1;
}

/** A saw-cut control joint on the slab top (a line segment). */
export interface SlabJoint {
  /** Axis the joint runs along. */
  run: 'x' | 'z';
  /** Its fixed coordinate on the other axis. */
  at: number;
  r0: number;
  r1: number;
}

export interface FoundationLayout {
  type: FoundationType;
  /** Whose details are drawn. */
  maker: FoundationMaker;
  /** Half the base-rail tube height (the rail is centered on y = 0; its top is y = railHalf). */
  railHalf: number;
  /** Adjacent ground level (the slab / footing top is 2" above it). */
  gradeY: number;
  /** Concrete slab = union of these rectangles (top y = 0, FOUNDATION.slabT thick). */
  slab: Footprint[] | null;
  /** Gravel / asphalt / dirt surface = union of these rectangles, top at `padTop`. */
  pad: Footprint[] | null;
  padTop: number;
  /** Footing strips under the base rails. */
  footings: FootingStrip[];
  /** Footings sit under the slab (top = slab underside) or stand alone (top = y = 0). */
  footingTop: 'slab' | 'self';
  /** Wedge / expansion anchor into concrete, or a helical ground anchor (ground / gravel / asphalt). Both fasten ON TOP of the rail. */
  anchor: 'wedge' | 'helical';
  /** Wedge: embedment below the concrete surface. Helical: the auger tip's depth below the surface. */
  anchorDepth: number;
  /** Helical only: helix plate radius + plate heights above the tip. */
  helix: { r: number; at: readonly number[] } | null;
  anchors: AnchorSpot[];
  joints: SlabJoint[];
  /** Main building is an OPEN carport (roof only) — detail 1B. */
  mainOpen: boolean;
}

type Section = { width: number; depth: number; bars: number; step?: number; barSpacing?: number; barUp?: number };

/** Plan reach of a section from its outer face: bottom width + the 45 degree haunch run. */
export const sectionReach = (sec: Pick<Section, 'width' | 'depth' | 'step'>): number =>
  sec.width + Math.max(0, sec.depth - FOUNDATION.slabT - (sec.step ?? 0));

const EPS = 0.02;
const isEnd = (v: EndSheeting) => v === 'open' || v === 'gableOnly';

/**
 * OPEN carport (1B: roof only, NO side walls): a carport with no eave side
 * panels, or a garage with both eave sides opened, and both ends open (a
 * gable-only triangle is roof-level, still open). Anything sheeted to the
 * ground-side (side panels, a closed / half-closed end, a storage bay) is
 * "partially enclosed" (1A / 1).
 */
export function mainIsOpen(s: Pick<StructureModel, 'enclosure' | 'eavePanelFt'>): boolean {
  const e = s.enclosure;
  if (!isEnd(e.front) || !isEnd(e.back) || e.partitionZ !== null) return false;
  if (e.type === 'carport') return s.eavePanelFt.left <= 0 && s.eavePanelFt.right <= 0;
  if (e.type === 'garage') return e.sideOpen.left && e.sideOpen.right && e.sideBandFt.left <= 0 && e.sideBandFt.right <= 0;
  return false;
}

/** An open (roof-only) lean-to. */
export function leanToIsOpen(lt: Pick<LeanToStructure, 'enclosure' | 'customWalls'>): boolean {
  if (lt.enclosure === 'open') return true;
  if (lt.enclosure === 'enclosed') return false;
  const cw = lt.customWalls;
  return !!cw && cw.side === 'open' && cw.front === 'open' && cw.back === 'open';
}

/** Rendered base-rail tube size (Frame.tsx: max(RAIL_VISUAL_FT, gauge size x 0.85)). */
export function railSizeFt(gauge: FramingGauge): number {
  return Math.max(RAIL_VISUAL_FT, FRAME_PROFILES[gauge].visualSizeFt * 0.85);
}

interface Rail {
  run: 'x' | 'z';
  c: number;
  lo: number;
  hi: number;
}

function groundRails(members: Member[]): Rail[] {
  const out: Rail[] = [];
  for (const m of members) {
    if (m.kind !== 'baseRail' || Math.abs(m.start[1]) > EPS || Math.abs(m.end[1]) > EPS) continue;
    const dx = Math.abs(m.end[0] - m.start[0]);
    const dz = Math.abs(m.end[2] - m.start[2]);
    if (dx < EPS && dz < EPS) continue;
    const run = dx > dz ? 'x' : 'z';
    const a = run === 'x' ? 0 : 2;
    out.push({ run, c: run === 'x' ? m.start[2] : m.start[0], lo: Math.min(m.start[a], m.end[a]), hi: Math.max(m.start[a], m.end[a]) });
  }
  return out;
}

interface Foot {
  x: number;
  z: number;
}

/** Feet of every leg / post standing on the ground (a leg cut by an opening has none). */
function legFeet(members: Member[]): Foot[] {
  const seen = new Set<string>();
  const out: Foot[] = [];
  for (const m of members) {
    if (m.kind !== 'leg') continue;
    const low = m.start[1] <= m.end[1] ? m.start : m.end;
    if (Math.abs(low[1]) > EPS) continue;
    const k = low[0].toFixed(3) + ',' + low[2].toFixed(3);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x: low[0], z: low[2] });
  }
  return out;
}

const across = (f: Foot, run: 'x' | 'z') => (run === 'x' ? f.z : f.x);
const along = (f: Foot, run: 'x' | 'z') => (run === 'x' ? f.x : f.z);

/** Union of `rects` along the line (run axis, fixed coordinate `at`): merged [lo, hi] intervals. */
function lineCover(rects: Footprint[], run: 'x' | 'z', at: number): Array<[number, number]> {
  const iv: Array<[number, number]> = [];
  for (const r of rects) {
    const [a0, a1, r0, r1] = run === 'x' ? [r.z0, r.z1, r.x0, r.x1] : [r.x0, r.x1, r.z0, r.z1];
    if (at > a0 + 1e-6 && at < a1 - 1e-6) iv.push([r0, r1]);
  }
  iv.sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  for (const [lo, hi] of iv) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1e-6) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** Saw-cut control joints: an even grid, panels <= jointMaxFt, clipped to the slab union. */
export function slabJoints(rects: Footprint[]): SlabJoint[] {
  if (!rects.length) return [];
  const x0 = Math.min(...rects.map((r) => r.x0));
  const x1 = Math.max(...rects.map((r) => r.x1));
  const z0 = Math.min(...rects.map((r) => r.z0));
  const z1 = Math.max(...rects.map((r) => r.z1));
  const out: SlabJoint[] = [];
  const grid = (lo: number, hi: number) => {
    const n = Math.max(1, Math.ceil((hi - lo) / FOUNDATION.jointMaxFt - 1e-9));
    return Array.from({ length: n - 1 }, (_, i) => lo + ((i + 1) * (hi - lo)) / n);
  };
  for (const x of grid(x0, x1)) for (const [lo, hi] of lineCover(rects, 'z', x)) out.push({ run: 'z', at: x, r0: lo, r1: hi });
  for (const z of grid(z0, z1)) for (const [lo, hi] of lineCover(rects, 'x', z)) out.push({ run: 'x', at: z, r0: lo, r1: hi });
  return out;
}


/**
 * The foundation drawing for a building: slab / pad, footing strips, anchors.
 * `foundation` unset = concrete (the program's '— select —'). `manufacturer`
 * 'CCI' draws CCI's details; anything else CA's (the program maps every
 * non-CCI ACTIVE_MFR to CA).
 */
export function foundationLayout(
  s: StructureModel,
  foundation: FoundationType | undefined,
  gauge: FramingGauge,
  manufacturer?: FoundationMaker,
): FoundationLayout {
  const type: FoundationType = foundation ?? 'concrete';
  const maker: FoundationMaker = manufacturer === 'CCI' ? 'CCI' : 'CA';
  const ca = maker === 'CA';
  const railHalf = railSizeFt(gauge) / 2;
  const e = railHalf + FOUNDATION.edgePastRail; // rail centerline -> slab edge
  const halfW = s.width / 2;
  const halfL = s.length / 2;
  const grow = (r: Footprint, d: number): Footprint => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });
  const rects = siteRects(s);
  const mainOpen = mainIsOpen(s);
  const concrete = type === 'concrete';
  const footers = type === 'footers';
  const rails = groundRails(s.members);
  // CCI detail 1 (32'-60'): the heavier section + paired anchors. CA's plan has
  // ONE footing detail (CA-1) and anchors each post / truss, at every width.
  const commercial = !ca && s.width >= FOUNDATION.commercialMinWidth;
  const mainSection: Section = ca
    ? FOUNDATION.sections.ca
    : commercial
      ? FOUNDATION.sections.commercial
      : FOUNDATION.sections.residential;
  const leanToSection: Section = ca ? FOUNDATION.sections.ca : FOUNDATION.sections.residential;

  // ── Footing strips (concrete: not for an open carport / open lean-to — CCI 1B,
  // CA's existing-slab detail; footers only: always) ──
  const footings: FootingStrip[] = [];
  /** Deepest parallel base rail inboard of the line (doubled / ladder columns) within its run. */
  const railInset = (run: 'x' | 'z', c: number, out: number, r0: number, r1: number) => {
    let inset = 0;
    for (const r of rails) {
      if (r.run !== run || r.hi < r0 || r.lo > r1) continue;
      const d = (c - r.c) * out; // distance inboard of the line
      if (d > -EPS && d < 2.3) inset = Math.max(inset, d);
    }
    return inset;
  };
  const pushStrip = (run: 'x' | 'z', c: number, out: 1 | -1, r0: number, r1: number, sec: Section): FootingStrip => {
    let width: number = sec.width;
    // FOOTERS ONLY (no slab to carry an inner rail): widen the strip so every
    // rail on this line (a doubled / ladder column's inner rail) bears on it
    // with 3" of concrete to spare. Under a slab the thickened edge is as drawn.
    if (footers) width = Math.max(width, e + railInset(run, c, out, r0, r1) + railHalf + FOUNDATION.barCover);
    const strip: FootingStrip = {
      run,
      c,
      out,
      outer: c + out * e,
      r0,
      r1,
      width,
      depth: sec.depth,
      bars: sec.bars,
      step: sec.step ?? 0,
      barSpacing: sec.barSpacing ?? null,
      barUp: sec.barUp ?? null,
      miter0: false,
      miter1: false,
    };
    footings.push(strip);
    return strip;
  };
  if (footers || (concrete && !mainOpen)) {
    const left = pushStrip('z', -halfW, -1, -halfL - e, halfL + e, mainSection);
    const right = pushStrip('z', halfW, 1, -halfL - e, halfL + e, mainSection);
    // Gable-end footing only where that end has a base rail (a CLOSED end),
    // corner to corner, mitered into the eave strips (no overlapping volume).
    for (const [z, out] of [[-halfL, -1], [halfL, 1]] as const) {
      if (s.enclosure[out < 0 ? 'front' : 'back'] !== 'closed') continue;
      const g = pushStrip('x', z, out, -halfW - e, halfW + e, mainSection);
      g.miter0 = g.miter1 = true;
      if (out < 0) left.miter0 = right.miter0 = true;
      else left.miter1 = right.miter1 = true;
    }
  }
  const mainStrips = footers || (concrete && !mainOpen);
  for (const lt of s.leanTos) {
    if (!(footers || (concrete && !leanToIsOpen(lt)))) continue;
    const eave = lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
    const c = eave ? lt.outer.x : lt.outer.z;
    const ci = eave ? lt.inner.x : lt.inner.z;
    if (![c, ci, lt.spanStart, lt.spanEnd].every(Number.isFinite)) continue;
    const out: 1 | -1 = c - ci >= 0 ? 1 : -1;
    const lo = Math.min(lt.spanStart, lt.spanEnd);
    const hi = Math.max(lt.spanStart, lt.spanEnd);
    const sec = leanToSection;
    const outerStrip = pushStrip(eave ? 'z' : 'x', c, out, lo - e, hi + e, sec);
    // END lines of an enclosed / partially enclosed lean-to: wherever an end
    // wall comes down to the floor ('closed', or the inner 'halfEnd'), the
    // thickened edge runs along that slab edge too — from the main building's
    // footing (abutting its outer face, so it continues the main end footing
    // when the lean-to is flush with a closed main end) out to the lean-to's
    // outer strip, mitered into it. The frame has no lean-to END base rail
    // (geometry.ts frames only the outer longitudinal rail), so this is the
    // foundation drawing only — legs, rails and anchors are unchanged.
    const walls = leanToWallSettings(lt);
    const mainHasStrip = mainStrips && (eave || s.enclosure[out < 0 ? 'front' : 'back'] === 'closed');
    const from = mainHasStrip ? ci + out * e : ci; // the main-building side of the end strip
    const to = c + out * e; // the lean-to's slab corner
    const fwd = lt.spanStart <= lt.spanEnd; // front = the lean-to's spanStart end (LeanToSiding)
    for (const [end, at, endOut] of [
      ['front', lt.spanStart, fwd ? -1 : 1],
      ['back', lt.spanEnd, fwd ? 1 : -1],
    ] as const) {
      if (walls[end] !== 'closed' && walls[end] !== 'halfEnd') continue;
      const [r0, r1] = out > 0 ? [from, to] : [to, from];
      if (r1 - r0 < sectionReach(sec) + 0.5) continue; // too short to miter
      const strip = pushStrip(eave ? 'x' : 'z', at, endOut, r0, r1, sec);
      if (out > 0) strip.miter1 = true;
      else strip.miter0 = true;
      if (endOut < 0) outerStrip.miter0 = true;
      else outerStrip.miter1 = true;
    }
  }

  // ── Anchors: one per DRAWN leg / post standing on a base rail, plus the
  // second rail's anchor at a CCI commercial doubled leg (1). This follows the
  // 3D frame's bents (ceil(L / spacing) + 1; no leg where a floor-level door
  // cut it), NOT the program's priced ground-anchor count (2 x (floor(L /
  // spacing) + 1)): the two agree only when the length divides evenly by the
  // spacing and no leg is cut. CA concrete / footers: every post along the
  // SIDES but only EVERY OTHER END-WALL post (CA-1). Drawing only — nothing
  // here is priced. Every anchor sits on the rail's top, within 6" of its post. ──
  const anchor: 'wedge' | 'helical' = concrete || footers ? 'wedge' : 'helical';
  const feet = legFeet(s.members);
  const gableLeanTos = s.leanTos.filter((lt) => lt.attachedSide === 'Front Gable' || lt.attachedSide === 'Back Gable');
  const inSpan = (lt: LeanToStructure, v: number) =>
    v >= Math.min(lt.spanStart, lt.spanEnd) - EPS && v <= Math.max(lt.spanStart, lt.spanEnd) + EPS;
  /** Rail run axis a leg's anchor sits on: along the bents' spacing axis (a gable lean-to's posts: its outer rail). */
  const preferredRun = (f: Foot): 'x' | 'z' =>
    gableLeanTos.some(
      (lt) =>
        inSpan(lt, f.x) &&
        (Math.abs(f.z - lt.outer.z) < EPS || (Math.abs(f.z - lt.inner.z) < EPS && Math.abs(f.x) < halfW - EPS)),
    )
      ? 'x'
      : 'z';
  const railThrough = (f: Foot, run: 'x' | 'z') =>
    rails.find((r) => r.run === run && Math.abs(r.c - across(f, run)) < EPS && along(f, run) >= r.lo - EPS && along(f, run) <= r.hi + EPS);
  const onRail = (run: 'x' | 'z', c: number, p: number, halfSpan: number) =>
    rails.some((r) => r.run === run && Math.abs(r.c - c) < EPS && p - halfSpan >= r.lo - 1e-6 && p + halfSpan <= r.hi + 1e-6);

  interface Placed {
    spot: AnchorSpot;
    /** The main-building end rail line (its z) for an END-WALL post, else null. */
    endLine: number | null;
    pos: number;
  }
  const placed: Placed[] = [];
  const clear = 0.09; // washer radius + a hair: the washer must sit fully on the rail
  for (const f of feet) {
    const pr = preferredRun(f);
    const rail = railThrough(f, pr) ?? railThrough(f, pr === 'x' ? 'z' : 'x');
    if (!rail) continue;
    const run = rail.run;
    const c = rail.c;
    const pos = along(f, run);
    // A doubled / ladder column's INNER chord: another foot at the same run
    // position further out on a parallel rail line.
    const partnerOut = feet.some(
      (g) =>
        g !== f &&
        Math.abs(along(g, run) - pos) < EPS &&
        Math.abs(across(g, run)) > Math.abs(c) + EPS &&
        Math.abs(across(g, run) - c) < 2.3 &&
        !!railThrough(g, run),
    );
    if (partnerOut) {
      // CCI detail 1 (32'-60'): one anchor per base rail at the leg — concrete /
      // footers only, main building only. Otherwise (and always for CA: "each
      // post / truss") the outer chord's anchor is the column's one anchor.
      const inMain = Math.abs(f.x) < halfW - EPS && Math.abs(f.z) <= halfL + EPS;
      if (!(anchor === 'wedge' && commercial && inMain)) continue;
    }
    const dirs = pos > 1e-6 ? [-1, 1] : [1, -1]; // toward the middle of the run first
    const d = FOUNDATION.anchorAlongRail;
    const dir = dirs.find((k) => onRail(run, c, pos + k * d, clear));
    if (dir === undefined) continue;
    const p = pos + dir * d;
    const inward: 1 | -1 = c > 0 ? -1 : 1;
    // An END-WALL post: on a main-building gable-end rail, between the corners
    // (the corner legs are side posts). The 3D frame draws no intermediate
    // end-wall posts of its own; the ones drawn today are a gable lean-to's
    // posts along a closed main end wall.
    const endLine = run === 'x' && Math.abs(Math.abs(c) - halfL) < EPS && Math.abs(f.x) < halfW - EPS ? c : null;
    placed.push({ spot: run === 'z' ? { x: c, z: p, run, c, inward } : { x: p, z: c, run, c, inward }, endLine, pos });
  }
  // CA-1 (concrete / footers — the expansion anchor): EVERY OTHER end-wall
  // post along each end line, counting from the -X corner post (anchored as a
  // side post): the 2nd, 4th, ... intermediate posts. CA's ground anchor
  // detail anchors each post, and CCI anchors every leg.
  const skip = new Set<Placed>();
  if (ca && anchor === 'wedge') {
    const lines = new Set(placed.filter((q) => q.endLine !== null).map((q) => q.endLine));
    for (const line of lines) {
      const onLine = placed.filter((q) => q.endLine === line).sort((a, b) => a.pos - b.pos);
      onLine.forEach((q, i) => {
        if (i % 2 === 0) skip.add(q);
      });
    }
  }
  const anchors: AnchorSpot[] = placed.filter((q) => !skip.has(q)).map((q) => q.spot);
  const helical = FOUNDATION.helical[maker];

  // ── Surfaces ──
  const slab = concrete ? rects.map((r) => grow(r, e)) : null;
  const pad = concrete ? null : rects.map((r) => grow(r, FOUNDATION.padMargin));
  const gradeY = -FOUNDATION.grade;
  // Footers only: the dirt between the footings is AT grade (a 1/4" skin so it
  // never z-fights the ground); gravel / asphalt / dirt pads come up to y = 0.
  const padTop = footers ? gradeY + 0.02 : 0;

  return {
    type,
    maker,
    railHalf,
    gradeY,
    slab,
    pad,
    padTop,
    footings,
    footingTop: concrete ? 'slab' : 'self',
    anchor,
    anchorDepth: anchor === 'wedge' ? FOUNDATION.wedgeEmbed[maker] : helical.depth,
    helix: anchor === 'helical' ? { r: helical.helixR, at: helical.helixAt } : null,
    anchors,
    joints: slab ? slabJoints(slab) : [],
    mainOpen,
  };
}
