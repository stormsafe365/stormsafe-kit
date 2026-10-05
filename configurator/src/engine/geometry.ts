import type { BuildingType, EndSheeting, LeanToOpening, OpenEnd, Opening, StorageMode, WallOverrides, WallSide } from '@/types/building';
import type { ResolvedBuilding } from './ruleEngine';
import { leanToWallSettings, rendersLeanToFixture, type LeanToStorageSpan } from './leanToFixtures';

/**
 * LAYER 2 (cont.) — Structural geometry derivation.
 *
 * Turns a ResolvedBuilding into explicit steel members in world space
 * (1 unit = 1 foot) plus an enclosure model and per-wall layouts that the
 * 2D editor + 3D scene share. Coordinate convention:
 *   X = width   (-W/2 .. +W/2)
 *   Y = height  (0 = slab)
 *   Z = length  (-L/2 .. +L/2)   (front = -L/2)
 */

export type Vec3 = [number, number, number];
/**
 * 'chord' / 'web' are the roof-truss members drawn from the manufacturers'
 * "Trusses and Bows" charts (trussStyleFor): a chord is a bottom chord, raised
 * tie or second (lower / sister) chord; a web is a king post, vertical,
 * diagonal, strut or spacer. DRAWING ONLY — the BOM / quote never counts them.
 */
export type MemberKind = 'leg' | 'rafter' | 'baseRail' | 'ridge' | 'purlin' | 'hatChannel' | 'girt' | 'brace' | 'chord' | 'web';

/**
 * Assembly layering (ft, measured out from the structural centerline):
 *   framing (centered on the line) → sheeting → components.
 * Sheeting sits just outside the tube's outer face so steel never pokes
 * through; doors/windows mount on the outside face of the sheeting.
 */
export const SHEET_OUTSET = 0.18;
/**
 * A Left/Right storage partition's end posts sit this far in from the end
 * frame line: half the heaviest drawn section (12-ga 0.27'), so the post's
 * outer face is on/inside the end wall's framing, never in its sheet gap.
 */
export const STORAGE_END_POST_INSET = 0.14;
/** An End Storage partition's rail + girts stop this far in from each eave frame line (the 14-ga leg's inner face). */
export const STORAGE_RUN_END_INSET = 0.1;
export const COMPONENT_OUTSET = SHEET_OUTSET + 0.16;
/** Roof panels are nudged out along their normal so they clear the rafters.
 * Shared so the eave trim can land on the SAME drip-edge height (no gap). */
export const ROOF_LIFT = 0.11;

export interface Member {
  kind: MemberKind;
  start: Vec3;
  end: Vec3;
  length: number;
}

/** Which surfaces are sheeted, derived from the building type. */
export interface Enclosure {
  type: BuildingType;
  /** z-range of sheeted side (eave) walls, or null for fully open. */
  sideZ: { start: number; end: number } | null;
  front: EndSheeting; // gable end at z = -L/2
  back: EndSheeting; // gable end at z = +L/2
  partitionZ: number | null; // interior gable wall (utility split, or End Storage)
  /**
   * 'storage' = `partitionZ` is an End Storage partition inside a garage /
   * carport (program "Storage / Add'l End Wall"): framed with its own bent
   * line, sheeted on the MAIN-ROOM face (`partitionFaces`) and offset off the
   * framing like an end wall; the building's wainscot on that face (owner
   * 10/3/26), no exterior corner flashing. Absent
   * = the GCH (utility) divider, drawn exactly as before.
   */
  partitionKind?: 'storage';
  /** Storage partition: the ±Z direction its sheeted face points (toward the main room). */
  partitionFaces?: -1 | 1;
  /**
   * Left / Right lengthwise storage partition: its framing line `x` and the ±X
   * direction its sheeted face points (toward the main room). Full length,
   * floor to roof underside; no openings; the building's wainscot on its
   * sheeted face. Absent = none.
   */
  sidePartition?: { x: number; faces: -1 | 1 };
  /** Per-side full-open override (garage "Right/Left Eave Side: Open"). */
  sideOpen: { left: boolean; right: boolean };
  /**
   * Partial closure band (ft from the eave down) per garage eave side —
   * 0 = no band (side is fully closed, or open per sideOpen).
   */
  sideBandFt: { left: number; right: number };
}

export interface TrussLine {
  /** Position along the wall (ft from the wall's local-left edge). */
  posFt: number;
  /** Spacing to the previous line (ft) — for dimension labels. */
  gapToPrevFt: number;
}

export interface WallLayout {
  side: WallSide;
  available: boolean; // can this wall hold openings for the current type?
  isEndWall: boolean; // gable (front/back/partition) vs eave (left/right)
  spanFt: number;
  eaveHeightFt: number;
  peakHeightFt: number;
  trussLines: TrussLine[];
}

/** Lean-to paneling information, derived for 3D rendering. */
export interface LeanToStructure {
  id: string;
  enclosure: 'open' | 'enclosed' | 'custom';
  customWalls?: { front: string; back: string; side: string };
  openings: LeanToOpening[];
  attachedSide: string; // 'Left Eave' | 'Right Eave' | 'Front Gable' | 'Back Gable'
  widthFt: number;
  lengthFt: number;
  lowLegHeightFt: number;
  peakHeightFt: number;
  rise: number;
  // World bounds (corner points)
  inner: { x: number; z: number };
  outer: { x: number; z: number };
  spanStart: number;
  spanEnd: number;
  /** Post/truss positions along the run, measured (ft) from spanStart — drives
   *  the drag-time spacing + truss-collision guides on the outer wall. */
  trussOffsets: number[];
  /**
   * Storage section (VIEW-ONLY; LeanTo.storage): partition bent position and
   * the storage stretch of the outer wall. Absent = no storage section (the
   * key is left out entirely, so a lean-to without one derives exactly as
   * before).
   */
  storage?: LeanToStorageSpan;
}

export interface StructureModel {
  width: number;
  length: number;
  legHeight: number;
  peakHeight: number;
  rise: number;
  rafterLength: number;
  /** Free-standing single-slope drop (ft): 0 = gabled. When >0, `legHeight` is
   *  the LOW (+X) eave, `peakHeight` the tall (−X) eave, and the roof is ONE
   *  plane between them (`rise` = the drop, `rafterLength` spans full width). */
  monoDropFt: number;
  roofOverhangFt: number;
  frameCount: number;
  framePositionsZ: number[];
  members: Member[];
  /**
   * PDF / CRM capture-framing proxy — set on TRUSS widths only (absent on bows
   * and mono-slope, whose frame did not change). It is the frame exactly as it
   * was drawn before the truss webs (c9ae93d): full-length knee braces and the
   * peak collar tie, no chords / webs, clipped the same way. Frame renders it
   * INVISIBLE and tags the drawn frame `captureIgnore`, so the capture fit
   * (CaptureHook starts from the average of every mesh corner and stops after a
   * few passes) frames every PDF view exactly as before the trusses. The
   * visible drawing is `members`; the BOM never reads this.
   */
  captureMembers?: Member[];
  enclosure: Enclosure;
  /** z-range of the OPEN (carport) eave portion — null when fully enclosed. */
  openBayZ: { start: number; end: number } | null;
  /** Partial side-panel band height (ft) on each open eave side, measured from
   *  the eave DOWNWARD (the band fills [H-bh, H]; the lower wall stays open). */
  eavePanelFt: { left: number; right: number };
  walls: Record<WallSide, WallLayout>;
  areas: { roof: number; walls: number };
  /** Lean-to panel data for 3D rendering (derived from config.leanTos). */
  leanTos: LeanToStructure[];
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const member = (kind: MemberKind, start: Vec3, end: Vec3): Member => ({
  kind,
  start,
  end,
  length: dist(start, end),
});

/**
 * Column style for a leg `heightFt` tall on a bent `widthFt` wide — the
 * program's badge rule (quote-builder doBld; Master Price Book 7/16/26
 * footnote; owner 9/28/26):
 *   LADDER when W >= 52 (any height);
 *   DOUBLE when W is 32-51, or the leg is 15'+ tall;
 *   SINGLE otherwise.
 * The main building evaluates it with its width + eave height. A lean-to
 * (owner 9/29/26 — DRAWING ONLY, no price change) evaluates it with its own
 * width and each post's own height, so a 15'+ lean-to post is doubled; lean-to
 * widths (8-20) never reach the width rules.
 */
export type LegStyle = 'single' | 'double' | 'ladder';
export function legStyleFor(widthFt: number, heightFt: number, mfr?: 'CCI' | 'CA'): LegStyle {
  // Owner 9/29/26, by manufacturer (drawing/badge only — pricing already
  // includes the framing):
  //   CCI — every WIDE SPAN (32'+) has LADDER legs (CCI "Trusses and Bows"
  //         chart / handbook p.23 + p.27 commercial trusses).
  //   CA  — engineering sheet AD-1 (FBC 2023): 31'-51' = DOUBLE POST,
  //         52'-60' = LADDER LEG. Unset manufacturer uses the CA rule.
  // Narrower buildings (both): double legs from 15' tall, else single.
  if (mfr === 'CCI' ? widthFt > 31 : widthFt >= 52) return 'ladder';
  if (widthFt > 31 || heightFt >= 15) return 'double';
  return 'single';
}

/** Doubled-post gap (ft): the second post stands this far inboard in the bent plane. */
const DOUBLE_D = 0.4;
/** Ladder column depth (ft, inboard in the bent plane) for a leg `heightFt` tall. */
const ladderDepth = (heightFt: number): number => Math.min(2, Math.max(1.3, heightFt * 0.09));

/**
 * Roof truss / bow WEB pattern per manufacturer + width class (owner 9/29/26 —
 * DRAWING ONLY: no pricing, legs untouched). Read off each manufacturer's own
 * "Trusses and Bows" chart; positions are fractions of the half-span measured
 * from the ridge, scaled to the real width + pitch.
 *
 * CCI — dealer handbook p.27 "Trusses and Bows" (Vertical / Boxed Eave rows):
 *   12'-24' bow ...... rafters only.
 *   26'-30' truss .... a raised horizontal TIE from rafter to rafter, meeting
 *                      them 0.66 of the half-span out (about a third of the
 *                      rise above the eave), + two splayed STRUTS from the tie
 *                      (±0.18) up to the rafters (±0.24).
 *   32'-40' truss .... BOTTOM CHORD at the eave, post to post; king post;
 *                      verticals at the 1/3 points; one diagonal each side
 *                      (top of the inner vertical → foot of the king post).
 *   42'-50' truss .... bottom chord; king post; verticals at the 1/4 points;
 *                      two Howe diagonals each side (V1 top → king-post foot,
 *                      V2 top → V1 foot; the outer vertical has none).
 *   52'-60' truss .... as 42'-50' with a third diagonal (V3 top → V2 foot).
 * CA — engineering sheet AD-1 (FBC 2023) "Trusses and Bows":
 *   6'-24' bow ....... rafters only.
 *   25'-30' truss .... a SISTER chord 5.5" c-c under each rafter (3" gap),
 *                      ridge to 0.647 of the half-span, on 4 spacer blocks.
 *   31'-41' truss .... BOX-EAVE: an 11"-deep parallel chord pair from each
 *                      eave in to a break (0.30), then a FLAT raised bottom
 *                      chord between the breaks; king post + verticals only.
 *   42'-51' truss .... same shape, break 0.288; in the middle a vertical at
 *                      0.133 whose top feeds two diagonals down to the king-post
 *                      foot and the break vertical (0.266).
 *   52'-60' truss .... break 0.447; zig-zag diagonals between the king post and
 *                      three verticals; the box-eave panels are LACED (a Λ pair
 *                      of short diagonals in each panel, 6" clear of the posts).
 * Widths past 60' keep the 52'-60' pattern, scaled. The Regular (rounded-eave)
 * rows of the charts are NOT drawn (owner: "Not now").
 */
export type TrussStyle =
  | 'bow'
  | 'cci-26-30'
  | 'cci-32-40'
  | 'cci-42-50'
  | 'cci-52-60'
  | 'ca-25-30'
  | 'ca-31-41'
  | 'ca-42-51'
  | 'ca-52-60';
export function trussStyleFor(widthFt: number, mfr?: 'CCI' | 'CA'): TrussStyle {
  // Both charts: up to 24' is a bow, anything wider is a truss. Unset
  // manufacturer follows CA, like legStyleFor.
  if (widthFt < 25) return 'bow';
  if (mfr === 'CCI') {
    if (widthFt < 31) return 'cci-26-30';
    if (widthFt < 41) return 'cci-32-40';
    if (widthFt < 51) return 'cci-42-50';
    return 'cci-52-60';
  }
  if (widthFt < 31) return 'ca-25-30';
  if (widthFt < 42) return 'ca-31-41';
  if (widthFt < 52) return 'ca-42-51';
  return 'ca-52-60';
}

/** CCI wide trusses: verticals (half-span fractions) + Howe diagonals per side. */
const CCI_WIDE: Record<'cci-32-40' | 'cci-42-50' | 'cci-52-60', { verts: number[]; diags: number }> = {
  'cci-32-40': { verts: [1 / 3, 2 / 3], diags: 1 },
  'cci-42-50': { verts: [0.25, 0.5, 0.75], diags: 2 },
  'cci-52-60': { verts: [0.25, 0.5, 0.75], diags: 3 },
};
/** CCI 26'-30': tie meets the rafters at ±TIE_F; struts from ±STRUT_LO on the tie to ±STRUT_HI on the rafter. */
const CCI_TIE_F = 0.66;
const CCI_STRUT_LO = 0.183;
const CCI_STRUT_HI = 0.243;

/** A web end: on the top chord (rafter) or on the bottom / lower chord. */
type WebEnd = 'top' | 'bot';
interface CaBoxTruss {
  /** Where the sloped box-eave lower chord turns into the flat bottom chord. */
  brk: number;
  /** Verticals on the flat chord (the king post is implied). */
  mid: number[];
  /** Middle diagonals: [from, fromEnd, to, toEnd] (fraction 0 = king post). */
  diags: Array<[number, WebEnd, number, WebEnd]>;
  /** Verticals in the box-eave (parallel chord) section. */
  outer: number[];
  /** Λ lacing in each box-eave panel between consecutive outer verticals. */
  lace: boolean;
}
const CA_BOX: Record<'ca-31-41' | 'ca-42-51' | 'ca-52-60', CaBoxTruss> = {
  'ca-31-41': { brk: 0.3, mid: [0.18], diags: [], outer: [0.31, 0.425, 0.655, 0.89], lace: false },
  'ca-42-51': {
    brk: 0.288,
    mid: [0.133, 0.266],
    diags: [
      [0.133, 'top', 0, 'bot'],
      [0.133, 'top', 0.266, 'bot'],
    ],
    outer: [0.329, 0.454, 0.645, 0.833, 0.961],
    lace: false,
  },
  'ca-52-60': {
    brk: 0.447,
    mid: [0.142, 0.283, 0.425],
    diags: [
      [0, 'bot', 0.142, 'top'],
      [0.142, 'top', 0.283, 'bot'],
      [0.283, 'bot', 0.425, 'top'],
    ],
    outer: [0.468, 0.59, 0.711, 0.832, 0.953],
    lace: true,
  },
};
/** CA box-eave chord depth, centre to centre (11" out-to-out on AD-1, ~2.5" tube). */
const CA_BOX_DEPTH = 8.5 / 12;
/** CA 25'-30' sister chord: 3" gap + a 2.5" tube, centre to centre. */
const CA_SISTER_DEPTH = 5.5 / 12;
const CA_SISTER_END = 0.647;
const CA_SISTER_SPACERS = [0.028, 0.205, 0.467, CA_SISTER_END];

/** A truss member in a bent's plane: [x, y] endpoints (world ft). */
type Seg2 = { kind: 'chord' | 'web'; a: [number, number]; b: [number, number] };

/**
 * The chart's chords + webs for one gabled bent, in the bent's X-Y plane.
 * `colDepth` = how far the eave column reaches inboard (double / ladder inner
 * post): a CA box-eave web inside that zone is left out — the column's inner
 * post already stands there (two tubes in one spot read as a glitch).
 */
function trussSegments(style: TrussStyle, halfW: number, H: number, rise: number, colDepth: number): Seg2[] {
  if (style === 'bow' || halfW <= 0) return [];
  const peak = H + rise;
  const roofY = (x: number) => peak - Math.abs(x) * (rise / halfW);
  const secant = Math.hypot(1, rise / halfW); // vertical offset per unit of perpendicular chord depth
  const out: Seg2[] = [];
  const chord = (a: [number, number], b: [number, number]) => out.push({ kind: 'chord', a, b });
  const web = (a: [number, number], b: [number, number]) => out.push({ kind: 'web', a, b });

  if (style === 'cci-26-30') {
    const yt = roofY(CCI_TIE_F * halfW);
    chord([-CCI_TIE_F * halfW, yt], [CCI_TIE_F * halfW, yt]);
    for (const s of [-1, 1]) web([s * CCI_STRUT_LO * halfW, yt], [s * CCI_STRUT_HI * halfW, roofY(CCI_STRUT_HI * halfW)]);
    return out;
  }
  if (style === 'cci-32-40' || style === 'cci-42-50' || style === 'cci-52-60') {
    const { verts, diags } = CCI_WIDE[style];
    chord([-halfW, H], [halfW, H]); // bottom chord at the eave, post to post
    web([0, H], [0, peak]); // king post
    for (const s of [-1, 1]) {
      for (const f of verts) web([s * f * halfW, H], [s * f * halfW, roofY(f * halfW)]);
      for (let i = 0; i < diags; i++) {
        const fTop = verts[i];
        const fFoot = i === 0 ? 0 : verts[i - 1];
        web([s * fTop * halfW, roofY(fTop * halfW)], [s * fFoot * halfW, H]);
      }
    }
    return out;
  }
  if (style === 'ca-25-30') {
    const dv = CA_SISTER_DEPTH * secant;
    for (const s of [-1, 1]) {
      const xe = s * CA_SISTER_END * halfW;
      chord([xe, roofY(xe) - dv], [0, peak - dv]);
      for (const f of CA_SISTER_SPACERS) {
        const x = s * f * halfW;
        web([x, roofY(x) - dv], [x, roofY(x)]);
      }
    }
    return out;
  }
  // CA box-eave wide trusses.
  const t = CA_BOX[style];
  const dv = CA_BOX_DEPTH * secant;
  const xb = t.brk * halfW;
  const yb = roofY(xb) - dv; // flat bottom chord height
  const top = (x: number): [number, number] => [x, roofY(x)];
  const bot = (x: number): [number, number] => [x, Math.abs(x) <= xb + 1e-9 ? yb : roofY(x) - dv];
  const inColumn = (...xs: number[]) => xs.some((x) => Math.abs(x) > halfW - colDepth - 0.25);
  chord([-xb, yb], [xb, yb]);
  web([0, yb], [0, peak]); // king post
  for (const s of [-1, 1]) {
    chord([s * xb, yb], [s * halfW, H - dv]); // box-eave lower chord, parallel to the rafter
    for (const f of t.mid) web(bot(s * f * halfW), top(s * f * halfW));
    for (const [f0, e0, f1, e1] of t.diags) {
      const x0 = s * f0 * halfW;
      const x1 = s * f1 * halfW;
      web(e0 === 'top' ? top(x0) : bot(x0), e1 === 'top' ? top(x1) : bot(x1));
    }
    for (const f of t.outer) {
      const x = s * f * halfW;
      if (!inColumn(x)) web(bot(x), top(x));
    }
    if (t.lace) {
      for (let i = 1; i < t.outer.length; i++) {
        const fa = t.outer[i - 1];
        const p = t.outer[i] - fa;
        const at = (k: number) => s * (fa + (p * k) / 7) * halfW;
        // Going outward: lower chord → top chord, 6" gap, top chord → lower chord.
        if (!inColumn(at(1), at(3))) web(bot(at(1)), top(at(3)));
        if (!inColumn(at(4), at(6))) web(top(at(4)), bot(at(6)));
      }
    }
  }
  return out;
}

/** Parameter along segment p0→p1 where it first crosses segment q0→q1 (X-Y), or null. */
function segCross2(p0: [number, number], p1: [number, number], q0: [number, number], q1: [number, number]): number | null {
  const rx = p1[0] - p0[0];
  const ry = p1[1] - p0[1];
  const sx = q1[0] - q0[0];
  const sy = q1[1] - q0[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null; // parallel
  const qpx = q0[0] - p0[0];
  const qpy = q0[1] - p0[1];
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null;
}

const purlinRunsPerSlope = (rafterLength: number): number => Math.max(2, Math.round(rafterLength / 3));
const hatRows = (legHeight: number): number => Math.max(2, Math.round(legHeight / 2));

/**
 * Subtract a set of `[lo, hi]` gaps from the segment `[a, b]`, returning the
 * surviving sub-segments. Used to CUT horizontal wall members (base rails,
 * girts, hat channels) where a door/window opening crosses them — so a roll-up
 * door reads as a real hole in the framing instead of bars running across it.
 * Slivers shorter than 0.05 ft are dropped.
 */
export function subtractSpans(a: number, b: number, gaps: Array<[number, number]>): Array<[number, number]> {
  let segs: Array<[number, number]> = [[Math.min(a, b), Math.max(a, b)]];
  for (const g of gaps) {
    const lo = Math.min(g[0], g[1]);
    const hi = Math.max(g[0], g[1]);
    const next: Array<[number, number]> = [];
    for (const [s, e] of segs) {
      if (hi <= s || lo >= e) {
        next.push([s, e]); // gap doesn't touch this segment
        continue;
      }
      if (lo > s) next.push([s, Math.min(lo, e)]); // surviving piece left of the gap
      if (hi < e) next.push([Math.max(hi, s), e]); // surviving piece right of the gap
    }
    segs = next;
  }
  return segs.filter(([s, e]) => e - s > 0.05);
}

/** An opening projected onto a wall: its span along the wall axis + vertical extent. */
interface WallHole {
  lo: number;
  hi: number;
  sill: number;
  top: number;
}

/** The `[lo, hi]` gaps among `holes` that a horizontal member at height `y` passes through. */
function gapsAtHeight(holes: WallHole[], y: number): Array<[number, number]> {
  return holes
    .filter((h) => y >= h.sill - 0.01 && y <= h.top + 0.01)
    .map((h) => [h.lo, h.hi] as [number, number]);
}

/**
 * Clip the vertical span `[ylo, yhi]` out of a single 3D segment, returning the
 * surviving sub-segments. Y is monotonic along the segment, so this removes the
 * exact parametric range where the member's height is inside the opening — used
 * to CUT columns (legs) and diagonal knee braces where a door/opening crosses
 * them, so you can step right through the framed opening (no framing in it).
 */
function clipSegmentByY(start: Vec3, end: Vec3, ylo: number, yhi: number): Array<[Vec3, Vec3]> {
  const y0 = start[1];
  const y1 = end[1];
  const lerp = (t: number): Vec3 => [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
    start[2] + (end[2] - start[2]) * t,
  ];
  if (Math.abs(y1 - y0) < 1e-6) {
    // Horizontal member: wholly inside the band → gone, else untouched.
    return y0 >= ylo - 0.01 && y0 <= yhi + 0.01 ? [] : [[start, end]];
  }
  const tAt = (y: number) => (y - y0) / (y1 - y0);
  const lo = Math.max(0, Math.min(tAt(ylo), tAt(yhi)));
  const hi = Math.min(1, Math.max(tAt(ylo), tAt(yhi)));
  if (hi <= lo) return [[start, end]]; // band doesn't overlap this segment
  const out: Array<[Vec3, Vec3]> = [];
  if (lo > 0.002) out.push([start, lerp(lo)]); // piece below the opening
  if (hi < 0.998) out.push([lerp(hi), end]); // piece above the opening
  return out;
}

/**
 * Cut columns + knee braces where an EAVE opening crosses them. Each eave leg /
 * brace sits in a constant-Z plane (Z = its bent position); if an opening on the
 * same side spans that Z, the part of the member within the opening's height is
 * removed. Horizontal girts/rails/hat-channels are already cut during build.
 */
function clipFrameAtEaveOpenings(members: Member[], openings: Opening[], halfW: number, halfL: number): Member[] {
  const eave = openings
    .filter((o) => o.side === 'left' || o.side === 'right')
    .map((o) => {
      const cz = -halfL + o.offset;
      const sill = o.sillHeight ?? 0;
      return { side: o.side, zlo: cz - o.width / 2, zhi: cz + o.width / 2, ylo: sill, yhi: sill + o.height };
    });
  if (!eave.length) return members;

  const out: Member[] = [];
  for (const m of members) {
    // Truss webs + SLOPED chords near the eave column (CA's box-eave lower
    // chord lands on the post ~9" under the eave) clear the opening like the
    // column does. A LEVEL chord (CCI bottom chord at the eave) spans the whole
    // bent — it is the header over the opening, never erased by it.
    const level = Math.abs(m.start[1] - m.end[1]) < 1e-6;
    const clippable = m.kind === 'leg' || m.kind === 'brace' || m.kind === 'web' || (m.kind === 'chord' && !level);
    const constZ = Math.abs(m.start[2] - m.end[2]) < 0.01;
    // A foot of the member must sit on or just inboard of an eave wall plane.
    // The band covers the DEEP-COLUMN inset too: double legs put a second post
    // 0.4' inboard and ladder legs (H>=17) up to 2' inboard — those inner
    // chords stood visible through framed openings when the band was a tight
    // 0.1' (regression: "trusses showing inside the opening again"). 2.25'
    // still excludes the peak collar tie (ends ≥ 3' further inboard on every
    // buildable width). The band is also bounded at the wall plane on the
    // OUTSIDE: an attached lean-to puts posts BEYOND the wall (|x| = halfW +
    // leanWidth), and the unbounded band let main-wall openings erase them
    // (regression: "legs on the lean-to are not showing").
    const maxAbsX = Math.max(Math.abs(m.start[0]), Math.abs(m.end[0]));
    const atEaveWall = maxAbsX > halfW - 2.25 && maxAbsX < halfW + 0.1;
    if (clippable && constZ && atEaveWall) {
      const side = (Math.abs(m.start[0]) > Math.abs(m.end[0]) ? m.start[0] : m.end[0]) < 0 ? 'left' : 'right';
      const z = m.start[2];
      const bands = eave.filter((o) => o.side === side && z >= o.zlo - 0.01 && z <= o.zhi + 0.01);
      if (bands.length) {
        let segs: Array<[Vec3, Vec3]> = [[m.start, m.end]];
        for (const b of bands) {
          const next: Array<[Vec3, Vec3]> = [];
          for (const [s, e] of segs) next.push(...clipSegmentByY(s, e, b.ylo, b.yhi));
          segs = next;
        }
        for (const [s, e] of segs) out.push(member(m.kind, s, e));
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

/** An opening on a gable-end wall (front / back / GCH partition) in that bent's X-Y plane. */
interface EndHole {
  z: number;
  lo: number;
  hi: number;
  ylo: number;
  yhi: number;
}
/** Side clearance kept between a truss web / cut chord and a gable opening's jambs (trim), ft. */
const END_WEB_CLEAR = 0.25;
/**
 * Parametric range [t0, t1] of the member (X-Y, constant Z) inside the opening
 * rectangle — jambs grown by END_WEB_CLEAR, top taken EXACTLY (a chord or web
 * sitting on top of a door that reaches the eave is its header, not in it).
 * Null when it misses (touching an edge is a miss). Liang-Barsky.
 */
function endHoleRange(m: Member, h: EndHole): [number, number] | null {
  const x0 = m.start[0];
  const y0 = m.start[1];
  const dx = m.end[0] - x0;
  const dy = m.end[1] - y0;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, x0 - (h.lo - END_WEB_CLEAR)],
    [dx, h.hi + END_WEB_CLEAR - x0],
    [-dy, y0 - h.ylo],
    [dy, h.yhi - 0.01 - y0],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return null;
  }
  return t1 - t0 > 1e-6 ? [t0, t1] : null;
}

/**
 * Truss chords / webs in a GABLE-END bent (the front / back end frames, or a
 * GCH partition bent) vs the openings on that wall. A tall end door can reach
 * up past the eave into the truss: a web it would cross is left out of that
 * bent (no floating stubs — same rule as a lean-to end brace), and a chord it
 * crosses is cut around it (jamb trim clear). Everything else — and every
 * other kind of member — passes through untouched.
 */
function clipTrussAtEndOpenings(members: Member[], holes: EndHole[]): Member[] {
  if (!holes.length) return members;
  const out: Member[] = [];
  for (const m of members) {
    if (m.kind !== 'web' && m.kind !== 'chord') {
      out.push(m);
      continue;
    }
    const hs = holes.filter((h) => Math.abs(m.start[2] - h.z) < 0.01 && Math.abs(m.end[2] - h.z) < 0.01);
    if (!hs.length) {
      out.push(m);
      continue;
    }
    if (m.kind === 'web') {
      if (!hs.some((h) => endHoleRange(m, h))) out.push(m);
      continue;
    }
    let segs: Array<[Vec3, Vec3]> = [[m.start, m.end]];
    let cut = false;
    for (const h of hs) {
      const next: Array<[Vec3, Vec3]> = [];
      for (const [s, e] of segs) {
        const r = endHoleRange(member('chord', s, e), h);
        if (!r) {
          next.push([s, e]);
          continue;
        }
        cut = true;
        const lerp = (t: number): Vec3 => [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t, s[2] + (e[2] - s[2]) * t];
        const len = dist(s, e);
        if (r[0] * len > 0.05) next.push([s, lerp(r[0])]);
        if ((1 - r[1]) * len > 0.05) next.push([lerp(r[1]), e]);
      }
      segs = next;
    }
    if (cut) for (const [s, e] of segs) out.push(member('chord', s, e));
    else out.push(m);
  }
  return out;
}

/**
 * Cut a lean-to's own columns + knee braces where one of its framed openings
 * crosses them — the shed-roof analogue of clipFrameAtEaveOpenings. Without this
 * a lean-to frame-out shows the outer posts standing behind the hole; with it
 * you see straight through, same as a frame-out on the main building.
 *
 * Each outer post/brace sits in a constant plane (constant-Z for an eave-attached
 * lean-to, constant-X for a gable-attached one) with a foot on the outer wall; if
 * an opening on that wall spans the post's run position, the part of the member
 * inside the opening's height band is removed. Mirrors openingPlacement's math:
 * the opening centre along the run is `spanStart + offsetFt`.
 *
 * The outer wall's column may be DOUBLED (a 15'+ lean-to post, see
 * legStyleFor): its second post and inset base rail stand `depth` inboard of
 * the wall plane, so the band reaches that far INBOARD (never outboard) — the
 * lean-to analogue of the main eave clip's deep-column band. A single-post
 * lean-to keeps the original ±0.1 ft plane test exactly.
 *
 * END-wall openings (wall 'front' = the run-start end bent, 'back' = the
 * run-end bent; only ones whose fixture is drawn — rendersLeanToFixture)
 * sit in the end bent's own plane, where the knee brace runs
 * diagonally from the outer post up to the rafter. There a lean-to post
 * (outboard of the main wall line only — the main building's own leg at the
 * inner corner is never touched) is cut over the opening's height like any
 * post, and a knee brace that would cross the opening (or its trim, within
 * END_BRACE_CLEAR) is left out of that bent entirely rather than leaving
 * floating stubs: a framed walk-through has nothing across its corner.
 * A storage PARTITION opening is treated the same way in the partition bent
 * (storage.runAt) — no post or knee brace across a partition door.
 */
const END_BRACE_CLEAR = 0.25;
function clipFrameAtLeanToOpenings(members: Member[], leanTos: LeanToStructure[]): Member[] {
  type Band = { eave: boolean; plane: number; inb: number; depth: number; lo: number; hi: number; ylo: number; yhi: number };
  /** An opening on a lean-to END wall, in that end bent's plane (run = const). */
  type EndBand = { eave: boolean; run: number; inner: number; sOut: number; width: number; lo: number; hi: number; ylo: number; yhi: number };
  const bands: Band[] = [];
  const endBands: EndBand[] = [];
  for (const lt of leanTos) {
    const eave = lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
    const plane = eave ? lt.outer.x : lt.outer.z;
    const innerPlane = eave ? lt.inner.x : lt.inner.z;
    const inb = Math.sign(innerPlane - plane) || 1; // outer wall -> main building
    const style = legStyleFor(lt.widthFt, lt.lowLegHeightFt);
    const depth = style === 'ladder' ? ladderDepth(lt.lowLegHeightFt) : style === 'double' ? DOUBLE_D : 0;
    const walls = leanToWallSettings(lt);
    for (const op of lt.openings ?? []) {
      if (op.wall === 'front' || op.wall === 'back' || op.wall === 'partition') {
        // Only an end-wall opening that is actually DRAWN (rendersLeanToFixture:
        // a frame-out always, a door/window only on a closed end) moves framing.
        // A storage PARTITION opening sits in the partition bent's plane (runAt)
        // and is framed exactly like an end-wall opening.
        if (!rendersLeanToFixture(op, walls)) continue;
        const run = op.wall === 'front' ? lt.spanStart : op.wall === 'back' ? lt.spanEnd : lt.storage?.runAt;
        if (run === undefined) continue;
        // Same across math as the lean-to fixture placement (LeanToSiding
        // openingPlacement): centre = min(inner, outer) + offsetFt.
        const c = Math.min(innerPlane, plane) + op.offsetFt;
        const sill = op.sillFt ?? 0;
        endBands.push({
          eave,
          run,
          inner: innerPlane,
          sOut: -inb,
          width: Math.abs(plane - innerPlane),
          lo: c - op.widthFt / 2,
          hi: c + op.widthFt / 2,
          ylo: sill,
          yhi: sill + op.heightFt,
        });
        continue;
      }
      if (op.wall !== 'outer') continue; // posts only cross the outer long wall
      const c = lt.spanStart + op.offsetFt; // centre along the run axis
      const sill = op.sillFt ?? 0;
      bands.push({
        eave,
        plane,
        inb,
        depth,
        lo: c - op.widthFt / 2,
        hi: c + op.widthFt / 2,
        ylo: sill,
        yhi: sill + op.heightFt,
      });
    }
  }
  if (!bands.length && !endBands.length) return members;

  // Is world coordinate `v` (across the wall) on the outer wall plane, or within
  // the doubled column's depth inboard of it?
  const inWallBand = (b: Band, v: number) => {
    const d = (v - b.plane) * b.inb; // distance inboard of the wall plane
    return d > -0.1 && d < b.depth + 0.1;
  };

  // End-wall openings: is this leg / brace one of the lean-to's own members in
  // that end bent's plane? (Constant run coordinate at the end, both feet
  // strictly OUTBOARD of the main wall line and not past the outer wall.)
  const inEndBent = (b: EndBand, m: Member) => {
    const ra = b.eave ? 2 : 0;
    const ca = b.eave ? 0 : 2;
    if (Math.abs(m.start[ra] - b.run) > 0.01 || Math.abs(m.end[ra] - b.run) > 0.01) return false;
    const d0 = (m.start[ca] - b.inner) * b.sOut;
    const d1 = (m.end[ca] - b.inner) * b.sOut;
    return Math.min(d0, d1) > 0.05 && Math.max(d0, d1) < b.width + 0.1;
  };
  /** Does the segment (across, y) cross the opening rectangle grown by `pad`? (Liang-Barsky.) */
  const segHitsRect = (b: EndBand, m: Member, pad: number) => {
    const ca = b.eave ? 0 : 2;
    const x0 = m.start[ca];
    const y0 = m.start[1];
    const dx = m.end[ca] - x0;
    const dy = m.end[1] - y0;
    let t0 = 0;
    let t1 = 1;
    const edges: Array<[number, number]> = [
      [-dx, x0 - (b.lo - pad)],
      [dx, b.hi + pad - x0],
      [-dy, y0 - (b.ylo - pad)],
      [dy, b.yhi + pad - y0],
    ];
    for (const [p, q] of edges) {
      if (Math.abs(p) < 1e-9) {
        if (q < 0) return false;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
    return true;
  };

  const out: Member[] = [];
  for (const m of members) {
    // Outer-wall BASE RAIL: a horizontal member at the slab line along the run.
    // A floor-level opening (sill ≈ 0) removes the rail across its width — same
    // rule as the main building's base rails (no rail across a framed opening).
    if (m.kind === 'baseRail' && Math.abs(m.start[1]) < 0.1 && Math.abs(m.end[1]) < 0.1) {
      let railSegs: Array<[Vec3, Vec3]> = [[m.start, m.end]];
      let railCut = false;
      for (const b of bands) {
        if (b.ylo > 0.1) continue; // opening doesn't reach the slab
        const runAxis = b.eave ? 2 : 0;
        const planeAxis = b.eave ? 0 : 2;
        const onPlane =
          Math.abs(m.start[planeAxis] - m.end[planeAxis]) < 0.01 && inWallBand(b, m.start[planeAxis]);
        if (!onPlane) continue;
        const next: Array<[Vec3, Vec3]> = [];
        for (const [s, e] of railSegs) {
          const spans = subtractSpans(s[runAxis], e[runAxis], [[b.lo, b.hi]]);
          if (spans.length !== 1 || Math.abs(spans[0][1] - spans[0][0] - Math.abs(e[runAxis] - s[runAxis])) > 0.01) railCut = true;
          for (const [p, q] of spans) {
            const ns = [...s] as Vec3;
            const ne = [...e] as Vec3;
            ns[runAxis] = p;
            ne[runAxis] = q;
            next.push([ns, ne]);
          }
        }
        railSegs = next;
      }
      if (railCut) {
        for (const [s, e] of railSegs) out.push(member('baseRail', s, e));
        continue;
      }
      out.push(m);
      continue;
    }
    if (m.kind !== 'leg' && m.kind !== 'brace') {
      out.push(m);
      continue;
    }
    let segs: Array<[Vec3, Vec3]> = [[m.start, m.end]];
    let cut = false;
    // Lean-to END-wall openings (see the doc comment): a knee brace that would
    // cross one is left out of that bent; a post standing in one is cut over its
    // height (then still goes through the outer-wall bands below).
    const endHits = endBands.filter((b) => inEndBent(b, m));
    if (endHits.length) {
      const ca = endHits[0].eave ? 0 : 2;
      if (Math.abs(m.start[ca] - m.end[ca]) >= 0.01) {
        if (endHits.some((b) => segHitsRect(b, m, END_BRACE_CLEAR))) continue; // brace dropped
      } else {
        const a = m.start[ca];
        for (const b of endHits) {
          if (a < b.lo - 0.01 || a > b.hi + 0.01) continue;
          const next: Array<[Vec3, Vec3]> = [];
          for (const [s, e] of segs) next.push(...clipSegmentByY(s, e, b.ylo, b.yhi));
          segs = next;
          cut = true;
        }
      }
    }
    for (const b of bands) {
      let onPlane: boolean;
      let run: number;
      if (b.eave) {
        const constZ = Math.abs(m.start[2] - m.end[2]) < 0.01;
        const atPlane = inWallBand(b, m.start[0]) || inWallBand(b, m.end[0]);
        onPlane = constZ && atPlane;
        run = m.start[2];
      } else {
        const constX = Math.abs(m.start[0] - m.end[0]) < 0.01;
        const atPlane = inWallBand(b, m.start[2]) || inWallBand(b, m.end[2]);
        onPlane = constX && atPlane;
        run = m.start[0];
      }
      if (!onPlane || run < b.lo - 0.01 || run > b.hi + 0.01) continue;
      const next: Array<[Vec3, Vec3]> = [];
      for (const [s, e] of segs) next.push(...clipSegmentByY(s, e, b.ylo, b.yhi));
      segs = next;
      cut = true;
    }
    if (cut) for (const [s, e] of segs) out.push(member(m.kind, s, e));
    else out.push(m);
  }
  return out;
}

function deriveEnclosure(
  type: BuildingType,
  halfL: number,
  L: number,
  enclosedLengthFt: number,
  openEnd: OpenEnd,
  openEndGable: boolean,
  ov?: WallOverrides,
): Enclosure {
  const openMode: EndSheeting = openEndGable ? 'gableOnly' : 'open';
  const noOpen = { left: false, right: false };
  const noBand = { left: 0, right: 0 };
  switch (type) {
    case 'carport':
      // Program Wall Options can CLOSE (or gable/half-close) a carport end.
      return { type, sideZ: null, front: ov?.front ?? openMode, back: ov?.back ?? openMode, partitionZ: null, sideOpen: noOpen, sideBandFt: noBand };
    case 'garage':
      // Program Wall Options can open / gable-only / half-close either end,
      // fully open either eave side, or partially close a side with eave-down
      // panels (1/1.5/2… panels, ¼/½/¾) — each side independent.
      return {
        type,
        sideZ: { start: -halfL, end: halfL },
        front: ov?.front ?? 'closed',
        back: ov?.back ?? 'closed',
        partitionZ: null,
        sideOpen: { left: !!ov?.leftOpen, right: !!ov?.rightOpen },
        sideBandFt: { left: ov?.leftBandFt ?? 0, right: ov?.rightBandFt ?? 0 },
      };
    case 'utility': {
      const encLen = Math.max(4, Math.min(L, enclosedLengthFt));
      const split = encLen < L;
      // Enclosed bay sits against the CLOSED end; the open bay is at `openEnd`.
      if (openEnd === 'front') {
        return {
          type,
          sideZ: { start: halfL - encLen, end: halfL },
          front: openMode,
          back: 'closed',
          partitionZ: split ? halfL - encLen : null,
          sideOpen: noOpen,
          sideBandFt: noBand,
        };
      }
      return {
        type,
        sideZ: { start: -halfL, end: -halfL + encLen },
        front: 'closed',
        back: openMode,
        partitionZ: split ? -halfL + encLen : null,
        sideOpen: noOpen,
        sideBandFt: noBand,
      };
    }
  }
}

/**
 * Interior storage partition of a garage / carport (`walls.storage`, synced
 * from the program's "Storage / Add'l End Wall") → where it stands.
 *  - End Storage ('end' = front end, 'endBack' = back end): a cross partition
 *    `lengthFt` in from that end, snapped onto a frame line within 0.05 ft (the
 *    program only offers frame-line depths), its sheet facing the main room.
 *  - 'left' / 'right' (internal −X / +X): a lengthwise partition `lengthFt` in
 *    from that eave wall, facing the main room.
 * Kept at least 1 ft off every wall. A utility (GCH) never gets one — its
 * divider is the enclosed-length split (deriveEnclosure). null = none.
 */
export function storagePartition(
  type: BuildingType,
  storage: { mode: StorageMode; lengthFt: number } | undefined,
  W: number,
  L: number,
  framePositionsZ: number[],
): Pick<Enclosure, 'partitionZ' | 'partitionKind' | 'partitionFaces'> | Pick<Enclosure, 'sidePartition'> | null {
  if (type === 'utility' || !storage || storage.mode === 'none' || !(storage.lengthFt > 0)) return null;
  const halfW = W / 2;
  const halfL = L / 2;
  if (storage.mode === 'end' || storage.mode === 'endBack') {
    if (L < 2) return null;
    const d = Math.min(L - 1, Math.max(1, storage.lengthFt));
    let pz = storage.mode === 'end' ? -halfL + d : halfL - d;
    const onFrame = framePositionsZ.find((z) => Math.abs(z - pz) < 0.05);
    if (onFrame !== undefined) pz = onFrame;
    return { partitionZ: pz, partitionKind: 'storage', partitionFaces: storage.mode === 'end' ? 1 : -1 };
  }
  if (W < 2) return null;
  const w = Math.min(W - 1, Math.max(1, storage.lengthFt));
  return storage.mode === 'left' ? { sidePartition: { x: -halfW + w, faces: 1 } } : { sidePartition: { x: halfW - w, faces: -1 } };
}

/** Truss lines visible on an eave (side) wall: each frame leg within its span. */
function eaveTrussLines(framePositionsZ: number[], start: number, end: number): TrussLine[] {
  const within = framePositionsZ.filter((z) => z >= start - 1e-6 && z <= end + 1e-6);
  let prev = start;
  return within.map((z) => {
    const posFt = z - start;
    const line = { posFt: round(posFt), gapToPrevFt: round(posFt - (prev - start)) };
    prev = z;
    return line;
  });
}

/** Truss lines on a gable end wall: just the two corner columns (+span dim). */
function endTrussLines(W: number): TrussLine[] {
  return [
    { posFt: 0, gapToPrevFt: 0 },
    { posFt: round(W), gapToPrevFt: round(W) },
  ];
}

export function deriveStructure(resolved: ResolvedBuilding): StructureModel {
  const { config, legSpacing, requiresHatChannels } = resolved;
  const { width: W, length: L, legHeight: H0, roofPitch, buildingType, enclosedLengthFt, openEnd, openEndGableSheeting, eavePanelFt } = config;

  const halfW = W / 2;
  const halfL = L / 2;
  // Free-standing single-slope: the ridge sits AT the tall (-X) eave. The
  // pipeline's `H` becomes the LOW (+X) eave and `peakHeight` the tall side, so
  // peakHeight = H + rise holds for both roof shapes and the end-wall "gable"
  // formulas (0.5·W·rise) remain exact (right triangle instead of isosceles).
  const monoDropFt = Math.min(Math.max(0, config.monoDropFt ?? 0), Math.max(0, H0 - 1));
  const mono = monoDropFt > 0.01;
  const tallH = H0;
  const H = mono ? H0 - monoDropFt : H0;
  const rise = mono ? monoDropFt : halfW * (roofPitch / 12);
  const peakHeight = H + rise;
  const rafterLength = mono ? Math.hypot(W, rise) : Math.hypot(halfW, rise);
  /** Roofline height at X — gabled: peak at 0; mono: linear tall(−halfW) → low(+halfW). */
  const roofYAt = (x: number): number =>
    mono ? tallH - rise * ((x + halfW) / W) : peakHeight - Math.abs(x) * (rise / halfW);

  // Frames sit at EXACT on-center intervals from the front gable (with end
  // frames at both walls and a possibly-short last bay) — NOT evenly
  // distributed. So "4' OC" really means a truss every 4', matching the shop
  // drawings + the quote's collision logic, so a door placed in a bay clears.
  const framePositionsZ = (() => {
    if (L <= 0 || legSpacing <= 0) return [0];
    const out = [-halfL];
    for (let t = legSpacing; t < L - 0.01; t += legSpacing) out.push(-halfL + t);
    out.push(halfL);
    return out;
  })();
  const frameCount = framePositionsZ.length;

  const baseEnclosure = deriveEnclosure(buildingType, halfL, L, enclosedLengthFt, openEnd, openEndGableSheeting, config.wallOverrides);
  // Interior storage room (garage / carport): an End Storage cross partition or
  // a Left/Right lengthwise one. Absent → the enclosure is exactly as before.
  const storage = storagePartition(buildingType, config.walls?.storage, W, L, framePositionsZ);
  const enclosure: Enclosure = storage ? { ...baseEnclosure, ...storage } : baseEnclosure;
  /** z of an End Storage partition (null = none / a GCH divider, which keeps its old framing). */
  const storagePz = enclosure.partitionKind === 'storage' ? enclosure.partitionZ : null;
  // Bent lines: every frame position, plus the storage partition's own bent
  // when it is off the grid (it never is from the program — depths are frame
  // lines — but keep it framed if it ever were). framePositionsZ itself stays
  // the truss grid (eave truss checks, lean-to grids).
  const bentZs =
    storagePz !== null && !framePositionsZ.some((z) => Math.abs(z - storagePz) < 1e-6)
      ? [...framePositionsZ, storagePz].sort((a, b) => a - b)
      : framePositionsZ;
  const sidePart = enclosure.sidePartition ?? null;
  // The OPEN (carport) eave portion: whole length for a carport, the un-enclosed
  // bay for a utility/GCH, none for a fully enclosed garage.
  const openBayZ: { start: number; end: number } | null =
    buildingType === 'carport'
      ? { start: -halfL, end: halfL }
      : buildingType === 'utility' && enclosure.partitionZ !== null
        ? openEnd === 'front'
          ? { start: -halfL, end: enclosure.partitionZ }
          : { start: enclosure.partitionZ, end: halfL }
        : null;
  const members: Member[] = [];

  // --- Opening projections per wall (to CUT horizontal members around them) ---
  // Each wall's holes are expressed along that wall's axis: eave walls run along
  // Z (center = -halfL + offset), gable/front-back along X (front: -halfW+offset,
  // back: halfW-offset). A floor-mounted door (sill 0) cuts the base rail; any
  // opening cuts the girts/hat channels it crosses.
  const holesForWall = (side: WallSide): WallHole[] =>
    (config.openings ?? [])
      .filter((o) => o.side === side)
      .map((o) => {
        const center =
          side === 'back'
            ? halfW - o.offset
            : side === 'left' || side === 'right'
              ? -halfL + o.offset
              : -halfW + o.offset; // front / partition
        const sill = o.sillHeight ?? 0;
        return { lo: center - o.width / 2, hi: center + o.width / 2, sill, top: sill + o.height };
      });
  const leftHoles = holesForWall('left');
  const rightHoles = holesForWall('right');
  const frontHoles = holesForWall('front');
  const backHoles = holesForWall('back');

  // --- Frame bents: legs + gable rafters + knee braces + truss webs ---
  // The rafters are the top chord; wider than 24' the manufacturer's truss web
  // pattern is added under them (trussStyleFor / trussSegments; a bow keeps the
  // peak collar tie). Leg style varies:
  //   • DOUBLE leg   when W > 31 (or H 15+) — a second post welded just
  //     INBOARD of the first (toward the interior, along X), tops meeting the
  //     rafter underside. 16' legs are STANDARD DOUBLE legs, not ladder.
  //   • LADDER leg   when W >= 52 — a deep two-chord column IN THE TRUSS
  //     PLANE: outer chord at the wall, inner chord ~a foot and a half
  //     inboard, horizontal rungs between them every ~3'. (The first attempt
  //     split the posts ALONG the wall (Z), which laid the ladder flat against
  //     the sheeting and read as two skinny posts — the depth must run
  //     inboard, like the real welded column.)
  // Ladder legs are a WIDE-building feature — Master Price Book 7/16/26 footnote:
  // 32'-51' wide = standard double legs, 52'-60' = standard ladder legs (any
  // height). Sensei renders CCI 30x96x18 with plain double legs (owner screenshot
  // 8/31/26). Narrow tall buildings get double posts from 15' up — owner 9/28/26 +
  // both price books: the 15' & 16' rows "include double legs + double base rail";
  // 14' and under are single legs.
  // (legStyleFor holds the rule, shared with the lean-to posts.)
  const mainLegStyle = legStyleFor(W, H, config.manufacturer);
  const doublePost = mainLegStyle === 'double';
  const ladderLeg = mainLegStyle === 'ladder';
  const LADDER_D = ladderDepth(H); // ladder column depth (inboard, X)

  const braceLen = Math.min(3, H * 0.45);
  const tBrace = rafterLength > 0 ? Math.min(0.5, braceLen / rafterLength) : 0;
  const pbx = Math.min(3, halfW * 0.5); // peak collar tie half-span from the ridge
  const pby = H + rise * (1 - pbx / halfW);

  // Truss web pattern from the manufacturer's chart (trussStyleFor). The same
  // in-plane pattern goes on EVERY gabled bent, end frames included; mono-slope
  // bents keep their plain rafter. The eave column's inboard reach keeps CA's
  // box-eave webs off the double / ladder inner post.
  const trussStyle: TrussStyle = mono ? 'bow' : trussStyleFor(W, config.manufacturer);
  const colDepth = ladderLeg ? LADDER_D : doublePost ? DOUBLE_D : 0;
  const trussSegs = trussSegments(trussStyle, halfW, H, rise, colDepth);
  const trussChords = trussSegs.filter((sg) => sg.kind === 'chord');

  // Column(s) at eave side `sx`, plane `z`. The inner chord/post rises past H
  // to meet the rafter underside (the roof climbs toward the ridge).
  const pushLeg = (sx: number, z: number) => {
    const inb = sx < 0 ? 1 : -1; // toward the building interior along X
    const topY = roofYAt(sx); // gabled: H both sides; mono: tall on −X, low on +X
    if (ladderLeg) {
      const xIn = sx + inb * LADDER_D;
      const yIn = roofYAt(xIn);
      members.push(member('leg', [sx, 0, z], [sx, topY, z]));
      members.push(member('leg', [xIn, 0, z], [xIn, yIn, z]));
      const rungs = Math.max(3, Math.round(topY / 3)); // ~every 3'
      for (let i = 1; i < rungs; i++) {
        const y = (topY * i) / rungs;
        members.push(member('brace', [sx, y, z], [sx + inb * LADDER_D, y, z]));
      }
    } else if (doublePost) {
      const xIn = sx + inb * DOUBLE_D;
      const yIn = roofYAt(xIn);
      members.push(member('leg', [sx, 0, z], [sx, topY, z]));
      members.push(member('leg', [xIn, 0, z], [xIn, yIn, z]));
    } else {
      members.push(member('leg', [sx, 0, z], [sx, topY, z]));
    }
  };

  // One bent: columns + two gable rafters + knee braces + the chart's truss
  // webs (a BOW keeps the short peak collar tie instead — every truss chart
  // already has members in that spot: king post, struts or sister chord).
  // Ladder bents skip the knee brace — the deep column IS the reinforcement,
  // and a diagonal across the ladder reads as clutter. A knee brace that would
  // pierce a truss chord (CA box-eave lower chord) ends ON that chord.
  // `preTruss` = the bent exactly as drawn before the truss webs (full knee
  // braces + peak collar tie, no webs) — only for the capture-framing proxy.
  const pushBent = (z: number, preTruss = false) => {
    pushLeg(-halfW, z);
    pushLeg(halfW, z);
    if (mono) {
      // Single-slope bent: one rafter across, tall (−X) eave → low (+X) eave.
      members.push(member('rafter', [-halfW, tallH, z], [halfW, H, z]));
      if (!ladderLeg) {
        for (const sx of [-halfW, halfW]) {
          const dir = sx < 0 ? 1 : -1; // brace tip runs inboard along the rafter
          const tipX = sx + dir * Math.min(braceLen, halfW);
          members.push(member('brace', [sx, roofYAt(sx) - braceLen, z], [tipX, roofYAt(tipX), z]));
        }
      }
      return; // no peak collar tie on a mono-slope bent
    }
    members.push(member('rafter', [-halfW, H, z], [0, peakHeight, z]));
    members.push(member('rafter', [halfW, H, z], [0, peakHeight, z]));
    if (!ladderLeg) {
      for (const sx of [-halfW, halfW]) {
        const foot: [number, number] = [sx, H - braceLen];
        let tip: [number, number] = [sx * (1 - tBrace), H + rise * tBrace];
        let tHit = 1;
        for (const c of preTruss ? [] : trussChords) {
          const t = segCross2(foot, tip, c.a, c.b);
          if (t !== null && t < tHit) tHit = t;
        }
        if (tHit < 1) tip = [foot[0] + (tip[0] - foot[0]) * tHit, foot[1] + (tip[1] - foot[1]) * tHit];
        members.push(member('brace', [foot[0], foot[1], z], [tip[0], tip[1], z]));
      }
    }
    if (preTruss || trussStyle === 'bow') members.push(member('brace', [-pbx, pby, z], [pbx, pby, z]));
    if (!preTruss) for (const sg of trussSegs) members.push(member(sg.kind, [sg.a[0], sg.a[1], z], [sg.b[0], sg.b[1], z]));
  };

  for (const z of bentZs) pushBent(z);
  // Capture-framing proxy (StructureModel.captureMembers): the same bents as
  // they were before the truss webs, built in the same order and lifted
  // straight back out; everything pushed after the bents is shared.
  const bentEnd = members.length;
  let preTrussBents: Member[] | null = null;
  if (trussStyle !== 'bow') {
    for (const z of bentZs) pushBent(z, true);
    preTrussBents = members.splice(bentEnd);
  }

  // --- Base rails (DOUBLED for double/ladder legs) ---
  // Eave (side) rails run the full length on both sides, CUT where a floor-level
  // door (sill ≈ 0) crosses them — a garage door has no rail across its threshold.
  // `inset` adds a second rail inboard, aligned under the inner chord/post so
  // the doubled column lands on it ("Ladder Legs Baserail").
  const railInsets = ladderLeg ? [0, LADDER_D] : doublePost ? [0, DOUBLE_D] : [0];
  for (const inset of railInsets) {
    for (const [s, e] of subtractSpans(-halfL, halfL, gapsAtHeight(leftHoles, 0)))
      members.push(member('baseRail', [-halfW + inset, 0, s], [-halfW + inset, 0, e]));
    for (const [s, e] of subtractSpans(-halfL, halfL, gapsAtHeight(rightHoles, 0)))
      members.push(member('baseRail', [halfW - inset, 0, s], [halfW - inset, 0, e]));
    // A gable-end base rail only exists when that end is CLOSED. An open or
    // gable-only end is a drive-through — no rail across the ground there.
    if (enclosure.front === 'closed')
      for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(frontHoles, 0)))
        members.push(member('baseRail', [s, 0, -halfL + inset], [e, 0, -halfL + inset]));
    if (enclosure.back === 'closed')
      for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(backHoles, 0)))
        members.push(member('baseRail', [s, 0, halfL - inset], [e, 0, halfL - inset]));
  }
  // Storage partition base rail (single — an interior wall), cut at its floor-level doors.
  // Its rail + girts end at the eave legs' inner faces (not in the side walls'
  // sheet gap, where an edge-on end drew a 1-px line through the closed eave).
  const storageRunX = halfW - STORAGE_RUN_END_INSET;
  if (storagePz !== null)
    for (const [s, e] of subtractSpans(-storageRunX, storageRunX, gapsAtHeight(holesForWall('partition'), 0)))
      members.push(member('baseRail', [s, 0, storagePz], [e, 0, storagePz]));

  // --- Ridge (clipped at openings) ---
  // Ridge is at peak height, so it's only affected by openings that extend to the peak
  const ridgeGaps = (config.openings ?? [])
    .filter(o => (o.side === 'left' || o.side === 'right') && (o.sillHeight ?? 0) + o.height >= peakHeight * 0.95)
    .map(o => {
      const center = -halfL + o.offset;
      return [center - o.width / 2, center + o.width / 2] as [number, number];
    });
  for (const [s, e] of subtractSpans(-halfL, halfL, ridgeGaps)) {
    // Mono-slope: the "ridge" strut runs along the TALL eave edge.
    members.push(member('ridge', [mono ? -halfW : 0, peakHeight, s], [mono ? -halfW : 0, peakHeight, e]));
  }

  // --- Roof purlins (clipped at openings) ---
  const runs = purlinRunsPerSlope(rafterLength);
  for (let i = 1; i < runs; i++) {
    const t = i / runs;
    const yL = mono ? tallH - rise * t : H + rise * t;
    const xL = mono ? -halfW + W * t : -halfW + halfW * t;
    const xR = halfW - halfW * t;

    // Clip purlins at opening locations along the Z-axis (length)
    // Openings on eave sides (left/right) create Z-axis gaps
    const zGaps = (config.openings ?? [])
      .filter(o => (o.side === 'left' || o.side === 'right') && yL >= (o.sillHeight ?? 0) && yL <= (o.sillHeight ?? 0) + o.height)
      .map(o => {
        const center = -halfL + o.offset;
        return [center - o.width / 2, center + o.width / 2] as [number, number];
      });

    // Generate purlin segments (mono-slope has ONE plane — no mirrored run)
    for (const [s, e] of subtractSpans(-halfL, halfL, zGaps)) {
      members.push(member('purlin', [xL, yL, s], [xL, yL, e]));
      if (!mono) members.push(member('purlin', [xR, yL, s], [xR, yL, e]));
    }
  }

  // --- Wall girts: horizontal members the sheeting screws to, on every framed
  // wall at ~4 ft vertical spacing (eave walls run along Z, end walls along X). ---
  // Mono-slope: the tall (−X) side wall is `tallH` high — its girt ladder runs
  // the full tall wall while the low side (and the end-wall rows) use `H`.
  const wallHFor = (sd: 'left' | 'right'): number => (mono && sd === 'left' ? tallH : H);
  for (const sd of ['left', 'right'] as const) {
    if (!enclosure.sideZ) break;
    const wallH = wallHFor(sd);
    const rowsS = Math.max(1, Math.floor((wallH - 1) / 4));
    const { start, end } = enclosure.sideZ;
    for (let i = 1; i <= rowsS; i++) {
      const y = (wallH * i) / (rowsS + 1);
      // A partially-closed side (eave-down band) only has girts within the
      // band — the open framing below gets none.
      const within =
        !enclosure.sideOpen[sd] && (enclosure.sideBandFt[sd] <= 0 || y >= wallH - enclosure.sideBandFt[sd] - 0.01);
      if (!within) continue;
      const holes = sd === 'left' ? leftHoles : rightHoles;
      const wx = sd === 'left' ? -halfW : halfW;
      for (const [s, e] of subtractSpans(start, end, gapsAtHeight(holes, y)))
        members.push(member('girt', [wx, y, s], [wx, y, e]));
    }
  }
  const girtRows = Math.max(1, Math.floor((H - 1) / 4));
  for (let i = 1; i <= girtRows; i++) {
    const y = (H * i) / (girtRows + 1);
    if (enclosure.front === 'closed')
      for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(frontHoles, y)))
        members.push(member('girt', [s, y, -halfL], [e, y, -halfL]));
    if (enclosure.back === 'closed')
      for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(backHoles, y)))
        members.push(member('girt', [s, y, halfL], [e, y, halfL]));
    // Storage partition girts (same rows as a closed end wall), cut around its openings.
    if (storagePz !== null)
      for (const [s, e] of subtractSpans(-storageRunX, storageRunX, gapsAtHeight(holesForWall('partition'), y)))
        members.push(member('girt', [s, y, storagePz], [e, y, storagePz]));
  }

  // --- Left/Right lengthwise storage partition framing: a post on every frame
  // line (floor to the roofline at its x), a base rail and girt rows along the
  // full length. No openings (no door rule for a lengthwise partition). ---
  if (sidePart) {
    const x = sidePart.x;
    const hx = roofYAt(x);
    // The two end posts stand INSIDE the end walls (outer face on the frame
    // line) and the rail + girts end at those posts: centred on the end frame
    // line, half the post sat in the end wall's 0.18' sheet gap, and its (and
    // the girts') near edge-on side faces rasterized through the closed end
    // sheet + base trim as a 1-px line at 1×–1.5× screen scale (visual
    // verifier 10/2/26).
    const zEnd = halfL - STORAGE_END_POST_INSET;
    const endZ = (z: number) => (z <= -halfL + 1e-6 ? -zEnd : z >= halfL - 1e-6 ? zEnd : z);
    for (const z of framePositionsZ) members.push(member('leg', [x, 0, endZ(z)], [x, hx, endZ(z)]));
    members.push(member('baseRail', [x, 0, -zEnd], [x, 0, zEnd]));
    const rowsX = Math.max(1, Math.floor((hx - 1) / 4));
    for (let i = 1; i <= rowsX; i++) {
      const y = (hx * i) / (rowsX + 1);
      members.push(member('girt', [x, y, -zEnd], [x, y, zEnd]));
    }
  }

  // --- Hat channels on sheeted side walls (vertical sheeting only) ---
  if (requiresHatChannels && enclosure.sideZ) {
    const { start, end } = enclosure.sideZ;
    for (const sd of ['left', 'right'] as const) {
      const wallH = wallHFor(sd);
      const rows = hatRows(wallH);
      for (let i = 1; i <= rows; i++) {
        const y = (wallH * i) / (rows + 1);
        const within =
          !enclosure.sideOpen[sd] && (enclosure.sideBandFt[sd] <= 0 || y >= wallH - enclosure.sideBandFt[sd] - 0.01);
        if (!within) continue;
        const holes = sd === 'left' ? leftHoles : rightHoles;
        const wx = sd === 'left' ? -halfW : halfW;
        for (const [s, e] of subtractSpans(start, end, gapsAtHeight(holes, y)))
          members.push(member('hatChannel', [wx, y, s], [wx, y, e]));
      }
    }
  }

  // --- Sheet-metal areas ---
  const gableTriangle = 0.5 * W * rise;
  const sideSpan = enclosure.sideZ ? enclosure.sideZ.end - enclosure.sideZ.start : 0;
  const sideSheetH = (sd: 'left' | 'right') =>
    enclosure.sideOpen[sd] ? 0 : enclosure.sideBandFt[sd] > 0 ? Math.min(enclosure.sideBandFt[sd], wallHFor(sd)) : wallHFor(sd);
  const sideWallArea = enclosure.sideZ ? (sideSheetH('left') + sideSheetH('right')) * sideSpan : 0;
  const endArea = (mode: EndSheeting) =>
    mode === 'closed'
      ? W * H + gableTriangle
      : mode === 'gableOnly'
        ? gableTriangle
        : mode === 'halfClosed'
          ? W * Math.min(6, H) + gableTriangle // 6' band below the eave + gable
          : 0;
  const endWallArea =
    endArea(enclosure.front) + endArea(enclosure.back) + (enclosure.partitionZ !== null ? W * H + gableTriangle : 0) +
    (sidePart ? L * roofYAt(sidePart.x) : 0);

  // --- Per-wall layouts for the editor + opening placement ---
  const sideTruss = enclosure.sideZ
    ? eaveTrussLines(framePositionsZ, enclosure.sideZ.start, enclosure.sideZ.end)
    : [];

  const walls: Record<WallSide, WallLayout> = {
    left: {
      side: 'left',
      available: !!enclosure.sideZ,
      isEndWall: false,
      spanFt: round(L),
      eaveHeightFt: mono ? round(tallH) : H,
      peakHeightFt: mono ? round(tallH) : H,
      trussLines: sideTruss,
    },
    right: {
      side: 'right',
      available: !!enclosure.sideZ,
      isEndWall: false,
      spanFt: round(L),
      eaveHeightFt: H,
      peakHeightFt: H,
      trussLines: sideTruss,
    },
    front: {
      side: 'front',
      available: enclosure.front === 'closed',
      isEndWall: true,
      spanFt: round(W),
      eaveHeightFt: H,
      peakHeightFt: round(peakHeight),
      trussLines: endTrussLines(W),
    },
    back: {
      side: 'back',
      available: enclosure.back === 'closed',
      isEndWall: true,
      spanFt: round(W),
      eaveHeightFt: H,
      peakHeightFt: round(peakHeight),
      trussLines: endTrussLines(W),
    },
    partition: {
      side: 'partition',
      available: enclosure.partitionZ !== null,
      isEndWall: true,
      spanFt: round(W),
      eaveHeightFt: H,
      peakHeightFt: round(peakHeight),
      trussLines: endTrussLines(W),
    },
  };

  // --- Lean-tos: SHED-ROOF bents on the main building's truss grid ---
  // Each bent: outer post (low, lh) + rafter up to the main wall (connH) + a
  // knee brace at the outer post; posts follow the main leg rule (legStyleFor —
  // a 15'+ post is doubled, drawing only); an outer base rail (doubled under a
  // doubled post) + two roof purlins run the length. The inner (high) end of
  // the rafter rides on the main building's own leg wherever one stands; a
  // lean-to inner post is drawn only where none does (a partial lean-to's end
  // between main trusses, and along a main gable wall).
  // Bent positions (UNCHANGED from before the render port — they also feed
  // trussOffsets, i.e. the drag-time post guides): both span ends + every
  // main-building truss position (framePositionsZ) strictly inside the span.
  // For a gable-attached lean-to those Z positions are reused along X, which
  // gives short end bays (e.g. 0,3,7,...,27,30 on a 30' wall at 4' OC).
  // Re-spacing them to the OC from the lean-to start is an owner decision that
  // has not been made, so it is deliberately NOT done here.
  const derivedLeanTos: LeanToStructure[] = [];
  for (const lt of config.leanTos ?? []) {
    if (!lt.widthFt || !lt.lengthFt || !lt.lowLegHeightFt) continue;

    const lw = lt.widthFt;
    const ll = lt.lengthFt;
    const lh = lt.lowLegHeightFt;

    const [riseStr, runStr] = (lt.roofPitch || '2:12').split(':');
    const pitchNum = parseFloat(riseStr) || 2;
    const runNum = parseFloat(runStr) || 12;
    const rise = (lw * pitchNum) / runNum;
    const connH = Math.min(H, lh + rise);
    const peakH = lh + rise;

    if (lt.type !== 'attached') continue;
    const side = lt.attachedSide || 'Left Eave';
    const isEave = side === 'Left Eave' || side === 'Right Eave';
    if (!isEave && side !== 'Front Gable' && side !== 'Back Gable') continue;

    // Span along the attachment wall: length clamped to the wall, shifted by
    // the user-chosen start offset (ft from the building front for eave sides,
    // from the left edge for gable ends).
    const wallLen = isEave ? L : W;
    const runLen = Math.min(ll, wallLen);
    const runOff = Math.max(0, Math.min(lt.offsetFt ?? 0, wallLen - runLen));
    const spanA = (isEave ? -halfL : -halfW) + runOff;
    const spanB = spanA + runLen;

    // World coordinate ACROSS the lean-to (X for an eave lean-to, Z for a gable
    // one) of its inner edge (the main wall) and outer wall. Left/Right are
    // defined as viewed from the FRONT of the building. In the front camera
    // (looking +Z), world +X renders on screen-LEFT, so Left Eave maps to +X
    // and Right Eave to -X. Front Gable = -Z, Back Gable = +Z.
    const innerC =
      side === 'Left Eave' ? halfW : side === 'Right Eave' ? -halfW : side === 'Front Gable' ? -halfL : halfL;
    const outerC =
      side === 'Left Eave' ? halfW + lw : side === 'Right Eave' ? -halfW - lw : side === 'Front Gable' ? -halfL - lw : halfL + lw;
    const sOut = Math.sign(outerC - innerC) || 1; // world direction inner -> outer
    /** World point at run position `run`, across coordinate `c`, height `y`. */
    const P = (run: number, c: number, y: number): Vec3 => (isEave ? [c, y, run] : [run, y, c]);
    /** Lean-to roofline (rafter) height at across coordinate `c`. */
    const roofY = (c: number): number =>
      c === innerC ? connH : c === outerC ? lh : connH + (lh - connH) * ((c - innerC) / (outerC - innerC));

    // Bent positions along the run (see the block comment: the pre-existing grid).
    const gridPos = Array.from(
      new Set([spanA, ...framePositionsZ.filter((v) => v > spanA && v < spanB), spanB]),
    ).sort((a, b) => a - b);

    // STORAGE SECTION (VIEW-ONLY; priced by the program): a partition wall
    // `lengthFt` in from the storage end. Its bent is a full lean-to bent
    // (outer post, inner post where no main leg stands, rafter, knee brace —
    // the same members as every other bent), added to the grid; on (or within
    // 0.05 ft of) an existing bent the partition simply uses that bent. The
    // storage length is kept at least 0.5 ft short of the run (the program
    // only prices a length SHORTER than the lean-to). No storage = gridPos,
    // exactly as before.
    let storage: LeanToStorageSpan | undefined;
    const st = lt.storage;
    if (st && (st.end === 'front' || st.end === 'back') && Number.isFinite(st.lengthFt) && st.lengthFt > 0) {
      const sL = Math.min(st.lengthFt, runLen - 0.5);
      if (sL >= 0.5) {
        let runAt = st.end === 'front' ? spanA + sL : spanB - sL;
        const onBent = gridPos.find((r) => Math.abs(r - runAt) < 0.05);
        if (onBent !== undefined) runAt = onBent;
        storage = {
          end: st.end,
          lengthFt: st.end === 'front' ? runAt - spanA : spanB - runAt,
          runAt,
          segStart: st.end === 'front' ? 0 : runAt - spanA,
          segEnd: st.end === 'front' ? runAt - spanA : runLen,
          faces: st.end === 'front' ? 1 : -1,
        };
      }
    }
    const runPos = storage && !gridPos.includes(storage.runAt) ? [...gridPos, storage.runAt].sort((a, b) => a - b) : gridPos;
    // Does a MAIN-building leg already stand at this run position on the lean-to's
    // wall line? (Every main truss on an eave wall; the two corners on a gable wall.)
    const mainLegAt = (run: number): boolean =>
      isEave ? framePositionsZ.some((z) => Math.abs(z - run) < 0.01) : Math.abs(Math.abs(run) - halfW) < 0.01;

    // A lean-to post at across coordinate `c` (inboard direction `inb` along the
    // across axis): single, or doubled / laddered by the main leg rule on its
    // own height, the extra chord `depth` inboard rising to the rafter.
    const pushPost = (run: number, c: number, inb: number) => {
      const top = roofY(c);
      members.push(member('leg', P(run, c, 0), P(run, c, top)));
      const style = legStyleFor(lw, top);
      if (style === 'single') return;
      const c2 = c + inb * (style === 'ladder' ? ladderDepth(top) : DOUBLE_D);
      members.push(member('leg', P(run, c2, 0), P(run, c2, roofY(c2))));
      if (style === 'ladder') {
        const rungs = Math.max(3, Math.round(top / 3));
        for (let i = 1; i < rungs; i++) {
          const y = (top * i) / rungs;
          members.push(member('brace', P(run, c, y), P(run, c2, y)));
        }
      }
    };

    // Knee brace at the outer post (same proportions as the main bent's): from
    // the post, braceLen below the low eave, up to the rafter braceLen along it
    // toward the main wall. A ladder post skips it, like the main building.
    // On a DOUBLED outer post the brace springs from the inboard (second) post,
    // so it never passes through that post; a single post is unchanged.
    const outerStyle = legStyleFor(lw, lh);
    const kneeLen = Math.min(3, lh * 0.45);
    const ltRafterLen = Math.hypot(lw, connH - lh);
    const tKnee = ltRafterLen > 0 ? Math.min(0.5, kneeLen / ltRafterLen) : 0;
    const kneeFootC = outerStyle === 'double' ? outerC - sOut * DOUBLE_D : outerC;
    const kneeTipC = kneeFootC + (innerC - outerC) * tKnee;
    // Outer base rail(s): at the wall, plus one under the second post of a doubled / ladder post.
    const railCs =
      outerStyle === 'ladder'
        ? [outerC, outerC - sOut * ladderDepth(lh)]
        : outerStyle === 'double'
          ? [outerC, outerC - sOut * DOUBLE_D]
          : [outerC];

    for (let i = 0; i < runPos.length; i++) {
      const run = runPos[i];
      if (!mainLegAt(run)) pushPost(run, innerC, sOut); // inner post, only where no main leg stands
      pushPost(run, outerC, -sOut); // outer post (low, away from the building)
      members.push(member('rafter', P(run, innerC, connH), P(run, outerC, lh)));
      if (outerStyle !== 'ladder' && kneeLen > 0.05 && tKnee > 0) {
        members.push(member('brace', P(run, kneeFootC, roofY(kneeFootC) - kneeLen), P(run, kneeTipC, roofY(kneeTipC))));
      }
      // LONGITUDINAL base rail along the OUTER (low-leg) wall only: an attached
      // lean-to is a roof extension that SHARES the main building's wall on the
      // inner side — there is no second wall there, so no lean-to base rail (it
      // was drawing a phantom rail across floor-level framed openings in the
      // shared wall).
      if (i > 0) {
        for (const c of railCs) members.push(member('baseRail', P(runPos[i - 1], c, 0), P(run, c, 0)));
      }
    }

    // Two purlin lines at 1/3 and 2/3 of the slope, full run.
    if (runPos.length > 1) {
      const r0 = runPos[0];
      const r1 = runPos[runPos.length - 1];
      for (let p = 1; p <= 2; p++) {
        const t = p / 3;
        const c = innerC + (outerC - innerC) * t;
        const y = connH + (lh - connH) * t;
        members.push(member('purlin', P(r0, c, y), P(r1, c, y)));
      }
    }

    // ===== DERIVE LEAN-TO PANEL DATA (for 3D rendering) =====
    const enclosure = (lt.enclosure ?? 'open') as 'open' | 'enclosed' | 'custom';
    derivedLeanTos.push({
      id: lt.id,
      enclosure,
      customWalls: lt.customWalls, // Pass through custom wall settings if present
      openings: lt.openings ?? [],
      attachedSide: side,
      widthFt: lw,
      lengthFt: isEave ? Math.abs(spanB - spanA) : spanB - spanA,
      lowLegHeightFt: lh,
      peakHeightFt: peakH,
      rise,
      inner: isEave ? { x: innerC, z: spanA } : { x: spanA, z: innerC },
      outer: isEave ? { x: outerC, z: spanA } : { x: spanA, z: outerC },
      spanStart: spanA,
      spanEnd: spanB,
      // Post positions along the run (the bents above), as offsets from
      // spanStart so they line up with an opening's offsetFt.
      trussOffsets: runPos.map((r) => r - spanA),
      // Only a lean-to WITH a storage section gets the key (no-storage output unchanged).
      ...(storage ? { storage } : {}),
    });
  }

  return {
    width: W,
    length: L,
    legHeight: H,
    peakHeight,
    rise,
    rafterLength,
    monoDropFt: mono ? monoDropFt : 0,
    roofOverhangFt: config.roofOverhangFt,
    frameCount,
    framePositionsZ,
    // Cut columns + knee braces out of any eave doorway/opening last, so you can
    // step right through a framed opening (horizontals were cut during build).
    // Truss webs/chords in a gable-end bent first clear that wall's openings.
    members: clipFrameAtLeanToOpenings(
      clipFrameAtEaveOpenings(
        clipTrussAtEndOpenings(members, [
          ...frontHoles.map((h) => ({ z: -halfL, lo: h.lo, hi: h.hi, ylo: h.sill, yhi: h.top })),
          ...backHoles.map((h) => ({ z: halfL, lo: h.lo, hi: h.hi, ylo: h.sill, yhi: h.top })),
          ...(enclosure.partitionZ !== null
            ? holesForWall('partition').map((h) => ({ z: enclosure.partitionZ as number, lo: h.lo, hi: h.hi, ylo: h.sill, yhi: h.top }))
            : []),
        ]),
        config.openings ?? [],
        halfW,
        halfL,
      ),
      derivedLeanTos,
    ),
    // Truss widths only: the pre-truss frame for the PDF capture fit, clipped
    // exactly as before (no truss members, so the end-wall truss clip is moot).
    ...(preTrussBents
      ? {
          captureMembers: clipFrameAtLeanToOpenings(
            clipFrameAtEaveOpenings([...preTrussBents, ...members.slice(bentEnd)], config.openings ?? [], halfW, halfL),
            derivedLeanTos,
          ),
        }
      : {}),
    enclosure,
    openBayZ,
    eavePanelFt: { left: eavePanelFt.left, right: eavePanelFt.right },
    walls,
    areas: { roof: 2 * rafterLength * L, walls: sideWallArea + endWallArea },
    leanTos: derivedLeanTos,
  };
}

/** Map a wall-local opening offset to a world transform for the 3D scene. */
export function openingWorldTransform(
  side: WallSide,
  offset: number,
  yCenter: number,
  structure: StructureModel,
): { pos: Vec3; rotY: number } {
  const halfW = structure.width / 2;
  const halfL = structure.length / 2;
  // Eave openings are measured from the building FRONT and may sit anywhere
  // along the full length — including the open carport bay of a GCH.
  const eaveStart = -halfL;
  const eps = COMPONENT_OUTSET; // mount on the outside face of the sheeting
  // rotY is chosen so the opening's LOCAL +Z always points OUTWARD (away from
  // the building). Detail meshes (knob, hinges, window rail/sill) are placed at
  // +Z so they sit proud on the exterior; recessed glass goes to -Z.
  switch (side) {
    case 'front':
      return { pos: [-halfW + offset, yCenter, -halfL - eps], rotY: Math.PI };
    case 'back':
      return { pos: [halfW - offset, yCenter, halfL + eps], rotY: 0 };
    case 'partition': {
      const enc = structure.enclosure;
      // End Storage partition: mounted on its sheeted (main-room) face like any
      // wall; the GCH divider keeps its in-plane placement (unchanged).
      if (enc.partitionKind === 'storage') {
        const f = enc.partitionFaces ?? -1;
        return { pos: [-halfW + offset, yCenter, (enc.partitionZ ?? 0) + f * eps], rotY: f < 0 ? Math.PI : 0 };
      }
      return { pos: [-halfW + offset, yCenter, enc.partitionZ ?? 0], rotY: Math.PI };
    }
    case 'left':
      return { pos: [-halfW - eps, yCenter, eaveStart + offset], rotY: -Math.PI / 2 };
    case 'right':
      return { pos: [halfW + eps, yCenter, eaveStart + offset], rotY: Math.PI / 2 };
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
