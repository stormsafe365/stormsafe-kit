import type { BuildingType, EndSheeting, LeanToOpening, OpenEnd, Opening, WallOverrides, WallSide } from '@/types/building';
import type { ResolvedBuilding } from './ruleEngine';

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
export type MemberKind = 'leg' | 'rafter' | 'baseRail' | 'ridge' | 'purlin' | 'hatChannel' | 'girt' | 'brace';

/**
 * Assembly layering (ft, measured out from the structural centerline):
 *   framing (centered on the line) → sheeting → components.
 * Sheeting sits just outside the tube's outer face so steel never pokes
 * through; doors/windows mount on the outside face of the sheeting.
 */
export const SHEET_OUTSET = 0.18;
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
  partitionZ: number | null; // interior gable wall (utility split)
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
}

export interface StructureModel {
  width: number;
  length: number;
  legHeight: number;
  peakHeight: number;
  rise: number;
  rafterLength: number;
  roofOverhangFt: number;
  frameCount: number;
  framePositionsZ: number[];
  members: Member[];
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
    const clippable = m.kind === 'leg' || m.kind === 'brace';
    const constZ = Math.abs(m.start[2] - m.end[2]) < 0.01;
    // A foot of the member must sit on or just inboard of an eave wall plane.
    // The band covers the DEEP-COLUMN inset too: double legs put a second post
    // 0.4' inboard and ladder legs (H>=16) up to 2' inboard — those inner
    // chords stood visible through framed openings when the band was a tight
    // 0.1' (regression: "trusses showing inside the opening again"). 2.25'
    // still excludes the peak collar tie (ends ≥ 3' further inboard on every
    // buildable width).
    const atEaveWall =
      Math.abs(m.start[0]) > halfW - 2.25 || Math.abs(m.end[0]) > halfW - 2.25;
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
 */
function clipFrameAtLeanToOpenings(members: Member[], leanTos: LeanToStructure[]): Member[] {
  type Band = { eave: boolean; plane: number; lo: number; hi: number; ylo: number; yhi: number };
  const bands: Band[] = [];
  for (const lt of leanTos) {
    const eave = lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
    for (const op of lt.openings ?? []) {
      if (op.wall !== 'outer') continue; // posts only cross the outer long wall
      const c = lt.spanStart + op.offsetFt; // centre along the run axis
      const sill = op.sillFt ?? 0;
      bands.push({
        eave,
        plane: eave ? lt.outer.x : lt.outer.z,
        lo: c - op.widthFt / 2,
        hi: c + op.widthFt / 2,
        ylo: sill,
        yhi: sill + op.heightFt,
      });
    }
  }
  if (!bands.length) return members;

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
          Math.abs(m.start[planeAxis] - b.plane) < 0.1 && Math.abs(m.end[planeAxis] - b.plane) < 0.1;
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
    for (const b of bands) {
      let onPlane: boolean;
      let run: number;
      if (b.eave) {
        const constZ = Math.abs(m.start[2] - m.end[2]) < 0.01;
        const atPlane = Math.abs(m.start[0] - b.plane) < 0.1 || Math.abs(m.end[0] - b.plane) < 0.1;
        onPlane = constZ && atPlane;
        run = m.start[2];
      } else {
        const constX = Math.abs(m.start[0] - m.end[0]) < 0.01;
        const atPlane = Math.abs(m.start[2] - b.plane) < 0.1 || Math.abs(m.end[2] - b.plane) < 0.1;
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
  const { width: W, length: L, legHeight: H, roofPitch, buildingType, enclosedLengthFt, openEnd, openEndGableSheeting, eavePanelFt } = config;

  const halfW = W / 2;
  const halfL = L / 2;
  const rise = halfW * (roofPitch / 12);
  const peakHeight = H + rise;
  const rafterLength = Math.hypot(halfW, rise);

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

  const enclosure = deriveEnclosure(buildingType, halfL, L, enclosedLengthFt, openEnd, openEndGableSheeting, config.wallOverrides);
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

  // --- Frame bents: legs + gable rafters + knee braces + peak collar tie ---
  // The roof member is the simple single rafter ("bow"). Leg style varies:
  //   • DOUBLE leg   when W > 31 (or H 14/15) — a second post welded just
  //     INBOARD of the first (toward the interior, along X), tops meeting the
  //     rafter underside.
  //   • LADDER leg   when H >= 16 — a deep two-chord column IN THE TRUSS
  //     PLANE: outer chord at the wall, inner chord ~a foot and a half
  //     inboard, horizontal rungs between them every ~3'. (The first attempt
  //     split the posts ALONG the wall (Z), which laid the ladder flat against
  //     the sheeting and read as two skinny posts — the depth must run
  //     inboard, like the real welded column.)
  const doublePost = W > 31 || H === 14 || H === 15;
  const ladderLeg = H >= 16;
  const LADDER_D = Math.min(2, Math.max(1.3, H * 0.09)); // ladder column depth (inboard, X)
  const DOUBLE_D = 0.4;                                  // doubled-post gap (inboard, X)

  const braceLen = Math.min(3, H * 0.45);
  const tBrace = rafterLength > 0 ? Math.min(0.5, braceLen / rafterLength) : 0;
  const pbx = Math.min(3, halfW * 0.5); // peak collar tie half-span from the ridge
  const pby = H + rise * (1 - pbx / halfW);

  // Column(s) at eave side `sx`, plane `z`. The inner chord/post rises past H
  // to meet the rafter underside (the roof climbs toward the ridge).
  const pushLeg = (sx: number, z: number) => {
    const inb = sx < 0 ? 1 : -1; // toward the building interior along X
    if (ladderLeg) {
      const xIn = sx + inb * LADDER_D;
      const yIn = H + rise * (LADDER_D / halfW);
      members.push(member('leg', [sx, 0, z], [sx, H, z]));
      members.push(member('leg', [xIn, 0, z], [xIn, yIn, z]));
      const rungs = Math.max(3, Math.round(H / 3)); // ~every 3'
      for (let i = 1; i < rungs; i++) {
        const y = (H * i) / rungs;
        members.push(member('brace', [sx, y, z], [sx + inb * LADDER_D, y, z]));
      }
    } else if (doublePost) {
      const xIn = sx + inb * DOUBLE_D;
      const yIn = H + rise * (DOUBLE_D / halfW);
      members.push(member('leg', [sx, 0, z], [sx, H, z]));
      members.push(member('leg', [xIn, 0, z], [xIn, yIn, z]));
    } else {
      members.push(member('leg', [sx, 0, z], [sx, H, z]));
    }
  };

  // One bent: columns + two gable rafters + knee braces + a peak collar tie.
  // Ladder bents skip the knee brace — the deep column IS the reinforcement,
  // and a diagonal across the ladder reads as clutter.
  const pushBent = (z: number) => {
    pushLeg(-halfW, z);
    pushLeg(halfW, z);
    members.push(member('rafter', [-halfW, H, z], [0, peakHeight, z]));
    members.push(member('rafter', [halfW, H, z], [0, peakHeight, z]));
    if (!ladderLeg) {
      for (const sx of [-halfW, halfW]) {
        members.push(member('brace', [sx, H - braceLen, z], [sx * (1 - tBrace), H + rise * tBrace, z]));
      }
    }
    members.push(member('brace', [-pbx, pby, z], [pbx, pby, z]));
  };

  for (const z of framePositionsZ) pushBent(z);

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

  // --- Ridge (clipped at openings) ---
  // Ridge is at peak height, so it's only affected by openings that extend to the peak
  const ridgeGaps = (config.openings ?? [])
    .filter(o => (o.side === 'left' || o.side === 'right') && (o.sillHeight ?? 0) + o.height >= peakHeight * 0.95)
    .map(o => {
      const center = -halfL + o.offset;
      return [center - o.width / 2, center + o.width / 2] as [number, number];
    });
  for (const [s, e] of subtractSpans(-halfL, halfL, ridgeGaps)) {
    members.push(member('ridge', [0, peakHeight, s], [0, peakHeight, e]));
  }

  // --- Roof purlins (clipped at openings) ---
  const runs = purlinRunsPerSlope(rafterLength);
  for (let i = 1; i < runs; i++) {
    const t = i / runs;
    const yL = H + rise * t;
    const xL = -halfW + halfW * t;
    const xR = halfW - halfW * t;

    // Clip purlins at opening locations along the Z-axis (length)
    // Openings on eave sides (left/right) create Z-axis gaps
    const zGaps = (config.openings ?? [])
      .filter(o => (o.side === 'left' || o.side === 'right') && yL >= (o.sillHeight ?? 0) && yL <= (o.sillHeight ?? 0) + o.height)
      .map(o => {
        const center = -halfL + o.offset;
        return [center - o.width / 2, center + o.width / 2] as [number, number];
      });

    // Generate purlin segments
    for (const [s, e] of subtractSpans(-halfL, halfL, zGaps)) {
      members.push(member('purlin', [xL, yL, s], [xL, yL, e]));
      members.push(member('purlin', [xR, yL, s], [xR, yL, e]));
    }
  }

  // --- Wall girts: horizontal members the sheeting screws to, on every framed
  // wall at ~4 ft vertical spacing (eave walls run along Z, end walls along X). ---
  const girtRows = Math.max(1, Math.floor((H - 1) / 4));
  for (let i = 1; i <= girtRows; i++) {
    const y = (H * i) / (girtRows + 1);
    if (enclosure.sideZ) {
      const { start, end } = enclosure.sideZ;
      // A partially-closed side (eave-down band) only has girts within the
      // band — the open framing below gets none.
      const within = (sd: 'left' | 'right') =>
        !enclosure.sideOpen[sd] && (enclosure.sideBandFt[sd] <= 0 || y >= H - enclosure.sideBandFt[sd] - 0.01);
      if (within('left'))
        for (const [s, e] of subtractSpans(start, end, gapsAtHeight(leftHoles, y)))
          members.push(member('girt', [-halfW, y, s], [-halfW, y, e]));
      if (within('right'))
        for (const [s, e] of subtractSpans(start, end, gapsAtHeight(rightHoles, y)))
          members.push(member('girt', [halfW, y, s], [halfW, y, e]));
    }
    if (enclosure.front === 'closed')
      for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(frontHoles, y)))
        members.push(member('girt', [s, y, -halfL], [e, y, -halfL]));
    if (enclosure.back === 'closed')
      for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(backHoles, y)))
        members.push(member('girt', [s, y, halfL], [e, y, halfL]));
  }

  // --- Hat channels on sheeted side walls (vertical sheeting only) ---
  if (requiresHatChannels && enclosure.sideZ) {
    const rows = hatRows(H);
    const { start, end } = enclosure.sideZ;
    for (let i = 1; i <= rows; i++) {
      const y = (H * i) / (rows + 1);
      const within = (sd: 'left' | 'right') =>
        !enclosure.sideOpen[sd] && (enclosure.sideBandFt[sd] <= 0 || y >= H - enclosure.sideBandFt[sd] - 0.01);
      if (within('left'))
        for (const [s, e] of subtractSpans(start, end, gapsAtHeight(leftHoles, y)))
          members.push(member('hatChannel', [-halfW, y, s], [-halfW, y, e]));
      if (within('right'))
        for (const [s, e] of subtractSpans(start, end, gapsAtHeight(rightHoles, y)))
          members.push(member('hatChannel', [halfW, y, s], [halfW, y, e]));
    }
  }

  // --- Sheet-metal areas ---
  const gableTriangle = 0.5 * W * rise;
  const sideSpan = enclosure.sideZ ? enclosure.sideZ.end - enclosure.sideZ.start : 0;
  const sideSheetH = (sd: 'left' | 'right') =>
    enclosure.sideOpen[sd] ? 0 : enclosure.sideBandFt[sd] > 0 ? Math.min(enclosure.sideBandFt[sd], H) : H;
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
    endArea(enclosure.front) + endArea(enclosure.back) + (enclosure.partitionZ !== null ? W * H + gableTriangle : 0);

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
      eaveHeightFt: H,
      peakHeightFt: H,
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

  // --- Lean-tos: SHED ROOF with intermediate trusses at building-matched spacing ---
  // Key: lean-to truss spacing = main building truss spacing (4' or 5' OC)
  // Trusses at each position: 2 posts (inner@connH, outer@lh) + rafters + ridge purlins
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

    // Span along the attachment wall: length clamped to the wall, shifted by
    // the user-chosen start offset (ft from the building front for eave sides,
    // from the left edge for gable ends).
    const wallLen = isEave ? L : W;
    const runLen = Math.min(ll, wallLen);
    const runOff = Math.max(0, Math.min(lt.offsetFt ?? 0, wallLen - runLen));
    const spanA = (isEave ? -halfL : -halfW) + runOff;
    const spanB = spanA + runLen;

    // Filter main building truss positions that fall within the lean-to span
    const ltPositions = framePositionsZ.filter((z) => {
      if (isEave) {
        return z >= spanA && z <= spanB;
      } else {
        // Front/Back: use X positions within the lean-to's run
        return z >= spanA && z <= spanB;
      }
    });

    // Left/Right are defined as viewed from the FRONT of the building. In the
    // front camera (looking +Z), world +X renders on screen-LEFT, so Left Eave
    // maps to +X and Right Eave to -X.
    const xInner = side === 'Left Eave' ? halfW : side === 'Right Eave' ? -halfW : null;
    const xOuter = side === 'Left Eave' ? halfW + lw : side === 'Right Eave' ? -halfW - lw : null;

    const zInner = side === 'Front Gable' ? -halfL : side === 'Back Gable' ? halfL : null;
    const zOuter = side === 'Front Gable' ? -halfL - lw : side === 'Back Gable' ? halfL + lw : null;

    // ===== EAVE-ATTACHED (Left or Right) =====
    if (side === 'Left Eave' || side === 'Right Eave') {
      // Ensure we have front and back trusses, plus intermediates
      const zFront = spanA;
      const zBack = spanB;
      const allZ = [zFront, ...ltPositions.filter(z => z > zFront && z < zBack), zBack];
      const uniqueZ = Array.from(new Set(allZ)).sort((a, b) => a - b);

      // Create truss frames at each position (front + intermediates + back)
      for (let i = 0; i < uniqueZ.length; i++) {
        const z = uniqueZ[i];

        // ONLY vertical posts at this truss location
        members.push(member('leg', [xInner!, 0, z], [xInner!, connH, z])); // inner post (high, at wall)
        members.push(member('leg', [xOuter!, 0, z], [xOuter!, lh, z])); // outer post (low, away from building)

        // Add simple rafter (roof support) from inner post top to outer post top
        members.push(member('rafter', [xInner!, connH, z], [xOuter!, lh, z]));

        // Add corner/knee braces (crossing X-pattern for structural bracing)
        // One diagonal from inner post top to 2/3 point along the rafter
        const rafter2_3_X = xInner! + (xOuter! - xInner!) * (2 / 3);
        const rafter2_3_Y = connH + (lh - connH) * (2 / 3);
        members.push(member('brace', [xInner!, connH, z], [rafter2_3_X, rafter2_3_Y, z]));

        // Another diagonal from outer post top to 1/3 point along the rafter (crossing diagonal)
        const rafter1_3_X = xInner! + (xOuter! - xInner!) * (1 / 3);
        const rafter1_3_Y = connH + (lh - connH) * (1 / 3);
        members.push(member('brace', [xOuter!, lh, z], [rafter1_3_X, rafter1_3_Y, z]));

        // Connect to adjacent trusses with a LONGITUDINAL base rail (along the length).
        // OUTER (low-leg) wall only: an attached lean-to is a roof extension that
        // SHARES the main building's wall on the inner side — there is no second
        // wall there, so no lean-to base rail (it was drawing a phantom rail
        // across floor-level framed openings in the shared wall).
        if (i > 0) {
          const zPrev = uniqueZ[i - 1];
          members.push(member('baseRail', [xOuter!, 0, zPrev], [xOuter!, 0, z])); // at outer edge
        }
      }

      // Add purlins (horizontal roof support members) along the roof slope
      // Purlins run the full length front-to-back at intermediate heights
      if (uniqueZ.length > 1) {
        const zFront = uniqueZ[0];
        const zBack = uniqueZ[uniqueZ.length - 1];
        // Add 2 purlin lines at 1/3 and 2/3 heights up the slope
        for (let p = 1; p <= 2; p++) {
          const t = p / 3; // 1/3 or 2/3 along the slope
          const purlinX = xInner! + (xOuter! - xInner!) * t;
          const purlinY = connH + (lh - connH) * t;
          members.push(member('purlin', [purlinX, purlinY, zFront], [purlinX, purlinY, zBack]));
        }
      }

    }
    // ===== GABLE-ATTACHED (Front or Back) =====
    else if (side === 'Front Gable' || side === 'Back Gable') {
      // Ensure we have left and right trusses, plus intermediates
      const xLeft = spanA;
      const xRight = spanB;
      const allX = [xLeft, ...framePositionsZ.filter(x => x > xLeft && x < xRight), xRight];
      const uniqueX = Array.from(new Set(allX)).sort((a, b) => a - b);

      for (let i = 0; i < uniqueX.length; i++) {
        const x = uniqueX[i];

        // ONLY vertical posts at this truss location
        members.push(member('leg', [x, 0, zInner!], [x, connH, zInner!])); // inner post (high, at wall)
        members.push(member('leg', [x, 0, zOuter!], [x, lh, zOuter!])); // outer post (low, away from building)

        // Add simple rafter (roof support) from inner post top to outer post top
        members.push(member('rafter', [x, connH, zInner!], [x, lh, zOuter!]));

        // Add corner/knee braces (crossing X-pattern for structural bracing)
        // One diagonal from inner post top to 2/3 point along the rafter
        const rafter2_3_Y = connH + (lh - connH) * (2 / 3);
        const rafter2_3_Z = zInner! + (zOuter! - zInner!) * (2 / 3);
        members.push(member('brace', [x, connH, zInner!], [x, rafter2_3_Y, rafter2_3_Z]));

        // Another diagonal from outer post top to 1/3 point along the rafter (crossing diagonal)
        const rafter1_3_Y = connH + (lh - connH) * (1 / 3);
        const rafter1_3_Z = zInner! + (zOuter! - zInner!) * (1 / 3);
        members.push(member('brace', [x, lh, zOuter!], [x, rafter1_3_Y, rafter1_3_Z]));

        // Connect to adjacent trusses with a LONGITUDINAL base rail (left to right).
        // OUTER wall only — the inner side shares the main building's gable wall
        // (see the eave-attached note above: no phantom rail on a shared wall).
        if (i > 0) {
          const xPrev = uniqueX[i - 1];
          members.push(member('baseRail', [xPrev, 0, zOuter!], [x, 0, zOuter!])); // at outer edge
        }
      }

      // Add purlins (horizontal roof support members) along the roof slope
      // Purlins run the full width left-to-right at intermediate heights
      if (uniqueX.length > 1) {
        const xLeft = uniqueX[0];
        const xRight = uniqueX[uniqueX.length - 1];
        // Add 2 purlin lines at 1/3 and 2/3 heights up the slope
        for (let p = 1; p <= 2; p++) {
          const t = p / 3; // 1/3 or 2/3 along the slope
          const purlinY = connH + (lh - connH) * t;
          const purlinZ = zInner! + (zOuter! - zInner!) * t;
          members.push(member('purlin', [xLeft, purlinY, purlinZ], [xRight, purlinY, purlinZ]));
        }
      }
    }

    // ===== DERIVE LEAN-TO PANEL DATA (for 3D rendering) =====
    const enclosure = (lt.enclosure ?? 'open') as 'open' | 'enclosed' | 'custom';
    const customWalls = lt.customWalls; // Pass through custom wall settings if present

    if (side === 'Left Eave' || side === 'Right Eave') {
      // Eave-attached: use Z range
      const zFront = spanA;
      const zBack = spanB;
      // Post positions along the run (same set the frame loop builds), as offsets
      // from spanStart so they line up with an opening's offsetFt.
      const postZ = Array.from(
        new Set([zFront, ...ltPositions.filter((z) => z > zFront && z < zBack), zBack]),
      ).sort((a, b) => a - b);
      derivedLeanTos.push({
        id: lt.id,
        enclosure,
        customWalls,
        openings: lt.openings ?? [],
        attachedSide: side,
        widthFt: lw,
        lengthFt: Math.abs(zBack - zFront),
        lowLegHeightFt: lh,
        peakHeightFt: peakH,
        rise,
        inner: { x: xInner!, z: zFront },
        outer: { x: xOuter!, z: zFront },
        spanStart: zFront,
        spanEnd: zBack,
        trussOffsets: postZ.map((z) => z - zFront),
      });
    } else {
      // Gable-attached: use X range
      const xLeft = spanA;
      const xRight = spanB;
      const postX = Array.from(
        new Set([xLeft, ...framePositionsZ.filter((x) => x > xLeft && x < xRight), xRight]),
      ).sort((a, b) => a - b);
      derivedLeanTos.push({
        id: lt.id,
        enclosure,
        customWalls,
        openings: lt.openings ?? [],
        attachedSide: side,
        widthFt: lw,
        lengthFt: xRight - xLeft,
        lowLegHeightFt: lh,
        peakHeightFt: peakH,
        rise,
        inner: { x: xLeft, z: zInner! },
        outer: { x: xLeft, z: zOuter! },
        spanStart: xLeft,
        spanEnd: xRight,
        trussOffsets: postX.map((x) => x - xLeft),
      });
    }
  }

  // ===== ADD LEAN-TO CORNER BRACES (safe, separate section) =====
  // After all other frame members are created, add corner braces to each lean-to
  for (const lt of config.leanTos ?? []) {
    if (!lt.widthFt || !lt.lengthFt || !lt.lowLegHeightFt) continue;
    if (lt.type !== 'attached') continue;

    const lw = lt.widthFt;
    const ll = lt.lengthFt;
    const lh = lt.lowLegHeightFt;
    const pitchStr = lt.roofPitch || '2:12';
    const [riseStr] = pitchStr.split(':');
    const pitch = parseFloat(riseStr) || 2;
    const rise = (lw * pitch) / 12;
    const connH = Math.min(H, lh + rise);
    const side = lt.attachedSide || 'Left Eave';

    // Left/Right are defined as viewed from the FRONT of the building. In the
    // front camera (looking +Z), world +X renders on screen-LEFT, so Left Eave
    // maps to +X and Right Eave to -X.
    const xInner = side === 'Left Eave' ? halfW : side === 'Right Eave' ? -halfW : null;
    const xOuter = side === 'Left Eave' ? halfW + lw : side === 'Right Eave' ? -halfW - lw : null;
    const zInner = side === 'Front Gable' ? -halfL : side === 'Back Gable' ? halfL : null;
    const zOuter = side === 'Front Gable' ? -halfL - lw : side === 'Back Gable' ? halfL + lw : null;

    // Same span math as the frame loop above — honor the placement offset.
    const isEave2 = side === 'Left Eave' || side === 'Right Eave';
    const wallLen2 = isEave2 ? L : W;
    const runLen2 = Math.min(ll, wallLen2);
    const runOff2 = Math.max(0, Math.min(lt.offsetFt ?? 0, wallLen2 - runLen2));
    const spanA2 = (isEave2 ? -halfL : -halfW) + runOff2;
    const spanB2 = spanA2 + runLen2;

    // Get the frame positions that fall within this lean-to span
    const ltPositions = framePositionsZ.filter((z) => {
      if (isEave2) {
        return z >= spanA2 && z <= spanB2;
      }
      return true;
    });

    // EAVE-ATTACHED: Add corner braces
    if ((side === 'Left Eave' || side === 'Right Eave') && xInner !== null && xOuter !== null) {
      const zFront = spanA2;
      const zBack = spanB2;
      const allZ = [zFront, ...ltPositions.filter((z) => z > zFront && z < zBack), zBack];
      const uniqueZ = Array.from(new Set(allZ)).sort((a, b) => a - b);

      for (const z of uniqueZ) {
        // Simple diagonal braces from posts toward the roof center
        members.push(member('brace', [xInner, connH, z], [xOuter, lh, z]));
      }
    }

    // GABLE-ATTACHED: Add corner braces
    if ((side === 'Front Gable' || side === 'Back Gable') && zInner !== null && zOuter !== null) {
      const xLeft = spanA2;
      const xRight = spanB2;
      const allX = [xLeft, ...framePositionsZ.filter((x) => x > xLeft && x < xRight), xRight];
      const uniqueX = Array.from(new Set(allX)).sort((a, b) => a - b);

      for (const x of uniqueX) {
        // Simple diagonal braces from posts toward the roof center
        members.push(member('brace', [x, connH, zInner], [x, lh, zOuter]));
      }
    }
  }

  return {
    width: W,
    length: L,
    legHeight: H,
    peakHeight,
    rise,
    rafterLength,
    roofOverhangFt: config.roofOverhangFt,
    frameCount,
    framePositionsZ,
    // Cut columns + knee braces out of any eave doorway/opening last, so you can
    // step right through a framed opening (horizontals were cut during build).
    members: clipFrameAtLeanToOpenings(
      clipFrameAtEaveOpenings(members, config.openings ?? [], halfW, halfL),
      derivedLeanTos,
    ),
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
    case 'partition':
      return { pos: [-halfW + offset, yCenter, structure.enclosure.partitionZ ?? 0], rotY: Math.PI };
    case 'left':
      return { pos: [-halfW - eps, yCenter, eaveStart + offset], rotY: -Math.PI / 2 };
    case 'right':
      return { pos: [halfW + eps, yCenter, eaveStart + offset], rotY: Math.PI / 2 };
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
