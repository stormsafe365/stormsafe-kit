import { SHEET_OUTSET, type LeanToStructure, type StructureModel } from '@/engine/geometry';
import { rendersLeanToFixture } from '@/engine/leanToFixtures';
import type { BuildingColors, LeanToOpening, Opening, PanelOrientation, Wainscot } from '@/types/building';
import { eaveSurfaces, gableOutline, gableSurfaces, resolveWalls, sideBandHeight, sideWallPolys, type LtWalls } from '../LeanToSiding';
import { clipHalf, cutHoles, polyArea, type P2 } from '../polyCut';
import { litFromRight, sheetOrientation, type V3 } from './materials';
import {
  BatchSet,
  SHELL,
  aabb,
  box,
  eaveTrim,
  edgeFrame,
  lapOn,
  plumbAt,
  polygon,
  rakeTrim,
  roofSurface,
  sheetSpanAt,
  shellLayout,
  subtractRanges,
  wallPoint,
  wallUV,
  type Emitter,
  type MainRoofCuts,
  type PlaneRef,
  type RoofSurface,
  type ShellBatch,
  type ShellLayout,
  type ShellWall,
  type UV,
  type WallHole,
} from './shellGeometry';

/**
 * ENHANCED look — LEAN-TO SHELL GEOMETRY (render-upgrade Phase 6). Pure: turns
 * the resolved lean-tos into merged vertex batches (EnhancedLeanTos) plus the
 * one thing the enhanced MAIN shell needs to know about them (main roof
 * cut-backs for EnhancedRoof). Nothing here is used by the classic look.
 *
 * It WRAPS the builder's existing lean-to geometry (LeanToSiding.tsx), so the
 * sheeting lines up with the classic fixtures, drag planes and 2D rules:
 *  - resolveWalls (open / enclosed / custom per-wall values),
 *  - the outer wall at the classic plane (outer post line + SHEET_OUTSET) with
 *    the classic partial bands (sideWallPolys: q1/q2/q3 = 25/50/75% of the low
 *    leg, N panels = N x 3', hanging from the eave),
 *  - the end walls at the classic planes (run ends -/+ SHEET_OUTSET) with the
 *    classic outlines (gableOutline: closed trapezoid, gable-only triangle,
 *    half end, q1/q2/q3 roof-down bands),
 *  - openings at the classic positions (outer: spanStart + offset; ends: the
 *    lower world across-coordinate + offset), filtered by rendersLeanToFixture;
 *  - a STORAGE SECTION (LeanToStructure.storage, view-only): its end wall is
 *    closed (resolveWalls), an open / partial outer wall gets a closed
 *    floor-to-roof stretch along the storage length, and the partition is one
 *    more end-type wall ('partition') across the lean-to at storage.runAt,
 *    its face toward the open part, cut around its openings like an end.
 *
 * What changes vs classic (the Phase 5 recipe):
 *  - outward faces, world-feet UVs, per-wall rib flip from each face's real +u;
 *  - every partial end variant (half end, gable only, q1-q3) and the triangle
 *    above the low eave are CUT around their openings (classic only cut the
 *    lower rectangle of a fully closed end), so a see-through frame-out on a
 *    partial end is really see-through;
 *  - walls stop SHELL.wallTopGap under the roof underside (the top follows the
 *    slope on the ends); the wainscot is the lower run of the same plane;
 *  - roof = colored top skin + Galvalume underside, overhang
 *    structure.roofOverhangFt at the outer eave and both ends, L eave + rake
 *    trims, flashing ON the main wall's sheeting face (visible), or a
 *    pitch-break flashing when the lean-to is flush with the main eave;
 *  - corner L trims only where two sheeted edges meet (outer corners, the
 *    inside corner where an end wall meets the main wall, the junction of two
 *    lean-tos wrapping a corner), base trim only where a sheet meets the slab,
 *    bottom trim on hanging edges (incl. the sloped bottom of a q-band end),
 *    wainscot Z-trim. An outer corner L runs the full height of BOTH of its
 *    walls' sheeted edges (a 3/4 outer wall over a closed end: down to the
 *    slab; a closed outer wall beside a roof-down end band: the whole outer
 *    edge), so no raw sheet edge shows under / over the shorter wall;
 *  - wall-mounted trim plates stand LEAN_TO.trimLift off the sheet: their
 *    back face never shares the sheet's plane (no z-fight where the inside of
 *    an open / partial lean-to shows); the outer faces stay where they were;
 *  - two lean-tos wrapping a main corner: their overlapping roof corners are
 *    mitered on a hip with a hip cap, rakes stop at the hip (no crossing stubs);
 *  - the main building's corner trim is NEVER cut (golden classic / lab): a
 *    lean-to end wall that continues a main wall plane butts against the
 *    full-height main corner trim, and its own base / bottom / Z trims break
 *    around it. The wall flashing face stops against the main corner trim;
 *  - where a lean-to roof overhangs PAST a main corner (the lean-to runs to
 *    that corner, not mitered, not flush), its roof and rake stop at the main
 *    corner trim's outer face (plumb rake end) and a closure plate continues
 *    the corner trim over that roof end: no roof / rake end pokes past the
 *    main wall plane beside the corner trim;
 *  - flush lean-to (connection within LEAN_TO.flushFt of the main eave, or the
 *    main eave trim would hit its roof): the main eave overhang + eave trim are
 *    skipped along it; a gable lean-to trims the main gable overhang / rake
 *    only where they would run into its roof (near the eave corners), with a
 *    closing rake where the overhang resumes and a cap over the cut roof edge.
 *
 * Lean-to sizing, posts and all opening / drag / write-back math are untouched.
 */

const SO = SHEET_OUTSET;
const EPS = 0.01;

export const LEAN_TO = {
  /** A lean-to connecting within this of the main eave is FLUSH (render only). */
  flushFt: 0.4,
  /** The main roof's eave / rake trim hangs about this far under its top skin (eave hem 0.245 + margin). */
  clearFt: 0.28,
  /** Wall flashing (lab buildLeanTo): face on the main sheeting, leg lying on the lean-to roof. */
  flash: { face: 0.22, below: 0.02, leg: 0.3, lift: 0.004 },
  /** Hip cap over the miter of two lean-to roofs wrapping a corner (one plate per roof). */
  hip: { half: 0.3, lift: 0.012 },
  /** A flush lean-to's main-roof cut runs this far past its roof ends (the main closing rake sits outside its rake). */
  cutGap: 2 * SHELL.trimT,
  /**
   * Wall-mounted lean-to trim plates start this far off the sheet (outer faces
   * unchanged): a plate's back face on the sheet's plane z-fights the sheet's
   * back face seen from inside an open / partial lean-to.
   */
  trimLift: 0.01,
} as const;

// ── 2D helpers (wall plane: c = along-wall world coordinate, y = height; cutting: ../polyCut.ts) ──

/** Vertical extent [y0, y1] of the outlines on the line c (null = not sheeted there). */
export function spanAt(outline: P2[][], c: number): [number, number] | null {
  const ys: number[] = [];
  for (const poly of outline) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (c < Math.min(p[0], q[0]) - 1e-6 || c > Math.max(p[0], q[0]) + 1e-6) continue;
      if (Math.abs(q[0] - p[0]) < 1e-9) ys.push(p[1], q[1]);
      else ys.push(p[1] + ((c - p[0]) / (q[0] - p[0])) * (q[1] - p[1]));
    }
  }
  if (ys.length < 2) return null;
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return y1 - y0 > 0.02 ? [y0, y1] : null;
}

/** Horizontal chord(s) of the outlines at height y, as along-wall ranges. */
function chordAt(outline: P2[][], y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const poly of outline) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if ((p[1] - y) * (q[1] - y) > 0 || Math.abs(q[1] - p[1]) < 1e-9) continue;
      xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.05) out.push([xs[i], xs[i + 1]]);
  }
  return out;
}

// ── Lean-to frame ───────────────────────────────────────────────────────────

/** The main building as the lean-tos see it. */
interface MainCtx {
  s: StructureModel;
  halfW: number;
  halfL: number;
  roof: RoofSurface;
  /** Outer faces of the side / end wall sheeting. */
  xw: number;
  zF: number;
  oh: number;
}

function mainCtx(s: StructureModel): MainCtx {
  const roof = roofSurface(s);
  return { s, halfW: s.width / 2, halfL: s.length / 2, roof, xw: s.width / 2 + SO, zF: s.length / 2 + SO, oh: roof.overhang };
}

/** Main eave height on side sx (single slope: the tall eave is at -X). */
const mainEaveY = (m: MainCtx, sx: number) => (m.roof.mono && sx < 0 ? m.s.peakHeight : m.s.legHeight);

/**
 * One lean-to in its local frame: across `a` (world X for an eave lean-to,
 * world Z for a gable lean-to; inner = the main wall's framing line, outer =
 * the outer post line), height y, run r (along the attachment wall,
 * spanStart -> spanEnd). The roof plane is the classic one (inner connection
 * -> outer low leg), lifted ROOF_LIFT along its normal.
 */
export interface LeanToFrame {
  lt: LeanToStructure;
  eave: boolean;
  inner: number;
  outer: number;
  /** Across sign pointing away from the building. */
  out: 1 | -1;
  r0: number;
  r1: number;
  lh: number;
  connH: number;
  slope: number;
  cos: number;
  oh: number;
  /** Roof top skin at across a. */
  topAt: (a: number) => number;
  /** Across coordinate of the main wall's sheeting face / the outer wall plane / the eave drip edge. */
  mainFace: number;
  wallFace: number;
  drip: number;
  /** Inner edge of the lean-to roof (the main wall face when flush). */
  roofInner: number;
  flush: boolean;
  walls: LtWalls;
  /** Local (a, y, r) -> world. */
  P: (a: number, y: number, r: number) => V3;
  /** Roof normal (up). */
  n: V3;
  /** World unit vectors: across outward, run +. */
  aHat: V3;
  rHat: V3;
}

const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Wall top under the lean-to roof at across a (Phase 5 rule: SHELL.wallTopGap under the underside). */
const wallTop = (f: LeanToFrame, a: number) => f.topAt(a) - SHELL.roofUnderGap - SHELL.wallTopGap;

function leanToFrame(lt: LeanToStructure, m: MainCtx): LeanToFrame | null {
  const eave = lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
  const inner = eave ? lt.inner.x : lt.inner.z;
  const outer = eave ? lt.outer.x : lt.outer.z;
  const r0 = lt.spanStart;
  const r1 = lt.spanEnd;
  const lh = lt.lowLegHeightFt;
  const connH = lt.peakHeightFt;
  if (![inner, outer, r0, r1, lh, connH].every(Number.isFinite) || r1 - r0 < 0.05) return null;
  const out = (Math.sign(outer - inner) || -1) as 1 | -1; // classic: Math.sign(outer - inner) || -1
  const aw = Math.abs(outer - inner) || 1;
  const slope = (connH - lh) / aw;
  const cos = 1 / Math.hypot(1, slope);
  const lift = SHELL.roofLift / cos;
  const topAt = (a: number) => connH - (a - inner) * out * slope + lift;
  const oh = m.oh;
  const mainFace = inner + out * SO;
  let flush = false;
  if (eave) {
    // Flush: the connection is at / near the main eave, or the main eave trim would hang into this roof.
    const gap = mainEaveY(m, out) - connH;
    const trimBottom = m.roof.topAt(out * m.roof.dripX) - LEAN_TO.clearFt;
    flush = gap < LEAN_TO.flushFt || trimBottom < topAt(mainFace);
  }
  return {
    lt,
    eave,
    inner,
    outer,
    out,
    r0,
    r1,
    lh,
    connH,
    slope,
    cos,
    oh,
    topAt,
    mainFace,
    wallFace: outer + out * SO,
    drip: outer + out * oh,
    roofInner: flush ? mainFace : inner,
    flush,
    walls: resolveWalls(lt),
    P: eave ? (a, y, r) => [a, y, r] : (a, y, r) => [r, y, a],
    n: unit(eave ? [out * slope, 1, 0] : [0, 1, out * slope]),
    aHat: eave ? [out, 0, 0] : [0, 0, out],
    rHat: eave ? [0, 0, 1] : [1, 0, 0],
  };
}

// ── Lean-to walls ───────────────────────────────────────────────────────────

type LtWallId = 'outer' | 'front' | 'back' | 'partition';

interface LtWall {
  id: LtWallId;
  plane: PlaneRef;
  flip: boolean;
  /** Sheet outline(s) in (c, y), under the roof, before the wainscot split / hole cuts. */
  outline: P2[][];
  holes: WallHole[];
  /** Wainscot line (0 = none). */
  wainscotY: number;
  /**
   * The outline polygons that carry the wainscot (default: all of them). An
   * open / partial outer wall with a storage section: only its closed storage
   * stretch.
   */
  wainscotOutline?: P2[][];
}

/** Plane of an end wall ('front' = the spanStart end). */
function endPlane(f: LeanToFrame, id: 'front' | 'back'): PlaneRef {
  const dir = id === 'front' ? -1 : 1;
  const at = id === 'front' ? f.r0 - SO : f.r1 + SO;
  return runPlane(f, at, dir);
}

/** A wall across the lean-to at run coordinate `at`, its face looking along the run in direction `dir`. */
function runPlane(f: LeanToFrame, at: number, dir: -1 | 1): PlaneRef {
  return f.eave ? { along: 'x', at, n: [0, 0, dir], u: [dir, 0, 0] } : { along: 'z', at, n: [dir, 0, 0], u: [0, 0, -dir] };
}

/**
 * Plane of the storage PARTITION: SO off its framing line (storage.runAt)
 * toward the open part of the lean-to, face looking at it — an end wall of
 * the open part.
 */
function partitionPlane(f: LeanToFrame): PlaneRef | null {
  const st = f.walls.storage;
  return st ? runPlane(f, st.runAt + st.faces * SO, st.faces) : null;
}

function leanToWalls(f: LeanToFrame, overhangFt: number, wainscotFt: number, vertical: boolean): LtWall[] {
  const lt = f.lt;
  const walls: LtWall[] = [];
  const shown = (lt.openings ?? []).filter((o) => rendersLeanToFixture(o, f.walls));
  const hole = (o: LeanToOpening, c: number): WallHole => ({ c, w: o.widthFt, y0: o.sillFt, y1: o.sillFt + o.heightFt });
  const flip = (p: PlaneRef) => vertical && litFromRight(p.n, p.u);

  // Outer long wall: closed = floor to roof, partial = the classic eave-down band.
  // A storage section closes its stretch of an open / partial outer wall floor
  // to roof (its own outline polygon, the only one with wainscot); the rest of
  // the wall keeps its setting.
  const st = f.walls.storage;
  const storSeg = st && f.walls.side !== 'closed' ? st : null;
  if (f.walls.side !== 'open' || storSeg) {
    const top = wallTop(f, f.wallFace);
    let yBot = 0;
    if (f.walls.side === 'open') yBot = Infinity;
    else if (f.walls.side !== 'closed') {
      const geo = f.eave ? eaveSurfaces(lt, overhangFt, f.walls) : gableSurfaces(lt, overhangFt, f.walls);
      const band = sideWallPolys(geo, f.walls.side, f.lh, []);
      yBot = band.length ? Math.min(...band.flatMap((p) => p.corners.map((c) => c[1]))) : Infinity;
    }
    const outline: P2[][] = [];
    let wainscotOutline: P2[][] | undefined;
    if (!storSeg) {
      if (top - yBot > 0.02) outline.push([[f.r0, yBot], [f.r1, yBot], [f.r1, top], [f.r0, top]]);
    } else {
      const s0 = f.r0 + storSeg.segStart;
      const s1 = f.r0 + storSeg.segEnd;
      const [b0, b1] = storSeg.end === 'front' ? [s1, f.r1] : [f.r0, s0];
      if (top - yBot > 0.02 && b1 - b0 > 0.02) outline.push([[b0, yBot], [b1, yBot], [b1, top], [b0, top]]);
      const seg: P2[] = [[s0, 0], [s1, 0], [s1, top], [s0, top]];
      outline.push(seg);
      wainscotOutline = [seg];
    }
    if (outline.length) {
      const plane: PlaneRef = f.eave
        ? { along: 'z', at: f.wallFace, n: [f.out, 0, 0], u: [0, 0, -f.out] }
        : { along: 'x', at: f.wallFace, n: [0, 0, f.out], u: [f.out, 0, 0] };
      walls.push({
        id: 'outer',
        plane,
        flip: flip(plane),
        outline,
        holes: shown.filter((o) => o.wall === 'outer').map((o) => hole(o, f.r0 + o.offsetFt)),
        wainscotY: (f.walls.side === 'closed' || storSeg) && wainscotFt > 0 && wainscotFt < top - 0.02 ? wainscotFt : 0,
        ...(wainscotOutline ? { wainscotOutline } : {}),
      });
    }
  }

  // End walls: the classic outline, topped just under the sloped roof.
  const minA = Math.min(f.inner, f.outer);
  for (const id of ['front', 'back'] as const) {
    const v = f.walls[id];
    if (v === 'open') continue;
    const raw = gableOutline(v, f.inner, f.outer, f.lh, f.connH).map(([a, y]): P2 => [a, y]);
    const poly = clipHalf(raw, (p) => wallTop(f, p[0]) - p[1]);
    if (Math.abs(polyArea(poly)) < 1e-3) continue;
    const cs = poly.map((p) => p[0]);
    const minTop = Math.min(wallTop(f, Math.min(...cs)), wallTop(f, Math.max(...cs)));
    const plane = endPlane(f, id);
    walls.push({
      id,
      plane,
      flip: flip(plane),
      outline: [poly],
      holes: shown.filter((o) => o.wall === id).map((o) => hole(o, minA + o.offsetFt)),
      wainscotY: v === 'closed' && wainscotFt > 0 && wainscotFt < minTop - 0.02 ? wainscotFt : 0,
    });
  }

  // Storage PARTITION: the closed end-wall outline across the lean-to at the
  // partition (low leg at the outer wall up to the connection at the main
  // wall), topped just under the roof, cut around its openings.
  const pPlane = partitionPlane(f);
  if (pPlane) {
    const raw = gableOutline('closed', f.inner, f.outer, f.lh, f.connH).map(([a, y]): P2 => [a, y]);
    const poly = clipHalf(raw, (p) => wallTop(f, p[0]) - p[1]);
    if (Math.abs(polyArea(poly)) >= 1e-3) {
      const cs = poly.map((p) => p[0]);
      const minTop = Math.min(wallTop(f, Math.min(...cs)), wallTop(f, Math.max(...cs)));
      walls.push({
        id: 'partition',
        plane: pPlane,
        flip: flip(pPlane),
        outline: [poly],
        holes: shown.filter((o) => o.wall === 'partition').map((o) => hole(o, minA + o.offsetFt)),
        wainscotY: wainscotFt > 0 && wainscotFt < minTop - 0.02 ? wainscotFt : 0,
      });
    }
  }
  return walls;
}

// ── Model: frames + walls + corner relations ────────────────────────────────

/** Plan point (world x, z). */
type Plan = [number, number];

interface Miter {
  /** Hip line from P (the two roofs' inner edges) to Q (their overhang corner), plan. */
  P: Plan;
  Q: Plan;
  /** A plan point on the side of PQ this roof keeps. */
  keep: Plan;
}

interface LeanToModel {
  f: LeanToFrame;
  walls: LtWall[];
  /** Hip miter at an end shared with another lean-to (two lean-tos wrapping a corner). */
  miter: Partial<Record<'front' | 'back', Miter>>;
}

/** Main corner (sx, zs) an end wall shares its plane with (the lean-to runs to that main corner), else null. */
function endCorner(f: LeanToFrame, m: MainCtx, id: 'front' | 'back'): { sx: -1 | 1; zs: -1 | 1 } | null {
  const tol = EPS;
  if (f.eave) {
    if (id === 'front' && Math.abs(f.r0 + m.halfL) < tol) return { sx: f.out, zs: -1 };
    if (id === 'back' && Math.abs(f.r1 - m.halfL) < tol) return { sx: f.out, zs: 1 };
  } else {
    if (id === 'front' && Math.abs(f.r0 + m.halfW) < tol) return { sx: -1, zs: f.out };
    if (id === 'back' && Math.abs(f.r1 - m.halfW) < tol) return { sx: 1, zs: f.out };
  }
  return null;
}

/** An eave and a gable lean-to meeting at a main corner (e.g. L_CA). */
interface Junction {
  sx: -1 | 1;
  zs: -1 | 1;
  eave: LeanToModel;
  eaveEnd: 'front' | 'back';
  gable: LeanToModel;
  gableEnd: 'front' | 'back';
}

function buildModels(s: StructureModel, wainscotFt: number, wallOrientation: PanelOrientation) {
  const m = mainCtx(s);
  const vertical = sheetOrientation(wallOrientation) === 'vertical';
  const models: LeanToModel[] = [];
  for (const lt of s.leanTos ?? []) {
    const f = leanToFrame(lt, m);
    if (!f) continue;
    models.push({ f, walls: leanToWalls(f, s.roofOverhangFt, wainscotFt, vertical), miter: {} });
  }
  const junctions: Junction[] = [];
  for (const a of models) {
    if (!a.f.eave) continue;
    for (const b of models) {
      if (b.f.eave) continue;
      for (const ea of ['front', 'back'] as const) {
        const ca = endCorner(a.f, m, ea);
        if (!ca) continue;
        for (const eb of ['front', 'back'] as const) {
          const cb = endCorner(b.f, m, eb);
          if (!cb || cb.sx !== ca.sx || cb.zs !== ca.zs) continue;
          junctions.push({ sx: ca.sx, zs: ca.zs, eave: a, eaveEnd: ea, gable: b, gableEnd: eb });
          // Their roof overhangs overlap in the corner square: miter on the hip
          // line P -> Q; each roof keeps the side where it is the LOWER one
          // (an outside corner is a hip).
          const P: Plan = [a.f.roofInner, b.f.roofInner];
          const Q: Plan = [eb === 'front' ? b.f.r0 - b.f.oh : b.f.r1 + b.f.oh, ea === 'front' ? a.f.r0 - a.f.oh : a.f.r1 + a.f.oh];
          a.miter[ea] = { P, Q, keep: [Q[0], P[1]] };
          b.miter[eb] = { P, Q, keep: [P[0], Q[1]] };
        }
      }
    }
  }
  return { m, models, junctions };
}

/** Main-wall ShellWall a lean-to attaches to (null = none). */
function mainWallFor(layout: ShellLayout, f: LeanToFrame): ShellWall | null {
  return (
    layout.walls.find((w) =>
      f.eave
        ? w.plane.along === 'z' && Math.sign(w.plane.at) === f.out
        : w.plane.along === 'x' && w.plane.id !== 'partition' && Math.sign(w.plane.at) === f.out,
    ) ?? null
  );
}

// ── Main-shell interplay (EnhancedRoof / EnhancedTrim) ──────────────────────

/**
 * Main roof cut-backs for the lean-tos (render only). Eave lean-to FLUSH with
 * the main eave: the main eave overhang + trim are skipped along its roof
 * (+ LEAN_TO.cutGap each end, so the main overhang's closing rake sits just
 * outside the lean-to rake). Gable lean-to: only where the main gable
 * overhang / rake would hang into its roof (the eave corners when it
 * connects near the eave).
 */
export function leanToRoofCuts(s: StructureModel): MainRoofCuts {
  const cuts: MainRoofCuts = { eave: [], gable: [] };
  if (!s.leanTos?.length) return cuts;
  const m = mainCtx(s);
  const r = m.roof;
  const zE = r.gableZ;
  for (const lt of s.leanTos) {
    const f = leanToFrame(lt, m);
    if (!f) continue;
    if (f.eave) {
      if (!f.flush) continue;
      const a = f.r0 - f.oh;
      const b = f.r1 + f.oh;
      cuts.eave.push({
        sx: f.out,
        z0: a <= -zE + LEAN_TO.cutGap ? -zE : a - LEAN_TO.cutGap,
        z1: b >= zE - LEAN_TO.cutGap ? zE : b + LEAN_TO.cutGap,
      });
      continue;
    }
    // Gable lean-to: the main roof collides where its top is within clearFt of this roof's top.
    const thr = f.topAt(f.mainFace) + LEAN_TO.clearFt;
    const xa = f.r0 - f.oh - LEAN_TO.cutGap;
    const xb = f.r1 + f.oh + LEAN_TO.cutGap;
    const push = (x0: number, x1: number) => {
      const lo = Math.max(x0, xa, -r.dripX);
      const hi = Math.min(x1, xb, r.dripX);
      if (hi - lo > EPS) cuts.gable.push({ sz: f.out, x0: lo, x1: hi, capY: f.topAt(f.mainFace) });
    };
    if (r.mono) {
      // top(x) = ridgeY - (x + W/2) * slope falls toward +X.
      if (r.slope < 1e-9) {
        if (r.ridgeY < thr) push(-r.dripX, r.dripX);
      } else push((r.ridgeY - thr) / r.slope - m.halfW, r.dripX);
    } else {
      for (const sx of [-1, 1] as const) {
        let from: number;
        if (r.slope < 1e-9) {
          if (r.ridgeY >= thr) continue;
          from = 0;
        } else from = Math.max(0, (r.ridgeY - thr) / r.slope);
        if (from >= r.dripX) continue;
        if (sx > 0) push(from, r.dripX);
        else push(-r.dripX, -from);
      }
    }
  }
  return cuts;
}

/** Merge two vertical spans into one or two disjoint spans (sorted). */
export function mergeSpans(a: [number, number], b: [number, number]): [number, number][] {
  const [p, q] = a[0] <= b[0] ? [a, b] : [b, a];
  return q[0] <= p[1] + EPS ? [[p[0], Math.max(p[1], q[1])]] : [p, q];
}

/** Main corner (sx, zs) at the spanStart (-1) / spanEnd (+1) end of a lean-to's run. */
const runEndCorner = (f: LeanToFrame, end: -1 | 1): { sx: -1 | 1; zs: -1 | 1 } => (f.eave ? { sx: f.out, zs: end } : { sx: end, zs: f.out });

/**
 * Where a lean-to roof overhangs PAST a main corner. E = run coordinate of
 * the main corner trim's outer face (the main end wall's corner plate for an
 * eave lean-to, the side wall's for a gable lean-to); aCut = across coordinate
 * of the main corner plate's outer face on the attached wall. At an end with
 * clip = true (the roof reaches past +-E, the end is not mitered, the lean-to
 * is not flush, and a main corner trim stands over the lean-to roof band
 * there) the roof and rake stop at aCut beyond +-E and a closure plate over
 * `band` (leanToBatches) continues the corner trim over that roof end.
 */
function cornerClip(f: LeanToFrame, m: MainCtx, corners: ShellLayout['corners'], mitered: Partial<Record<'front' | 'back', unknown>>) {
  const T = SHELL.trimT;
  const E = (f.eave ? m.halfL : m.halfW) + SO + T;
  const aCut = f.mainFace + f.out * T;
  const band = closureBand(f, aCut);
  const trimAt = (end: -1 | 1) => {
    const k = runEndCorner(f, end);
    return corners.some((c) => c.end !== 'partition' && c.sx === k.sx && c.zs === k.zs && c.y0 < band[1] && c.y1 > band[0]);
  };
  const rS = f.r0 - f.oh;
  const rE = f.r1 + f.oh;
  return {
    E,
    aCut,
    band,
    front: !f.flush && !mitered.front && rS < -E - EPS && trimAt(-1),
    back: !f.flush && !mitered.back && rE > E + EPS && trimAt(1),
  };
}

/** Vertical band [yLo, yHi] a lean-to rake (face + leg) covers at across a, plumb. */
function closureBand(f: LeanToFrame, a: number): [number, number] {
  const k = SHELL.rake;
  const T = SHELL.trimT;
  const y = f.topAt(a);
  return [y + (k.faceCenter - k.face / 2) / f.cos, y + Math.max(k.faceCenter + k.face / 2, k.legCenter + T / 2) / f.cos];
}

// ── Batches ─────────────────────────────────────────────────────────────────

export interface LeanToShellInput {
  structure: StructureModel;
  /** Main-building openings (the flashing breaks at a main opening crossing it). */
  mainOpenings: Opening[];
  wallOrientation: PanelOrientation;
  roofOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

interface Zone {
  c0: number;
  c1: number;
  y0: number;
  y1: number;
}

/** A flashing run on a main wall: along-wall [c0, c1], face top t0 at c0 / t1 at c1 (= the band top when fully sheeted). */
type Cover = [c0: number, c1: number, t0: number, t1: number];

/** A flashing face shorter than this (where the wall top dips into the band) is not drawn. */
const MIN_FLASH_FACE = 0.06;

/**
 * Sheeted along-wall runs of a main wall over the flashing band [y0, y1],
 * inside [lo, hi], never across a main opening. Where the wall's sheet top
 * dips into the band (a gable end wall near its eave corners, under the main
 * rake) the run is kept with its face top clipped to the sheet top (sloped),
 * as long as at least MIN_FLASH_FACE of it is sheeted.
 */
function mainCoverage(w: ShellWall | null, y0: number, y1: number, lo: number, hi: number): Cover[] {
  if (!w || hi - lo <= EPS) return [];
  const bps: number[] = [lo, hi];
  for (const r of w.regions) bps.push(r.c0, r.c1);
  for (const h of w.holes) bps.push(h.c - h.w / 2, h.c + h.w / 2);
  for (const poly of w.polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      bps.push(p[0]);
      for (const y of [y0, y0 + MIN_FLASH_FACE, y1]) {
        if ((p[1] - y) * (q[1] - y) < 0) bps.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
    }
  }
  const xs = bps
    .filter((c) => c >= lo && c <= hi)
    .sort((a, b) => a - b)
    .filter((c, i, arr) => i === 0 || c - arr[i - 1] > 1e-7);
  const runs: Cover[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const mid = (a + b) / 2;
    const sp = sheetSpanAt(w, mid);
    const hole = w.holes.some((h) => mid > h.c - h.w / 2 && mid < h.c + h.w / 2 && h.y0 < y1 && h.y1 > y0);
    if (!sp || sp[0] > y0 + 1e-6 || sp[1] < y0 + MIN_FLASH_FACE - 1e-6 || hole) continue;
    let t0 = y1;
    let t1 = y1;
    if (sp[1] < y1 - 1e-6) {
      // Sheet top inside the band on this segment (linear between the breakpoints): clip the face to it.
      const e = Math.min(0.01, (b - a) / 4);
      const ta = sheetSpanAt(w, a + e)?.[1] ?? sp[1];
      const tb = sheetSpanAt(w, b - e)?.[1] ?? sp[1];
      const k = (tb - ta) / (b - a - 2 * e);
      t0 = Math.min(y1, ta - k * e);
      t1 = Math.min(y1, tb + k * e);
    }
    const prev = runs[runs.length - 1];
    const full = (c: Cover) => c[2] === y1 && c[3] === y1;
    if (prev && Math.abs(prev[1] - a) < 1e-7 && full(prev) && t0 === y1 && t1 === y1) prev[1] = b;
    else runs.push([a, b, t0, t1]);
  }
  // Drop slivers: chains of touching runs shorter than 0.05 in all.
  const out: Cover[] = [];
  for (let i = 0; i < runs.length; ) {
    let j = i;
    while (j + 1 < runs.length && Math.abs(runs[j + 1][0] - runs[j][1]) < 1e-7) j++;
    if (runs[j][1] - runs[i][0] > 0.05) out.push(...runs.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

/**
 * Every enhanced lean-to: walls + wainscot, roof skin + underside, eave /
 * rake / flashing / hip trims (no cast: roof trims), corner / base / bottom /
 * Z trims (cast, like the main wall trims). One merged batch per material
 * for all lean-tos together.
 */
export function leanToBatches(inp: LeanToShellInput): ShellBatch[] {
  const s = inp.structure;
  if (!s.leanTos?.length) return [];
  const wH = inp.wainscot.enabled ? inp.wainscot.heightFt : 0;
  const { m, models, junctions } = buildModels(s, wH, inp.wallOrientation);
  if (!models.length) return [];
  const layout = shellLayout({
    structure: s,
    openings: inp.mainOpenings,
    wallOrientation: inp.wallOrientation,
    colors: inp.colors,
    wainscot: inp.wainscot,
  });
  // The main corner trims as EnhancedTrim draws them (never cut by a lean-to): the flashing stops against them.
  const mainCorners = layout.corners;
  const set = new BatchSet();
  const wallOrient = sheetOrientation(inp.wallOrientation);
  const roofOrient = sheetOrientation(inp.roofOrientation);
  const trimSpec = { surface: 'trim' as const, color: inp.colors.trim };
  const wallTrim = set.get(trimSpec, true);
  const roofTrim = set.get(trimSpec, false);
  const T = SHELL.trimT;
  const cw = SHELL.cornerWidth;
  const L = LEAN_TO.trimLift;

  const zones = new Map<LtWall, Zone[]>();
  const addZone = (w: LtWall | undefined, z: Zone) => {
    if (!w) return;
    const list = zones.get(w) ?? [];
    list.push({ c0: Math.min(z.c0, z.c1), c1: Math.max(z.c0, z.c1), y0: z.y0, y1: z.y1 });
    zones.set(w, list);
  };
  const zoneGaps = (w: LtWall, y: number): [number, number][] =>
    (zones.get(w) ?? []).filter((z) => y >= z.y0 - EPS && y <= z.y1 + EPS).map((z) => [z.c0, z.c1]);
  const wallOf = (md: LeanToModel, id: LtWallId) => md.walls.find((w) => w.id === id);
  /** World aabb from two local (a, y, r) corners. */
  const localBox = (e: Emitter, f: LeanToFrame, a0: number, a1: number, y0: number, y1: number, r0: number, r1: number) =>
    aabb(e, f.P(a0, y0, r0), f.P(a1, y1, r1));
  /** Keep a corner plate under the roof over its across extent [a0, a1]. */
  const under = (f: LeanToFrame, a0: number, a1: number) => Math.min(wallTop(f, a0), wallTop(f, a1));
  /**
   * Inside corner where a wall across the lean-to (an end wall part-way along
   * the main wall, or the storage partition) meets the main wall's sheeting:
   * its sheet plane at run ePlane, face looking along the run in `dir`.
   */
  const insideCorner = (f: LeanToFrame, end: LtWall, ePlane: number, dir: -1 | 1) => {
    const mw = mainWallFor(layout, f);
    const a = mw ? sheetSpanAt(mw, ePlane) : null;
    const b = spanAt(end.outline, f.mainFace);
    if (a && b) {
      const y0 = Math.max(a[0], b[0]);
      const y1 = Math.min(a[1], b[1], under(f, f.mainFace, f.mainFace + f.out * cw));
      if (y1 - y0 >= SHELL.minCornerFt) {
        addZone(end, { c0: f.mainFace, c1: f.mainFace + f.out * cw, y0, y1 });
        // The main-wall plate sits on top of the main base trim.
        const yB = y0 < EPS ? SHELL.baseHeight : y0;
        plates.push(() => {
          localBox(wallTrim, f, f.mainFace, f.mainFace + f.out * cw, y0, y1, ePlane + dir * L, ePlane + dir * T);
          if (y1 - yB > 0.05) localBox(wallTrim, f, f.mainFace + f.out * L, f.mainFace + f.out * T, yB, y1, ePlane + dir * L, ePlane + dir * cw);
        });
      }
    }
  };

  // ── Corner plates (collected first: their zones break the base / bottom / Z trims) ──
  const plates: (() => void)[] = [];
  for (const md of models) {
    const { f } = md;
    const side = wallOf(md, 'outer');
    for (const id of ['front', 'back'] as const) {
      const end = wallOf(md, id);
      const dir = id === 'front' ? -1 : 1;
      const rEnd = id === 'front' ? f.r0 : f.r1;
      const ePlane = rEnd + dir * SO;
      // Outer corner: outer wall meets this end wall (two-plate L, end plate wraps the corner).
      // It runs the full height of both sheeted edges (their merged spans), so a
      // shorter wall never leaves the other wall's edge raw above / below it.
      if (side && end) {
        const a = spanAt(side.outline, rEnd);
        const b = spanAt(end.outline, f.outer);
        if (a && b) {
          const top = under(f, f.wallFace - f.out * cw, f.wallFace + f.out * T);
          for (const [s0, s1] of mergeSpans(a, b)) {
            const y0 = s0;
            const y1 = Math.min(s1, top);
            if (y1 - y0 < SHELL.minCornerFt) continue;
            addZone(side, { c0: ePlane - dir * cw, c1: ePlane, y0, y1 });
            addZone(end, { c0: f.wallFace - f.out * cw, c1: f.wallFace + f.out * T, y0, y1 });
            plates.push(() => {
              // (both plates stand trimLift off their sheets; the side plate reaches the end plate's back)
              localBox(wallTrim, f, f.wallFace + f.out * L, f.wallFace + f.out * T, y0, y1, ePlane - dir * cw, ePlane + dir * L);
              localBox(wallTrim, f, f.wallFace - f.out * cw, f.wallFace + f.out * T, y0, y1, ePlane + dir * L, ePlane + dir * T);
            });
          }
        }
      }
      if (!end) continue;
      const corner = endCorner(f, m, id);
      if (corner) {
        // This end wall continues a main wall plane: it butts against the
        // full-height main corner trim, whose plate covers
        // [mainFace - cornerWidth, mainFace + T] on this plane (EnhancedTrim).
        // Its own base / bottom / Z trims break there.
        const k = mainCorners.find((c) => c.end !== 'partition' && c.sx === corner.sx && c.zs === corner.zs);
        if (k) addZone(end, { c0: f.mainFace - f.out * cw, c1: f.mainFace + f.out * T, y0: k.y0, y1: k.y1 });
        continue;
      }
      // Inside corner: this end wall meets the main wall part-way along it.
      insideCorner(f, end, ePlane, dir);
    }

    // Storage PARTITION (its face looks along the run toward the open part):
    // an inside corner where it meets the main wall (same as an end wall
    // part-way along it) and, when the outer wall is open / partial, an
    // OUTSIDE corner where the closed storage stretch ends at it — a two-plate
    // L like an end corner; on a partial wall its outer-wall plate stops under
    // the eave-down band, which carries on past the partition.
    const st = f.walls.storage;
    const part = wallOf(md, 'partition');
    if (st && part) {
      const dir = st.faces;
      const ePlane = st.runAt + dir * SO;
      if (side && f.walls.side !== 'closed') {
        const b = spanAt(part.outline, f.outer);
        const top = under(f, f.wallFace - f.out * cw, f.wallFace + f.out * T);
        const ySide = Math.min(top, f.walls.side === 'open' ? top : f.lh - sideBandHeight(f.walls.side, f.lh));
        const yEnd = b ? Math.min(b[1], top) : 0;
        if (ySide >= SHELL.minCornerFt) {
          addZone(side, { c0: ePlane - dir * cw, c1: ePlane, y0: 0, y1: ySide });
          plates.push(() => localBox(wallTrim, f, f.wallFace + f.out * L, f.wallFace + f.out * T, 0, ySide, ePlane - dir * cw, ePlane + dir * L));
        }
        if (b && yEnd - b[0] >= SHELL.minCornerFt) {
          addZone(part, { c0: f.wallFace - f.out * cw, c1: f.wallFace + f.out * T, y0: b[0], y1: yEnd });
          // Below the band the partition plate wraps the corner (to the outer
          // face, like an end corner); behind a partial band it stops just
          // inside the band (never poking through the sheeting).
          const yWrap = Math.max(b[0], Math.min(yEnd, ySide));
          plates.push(() => {
            if (yWrap - b[0] > 0.02) localBox(wallTrim, f, f.wallFace - f.out * cw, f.wallFace + f.out * T, b[0], yWrap, ePlane + dir * L, ePlane + dir * T);
            if (yEnd - yWrap > 0.02) localBox(wallTrim, f, f.wallFace - f.out * cw, f.wallFace - f.out * L, yWrap, yEnd, ePlane + dir * L, ePlane + dir * T);
          });
        }
      }
      insideCorner(f, part, ePlane, dir);
    }
  }
  // Junction of two lean-tos wrapping a main corner: inside corner between their end walls.
  for (const j of junctions) {
    const A = j.eave;
    const B = j.gable;
    const ea = wallOf(A, j.eaveEnd);
    const eb = wallOf(B, j.gableEnd);
    if (!ea || !eb) continue;
    const xw = j.sx * m.xw;
    const zw = j.zs * m.zF;
    const a = spanAt(ea.outline, xw);
    const b = spanAt(eb.outline, zw);
    if (!a || !b) continue;
    const y0 = Math.max(a[0], b[0]);
    const y1 = Math.min(a[1], b[1], under(A.f, A.f.mainFace, A.f.mainFace + A.f.out * cw), under(B.f, B.f.mainFace, B.f.mainFace + B.f.out * cw));
    if (y1 - y0 < SHELL.minCornerFt) continue;
    addZone(ea, { c0: xw, c1: xw + j.sx * cw, y0, y1 });
    addZone(eb, { c0: zw, c1: zw + j.zs * cw, y0, y1 });
    plates.push(() => {
      aabb(wallTrim, [xw + j.sx * L, y0, zw + j.zs * L], [xw + j.sx * cw, y1, zw + j.zs * T]); // on the eave lean-to's end wall
      aabb(wallTrim, [xw + j.sx * L, y0, zw + j.zs * L], [xw + j.sx * T, y1, zw + j.zs * cw]); // on the gable lean-to's end wall
    });
  }

  // ── Walls, wainscot, base / bottom / Z trims ──
  for (const md of models) {
    for (const w of md.walls) {
      const uv = wallUV(w.plane);
      const emit = (pts: P2[], wainscot: boolean) =>
        polygon(
          set.get({ surface: 'wall', color: wainscot ? inp.colors.wainscot : inp.colors.walls, orientation: wallOrient, flipX: w.flip }, true),
          pts.map(([c, y]) => wallPoint(w.plane, c, y)),
          w.plane.n,
          uv,
        );
      for (const poly of w.outline) {
        const parts: { pts: P2[]; wainscot: boolean }[] = w.wainscotY && (!w.wainscotOutline || w.wainscotOutline.includes(poly))
          ? [
              { pts: clipHalf(poly, (p) => w.wainscotY - p[1]), wainscot: true },
              { pts: clipHalf(poly, (p) => p[1] - w.wainscotY), wainscot: false },
            ]
          : [{ pts: poly, wainscot: false }];
        for (const part of parts) for (const pc of cutHoles(part.pts, w.holes)) emit(pc, part.wainscot);
      }

      const plate = (c0: number, c1: number, y0: number, y1: number, o0: number, o1: number) =>
        aabb(wallTrim, wallPoint(w.plane, c0, y0, o0), wallPoint(w.plane, c1, y1, o1));
      const floorCuts = w.holes.filter((h) => h.y0 <= SHELL.floorSillFt).map((h): [number, number] => [h.c - h.w / 2, h.c + h.w / 2]);
      const bt = SHELL.bottomTrim;
      for (const poly of w.outline) {
        const ccw = polyArea(poly) > 0;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i];
          const q = poly[(i + 1) % poly.length];
          const dx = q[0] - p[0];
          const dy = q[1] - p[1];
          const len = Math.hypot(dx, dy);
          if (len < 0.05) continue;
          const ny = (ccw ? -dx : dx) / len; // outward normal's y
          if (ny > -0.7) continue; // bottom edges only
          const ca = Math.min(p[0], q[0]);
          const cb = Math.max(p[0], q[0]);
          const yAt = (c: number) => p[1] + ((c - p[0]) / dx) * dy;
          if (Math.max(p[1], q[1]) < EPS) {
            // Sheet meets the slab: base trim, broken at floor-level openings and corner plates.
            for (const [a, b] of subtractRanges(ca, cb, [...floorCuts, ...zoneGaps(w, 0)])) plate(a, b, 0, SHELL.baseHeight, L, T);
            continue;
          }
          // Hanging bottom edge (partial band, gable-only / half-end header, q-band end): bottom trim.
          const yMid = (p[1] + q[1]) / 2;
          const cuts = w.holes
            .filter((h) => h.y0 < Math.max(p[1], q[1]) + EPS && h.y1 > Math.min(p[1], q[1]) - EPS)
            .map((h): [number, number] => [h.c - h.w / 2, h.c + h.w / 2]);
          for (const [a, b] of subtractRanges(ca, cb, [...cuts, ...zoneGaps(w, yMid)])) {
            if (Math.abs(dy) < 1e-6) {
              plate(a, b, p[1] - bt.below, p[1] + bt.above, L, T);
              continue;
            }
            // Sloped edge (q-band end): a plate along the edge in the wall plane.
            const A = wallPoint(w.plane, a, yAt(a));
            const B = wallPoint(w.plane, b, yAt(b));
            const x = unit([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
            const z = w.plane.n;
            let y = unit([z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]);
            if (y[1] < 0) y = [-y[0], -y[1], -y[2]];
            const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
            box(wallTrim, { o: A, x, y, z }, [len / 2, (bt.above - bt.below) / 2, (L + T) / 2], [len, bt.above + bt.below, T - L]);
          }
        }
      }
      // Wainscot Z-trim (classic crossing rule: +-0.08 around the line).
      if (w.wainscotY) {
        const zt = SHELL.zTrim;
        const cuts = w.holes
          .filter((h) => h.y0 < w.wainscotY + 0.08 && h.y1 > w.wainscotY - 0.08)
          .map((h): [number, number] => [h.c - h.w / 2, h.c + h.w / 2]);
        for (const [c0, c1] of chordAt(w.wainscotOutline ?? w.outline, w.wainscotY))
          for (const [a, b] of subtractRanges(c0, c1, [...cuts, ...zoneGaps(w, w.wainscotY)]))
            plate(a, b, w.wainscotY - zt.below, w.wainscotY - zt.below + zt.face, zt.standoff, zt.standoff + T);
      }
    }
  }
  for (const p of plates) p();

  // ── Roofs, eave / rake trims, hip caps, flashing ──
  const claimed = new Set(junctions.map((j) => `${j.sx},${j.zs}`));
  for (const md of models) {
    const { f } = md;
    const rS = f.r0 - f.oh;
    const rE = f.r1 + f.oh;
    const uDir: V3 = f.eave ? [0, 0, -f.out] : [f.out, 0, 0];
    const flip = roofOrient === 'vertical' && litFromRight(f.n, uDir);
    const acrossOf = (p: Plan) => (f.eave ? p[0] : p[1]);
    // Past a main corner the roof stops at the corner trim's outer face (clip).
    const clip = cornerClip(f, m, mainCorners, md.miter);
    const rect = (a0: number, a1: number, r0: number, r1: number): Plan[] =>
      [
        [a0, r0],
        [a1, r0],
        [a1, r1],
        [a0, r1],
      ].map(([a, r]) => {
        const w = f.P(a, 0, r);
        return [w[0], w[2]] as Plan;
      });
    // Convex plan pieces: the whole roof, or (clipped) the full-length strip
    // outside the corner-trim plane + the strip into the wall between the corners.
    let pieces: Plan[][] =
      clip.front || clip.back
        ? [rect(clip.aCut, f.drip, rS, rE), rect(f.roofInner, clip.aCut, clip.front ? -clip.E : rS, clip.back ? clip.E : rE)]
        : [rect(f.roofInner, f.drip, rS, rE)];
    for (const mt of Object.values(md.miter)) {
      if (!mt) continue;
      const side = (p: Plan) => (mt.Q[0] - mt.P[0]) * (p[1] - mt.P[1]) - (mt.Q[1] - mt.P[1]) * (p[0] - mt.P[0]);
      const keep = Math.sign(side(mt.keep)) || 1;
      pieces = pieces.map((pc) => clipHalf(pc, (p) => keep * side(p)));
    }
    const uvOf = (p: V3): UV => [p[0] * uDir[0] + p[1] * uDir[1] + p[2] * uDir[2], -Math.abs((f.eave ? p[0] : p[2]) - f.inner) / f.cos];
    for (const plan of pieces) {
      if (plan.length < 3) continue;
      const pts = plan.map((p): V3 => [p[0], f.topAt(acrossOf(p)), p[1]]);
      polygon(set.get({ surface: 'roof', color: inp.colors.roof, orientation: roofOrient, flipX: flip }, false), pts, f.n, uvOf);
      polygon(
        set.get({ surface: 'roofUnder' }, false),
        pts.map((p): V3 => [p[0], p[1] - SHELL.roofUnderGap, p[2]]),
        [-f.n[0], -f.n[1], -f.n[2]],
        uvOf,
      );
    }

    const at = (a: number, r: number) => f.P(a, f.topAt(a), r);
    // Eave L trim along the outer drip edge (+ one plate past each end to close against the rakes).
    eaveTrim(roofTrim, at(f.drip, rS - SHELL.trimT), at(f.drip, rE + SHELL.trimT), f.n, f.aHat);
    // Rake L trims up both ends; at a mitered end the rake stops at the hip.
    for (const id of ['front', 'back'] as const) {
      const r = id === 'front' ? rS : rE;
      const mt = md.miter[id];
      const clipped = clip[id];
      const aEnd = mt ? acrossOf(mt.Q) : clipped ? clip.aCut : f.roofInner;
      const sideDir: V3 = id === 'front' ? [-f.rHat[0], 0, -f.rHat[2]] : f.rHat;
      // Past a main corner: a PLUMB end on the closure (never leaning into the corner trim) ...
      const cutTo = clipped ? plumbAt(f.eave ? 'x' : 'z', clip.aCut) : null;
      if (Math.abs(aEnd - f.drip) > 0.05) rakeTrim(roofTrim, at(f.drip, r), at(aEnd, r), f.n, sideDir, null, cutTo);
      // ... and a closure plate continuing the main corner trim's plate on the
      // attached wall out over the roof end, from under the rake face to its top.
      if (clipped) {
        const rOut = id === 'front' ? r - T : r + T;
        const rIn = id === 'front' ? -clip.E : clip.E;
        localBox(roofTrim, f, f.mainFace, clip.aCut, clip.band[0], clip.band[1], rOut, rIn);
      }
      if (mt) {
        // Hip cap: a plate on this roof along Q -> P (the other roof lays its own).
        const from: V3 = [mt.Q[0], f.topAt(acrossOf(mt.Q)), mt.Q[1]];
        const to: V3 = [mt.P[0], f.topAt(acrossOf(mt.P)), mt.P[1]];
        const toward: V3 = [mt.keep[0] - mt.P[0], 0, mt.keep[1] - mt.P[1]];
        const { f: fr, len, out } = edgeFrame(from, to, f.n, toward);
        box(roofTrim, fr, [len / 2, LEAN_TO.hip.lift + T / 2, (out * LEAN_TO.hip.half) / 2], [len, T, LEAN_TO.hip.half]);
      }
    }

    // Flashing where this roof meets the main building.
    const mw = mainWallFor(layout, f);
    const yJ = f.topAt(f.mainFace);
    const fl = LEAN_TO.flash;
    const legOn = (e: Emitter, a: number, y: number, c0: number, c1: number, up: V3, toward: V3, width: number, lift: number) => {
      const { f: fr, len, out } = edgeFrame(f.P(a, y, c0), f.P(a, y, c1), up, toward);
      box(e, fr, [len / 2, lift + T / 2, (out * width) / 2], [len, T, width]);
    };
    if (f.flush && f.eave) {
      // Pitch-break flashing over the joint of the two roofs (the main eave
      // overhang is skipped along this lean-to: leanToRoofCuts), with a riser
      // over any step between them.
      const sx = f.out;
      const zE = m.roof.gableZ;
      const c0 = Math.max(rS, -zE);
      const c1 = Math.min(rE, zE);
      if (c1 - c0 > 0.05) {
        const mainTop = m.roof.topAt(sx * m.xw);
        const mainN = m.roof.mono ? unit([m.roof.slope, 1, 0]) : unit([sx * m.roof.slope, 1, 0]);
        legOn(roofTrim, f.mainFace, mainTop, c0, c1, mainN, [-sx, 0, 0], fl.leg, fl.lift);
        legOn(roofTrim, f.mainFace, yJ, c0, c1, f.n, f.aHat, fl.leg, fl.lift);
        const lo = Math.min(mainTop, yJ);
        const hi = Math.max(mainTop, yJ);
        if (hi - lo > T) localBox(roofTrim, f, f.mainFace, f.mainFace + f.out * T, lo, hi + T, c0, c1);
      }
    } else if (mw) {
      // Face ON the main wall's sheeting face + a leg lying on the lean-to roof,
      // only where that wall is sheeted across the flashing height (an open
      // main side gets none).
      const y0 = yJ - fl.below;
      const y1 = y0 + fl.face;
      const endLo = f.eave ? -m.halfL : -m.halfW;
      const endHi = -endLo;
      const cornerAt = (end: -1 | 1) => runEndCorner(f, end);
      // Is a main corner trim standing over this flashing band at that end?
      const cornerKept = (end: -1 | 1) => {
        const k = cornerAt(end);
        return mainCorners.some((c) => c.end !== 'partition' && c.sx === k.sx && c.zs === k.zs && c.y0 < y1 - EPS && c.y1 > y0 + EPS);
      };
      // Its plate on this wall reaches cornerWidth in from the corner face (= inset from the framing line).
      const inset = SHELL.cornerWidth - SO;
      // Past the corner the leg reaches over the corner when the roof does; a
      // gable lean-to leaves the corner plate to an eave lean-to sharing it.
      const ext = (sxz: { sx: number; zs: number }) => SO + (!f.eave && claimed.has(`${sxz.sx},${sxz.zs}`) ? 0 : T);
      /** A face whose top follows a dipping wall top (t0 at c0 -> t1 at c1): outer face, top, ends. */
      const slopedFace = (c0: number, c1: number, t0: number, t1: number) => {
        const a0 = f.mainFace;
        const a1 = f.mainFace + f.out * T;
        const len = Math.hypot(c1 - c0, t1 - t0);
        const r = f.rHat;
        const back: V3 = [-r[0], -r[1], -r[2]];
        const topN: V3 = [(-r[0] * (t1 - t0)) / len, (c1 - c0) / len, (-r[2] * (t1 - t0)) / len];
        polygon(roofTrim, [f.P(a1, y0, c0), f.P(a1, y0, c1), f.P(a1, t1, c1), f.P(a1, t0, c0)], f.aHat);
        polygon(roofTrim, [f.P(a0, t0, c0), f.P(a1, t0, c0), f.P(a1, t1, c1), f.P(a0, t1, c1)], topN);
        polygon(roofTrim, [f.P(a0, y0, c0), f.P(a1, y0, c0), f.P(a1, t0, c0), f.P(a0, t0, c0)], back);
        polygon(roofTrim, [f.P(a0, y0, c1), f.P(a1, y0, c1), f.P(a1, t1, c1), f.P(a0, t1, c1)], r);
      };
      for (const [c0, c1, t0, t1] of mainCoverage(mw, y0, y1, rS, rE)) {
        let f0 = c0;
        let f1 = c1;
        let l0 = c0;
        let l1 = c1;
        if (Math.abs(c0 - endLo) < 0.03) {
          if (rS < c0 - EPS) l0 = Math.max(rS, c0 - ext(cornerAt(-1)));
          // The face stops against a standing corner trim (never through it); with none it wraps like the leg.
          f0 = cornerKept(-1) ? Math.max(c0, endLo + inset) : l0;
        }
        if (Math.abs(c1 - endHi) < 0.03) {
          if (rE > c1 + EPS) l1 = Math.min(rE, c1 + ext(cornerAt(1)));
          f1 = cornerKept(1) ? Math.min(c1, endHi - inset) : l1;
        }
        if (f1 - f0 > 1e-3) {
          // (its back face lies on the main sheet: lapped, or it z-fights through it seen from inside the main building)
          if (t0 >= y1 && t1 >= y1) aabb(roofTrim, f.P(f.mainFace, y0, f0), f.P(f.mainFace + f.out * T, y1, f1), lapOn(mw.plane));
          else {
            const topAt = (c: number) => Math.min(y1, t0 + ((c - c0) / (c1 - c0)) * (t1 - t0));
            slopedFace(f0, f1, topAt(f0), topAt(f1));
          }
        }
        legOn(roofTrim, f.mainFace, yJ, l0, l1, f.n, f.aHat, fl.leg, fl.lift);
      }
    }
  }
  return set.build();
}

/** Memo key of every lean-to batch input. */
export function leanToBatchKey(inp: LeanToShellInput): string {
  const s = inp.structure;
  return JSON.stringify([
    (s.leanTos ?? []).map((lt) => [
      lt.id,
      lt.attachedSide,
      lt.inner,
      lt.outer,
      lt.spanStart,
      lt.spanEnd,
      lt.lowLegHeightFt,
      lt.peakHeightFt,
      lt.enclosure,
      lt.customWalls ?? null,
      (lt.openings ?? []).map((o) => [o.type, o.wall, o.widthFt, o.heightFt, o.sillFt, o.offsetFt]),
      lt.storage ?? null,
    ]),
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
    inp.mainOpenings.map((o) => [o.side, o.offset, o.sillHeight, o.width, o.height]),
    inp.wallOrientation,
    inp.roofOrientation,
    inp.colors,
    inp.wainscot.enabled ? inp.wainscot.heightFt : 0,
  ]);
}
