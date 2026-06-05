import type { BuildingType, EndSheeting, OpenEnd, Opening, WallSide } from '@/types/building';
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
  /** Partial side-panel band height (ft from slab) on each open eave side. */
  eavePanelFt: { left: number; right: number };
  walls: Record<WallSide, WallLayout>;
  areas: { roof: number; walls: number };
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
    // A foot of the member must sit on an eave wall plane (|x| ≈ halfW) — this
    // excludes the ridge-level peak collar braces (which span the middle in X).
    const atEaveWall =
      Math.abs(Math.abs(m.start[0]) - halfW) < 0.1 || Math.abs(Math.abs(m.end[0]) - halfW) < 0.1;
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

function deriveEnclosure(
  type: BuildingType,
  halfL: number,
  L: number,
  enclosedLengthFt: number,
  openEnd: OpenEnd,
  openEndGable: boolean,
): Enclosure {
  const openMode: EndSheeting = openEndGable ? 'gableOnly' : 'open';
  switch (type) {
    case 'carport':
      return { type, sideZ: null, front: openMode, back: openMode, partitionZ: null };
    case 'garage':
      return { type, sideZ: { start: -halfL, end: halfL }, front: 'closed', back: 'closed', partitionZ: null };
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
        };
      }
      return {
        type,
        sideZ: { start: -halfL, end: -halfL + encLen },
        front: 'closed',
        back: openMode,
        partitionZ: split ? -halfL + encLen : null,
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
  const { config, frameCount, requiresHatChannels } = resolved;
  const { width: W, length: L, legHeight: H, roofPitch, buildingType, enclosedLengthFt, openEnd, openEndGableSheeting, eavePanelFt } = config;

  const halfW = W / 2;
  const halfL = L / 2;
  const rise = halfW * (roofPitch / 12);
  const peakHeight = H + rise;
  const rafterLength = Math.hypot(halfW, rise);

  const framePositionsZ =
    frameCount <= 1
      ? [0]
      : Array.from({ length: frameCount }, (_, i) => -halfL + (i * L) / (frameCount - 1));

  const enclosure = deriveEnclosure(buildingType, halfL, L, enclosedLengthFt, openEnd, openEndGableSheeting);
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

  // --- Frame loops (bents): legs + gable rafters at each Z ---
  // Knee braces (U-shaped corner brace, leg → roof bow) sit at every bent on
  // both eaves — a real structural member, so they show on every building.
  const braceLen = Math.min(3, H * 0.45);
  const tBrace = rafterLength > 0 ? Math.min(0.5, braceLen / rafterLength) : 0;
  for (const z of framePositionsZ) {
    members.push(member('leg', [-halfW, 0, z], [-halfW, H, z]));
    members.push(member('leg', [halfW, 0, z], [halfW, H, z]));
    members.push(member('rafter', [-halfW, H, z], [0, peakHeight, z]));
    members.push(member('rafter', [halfW, H, z], [0, peakHeight, z]));
    for (const sx of [-halfW, halfW]) {
      const legPt: Vec3 = [sx, H - braceLen, z]; // down the leg from the eave
      const rafterPt: Vec3 = [sx * (1 - tBrace), H + rise * tBrace, z]; // up the rafter
      members.push(member('brace', legPt, rafterPt));
    }
    // Peak brace (collar tie at the center of the roof) tying the two rafter
    // slopes together just below the ridge.
    const pbx = Math.min(3, halfW * 0.5); // half-span out from the ridge
    const pby = H + rise * (1 - pbx / halfW); // rafter height at that x
    members.push(member('brace', [-pbx, pby, z], [pbx, pby, z]));
  }

  // --- Base rails ---
  // Eave (side) rails run the full length on both sides, CUT where a floor-level
  // door (sill ≈ 0) crosses them — a garage door has no rail across its threshold.
  for (const [s, e] of subtractSpans(-halfL, halfL, gapsAtHeight(leftHoles, 0)))
    members.push(member('baseRail', [-halfW, 0, s], [-halfW, 0, e]));
  for (const [s, e] of subtractSpans(-halfL, halfL, gapsAtHeight(rightHoles, 0)))
    members.push(member('baseRail', [halfW, 0, s], [halfW, 0, e]));
  // A gable-end base rail only exists when that end is CLOSED. An open or
  // gable-only end is a drive-through — no rail across the ground there.
  if (enclosure.front === 'closed')
    for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(frontHoles, 0)))
      members.push(member('baseRail', [s, 0, -halfL], [e, 0, -halfL]));
  if (enclosure.back === 'closed')
    for (const [s, e] of subtractSpans(-halfW, halfW, gapsAtHeight(backHoles, 0)))
      members.push(member('baseRail', [s, 0, halfL], [e, 0, halfL]));

  // --- Ridge ---
  members.push(member('ridge', [0, peakHeight, -halfL], [0, peakHeight, halfL]));

  // --- Roof purlins ---
  const runs = purlinRunsPerSlope(rafterLength);
  for (let i = 1; i < runs; i++) {
    const t = i / runs;
    const yL = H + rise * t;
    const xL = -halfW + halfW * t;
    const xR = halfW - halfW * t;
    members.push(member('purlin', [xL, yL, -halfL], [xL, yL, halfL]));
    members.push(member('purlin', [xR, yL, -halfL], [xR, yL, halfL]));
  }

  // --- Wall girts: horizontal members the sheeting screws to, on every framed
  // wall at ~4 ft vertical spacing (eave walls run along Z, end walls along X). ---
  const girtRows = Math.max(1, Math.floor((H - 1) / 4));
  for (let i = 1; i <= girtRows; i++) {
    const y = (H * i) / (girtRows + 1);
    if (enclosure.sideZ) {
      const { start, end } = enclosure.sideZ;
      for (const [s, e] of subtractSpans(start, end, gapsAtHeight(leftHoles, y)))
        members.push(member('girt', [-halfW, y, s], [-halfW, y, e]));
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
      for (const [s, e] of subtractSpans(start, end, gapsAtHeight(leftHoles, y)))
        members.push(member('hatChannel', [-halfW, y, s], [-halfW, y, e]));
      for (const [s, e] of subtractSpans(start, end, gapsAtHeight(rightHoles, y)))
        members.push(member('hatChannel', [halfW, y, s], [halfW, y, e]));
    }
  }

  // --- Sheet-metal areas ---
  const gableTriangle = 0.5 * W * rise;
  const sideSpan = enclosure.sideZ ? enclosure.sideZ.end - enclosure.sideZ.start : 0;
  const sideWallArea = enclosure.sideZ ? 2 * sideSpan * H : 0;
  const endArea = (mode: EndSheeting) =>
    mode === 'closed' ? W * H + gableTriangle : mode === 'gableOnly' ? gableTriangle : 0;
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
    members: clipFrameAtEaveOpenings(members, config.openings ?? [], halfW, halfL),
    enclosure,
    openBayZ,
    eavePanelFt: { left: eavePanelFt.left, right: eavePanelFt.right },
    walls,
    areas: { roof: 2 * rafterLength * L, walls: sideWallArea + endWallArea },
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
