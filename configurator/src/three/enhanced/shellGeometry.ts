import * as THREE from 'three';
import { ROOF_LIFT, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { BuildingColors, Opening, PanelOrientation, Wainscot, WallSide } from '@/types/building';
import { eaveDownBand, stripsAround, type LocalRect } from '../Siding';
import { litFromRight, materialKey, sheetOrientation, type EnhancedMaterialSpec, type V3 } from './materials';

/**
 * ENHANCED look — MAIN SHELL GEOMETRY (render-upgrade Phase 5, HANDOFF Steps
 * 1-3). Pure: turns the resolved structure + openings into merged vertex
 * batches, one per material, for EnhancedSiding / EnhancedRoof / EnhancedTrim.
 * Nothing here is used by the classic look.
 *
 * WALLS reuse the classic wall-cutting geometry (Siding.tsx stripsAround /
 * eaveDownBand) and every classic enclosure branch — enclosed sides, open
 * sides, eave-hung bands (garage partial closure + carport side panels),
 * open-bay bands (utility / GCH), closed / halfClosed / gableOnly / open ends,
 * the partition wall and the single-slope (mono) building — so doors, windows
 * and frame-outs cut real holes exactly where they do in classic. The wall
 * planes are the classic ones (sides at x = +-(W/2 + SHEET_OUTSET), ends at
 * z = +-(L/2 + SHEET_OUTSET), the partition at partitionZ), so the classic
 * fixtures and lean-tos still line up.
 *
 * What changes vs classic:
 *  - every exterior face is built with an OUTWARD normal (no back faces seen
 *    from outside), and its UVs are WORLD FEET: u = P . u_hat where u_hat runs
 *    left -> right as seen from outside, v = height (walls) / distance along
 *    the slope (roof). The normal maps tile every 3 ft (normalMaps.ts), so the
 *    rib phase is world-anchored: a strip above a door lines its ribs up with
 *    the strips beside it.
 *  - vertical walls (and a vertical-rib roof) use the per-wall rib flip
 *    (materials.ts litFromRight) with each face's REAL +u direction.
 *  - walls stop SHELL.wallTopGap under the roof underside; the wainscot is the
 *    lower part of the SAME wall plane (no overlaid band).
 *  - roof = colored top skin + bare Galvalume underside SHELL.roofUnderGap
 *    below it; both slopes meet exactly on the ridge line; overhang =
 *    structure.roofOverhangFt on the eaves and the gables (0.5 or 1.0).
 *  - bent-plate trims: ridge cap, eave + rake L trims, two-plate corner L
 *    trims (only where two sheeted edges meet), base trim (only where the sheet
 *    meets the slab, split at floor-level openings), a slim bottom trim on the
 *    raw bottom edge of eave-hung bands / gable-only sheets, and the wainscot
 *    Z-trim (classic WainscotCap rules: broken around every opening that
 *    crosses the wainscot line).
 */

// ── Constants (feet; HANDOFF Step 1 / lab v20 unless noted) ────────────────

export const SHELL = {
  /** Roof top skin lift along its normal off the frame roofline (classic ROOF_LIFT: clears the rafters). */
  roofLift: ROOF_LIFT,
  /** Colored top skin -> bare Galvalume underside (vertical). */
  roofUnderGap: 0.07,
  /** Walls stop this far under the roof underside, so the eave / rake trim hides the top edge. */
  wallTopGap: 0.07,
  /** Bent trim metal thickness (26 ga). */
  trimT: 0.025,
  /** Ridge cap: inverted V at the roof pitch. `lift` = gap over the roof skin (lab 0.015; 0.03 keeps the rake tops inside the cap). */
  ridgeCap: { halfWidth: 0.33, thickness: 0.025, hem: 0.04, lift: 0.03, endOverrun: 0.03 },
  /** Rake L: face 0.25 (0.2 below / 0.05 above the roof), leg 0.14 on the panel. */
  rake: { face: 0.25, faceCenter: -0.075, leg: 0.14, legCenter: 0.04 },
  /** Eave L: face 0.26, leg 0.14, 0.05 drip hem kicked out at the bottom. */
  eave: { face: 0.26, faceCenter: -0.08, leg: 0.14, legCenter: 0.04, hem: 0.05, hemCenter: -0.2, hemOut: 0.04 },
  /** Corner trim plate width (each leg of the L). */
  cornerWidth: 0.28,
  /** Base trim height (one plate thick). */
  baseHeight: 0.22,
  /** Openings whose sill is at or below this cut the base trim (floor-level doors / frame-outs). */
  floorSillFt: 0.1,
  /** Wainscot Z-trim: face plate (lab: 0.1 tall, 0.03 below / 0.07 above the line, 0.01 off the sheet). */
  zTrim: { face: 0.1, below: 0.03, standoff: 0.01 },
  /** Slim bottom trim on a hanging sheet's raw bottom edge (0.08 below / 0.04 above the edge). */
  bottomTrim: { below: 0.08, above: 0.04 },
  /** Classic "Half Closed (6' Panel)" band height. */
  halfClosedBandFt: 6,
  /** A corner trim shorter than this is not drawn. */
  minCornerFt: 0.3,
} as const;

const EPS = 0.01;

// ── Small vector helpers ───────────────────────────────────────────────────

export type UV = readonly [number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ── Vertex batches ─────────────────────────────────────────────────────────

/** One merged, non-indexed triangle list drawn with one material. */
export interface ShellBatch {
  /** Stable mesh key: material key + cast flag. */
  id: string;
  spec: EnhancedMaterialSpec;
  castShadow: boolean;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
}

export class Emitter {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  tri(a: V3, b: V3, c: V3, n: V3, ua: UV, ub: UV, uc: UV) {
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc);
  }
}

const ZERO_UV = (): UV => [0, 0];

/**
 * A planar CONVEX polygon, wound so its front face (and the normal attribute)
 * points along `n` whatever order the points come in.
 */
export function polygon(e: Emitter, pts: V3[], n: V3, uvOf: (p: V3) => UV = ZERO_UV) {
  if (pts.length < 3) return;
  // Newell normal of the given order.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const o = nx * n[0] + ny * n[1] + nz * n[2] >= 0 ? pts : [...pts].reverse();
  const uv = o.map(uvOf);
  for (let i = 1; i < o.length - 1; i++) e.tri(o[0], o[i], o[i + 1], n, uv[0], uv[i], uv[i + 1]);
}

/** A local frame: origin + orthonormal axes. */
export interface Frame3 {
  o: V3;
  x: V3;
  y: V3;
  z: V3;
}
const WORLD: Frame3 = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const at = (f: Frame3, l: V3): V3 => add(f.o, add(scale(f.x, l[0]), add(scale(f.y, l[1]), scale(f.z, l[2]))));

/** A box (plate) centered at local `c` with local size `s`, 6 outward faces. */
export function box(e: Emitter, f: Frame3, c: V3, s: V3) {
  const ax = [f.x, f.y, f.z];
  for (let k = 0; k < 3; k++) {
    const i = (k + 1) % 3;
    const j = (k + 2) % 3;
    for (const sg of [-1, 1]) {
      const corner = (a: number, b: number): V3 => {
        const l: [number, number, number] = [c[0], c[1], c[2]];
        l[k] += (sg * s[k]) / 2;
        l[i] += (a * s[i]) / 2;
        l[j] += (b * s[j]) / 2;
        return at(f, l);
      };
      polygon(e, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], scale(ax[k], sg));
    }
  }
}

/** Axis-aligned box from two corners. */
export function aabb(e: Emitter, a: V3, b: V3) {
  const lo: V3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const hi: V3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  if (hi[0] - lo[0] < 1e-6 || hi[1] - lo[1] < 1e-6 || hi[2] - lo[2] < 1e-6) return;
  box(e, WORLD, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], sub(hi, lo));
}

/**
 * A prism: the simple (possibly concave) XY `profile` extruded along world Z
 * from z0 to z1 (flat-shaded sides, triangulated caps).
 */
function prismZ(e: Emitter, profile: [number, number][], z0: number, z1: number) {
  const v2 = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const ccw = !THREE.ShapeUtils.isClockWise(v2);
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = profile[i];
    const [bx, by] = profile[(i + 1) % n];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    // outward normal of edge a->b for a CCW profile is (dy, -dx)
    const nrm: V3 = ccw ? [dy / len, -dx / len, 0] : [-dy / len, dx / len, 0];
    polygon(e, [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]], nrm);
  }
  const tris = THREE.ShapeUtils.triangulateShape(v2, []);
  for (const [a, b, c] of tris) {
    for (const [z, nz] of [[z0, -1], [z1, 1]] as const) {
      polygon(e, [[profile[a][0], profile[a][1], z], [profile[b][0], profile[b][1], z], [profile[c][0], profile[c][1], z]], [0, 0, nz]);
    }
  }
}

/** Collects emitters per (material, castShadow). */
export class BatchSet {
  private readonly m = new Map<string, { spec: EnhancedMaterialSpec; cast: boolean; e: Emitter }>();
  get(spec: EnhancedMaterialSpec, cast: boolean): Emitter {
    const id = `${materialKey(spec)}|${cast ? 'cast' : 'nocast'}`;
    let b = this.m.get(id);
    if (!b) {
      b = { spec, cast, e: new Emitter() };
      this.m.set(id, b);
    }
    return b.e;
  }
  build(): ShellBatch[] {
    const out: ShellBatch[] = [];
    for (const [id, b] of this.m) {
      if (!b.e.pos.length) continue;
      out.push({
        id,
        spec: b.spec,
        castShadow: b.cast,
        position: new Float32Array(b.e.pos),
        normal: new Float32Array(b.e.nor),
        uv: new Float32Array(b.e.uv),
      });
    }
    return out;
  }
}

// ── Inputs ─────────────────────────────────────────────────────────────────

export interface ShellInput {
  structure: StructureModel;
  openings: Opening[];
  wallOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

type RoofInputs = Pick<StructureModel, 'width' | 'length' | 'legHeight' | 'peakHeight' | 'rise' | 'monoDropFt' | 'roofOverhangFt'>;

// ── Roof surface ───────────────────────────────────────────────────────────

export interface RoofSurface {
  mono: boolean;
  /** Gabled with a real pitch (a ridge + ridge cap). False for mono and for a 0-pitch gable. */
  pitched: boolean;
  /** |dy/dx| of the roof planes. */
  slope: number;
  /** cos(pitch angle). */
  cos: number;
  /** Top-skin height at plan x (both slopes meet exactly at x = 0 on a gable). */
  topAt: (x: number) => number;
  /** Top skin on the ridge line (gable) / along the tall edge's wall line (mono, x = -W/2). */
  ridgeY: number;
  /** Plan |x| of the eave drip edges = W/2 + overhang. */
  dripX: number;
  /** Plan |z| of the gable roof edges = L/2 + overhang. */
  gableZ: number;
  overhang: number;
}

/**
 * The roof planes: the frame roofline (eave H -> ridge peakHeight; mono: tall
 * peakHeight at -X -> low H at +X) lifted ROOF_LIFT along the plane normal,
 * so the two lifted planes of a gable intersect exactly on x = 0.
 */
export function roofSurface(s: RoofInputs): RoofSurface {
  const halfW = s.width / 2;
  const mono = s.monoDropFt > 0.01;
  const run = mono ? s.width : halfW;
  const slope = run > 1e-6 ? Math.max(0, s.rise) / run : 0;
  const cos = 1 / Math.hypot(1, slope);
  const lift = SHELL.roofLift / cos;
  const ridgeY = s.peakHeight + lift;
  const topAt = mono ? (x: number) => ridgeY - (x + halfW) * slope : (x: number) => ridgeY - Math.abs(x) * slope;
  const oh = Math.max(0, s.roofOverhangFt);
  return {
    mono,
    pitched: !mono && slope > 1e-4,
    slope,
    cos,
    topAt,
    ridgeY,
    dripX: halfW + oh,
    gableZ: s.length / 2 + oh,
    overhang: oh,
  };
}

/** Wall top at plan x: SHELL.wallTopGap under the roof underside. */
export const wallTopAt = (r: RoofSurface, x: number) => r.topAt(x) - SHELL.roofUnderGap - SHELL.wallTopGap;

// ── Wall layout ────────────────────────────────────────────────────────────

/** A sheeted wall plane. Walls run along world X (ends, partition) or Z (eave sides). */
export interface WallPlane {
  id: WallSide;
  along: 'x' | 'z';
  /** The fixed coordinate: x of an eave side wall, z of an end / partition wall. */
  at: number;
  /** Outward normal. */
  n: V3;
  /** Texture +u: left -> right as seen from outside. */
  u: V3;
}

/** The geometric part of a wall plane (lean-to walls use it too). */
export type PlaneRef = Pick<WallPlane, 'along' | 'at' | 'n' | 'u'>;

/** A world point on a wall plane: `c` along the wall's world axis, `y` up, `out` along the normal. */
export const wallPoint = (w: PlaneRef, c: number, y: number, out = 0): V3 =>
  w.along === 'z' ? [w.at + w.n[0] * out, y, c] : [c, y, w.at + w.n[2] * out];

/** World-feet UVs of a wall point (u along +u, v = height). */
export const wallUV = (w: PlaneRef) => (p: V3): UV => [dot(p, w.u), p[1]];

/** An opening projected on its wall: world coordinate along the wall axis + vertical extent. */
export interface WallHole {
  c: number;
  w: number;
  y0: number;
  y1: number;
}

/** A rectangle of sheeting (world along-axis range x height), cut around the wall's holes. */
export interface SheetRegion {
  c0: number;
  c1: number;
  y0: number;
  y1: number;
  wainscot: boolean;
}

/** A horizontal trim line along a wall: y + along-axis range. */
export interface TrimRun {
  y: number;
  c0: number;
  c1: number;
}

export interface ShellWall {
  plane: WallPlane;
  /** Use the flipX (normalScale.x negated) wall material (vertical ribs only). */
  flip: boolean;
  holes: WallHole[];
  regions: SheetRegion[];
  /** Solid gable / single-slope end polygons above the rectangle, (c, y) points (never cut). */
  polys: [number, number][][];
  /** Where the sheet meets the slab (base trim). */
  base: { c0: number; c1: number }[];
  /** Raw bottom edges of hanging sheets (bottom trim). */
  bottom: TrimRun[];
  /** Wainscot line (Z-trim). */
  cap: TrimRun[];
}

/** An outside corner where two sheeted edges meet (two-plate L). */
export interface ShellCorner {
  /** Eave side: -1 = left (-X), +1 = right (+X). */
  sx: -1 | 1;
  /** Outer face z of the end / partition wall at this corner. */
  zw: number;
  /** Direction the end / partition face points (+-Z). */
  zs: -1 | 1;
  y0: number;
  y1: number;
  side: WallSide;
  end: WallSide;
}

export interface ShellLayout {
  roof: RoofSurface;
  walls: ShellWall[];
  corners: ShellCorner[];
  /** Wainscot height (0 = none), classic rule min(height, H - 0.5). */
  wainscotFt: number;
}

/** Sheet extent [y0, y1] of a wall at along-axis coordinate c (null = not sheeted there). */
export function sheetSpanAt(w: ShellWall, c: number): [number, number] | null {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of w.regions) {
    if (c < Math.min(r.c0, r.c1) - 0.02 || c > Math.max(r.c0, r.c1) + 0.02) continue;
    y0 = Math.min(y0, r.y0);
    y1 = Math.max(y1, r.y1);
  }
  // The solid gable / single-slope polygons above the rectangle: their
  // vertical extent on the line x = c (a mono end's tall corner is sheeted to
  // the high roof edge; a gable corner is a single point and adds nothing).
  for (const poly of w.polys) {
    const xs = poly.map((p) => p[0]);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    if (c < lo - 0.02 || c > hi + 0.02) continue;
    const cc = Math.min(hi, Math.max(lo, c));
    const ys: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      if ((ax - cc) * (bx - cc) > 0) continue;
      if (Math.abs(bx - ax) < 1e-9) ys.push(ay, by);
      else ys.push(ay + ((cc - ax) / (bx - ax)) * (by - ay));
    }
    if (ys.length < 2) continue;
    const pl = Math.min(...ys);
    const ph = Math.max(...ys);
    if (ph - pl < 0.02) continue;
    y0 = Math.min(y0, pl);
    y1 = Math.max(y1, ph);
  }
  return y1 > y0 ? [y0, y1] : null;
}

export function shellLayout(inp: ShellInput): ShellLayout {
  const s = inp.structure;
  const { width: W, length: L, legHeight: H, peakHeight: peak, enclosure: enc } = s;
  const halfW = W / 2;
  const halfL = L / 2;
  const SO = SHEET_OUTSET;
  const T = SHELL.trimT;
  const roof = roofSurface(s);
  const mono = roof.mono;
  const top = (x: number) => wallTopAt(roof, x);
  const wH = inp.wainscot.enabled ? Math.min(inp.wainscot.heightFt, H - 0.5) : 0;
  const vertical = sheetOrientation(inp.wallOrientation) === 'vertical';
  /** Classic full sheeted height of an eave side wall (mono tall -X side reaches the peak). */
  const sideWallH = (sd: 'left' | 'right') => (mono && sd === 'left' ? peak : H);
  const holesFor = (side: WallSide, cOf: (o: Opening) => number): WallHole[] =>
    inp.openings
      .filter((o) => o.side === side)
      .map((o) => ({ c: cOf(o), w: o.width, y0: o.sillHeight, y1: o.sillHeight + o.height }));

  const newWall = (plane: WallPlane, holes: WallHole[]): ShellWall => ({
    plane,
    flip: vertical && litFromRight(plane.n, plane.u),
    holes,
    regions: [],
    polys: [],
    base: [],
    bottom: [],
    cap: [],
  });

  /**
   * One sheeted run [c0, c1] x [yBot, yTop]. From the slab: base trim + (when
   * allowed) the wainscot split with its Z-trim line. Hanging (eave-down
   * band): a bottom trim along its raw bottom edge.
   */
  const addRun = (w: ShellWall, c0: number, c1: number, yBot: number, yTop: number, allowWainscot: boolean) => {
    if (c1 - c0 <= 0.02 || yTop - yBot <= 0.02) return;
    if (yBot <= EPS) {
      if (allowWainscot && wH > 0 && wH < yTop - 0.02) {
        w.regions.push({ c0, c1, y0: 0, y1: wH, wainscot: true });
        w.regions.push({ c0, c1, y0: wH, y1: yTop, wainscot: false });
        w.cap.push({ y: wH, c0, c1 });
      } else {
        w.regions.push({ c0, c1, y0: 0, y1: yTop, wainscot: false });
      }
      w.base.push({ c0, c1 });
    } else {
      w.regions.push({ c0, c1, y0: yBot, y1: yTop, wainscot: false });
      w.bottom.push({ y: yBot, c0, c1 });
    }
  };

  const walls: ShellWall[] = [];

  // Eave side walls (x = +-(W/2 + SHEET_OUTSET)).
  for (const sd of ['left', 'right'] as const) {
    const sx = sd === 'left' ? -1 : 1;
    const X0 = sx * (halfW + SO);
    const w = newWall({ id: sd, along: 'z', at: X0, n: [sx, 0, 0], u: [0, 0, -sx] }, holesFor(sd, (o) => -halfL + o.offset));
    const yTop = top(X0);
    const wallH = sideWallH(sd);
    // Enclosed span: full height, or the partial-closure band hanging from the eave.
    if (enc.sideZ && !enc.sideOpen[sd]) {
      const band = enc.sideBandFt[sd];
      const bandH = band > 0 ? Math.min(band, wallH) : wallH;
      addRun(w, enc.sideZ.start, enc.sideZ.end, wallH - bandH, yTop, band <= 0);
    }
    // Open bay (carport / GCH / utility): side panels hanging from the eave.
    if (s.openBayZ && s.openBayZ.end - s.openBayZ.start > 0) {
      const bh = Math.min(s.eavePanelFt[sd], wallH);
      if (bh > 0) addRun(w, s.openBayZ.start, s.openBayZ.end, eaveDownBand(wallH, bh).bottom, yTop, true);
    }
    walls.push(w);
  }

  // End walls + partition: a rectangle up to the eave-line wall top, then the
  // gable triangle (mono: right triangle, tall side at -X) under the roof.
  const yLow = Math.min(top(-halfW), top(halfW));
  const apex: [number, number] = mono ? [-halfW, top(-halfW)] : [0, top(0)];
  const gablePoly: [number, number][] | null =
    apex[1] - yLow > 0.02 ? [[-halfW, yLow], [halfW, yLow], apex] : null;

  const endWall = (id: WallSide, Z0: number, zs: -1 | 1, mode: 'closed' | 'gableOnly' | 'open' | 'halfClosed', holes: WallHole[]) => {
    if (mode === 'open') return;
    const w = newWall({ id, along: 'x', at: Z0, n: [0, 0, zs], u: [zs, 0, 0] }, holes);
    if (mode === 'closed') addRun(w, -halfW, halfW, 0, yLow, true);
    else if (mode === 'halfClosed') addRun(w, -halfW, halfW, H - Math.min(SHELL.halfClosedBandFt, H), yLow, false);
    else if (mode === 'gableOnly' && gablePoly) w.bottom.push({ y: yLow, c0: -halfW, c1: halfW });
    if (gablePoly) w.polys.push(gablePoly);
    walls.push(w);
  };
  endWall('front', -(halfL + SO), -1, enc.front, holesFor('front', (o) => -halfW + o.offset));
  endWall('back', halfL + SO, 1, enc.back, holesFor('back', (o) => halfW - o.offset));
  // Partition (utility / GCH split): faces the open bay, which lies past the
  // enclosed span's end (classic partition-corner rule).
  let openSign: -1 | 1 = 1;
  if (enc.partitionZ !== null) {
    const pz = enc.partitionZ;
    openSign = enc.sideZ
      ? Math.abs(pz - enc.sideZ.end) < EPS
        ? 1
        : -1
      : s.openBayZ && (s.openBayZ.start + s.openBayZ.end) / 2 < pz
        ? -1
        : 1;
    endWall('partition', pz, openSign, 'closed', holesFor('partition', (o) => -halfW + o.offset));
  }

  // Corner trims: only where two sheeted edges meet.
  const corners: ShellCorner[] = [];
  const byId = (id: WallSide) => walls.find((w) => w.plane.id === id) ?? null;
  const xw = halfW + SO;
  const pushCorner = (sx: -1 | 1, zw: number, zs: -1 | 1, side: ShellWall | null, sideC: number, end: ShellWall | null) => {
    if (!side || !end) return;
    const a = sheetSpanAt(side, sideC);
    const b = sheetSpanAt(end, sx * halfW);
    if (!a || !b) return;
    // Plates are horizontal-topped: keep them under the roof across their whole plan extent.
    const plateTop = Math.min(top(sx * (xw + T)), top(sx * (xw - SHELL.cornerWidth)));
    const y0 = Math.max(a[0], b[0]);
    const y1 = Math.min(a[1], b[1], plateTop);
    if (y1 - y0 < SHELL.minCornerFt) return;
    corners.push({ sx, zw, zs, y0, y1, side: side.plane.id, end: end.plane.id });
  };
  for (const sx of [-1, 1] as const) {
    const side = byId(sx < 0 ? 'left' : 'right');
    pushCorner(sx, -(halfL + SO), -1, side, -halfL, byId('front'));
    pushCorner(sx, halfL + SO, 1, side, halfL, byId('back'));
    // Partition corner (classic rule: only where no side paneling continues past it).
    if (enc.partitionZ !== null && enc.sideZ) {
      const panelFt = sx < 0 ? s.eavePanelFt.left : s.eavePanelFt.right;
      if (panelFt <= EPS) pushCorner(sx, enc.partitionZ, openSign, side, enc.partitionZ - openSign * 0.05, byId('partition'));
    }
  }

  return { roof, walls, corners, wainscotFt: wH };
}

// ── Batches: walls ─────────────────────────────────────────────────────────

const wallSpec = (inp: ShellInput, wainscot: boolean, flip: boolean): EnhancedMaterialSpec => ({
  surface: 'wall',
  color: wainscot ? inp.colors.wainscot : inp.colors.walls,
  orientation: sheetOrientation(inp.wallOrientation),
  flipX: flip,
});

/** Emit one sheet rectangle, cut into strips around the holes that reach into it (classic stripsAround). */
function emitRegion(e: Emitter, w: ShellWall, r: SheetRegion) {
  const width = r.c1 - r.c0;
  const height = r.y1 - r.y0;
  if (width <= 0.02 || height <= 0.02) return;
  const cm = (r.c0 + r.c1) / 2;
  const ym = (r.y0 + r.y1) / 2;
  // Only holes that actually overlap this rectangle's height (stripsAround
  // clamps partial overlaps; a hole wholly above/below must not be passed in).
  const local: LocalRect[] = w.holes
    .filter((h) => h.y1 > r.y0 + EPS && h.y0 < r.y1 - EPS)
    .map((h) => ({ u: h.c - cm, v: (h.y0 + h.y1) / 2 - ym, w: h.w, h: h.y1 - h.y0 }));
  const uv = wallUV(w.plane);
  for (const st of stripsAround(width, height, local)) {
    const a0 = cm + st.u - st.w / 2;
    const a1 = cm + st.u + st.w / 2;
    const b0 = ym + st.v - st.h / 2;
    const b1 = ym + st.v + st.h / 2;
    const p = w.plane;
    polygon(e, [wallPoint(p, a0, b0), wallPoint(p, a1, b0), wallPoint(p, a1, b1), wallPoint(p, a0, b1)], p.n, uv);
  }
}

/** Wall + wainscot sheeting (one batch per wall material). */
export function wallBatches(inp: ShellInput, layout: ShellLayout = shellLayout(inp)): ShellBatch[] {
  const set = new BatchSet();
  for (const w of layout.walls) {
    for (const r of w.regions) emitRegion(set.get(wallSpec(inp, r.wainscot, w.flip), true), w, r);
    for (const poly of w.polys) {
      const e = set.get(wallSpec(inp, false, w.flip), true);
      polygon(e, poly.map(([c, y]) => wallPoint(w.plane, c, y)), w.plane.n, wallUV(w.plane));
    }
  }
  return set.build();
}

// ── Batches: roof skins, ridge cap, eave + rake trim ───────────────────────

/**
 * Lean-to driven cut-backs of the main roof (render only, Phase 6; built by
 * leanToShell.ts leanToRoofCuts). Inside a cut the main roof ends at the wall
 * sheeting face instead of overhanging, and its eave / rake trim is skipped,
 * so a flush lean-to roof (or a gable lean-to's roof near the eave corners)
 * never runs through the main overhang or its trim.
 */
export interface MainRoofCuts {
  /** Eave side sx: plan z-ranges where the main eave overhang + eave trim are skipped. */
  eave: { sx: -1 | 1; z0: number; z1: number }[];
  /**
   * Gable end sz: plan x-ranges where the main gable overhang + rake trim are
   * skipped. capY = the lean-to roof top at the end-wall face: a cap plate
   * closes the cut roof edge from there up (none when absent).
   */
  gable: { sz: -1 | 1; x0: number; x1: number; capY?: number }[];
}

export const hasRoofCuts = (c?: MainRoofCuts | null): c is MainRoofCuts => !!c && (c.eave.length > 0 || c.gable.length > 0);

type RoofBatchInput = {
  structure: RoofInputs;
  roofOrientation: PanelOrientation;
  colors: Pick<BuildingColors, 'roof' | 'trim'>;
  /** Lean-to cut-backs (none = the plain Phase-5 roof, byte-identical). */
  cuts?: MainRoofCuts | null;
};

/** A frame along a roof edge (lab edgeFrame): +x from `from` to `to`, +y = `up` (roof normal), +z = x cross y. */
export function edgeFrame(from: V3, to: V3, up: V3, side: V3): { f: Frame3; len: number; out: number } {
  const d = sub(to, from);
  const len = Math.hypot(d[0], d[1], d[2]);
  const x = unit(d);
  const y = unit(up);
  const z = unit(cross(x, y));
  const out = Math.sign(dot(z, side)) || 1;
  return { f: { o: from, x, y, z }, len, out };
}

/** A plane dot(n, p) = d (world). */
export interface CutPlane {
  n: V3;
  d: number;
}

/** A vertical cut plane at plan x (n = +X) or plan z (n = +Z). */
export const plumbAt = (axis: 'x' | 'z', v: number): CutPlane => ({ n: axis === 'x' ? [1, 0, 0] : [0, 0, 1], d: v });

/**
 * Six planar faces of a hexahedron given its 8 corners, indexed
 * end * 4 + yi * 2 + zi (end 0/1 along the frame's x, yi / zi = low/high
 * local y / z), each wound outward.
 */
function hexahedron(e: Emitter, c: V3[]) {
  const mid: V3 = scale(c.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / 8);
  for (const q of [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ]) {
    const pts = q.map((i) => c[i]);
    let n = unit(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
    const fc = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / 4);
    if (dot(n, sub(fc, mid)) < 0) n = scale(n, -1);
    polygon(e, pts, n);
  }
}

/**
 * A plate along an edge frame spanning local y [y0, y1] x z [z0, z1] from
 * x = 0 to x = len, like box() — except that an end with a cut plane is cut
 * by that plane instead of square to the edge (each end corner slides along
 * the edge onto the plane), e.g. a PLUMB end on a sloped trim.
 */
export function cutPlate(e: Emitter, f: Frame3, len: number, y: [number, number], z: [number, number], cut0: CutPlane | null, cut1: CutPlane | null) {
  const c: V3[] = [];
  for (const end of [0, 1] as const) {
    const cut = end === 0 ? cut0 : cut1;
    for (const yy of y)
      for (const zz of z) {
        let s = end === 0 ? 0 : len;
        if (cut) {
          const dn = dot(cut.n, f.x);
          if (Math.abs(dn) > 1e-6) s = (cut.d - dot(cut.n, at(f, [0, yy, zz]))) / dn;
        }
        c.push(at(f, [s, yy, zz]));
      }
  }
  hexahedron(e, c);
}

/**
 * Rake L trim from `from` to `to`. Optional cut planes replace the square
 * ends (a lean-to rake ending on the closure at a main corner gets a PLUMB
 * end, so its sloped face never leans past the closure into the corner trim);
 * with none it is the plain two-box rake (byte-identical to Phase 5).
 */
export function rakeTrim(e: Emitter, from: V3, to: V3, up: V3, side: V3, cutFrom: CutPlane | null = null, cutTo: CutPlane | null = null) {
  const { f, len, out } = edgeFrame(from, to, up, side);
  const T = SHELL.trimT;
  const k = SHELL.rake;
  if (cutFrom || cutTo) {
    const zr = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
    cutPlate(e, f, len, [k.faceCenter - k.face / 2, k.faceCenter + k.face / 2], zr(0, out * T), cutFrom, cutTo);
    cutPlate(e, f, len, [k.legCenter - T / 2, k.legCenter + T / 2], zr(0, -out * k.leg), cutFrom, cutTo);
    return;
  }
  box(e, f, [len / 2, k.faceCenter, (out * T) / 2], [len, k.face, T]); // face over the roof edge
  box(e, f, [len / 2, k.legCenter, -out * (k.leg / 2)], [len, T, k.leg]); // leg lying on the panel
}

export function eaveTrim(e: Emitter, from: V3, to: V3, up: V3, side: V3) {
  const { f, len, out } = edgeFrame(from, to, up, side);
  const T = SHELL.trimT;
  const k = SHELL.eave;
  box(e, f, [len / 2, k.faceCenter, (out * T) / 2], [len, k.face, T]); // fascia face
  box(e, f, [len / 2, k.legCenter, -out * (k.leg / 2)], [len, T, k.leg]); // leg on the panel
  box(e, f, [len / 2, k.hemCenter, out * k.hemOut], [len, T, k.hem]); // drip hem kicked out
}

/** Ridge cap cross-section (lab ridgeCap): inverted V at the roof pitch, hemmed edges. */
export function ridgeCapProfile(r: RoofSurface): [number, number][] {
  const { halfWidth: hw, thickness: t, hem, lift } = SHELL.ridgeCap;
  const inner = (x: number) => r.ridgeY + lift - Math.abs(x) * r.slope;
  return [
    [-hw, inner(-hw) - hem],
    [-hw, inner(-hw)],
    [0, inner(0)],
    [hw, inner(hw)],
    [hw, inner(hw) - hem],
    [hw + t, inner(hw) - hem],
    [hw + t, inner(hw) + t],
    [0, inner(0) + t],
    [-hw - t, inner(-hw) + t],
    [-hw - t, inner(-hw) - hem],
  ];
}

/** One roof plane (plan x0 -> x1, full gable-to-gable length) + its underside. */
interface RoofPlane {
  x0: number;
  x1: number;
  /** Texture +u (left -> right seen from outside, looking at this plane from its low side). */
  u: V3;
  /** Plan x the slope distance (texture v) is measured from. */
  vFrom: number;
}

export function roofPlanes(r: RoofSurface, width: number): RoofPlane[] {
  const halfW = width / 2;
  if (r.mono) return [{ x0: -r.dripX, x1: r.dripX, u: [0, 0, -1], vFrom: -halfW }];
  return [
    { x0: 0, x1: r.dripX, u: [0, 0, -1], vFrom: 0 },
    // A 0-pitch gable is one flat plane: keep one u (and one rib flip) across it.
    { x0: 0, x1: -r.dripX, u: r.pitched ? [0, 0, 1] : [0, 0, -1], vFrom: 0 },
  ];
}

export function roofBatches(inp: RoofBatchInput): ShellBatch[] {
  if (hasRoofCuts(inp.cuts)) return roofBatchesCut(inp, inp.cuts);
  const s = inp.structure;
  const r = roofSurface(s);
  const set = new BatchSet();
  const orientation = sheetOrientation(inp.roofOrientation);
  const zE = r.gableZ;
  const under = SHELL.roofUnderGap;
  const T = SHELL.trimT;

  for (const pl of roofPlanes(r, s.width)) {
    const y0 = r.topAt(pl.x0);
    const y1 = r.topAt(pl.x1);
    const pts: V3[] = [
      [pl.x0, y0, -zE],
      [pl.x0, y0, zE],
      [pl.x1, y1, zE],
      [pl.x1, y1, -zE],
    ];
    let n = unit(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
    if (n[1] < 0) n = scale(n, -1);
    const flip = orientation === 'vertical' && litFromRight(n, pl.u);
    // u along the eave (world feet, left -> right from outside); v = distance along the slope.
    const uvOf = (p: V3): UV => [dot(p, pl.u), -Math.abs(p[0] - pl.vFrom) / r.cos];
    polygon(set.get({ surface: 'roof', color: inp.colors.roof, orientation, flipX: flip }, false), pts, n, uvOf);
    // Bare Galvalume underside, a hair below, facing down.
    const dn = pts.map((p): V3 => [p[0], p[1] - under, p[2]]);
    polygon(set.get({ surface: 'roofUnder' }, false), dn, scale(n, -1), uvOf);
  }

  const trim = set.get({ surface: 'trim', color: inp.colors.trim }, false);
  if (r.pitched) prismZ(trim, ridgeCapProfile(r), -(zE + SHELL.ridgeCap.endOverrun), zE + SHELL.ridgeCap.endOverrun);

  const normalOf = (sx: number): V3 => (r.mono ? unit([r.slope, 1, 0]) : unit([sx * r.slope, 1, 0]));
  // Eave trims run the full roof length + one plate past each gable edge so
  // they close the corner against the rake faces.
  const eave = (sx: -1 | 1) => {
    const x = sx * r.dripX;
    const y = r.topAt(x);
    eaveTrim(trim, [x, y, -(zE + T)], [x, y, zE + T], normalOf(sx), [sx, 0, 0]);
  };
  eave(-1); // mono: the high-side trim along the tall edge
  eave(1);

  for (const sz of [-1, 1] as const) {
    const z = sz * zE;
    if (r.pitched) {
      // Eave -> ridge up each gable edge, meeting on the ridge line under the
      // cap. Each face's end is square to its own slope, so the two ends cross
      // at the ridge and leave a small V open above it (seen from the gable
      // end it shows the gap under the cap): a gusset in the face plane fills it.
      const R: V3 = [0, r.ridgeY, z];
      for (const sx of [-1, 1] as const) {
        const x = sx * r.dripX;
        rakeTrim(trim, [x, r.topAt(x), z], R, normalOf(sx), [0, 0, sz]);
      }
      const top = SHELL.rake.faceCenter + SHELL.rake.face / 2;
      const a = add(R, scale(normalOf(-1), top));
      const d = add(R, scale(normalOf(1), top));
      for (const [off, nz] of [[0, -sz], [sz * T, sz]] as const) {
        const sh = (p: V3): V3 => [p[0], p[1], p[2] + off];
        polygon(trim, [sh(R), sh(a), sh(d)], [0, 0, nz]);
      }
    } else {
      // Mono: low -> high along the one plane. Flat gable: straight across.
      rakeTrim(trim, [r.dripX, r.topAt(r.dripX), z], [-r.dripX, r.topAt(-r.dripX), z], normalOf(1), [0, 0, sz]);
    }
  }
  return set.build();
}

/** Sorted, de-duplicated breakpoints inside [lo, hi]. */
function breakpoints(values: number[], lo: number, hi: number): number[] {
  const xs = values.map((v) => Math.min(hi, Math.max(lo, v))).sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of xs) if (!out.length || x - out[out.length - 1] > 1e-7) out.push(x);
  return out;
}

/**
 * The main roof with lean-to cut-backs (MainRoofCuts). Same planes, normals,
 * rib flip and UVs as the plain roof; each plane is emitted as plan
 * rectangles (a notched plane), so inside an eave cut the plane stops at the
 * side-wall face (x = +-(W/2 + SHEET_OUTSET)) and inside a gable cut at the
 * end-wall face (z = +-(L/2 + SHEET_OUTSET)). Eave trim skips eave cuts (a
 * short rake closes the overhang where it resumes), rakes skip gable cuts and
 * start at the wall face where an eave cut reaches the gable edge. A gable cut
 * gets the same short closing rake where the gable overhang resumes, and a cap
 * over its cut roof edge (from the lean-to roof up, cutEdgeCap).
 */
function roofBatchesCut(inp: RoofBatchInput, cuts: MainRoofCuts): ShellBatch[] {
  const s = inp.structure;
  const r = roofSurface(s);
  const set = new BatchSet();
  const orientation = sheetOrientation(inp.roofOrientation);
  const zE = r.gableZ;
  const under = SHELL.roofUnderGap;
  const T = SHELL.trimT;
  const xw = Math.min(s.width / 2 + SHEET_OUTSET, r.dripX);
  const zF = Math.min(s.length / 2 + SHEET_OUTSET, zE);
  const inRange = (v: number, a: number, b: number) => v > Math.min(a, b) && v < Math.max(a, b);
  const eaveCut = (sx: number, z: number) => cuts.eave.some((c) => c.sx === sx && inRange(z, c.z0, c.z1));
  const gableCut = (sz: number, x: number) => cuts.gable.some((c) => c.sz === sz && inRange(x, c.x0, c.x1));
  const kept = (x: number, z: number) =>
    !(Math.abs(x) > xw && eaveCut(Math.sign(x), z)) && !(Math.abs(z) > zF && gableCut(Math.sign(z), x));

  for (const pl of roofPlanes(r, s.width)) {
    const full: V3[] = [
      [pl.x0, r.topAt(pl.x0), -zE],
      [pl.x0, r.topAt(pl.x0), zE],
      [pl.x1, r.topAt(pl.x1), zE],
      [pl.x1, r.topAt(pl.x1), -zE],
    ];
    let n = unit(cross(sub(full[1], full[0]), sub(full[3], full[0])));
    if (n[1] < 0) n = scale(n, -1);
    const flip = orientation === 'vertical' && litFromRight(n, pl.u);
    const uvOf = (p: V3): UV => [dot(p, pl.u), -Math.abs(p[0] - pl.vFrom) / r.cos];
    const top = set.get({ surface: 'roof', color: inp.colors.roof, orientation, flipX: flip }, false);
    const bottom = set.get({ surface: 'roofUnder' }, false);
    const lo = Math.min(pl.x0, pl.x1);
    const hi = Math.max(pl.x0, pl.x1);
    const xs = breakpoints([lo, hi, -xw, xw, ...cuts.gable.flatMap((c) => [c.x0, c.x1])], lo, hi);
    const zs = breakpoints([-zE, -zF, zF, zE, ...cuts.eave.flatMap((c) => [c.z0, c.z1])], -zE, zE);
    const rect = (xa: number, xb: number, za: number, zb: number) => {
      const pts: V3[] = [
        [xa, r.topAt(xa), za],
        [xa, r.topAt(xa), zb],
        [xb, r.topAt(xb), zb],
        [xb, r.topAt(xb), za],
      ];
      polygon(top, pts, n, uvOf);
      polygon(bottom, pts.map((p): V3 => [p[0], p[1] - under, p[2]]), scale(n, -1), uvOf);
    };
    for (let i = 0; i + 1 < xs.length; i++) {
      const xa = xs[i];
      const xb = xs[i + 1];
      const xm = (xa + xb) / 2;
      let start: number | null = null;
      for (let j = 0; j + 1 < zs.length; j++) {
        const inside = kept(xm, (zs[j] + zs[j + 1]) / 2);
        if (inside && start === null) start = zs[j];
        if (!inside && start !== null) {
          rect(xa, xb, start, zs[j]);
          start = null;
        }
      }
      if (start !== null) rect(xa, xb, start, zs[zs.length - 1]);
    }
  }

  const trim = set.get({ surface: 'trim', color: inp.colors.trim }, false);
  if (r.pitched) prismZ(trim, ridgeCapProfile(r), -(zE + SHELL.ridgeCap.endOverrun), zE + SHELL.ridgeCap.endOverrun);
  const normalOf = (sx: number): V3 => (r.mono ? unit([r.slope, 1, 0]) : unit([sx * r.slope, 1, 0]));

  // Eave trims: skip eave cuts; at a gable cut covering the drip corner stop at the end-wall face.
  for (const sx of [-1, 1] as const) {
    const x = sx * r.dripX;
    const y = r.topAt(x);
    const stopAt: Record<number, boolean> = { [-1]: gableCut(-1, x - sx * 0.01), [1]: gableCut(1, x - sx * 0.01) };
    const gaps: [number, number][] = cuts.eave.filter((c) => c.sx === sx).map((c) => [c.z0, c.z1]);
    for (const sz of [-1, 1] as const) if (stopAt[sz]) gaps.push([sz * zF, sz * (zE + 1)]);
    for (const [a, b] of subtractRanges(-zE, zE, gaps)) {
      const ea = stopAt[-1] && Math.abs(a + zF) < 1e-6 ? 0 : T;
      const eb = stopAt[1] && Math.abs(b - zF) < 1e-6 ? 0 : T;
      eaveTrim(trim, [x, y, a - ea], [x, y, b + eb], normalOf(sx), [sx, 0, 0]);
    }
    // Where the overhang resumes past an eave cut, a short rake closes its end face.
    for (const c of cuts.eave.filter((k) => k.sx === sx)) {
      for (const [zb, face] of [[Math.min(c.z0, c.z1), 1], [Math.max(c.z0, c.z1), -1]] as const) {
        if (Math.abs(zb) >= zE - 1e-6 || eaveCut(sx, zb - face * 0.01)) continue;
        rakeTrim(trim, [x, y, zb], [sx * xw, r.topAt(sx * xw), zb], normalOf(sx), [0, 0, face]);
      }
    }
  }

  for (const sz of [-1, 1] as const) {
    const z = sz * zE;
    if (r.pitched) {
      const R: V3 = [0, r.ridgeY, z];
      for (const sx of [-1, 1] as const) {
        // |x| ranges (this side) where the rake is skipped.
        const gaps: [number, number][] = cuts.gable
          .filter((c) => c.sz === sz)
          .map((c): [number, number] => {
            const lo = Math.min(c.x0, c.x1);
            const hi = Math.max(c.x0, c.x1);
            return sx > 0 ? [Math.max(0, lo), Math.max(0, hi)] : [Math.max(0, -hi), Math.max(0, -lo)];
          });
        if (eaveCut(sx, z - sz * 0.01)) gaps.push([xw, r.dripX + 1]);
        for (const [u0, u1] of subtractRanges(0, r.dripX, gaps)) {
          const from: V3 = [sx * u1, r.topAt(sx * u1), z];
          const to: V3 = u0 <= 1e-9 ? R : [sx * u0, r.topAt(sx * u0), z];
          rakeTrim(trim, from, to, normalOf(sx), [0, 0, sz]);
        }
      }
      if (!gableCut(sz, 0)) {
        const top = SHELL.rake.faceCenter + SHELL.rake.face / 2;
        const a = add(R, scale(normalOf(-1), top));
        const d = add(R, scale(normalOf(1), top));
        for (const [off, nz] of [[0, -sz], [sz * T, sz]] as const) {
          const sh = (p: V3): V3 => [p[0], p[1], p[2] + off];
          polygon(trim, [sh(R), sh(a), sh(d)], [0, 0, nz]);
        }
      }
    } else {
      const gaps: [number, number][] = cuts.gable.filter((c) => c.sz === sz).map((c) => [c.x0, c.x1]);
      if (eaveCut(-1, z - sz * 0.01)) gaps.push([-r.dripX - 1, -xw]);
      if (eaveCut(1, z - sz * 0.01)) gaps.push([xw, r.dripX + 1]);
      for (const [a, b] of subtractRanges(-r.dripX, r.dripX, gaps))
        rakeTrim(trim, [b, r.topAt(b), z], [a, r.topAt(a), z], normalOf(1), [0, 0, sz]);
    }
  }

  // Gable cuts: close the raw roof edges they leave.
  const capUp = SHELL.rake.faceCenter + SHELL.rake.face / 2; // a rake face's top over the roof skin
  for (const c of cuts.gable) {
    const sz = c.sz;
    const lo = Math.max(Math.min(c.x0, c.x1), -r.dripX);
    const hi = Math.min(Math.max(c.x0, c.x1), r.dripX);
    if (hi - lo <= EPS) continue;
    // Where the gable overhang resumes past the cut, a short rake closes its
    // side edge (end-wall face -> past the gable rake's face).
    for (const [xb, face] of [[lo, 1], [hi, -1]] as const) {
      if (Math.abs(xb) >= r.dripX - 1e-6 || gableCut(sz, xb - face * 0.01)) continue;
      rakeTrim(trim, [xb, r.topAt(xb), sz * (zE + T)], [xb, r.topAt(xb), sz * zF], normalOf(xb < 0 ? -1 : 1), [face, 0, 0]);
    }
    // Along the cut the roof ends at the end-wall face: a cap closes that
    // edge from the lean-to roof up (over the eave trim's end at a drip corner).
    if (c.capY === undefined) continue;
    const xa = lo <= -r.dripX + 1e-6 ? lo - T : lo;
    const xb = hi >= r.dripX - 1e-6 ? hi + T : hi;
    const xs = r.pitched && xa < 0 && xb > 0 ? [xa, 0, xb] : [xa, xb];
    for (let i = 0; i + 1 < xs.length; i++) cutEdgeCap(trim, r, sz, zF, xs[i], xs[i + 1], c.capY, capUp);
  }
  return set.build();
}

/**
 * A cap plate on the end-wall face (z = sz*zF .. sz*(zF + T)) over plan x in
 * [a, b] (one roof plane), from yB up to `up` over the roof top, kept where
 * it is at least 0.01 tall.
 */
function cutEdgeCap(e: Emitter, r: RoofSurface, sz: -1 | 1, zF: number, a: number, b: number, yB: number, up: number) {
  const min = 0.01;
  const top = (x: number) => r.topAt(x) + up;
  const hA = top(a) - yB;
  const hB = top(b) - yB;
  if (b - a <= 1e-6 || (hA < min && hB < min)) return;
  const at = (h: number) => a + ((h - hA) / (hB - hA)) * (b - a);
  const x0 = hA < min ? at(min) : a;
  const x1 = hB < min ? at(min) : b;
  if (x1 - x0 <= 1e-4) return;
  const T = SHELL.trimT;
  const zi = sz * zF;
  const zo = sz * (zF + T);
  const t0 = top(x0);
  const t1 = top(x1);
  const len = Math.hypot(x1 - x0, t1 - t0);
  polygon(e, [[x0, yB, zo], [x1, yB, zo], [x1, t1, zo], [x0, t0, zo]], [0, 0, sz]);
  polygon(e, [[x0, t0, zi], [x1, t1, zi], [x1, t1, zo], [x0, t0, zo]], [-(t1 - t0) / len, (x1 - x0) / len, 0]);
  polygon(e, [[x0, yB, zi], [x0, yB, zo], [x0, t0, zo], [x0, t0, zi]], [-1, 0, 0]);
  polygon(e, [[x1, yB, zi], [x1, yB, zo], [x1, t1, zo], [x1, t1, zi]], [1, 0, 0]);
}

// ── Batches: corner, base, bottom, Z-trim ──────────────────────────────────

/** [lo, hi] minus the gaps (segments shorter than 0.05 dropped). */
export function subtractRanges(lo: number, hi: number, gaps: [number, number][]): [number, number][] {
  let segs: [number, number][] = [[Math.min(lo, hi), Math.max(lo, hi)]];
  for (const g of gaps) {
    const a = Math.min(g[0], g[1]);
    const b = Math.max(g[0], g[1]);
    const next: [number, number][] = [];
    for (const [s, e] of segs) {
      if (b <= s || a >= e) {
        next.push([s, e]);
        continue;
      }
      if (a > s) next.push([s, a]);
      if (b < e) next.push([b, e]);
    }
    segs = next;
  }
  return segs.filter(([s, e]) => e - s > 0.05);
}

/** Along-axis zone a corner's plate covers on each of its two walls. */
function cornerZones(layout: ShellLayout): { wall: WallSide; c0: number; c1: number; y0: number; y1: number }[] {
  const out: { wall: WallSide; c0: number; c1: number; y0: number; y1: number }[] = [];
  const cw = SHELL.cornerWidth;
  const T = SHELL.trimT;
  for (const k of layout.corners) {
    const xw = Math.abs(layout.walls.find((w) => w.plane.id === k.side)!.plane.at);
    out.push({ wall: k.side, c0: Math.min(k.zw, k.zw - k.zs * cw), c1: Math.max(k.zw, k.zw - k.zs * cw), y0: k.y0, y1: k.y1 });
    const e0 = k.sx * (xw - cw);
    const e1 = k.sx * (xw + T);
    out.push({ wall: k.end, c0: Math.min(e0, e1), c1: Math.max(e0, e1), y0: k.y0, y1: k.y1 });
  }
  return out;
}

export function trimBatches(inp: ShellInput & { trimColor: string }, layout: ShellLayout = shellLayout(inp)): ShellBatch[] {
  const set = new BatchSet();
  const e = set.get({ surface: 'trim', color: inp.trimColor }, true);
  const T = SHELL.trimT;
  const zones = cornerZones(layout);
  const zoneGaps = (w: ShellWall, y: number): [number, number][] =>
    zones.filter((z) => z.wall === w.plane.id && y >= z.y0 - EPS && y <= z.y1 + EPS).map((z) => [z.c0, z.c1]);

  /** A plate on a wall: along-axis [c0, c1], height [y0, y1], `o0..o1` out from the sheet face. */
  const plate = (w: ShellWall, c0: number, c1: number, y0: number, y1: number, o0: number, o1: number) =>
    aabb(e, wallPoint(w.plane, c0, y0, o0), wallPoint(w.plane, c1, y1, o1));

  for (const w of layout.walls) {
    // Base trim: floor-level openings (sill <= 0.1) and corner plates break it.
    const floorCuts = w.holes.filter((h) => h.y0 <= SHELL.floorSillFt).map((h): [number, number] => [h.c - h.w / 2, h.c + h.w / 2]);
    for (const run of w.base)
      for (const [a, b] of subtractRanges(run.c0, run.c1, [...floorCuts, ...zoneGaps(w, 0)]))
        plate(w, a, b, 0, SHELL.baseHeight, 0, T);

    // Bottom trim on a hanging sheet's raw bottom edge (broken where an opening crosses it).
    const bt = SHELL.bottomTrim;
    for (const run of w.bottom) {
      const cuts = w.holes.filter((h) => h.y0 < run.y - EPS && h.y1 > run.y + EPS).map((h): [number, number] => [h.c - h.w / 2, h.c + h.w / 2]);
      for (const [a, b] of subtractRanges(run.c0, run.c1, [...cuts, ...zoneGaps(w, run.y)])) plate(w, a, b, run.y - bt.below, run.y + bt.above, 0, T);
    }

    // Wainscot Z-trim (classic WainscotCap crossing rule: +-0.08 around the line).
    const z = SHELL.zTrim;
    for (const run of w.cap) {
      const cuts = w.holes
        .filter((h) => h.y0 < run.y + 0.08 && h.y1 > run.y - 0.08)
        .map((h): [number, number] => [h.c - h.w / 2, h.c + h.w / 2]);
      for (const [a, b] of subtractRanges(run.c0, run.c1, [...cuts, ...zoneGaps(w, run.y)]))
        plate(w, a, b, run.y - z.below, run.y - z.below + z.face, z.standoff, z.standoff + T);
    }
  }

  // Corner L: the side plate stops at the end wall's face; the end plate wraps
  // the corner by one plate thickness (covers the side plate's edge).
  const cw = SHELL.cornerWidth;
  for (const k of layout.corners) {
    const xw = Math.abs(layout.walls.find((w) => w.plane.id === k.side)!.plane.at);
    aabb(e, [k.sx * xw, k.y0, k.zw - k.zs * cw], [k.sx * (xw + T), k.y1, k.zw]);
    aabb(e, [k.sx * (xw - cw), k.y0, k.zw], [k.sx * (xw + T), k.y1, k.zw + k.zs * T]);
  }
  return set.build();
}

/** Mesh key of a batch set's input (so the memo only rebuilds when geometry inputs change). */
export function structureKey(s: StructureModel): string {
  return JSON.stringify([
    s.width,
    s.length,
    s.legHeight,
    s.peakHeight,
    s.rise,
    s.monoDropFt,
    s.roofOverhangFt,
    s.enclosure,
    s.openBayZ,
    s.eavePanelFt,
  ]);
}

export function openingsKey(openings: Opening[]): string {
  return JSON.stringify(openings.map((o) => [o.side, o.offset, o.sillHeight, o.width, o.height]));
}
