import type { BuildingType, EndSheeting, OpenEnd, WallSide } from '@/types/building';
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
export type MemberKind = 'leg' | 'rafter' | 'baseRail' | 'ridge' | 'purlin' | 'hatChannel' | 'girt';

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
  const { width: W, length: L, legHeight: H, roofPitch, buildingType, enclosedLengthFt, openEnd, openEndGableSheeting } = config;

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
  const members: Member[] = [];

  // --- Frame loops (bents): legs + gable rafters at each Z ---
  for (const z of framePositionsZ) {
    members.push(member('leg', [-halfW, 0, z], [-halfW, H, z]));
    members.push(member('leg', [halfW, 0, z], [halfW, H, z]));
    members.push(member('rafter', [-halfW, H, z], [0, peakHeight, z]));
    members.push(member('rafter', [halfW, H, z], [0, peakHeight, z]));
  }

  // --- Base rails (perimeter) ---
  members.push(member('baseRail', [-halfW, 0, -halfL], [-halfW, 0, halfL]));
  members.push(member('baseRail', [halfW, 0, -halfL], [halfW, 0, halfL]));
  members.push(member('baseRail', [-halfW, 0, -halfL], [halfW, 0, -halfL]));
  members.push(member('baseRail', [-halfW, 0, halfL], [halfW, 0, halfL]));

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
      members.push(member('girt', [-halfW, y, start], [-halfW, y, end]));
      members.push(member('girt', [halfW, y, start], [halfW, y, end]));
    }
    if (enclosure.front === 'closed') members.push(member('girt', [-halfW, y, -halfL], [halfW, y, -halfL]));
    if (enclosure.back === 'closed') members.push(member('girt', [-halfW, y, halfL], [halfW, y, halfL]));
  }

  // --- Hat channels on sheeted side walls (vertical sheeting only) ---
  if (requiresHatChannels && enclosure.sideZ) {
    const rows = hatRows(H);
    const { start, end } = enclosure.sideZ;
    for (let i = 1; i <= rows; i++) {
      const y = (H * i) / (rows + 1);
      members.push(member('hatChannel', [-halfW, y, start], [-halfW, y, end]));
      members.push(member('hatChannel', [halfW, y, start], [halfW, y, end]));
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
  const sideSpanFt = enclosure.sideZ ? enclosure.sideZ.end - enclosure.sideZ.start : 0;
  const sideTruss = enclosure.sideZ
    ? eaveTrussLines(framePositionsZ, enclosure.sideZ.start, enclosure.sideZ.end)
    : [];

  const walls: Record<WallSide, WallLayout> = {
    left: {
      side: 'left',
      available: !!enclosure.sideZ,
      isEndWall: false,
      spanFt: round(sideSpanFt),
      eaveHeightFt: H,
      peakHeightFt: H,
      trussLines: sideTruss,
    },
    right: {
      side: 'right',
      available: !!enclosure.sideZ,
      isEndWall: false,
      spanFt: round(sideSpanFt),
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
    members,
    enclosure,
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
  const sideStart = structure.enclosure.sideZ?.start ?? -halfL;
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
      return { pos: [-halfW - eps, yCenter, sideStart + offset], rotY: -Math.PI / 2 };
    case 'right':
      return { pos: [halfW + eps, yCenter, sideStart + offset], rotY: Math.PI / 2 };
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
