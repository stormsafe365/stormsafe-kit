import type { LeanToOpening, Opening, WallSide } from '@/types/building';
import type { Enclosure, LeanToStructure, Member, MemberKind, Vec3 } from './geometry';
import { leanToWallSettings, type LeanToWallSettings } from './leanToFixtures';

/**
 * FRAMED OPENINGS ON OPEN (UNSHEETED) WALLS — DRAWING ONLY (owner 10/14/26:
 * "our framed openings when there is no sheeting on the walls ... our frame
 * outs look wrong"). Nothing here is priced or read by the quote.
 *
 * In sheeting, a frame-out is a hole trimmed with J-trim, and that is how it
 * has always been drawn (it still is, exactly). On a wall with NO sheeting
 * where the opening is (an open carport / GCH side, an open garage side, an
 * open or gable-only end, an open lean-to wall) there is nothing to trim: the
 * real thing is galvanized tube like the legs (owner photos 10/14/26) —
 *   - a DOUBLED jamb (two tubes side by side) at each side of the opening, from
 *     the base rail up to the top of the wall (eave / rafter);
 *   - a HEADER across the opening top, tied into the legs on each side on an
 *     eave / lean-to outer wall (on an end wall it runs jamb to jamb);
 *   - a sill tube under an opening that sits up the wall;
 *   - the legs inside the opening removed below the header (the existing
 *     opening cut), knee braces and the base rail kept;
 *   - NO trim, except on the edges of the hole that run through sheeting (a
 *     partial eave-down panel band the opening reaches up into is notched
 *     around it and trimmed there; the header sits at the notch top = the cut
 *     panel's bottom edge over the opening).
 *
 * Owner's standing rule (9/30/26): frame-out = legs removed + header + jambs.
 */

export type Span = [number, number];

/** The main-building fields the sheeting rule reads (a StructureModel subset). */
export interface MainWallCtx {
  width: number;
  length: number;
  /** Low eave (gabled: the eave). */
  legHeight: number;
  /** Ridge (gabled) / tall eave (single slope). */
  peakHeight: number;
  monoDropFt: number;
  enclosure: Enclosure;
  openBayZ: { start: number; end: number } | null;
  eavePanelFt: { left: number; right: number };
}

/** Height of the main roofline (rafter line) at world X. */
export function mainRoofAt(s: MainWallCtx, x: number): number {
  const halfW = s.width / 2;
  const rise = s.peakHeight - s.legHeight;
  if (s.monoDropFt > 0.01) return s.peakHeight - rise * ((x + halfW) / (s.width || 1));
  return s.peakHeight - Math.abs(x) * (rise / (halfW || 1));
}

/** World along-wall coordinate of a wall-local offset (the openings' frame: openingWorldTransform). */
export function mainAlong(s: Pick<MainWallCtx, 'width' | 'length'>, side: WallSide, offset: number): number {
  if (side === 'left' || side === 'right') return -s.length / 2 + offset;
  if (side === 'back') return s.width / 2 - offset;
  return -s.width / 2 + offset; // front / partition
}

/**
 * Sheeted vertical extent [y0, y1] of a MAIN-building wall at the wall-local
 * offset `offset` (the same frame as Opening.offset), or null when that line of
 * the wall carries no sheeting. Same rules as both shells (classic Siding /
 * enhanced shellLayout): closed / partial eave-down band / open-bay side
 * panels on the eaves; closed / half-closed / gable-only / open ends; the
 * GCH divider and an End Storage partition are always closed.
 */
export function mainWallSheetSpan(s: MainWallCtx, side: WallSide, offset: number): Span | null {
  const enc = s.enclosure;
  const H = s.legHeight;
  if (side === 'left' || side === 'right') {
    const z = mainAlong(s, side, offset);
    const wallH = s.monoDropFt > 0.01 && side === 'left' ? s.peakHeight : H;
    let y0 = Infinity;
    let y1 = -Infinity;
    if (enc.sideZ && !enc.sideOpen[side] && z >= enc.sideZ.start - 0.01 && z <= enc.sideZ.end + 0.01) {
      const band = enc.sideBandFt[side];
      y0 = Math.min(y0, band > 0 ? wallH - Math.min(band, wallH) : 0);
      y1 = Math.max(y1, wallH);
    }
    if (s.openBayZ && z >= s.openBayZ.start - 0.01 && z <= s.openBayZ.end + 0.01) {
      const bh = Math.min(s.eavePanelFt[side], wallH);
      if (bh > 0) {
        y0 = Math.min(y0, wallH - bh);
        y1 = Math.max(y1, wallH);
      }
    }
    return y1 > y0 ? [y0, y1] : null;
  }
  const x = mainAlong(s, side, offset);
  const roof = mainRoofAt(s, x);
  if (side === 'partition') return [0, roof];
  const mode = side === 'front' ? enc.front : enc.back;
  if (mode === 'closed') return [0, roof];
  if (mode === 'halfClosed') return [H - Math.min(6, H), roof];
  if (mode === 'gableOnly') return roof - H > 0.02 ? [H, roof] : null;
  return null;
}

/** A lean-to outer wall's eave-down band height — the same rule as LeanToSiding.sideBandHeight (a test holds them equal). */
export function leanToSideBandFt(side: string, lh: number): number {
  if (side === 'q1') return lh * 0.25;
  if (side === 'q2') return lh * 0.5;
  if (side === 'q3') return lh * 0.75;
  const m = /^(\d)panel$/.exec(side);
  if (m) return Math.min(lh, parseInt(m[1], 10) * 3);
  return lh;
}

/** The lean-to fields the sheeting rule reads (a LeanToStructure subset). */
export type LeanToWallCtx = Pick<LeanToStructure, 'enclosure' | 'customWalls' | 'storage' | 'inner' | 'outer' | 'attachedSide' | 'lowLegHeightFt' | 'peakHeightFt'>;

const ltEave = (lt: Pick<LeanToStructure, 'attachedSide'>) => lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
/** Across-axis coordinates (X for an eave lean-to, Z for a gable one) of the main wall line and the outer wall. */
export function leanToAcross(lt: Pick<LeanToStructure, 'attachedSide' | 'inner' | 'outer'>): { inner: number; outer: number } {
  return ltEave(lt) ? { inner: lt.inner.x, outer: lt.outer.x } : { inner: lt.inner.z, outer: lt.outer.z };
}
/** Lean-to roofline height at across coordinate `c`, connection height `connH` at the main wall. */
const ltRoofAt = (inner: number, outer: number, lh: number, connH: number, c: number) =>
  connH + (lh - connH) * ((c - inner) / ((outer - inner) || 1));

const GABLE_FRAC: Record<string, number> = { q1: 0.25, q2: 0.5, q3: 0.75 };

/**
 * Sheeted vertical extent of a LEAN-TO wall at `offsetFt` (an opening's offset
 * frame: along the run from spanStart on the outer wall; across from the lower
 * world across-coordinate on an end wall / the partition), or null. Rules =
 * the lean-to shells (LeanToSiding / leanToShell): outer closed / open /
 * eave-down band, the storage stretch closed; ends closed / gable / half end /
 * roof-down bands / open; the storage partition always closed.
 */
export function leanToWallSheetSpan(lt: LeanToWallCtx, walls: LeanToWallSettings, wall: LeanToOpening['wall'], offsetFt: number): Span | null {
  const lh = lt.lowLegHeightFt;
  if (wall === 'outer') {
    const st = walls.storage;
    if (walls.side === 'closed' || (st && offsetFt >= st.segStart - 1e-6 && offsetFt <= st.segEnd + 1e-6)) return [0, lh];
    if (walls.side === 'open') return null;
    return [lh - leanToSideBandFt(walls.side, lh), lh];
  }
  const { inner, outer } = leanToAcross(lt);
  const connH = lt.peakHeightFt;
  const a = Math.min(inner, outer) + offsetFt;
  const roof = ltRoofAt(inner, outer, lh, connH, a);
  if (wall === 'partition') return walls.storage ? [0, roof] : null;
  const v = walls[wall];
  if (v === 'open') return null;
  if (v === 'gable') return roof - lh > 0.02 ? [lh, roof] : null;
  if (v === 'halfEnd') {
    const mid = (inner + outer) / 2;
    const outerHalf = (a - mid) * Math.sign(outer - inner) >= 0;
    return outerHalf ? [0, roof] : roof - lh > 0.02 ? [lh, roof] : null;
  }
  const f = GABLE_FRAC[v];
  if (f) return [(1 - f) * roof, roof];
  return [0, roof]; // closed
}

/**
 * Which edges of a frame-out's hole run through sheeting (absolute heights).
 * `left` / `right` = the stretch of each jamb line inside sheeting; `header` /
 * `sill` = sheeting the hole cuts just above its top / below its sill.
 */
export interface FrameOutTrim {
  header: boolean;
  sill: boolean;
  left: Span | null;
  right: Span | null;
}

/** The hole of an opening in its wall's own offset frame. */
export interface OpeningBox {
  offset: number;
  width: number;
  sill: number;
  height: number;
}

/**
 * Trim for a frame-out from its wall's sheeting rule. NULL = sheeting runs up
 * both jambs over the whole opening — a frame-out in a sheeted wall, drawn
 * EXACTLY as before (full trim). Otherwise the frame-out stands (at least
 * partly) on an open wall: steel jambs + header are drawn (frameOutMembers)
 * and trim only where the hole cuts sheeting (often none at all).
 */
export function frameOutTrim(spanAt: (offset: number) => Span | null, o: OpeningBox): FrameOutTrim | null {
  const y0 = o.sill;
  const y1 = o.sill + o.height;
  const sL = spanAt(o.offset - o.width / 2 - 0.1);
  const sR = spanAt(o.offset + o.width / 2 + 0.1);
  const covers = (s: Span | null) => !!s && s[0] <= y0 + 0.05 && s[1] >= y1 - 0.3;
  if (covers(sL) && covers(sR)) return null;
  const clip = (s: Span | null): Span | null => {
    if (!s) return null;
    const a = Math.max(s[0], y0);
    const b = Math.min(s[1], y1);
    return b - a > 0.05 ? [a, b] : null;
  };
  const sC = spanAt(o.offset);
  return {
    // The hole cuts into sheeting above its top (a band it reaches up into).
    header: !!sC && sC[0] < y1 - 0.05 && sC[1] > y1 + 0.05,
    sill: y0 > 0.1 && !!sC && sC[0] < y0 - 0.05 && sC[1] > y0 + 0.05,
    left: clip(sL),
    right: clip(sR),
  };
}

/** Main-building frame-out trim (null = sheeted all round: today's full trim; non-frame-outs: null). */
export function mainFrameOutTrim(s: MainWallCtx, o: Opening): FrameOutTrim | null {
  if (o.type !== 'frameOut') return null;
  return frameOutTrim((off) => mainWallSheetSpan(s, o.side, off), { offset: o.offset, width: o.width, sill: o.sillHeight ?? 0, height: o.height });
}

/** Lean-to frame-out trim (null = sheeted all round / not a frame-out). */
export function leanToFrameOutTrim(lt: LeanToWallCtx, o: LeanToOpening, walls: LeanToWallSettings = leanToWallSettings(lt)): FrameOutTrim | null {
  if (o.type !== 'frameOut') return null;
  return frameOutTrim((off) => leanToWallSheetSpan(lt, walls, o.wall, off), { offset: o.offsetFt, width: o.widthFt, sill: o.sillFt ?? 0, height: o.heightFt });
}

/**
 * Trim pieces to draw for a partial (open-wall) frame-out, in the fixture's
 * local frame (origin at the opening centre, +X along the wall, +Y up): the
 * same bars as the full trim (face `t`), only where `trim` says the hole cuts
 * sheeting. Each: centre (x, y) and size (w, h).
 */
export function frameOutTrimBars(trim: FrameOutTrim, w: number, h: number, sill: number, t: number): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const yC = sill + h / 2;
  const top = sill + h;
  if (trim.header) out.push({ x: 0, y: h / 2 + t / 2, w: w + 2 * t, h: t });
  if (trim.sill) out.push({ x: 0, y: -h / 2 - t / 2, w: w + 2 * t, h: t });
  for (const [sx, s] of [[-1, trim.left], [1, trim.right]] as const) {
    if (!s) continue;
    // Close the corners like the full trim: up into the header bar, down into the sill bar.
    const a = s[0] - (trim.sill && s[0] <= sill + 0.01 ? t : 0);
    const b = s[1] + (trim.header && s[1] >= top - 0.01 ? t : 0);
    out.push({ x: sx * (w / 2 + t / 2), y: (a + b) / 2 - yC, w: t, h: b - a });
  }
  return out;
}

// ── Steel: jambs, header, sill tube ─────────────────────────────────────────

/** First jamb tube centre, this far outside the opening edge (a ~2.5" tube's face on the edge). */
export const JAMB_IN = 0.14;
/** Doubled jamb: the second tube's centre this much further out (two tubes side by side). */
export const JAMB_PITCH = 0.28;
/** Header / sill tube centre this far above the opening top / below its sill. */
export const HEADER_UP = 0.14;
/** A jamb tube closer than this to a leg or another jamb tube is left out (the leg is the jamb there). */
const TUBE_CLEAR = 0.27;

/** One wall a frame-out stands on, in its own along / up frame. */
export interface FrameOutWall {
  /** World point at along-wall world coordinate `a`, height `y` (in the frame / post plane). */
  P: (a: number, y: number) => Vec3;
  /** Top of the wall framing (eave / rafter line) at `a`. */
  topAt: (a: number) => number;
  /** Leg / post lines (world along coordinates): headers tie into them; jamb tubes never stand on them. */
  posts: number[];
  /** Along-axis extent of the wall. */
  ext: Span;
  /** Run the header out to the nearest leg on each side (eave / lean-to outer walls); else jamb to jamb. */
  tieHeader: boolean;
}

/** An opening on that wall, in world along coordinates; `open` = draw its steel (frameOutTrim non-null). */
export interface FrameOutHole {
  lo: number;
  hi: number;
  sill: number;
  top: number;
  open: boolean;
}

const mem = (kind: MemberKind, start: Vec3, end: Vec3): Member => ({
  kind,
  start,
  end,
  length: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
});

/** Jambs + header (+ sill tube) for every OPEN frame-out on one wall. `holes` = every opening on the wall. */
export function frameOutMembersForWall(wall: FrameOutWall, holes: FrameOutHole[]): Member[] {
  const out: Member[] = [];
  const placed: number[] = [];
  const inAnyHole = (a: number) => holes.some((h) => a > h.lo - 0.02 && a < h.hi + 0.02);
  // Legs still standing on the base rail: one in (or on the edge of) a floor-level
  // opening is cut away below its header (the engine's opening cut), so it is
  // not there to be the jamb.
  const posts = wall.posts.filter((p) => !holes.some((h) => h.sill <= 0.1 && p >= h.lo - 0.01 && p <= h.hi + 0.01));
  const free = (a: number) =>
    a > wall.ext[0] + 0.05 &&
    a < wall.ext[1] - 0.05 &&
    !inAnyHole(a) &&
    !posts.some((p) => Math.abs(p - a) < TUBE_CLEAR) &&
    !placed.some((p) => Math.abs(p - a) < TUBE_CLEAR);
  for (const h of holes) {
    if (!h.open) continue;
    // Doubled jambs: nearest tube first, then its twin further out.
    const side = (dir: -1 | 1) => {
      const edge = dir < 0 ? h.lo : h.hi;
      const tubes: number[] = [];
      for (const d of [JAMB_IN, JAMB_IN + JAMB_PITCH]) {
        const a = edge + dir * d;
        if (!free(a)) continue;
        placed.push(a);
        tubes.push(a);
        out.push(mem('jamb', wall.P(a, 0), wall.P(a, wall.topAt(a))));
      }
      return tubes;
    };
    const left = side(-1);
    const right = side(1);
    // The header's ends: the outer jamb tube (or the opening edge + JAMB_IN when a leg is the jamb).
    let a0 = left.length ? Math.min(...left) : h.lo - JAMB_IN;
    let a1 = right.length ? Math.max(...right) : h.hi + JAMB_IN;
    const yH = h.top + HEADER_UP;
    const roofMin = Math.min(wall.topAt(a0), wall.topAt(a1), wall.topAt((h.lo + h.hi) / 2));
    // An opening up to the wall top is headed by the roof framing itself.
    if (yH + HEADER_UP <= roofMin) {
      if (wall.tieHeader) {
        // Out to the nearest leg each side, never into another opening's span, and only where it fits under the roof.
        const others = holes.filter((o) => o !== h);
        const lBound = Math.max(wall.ext[0], ...others.filter((o) => o.hi <= h.lo + 1e-6).map((o) => o.hi + 0.5));
        const rBound = Math.min(wall.ext[1], ...others.filter((o) => o.lo >= h.hi - 1e-6).map((o) => o.lo - 0.5));
        const lp = posts.filter((p) => p < a0 - 0.01 && p >= lBound - 1e-6);
        const rp = posts.filter((p) => p > a1 + 0.01 && p <= rBound + 1e-6);
        if (lp.length) {
          const p = Math.max(...lp);
          if (wall.topAt(p) >= yH + HEADER_UP) a0 = p;
        }
        if (rp.length) {
          const p = Math.min(...rp);
          if (wall.topAt(p) >= yH + HEADER_UP) a1 = p;
        }
      }
      out.push(mem('header', wall.P(a0, yH), wall.P(a1, yH)));
    }
    // An opening up the wall: a sill tube under it, jamb to jamb.
    if (h.sill > 0.1 + HEADER_UP) {
      const s0 = left.length ? Math.min(...left) : h.lo - JAMB_IN;
      const s1 = right.length ? Math.max(...right) : h.hi + JAMB_IN;
      out.push(mem('header', wall.P(s0, h.sill - HEADER_UP), wall.P(s1, h.sill - HEADER_UP)));
    }
  }
  return out;
}

/** Inputs for the whole building's frame-out steel (deriveStructure). */
export interface FrameOutBuild {
  main: MainWallCtx;
  openings: Opening[];
  /** Main bent lines (world Z): the eave legs. */
  bentZs: number[];
  leanTos: LeanToStructure[];
}

/**
 * Every open-wall frame-out's jambs / header / sill tube (kinds 'jamb' /
 * 'header'), main building + lean-tos. Empty when no frame-out stands on an
 * open wall — the caller then leaves StructureModel.frameOutMembers out.
 */
export function frameOutMembers(b: FrameOutBuild): Member[] {
  const s = b.main;
  const halfW = s.width / 2;
  const halfL = s.length / 2;
  const out: Member[] = [];

  // Main walls (the partition is always sheeted: nothing to add there).
  for (const side of ['left', 'right', 'front', 'back'] as const) {
    const ops = b.openings.filter((o) => o.side === side);
    if (!ops.some((o) => o.type === 'frameOut')) continue;
    const holes: FrameOutHole[] = ops.map((o) => {
      const c = mainAlong(s, side, o.offset);
      const sill = o.sillHeight ?? 0;
      return { lo: c - o.width / 2, hi: c + o.width / 2, sill, top: sill + o.height, open: !!mainFrameOutTrim(s, o) };
    });
    if (!holes.some((h) => h.open)) continue;
    const eave = side === 'left' || side === 'right';
    const x = side === 'left' ? -halfW : halfW;
    const z = side === 'front' ? -halfL : halfL;
    const wallH = s.monoDropFt > 0.01 && side === 'left' ? s.peakHeight : s.legHeight;
    const wall: FrameOutWall = eave
      ? { P: (a, y) => [x, y, a], topAt: () => wallH, posts: b.bentZs, ext: [-halfL, halfL], tieHeader: true }
      : { P: (a, y) => [a, y, z], topAt: (a) => mainRoofAt(s, a), posts: [-halfW, halfW], ext: [-halfW, halfW], tieHeader: false };
    out.push(...frameOutMembersForWall(wall, holes));
  }

  // Lean-to walls: the outer long wall and the two end walls (a storage partition is always sheeted).
  for (const lt of b.leanTos) {
    const fos = (lt.openings ?? []).filter((o) => o.type === 'frameOut');
    if (!fos.length) continue;
    const walls = leanToWallSettings(lt);
    const eave = ltEave(lt);
    const { inner, outer } = leanToAcross(lt);
    const lh = lt.lowLegHeightFt;
    // The rafter line geometry draws (connection clamped to the main eave).
    const connH = Math.min(s.legHeight, lt.peakHeightFt);
    const runPosts = lt.trussOffsets.map((o) => lt.spanStart + o);
    for (const wallId of ['outer', 'front', 'back'] as const) {
      const ops = (lt.openings ?? []).filter((o) => o.wall === wallId);
      if (!ops.some((o) => o.type === 'frameOut')) continue;
      const lo0 = Math.min(inner, outer);
      const holes: FrameOutHole[] = ops.map((o) => {
        const c = wallId === 'outer' ? lt.spanStart + o.offsetFt : lo0 + o.offsetFt;
        const sill = o.sillFt ?? 0;
        return { lo: c - o.widthFt / 2, hi: c + o.widthFt / 2, sill, top: sill + o.heightFt, open: !!leanToFrameOutTrim(lt, o, walls) };
      });
      if (!holes.some((h) => h.open)) continue;
      let wall: FrameOutWall;
      if (wallId === 'outer') {
        wall = {
          P: (a, y) => (eave ? [outer, y, a] : [a, y, outer]),
          topAt: () => lh,
          posts: runPosts,
          ext: [lt.spanStart, lt.spanEnd],
          tieHeader: true,
        };
      } else {
        const run = wallId === 'front' ? lt.spanStart : lt.spanEnd;
        wall = {
          P: (a, y) => (eave ? [a, y, run] : [run, y, a]),
          topAt: (a) => ltRoofAt(inner, outer, lh, connH, a),
          posts: [inner, outer],
          ext: [lo0, Math.max(inner, outer)],
          tieHeader: false,
        };
      }
      out.push(...frameOutMembersForWall(wall, holes));
    }
  }
  return out;
}

/** Is this main opening a frame-out standing on an open wall (its base rail stays; steel drawn)? */
export const mainFrameOutOpen = (s: MainWallCtx, o: Opening): boolean => !!mainFrameOutTrim(s, o);
