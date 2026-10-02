import { COMPONENT_OUTSET, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { inStorageSegment, type LeanToWallSettings } from '@/engine/leanToFixtures';
import type { BuildingColors, LeanToOpening, Opening, WallSide } from '@/types/building';
import { sheetSpanAt, shellLayout } from './shellGeometry';

/**
 * ENHANCED look — door / window / roll-up / frame-out FIXTURE numbers and the
 * pure placement helpers behind enhanced/fixtures.tsx (render-upgrade Phase 7,
 * HANDOFF Steps 4-5). Feet. Nothing here moves an opening: the fixture group
 * still sits exactly where the classic one does (openingWorldTransform /
 * the lean-to openingPlacement, local +Z = OUTWARD); these numbers only shape
 * what is drawn inside that group.
 */
export const FIXTURE = {
  /** Jamb / header / sill trim face (~2"). */
  trimFace: 0.17,
  /** How far the trim stands proud of the siding. */
  trimProj: 0.07,
  /** Trim back face this far off the sheet (never coplanar with it: no z-fight seen from inside). */
  trimLift: 0.01,
  /** Shallow reveal (wall-colored jamb liner) depth into the hole, and its plate thickness. */
  reveal: 0.12,
  revealT: 0.02,
  /** Door leaf / roll-up curtain thickness, and its front face this far behind the siding face (flush). */
  panelDepth: 0.09,
  panelGap: 0.01,
  /** Roll-up bottom rail (door color) and lift handle. */
  rail: { h: 0.2, d: 0.11, zOff: -0.04, up: 0.11 },
  handle: { w: 0.5, h: 0.07, d: 0.05, zOff: 0.02, up: 0.42 },
  /** Double-hung window: glass + sash bars, upper sash on the outer track, lower on the inner. */
  glassT: 0.03,
  upperSashZ: -0.03,
  lowerSashZ: -0.085,
  sashRail: 0.06,
  sashStile: 0.05,
  sashBarD: 0.04,
  meetingLip: { h: 0.05, d: 0.03, z: -0.055, y: -0.02 },
  /** Walk-door knob height off the leaf bottom (the classic 36"). */
  knobUp: 3.0,
  /** A roll-up's clip plane sits this far above the opening top. */
  clipAbove: 0.01,
} as const;

/**
 * Local z (fixture frame, +Z outward) of the wall SHEETING face. Every wall's
 * fixture group sits at COMPONENT_OUTSET off the frame line while its sheet is
 * at SHEET_OUTSET, so the face is 0.16 ft behind the group origin; the GCH
 * partition's fixture group sits IN its sheet plane (openingWorldTransform
 * puts it at partitionZ with no outset). An End Storage partition
 * (`partitionInPlane` false) is sheeted off its framing line like any wall, so
 * it follows the wall rule. Lean-to walls follow the eave rule (COMP_PROUD in
 * LeanToSiding.tsx).
 */
export function fixtureFaceZ(side: WallSide | 'leanTo', partitionInPlane = true): number {
  return side === 'partition' && partitionInPlane ? 0 : -(COMPONENT_OUTSET - SHEET_OUTSET);
}

/** Door leaf / curtain centre z: flush, its front face panelGap behind the siding face. */
export const panelCenterZ = (faceZ: number) => faceZ - FIXTURE.panelGap - FIXTURE.panelDepth / 2;

/** Jamb / header / sill trim centre z (proud of the siding face). */
export const trimCenterZ = (faceZ: number) => faceZ + FIXTURE.trimLift + FIXTURE.trimProj / 2;

/**
 * Walk-door hinge pivot z. An OUT-swinging (hi-impact) leaf turns about its
 * EXTERIOR face so it clears the proud jamb trim; a standard (in-swinging)
 * leaf turns about its INTERIOR face. The angle's sign still comes only from
 * openingAnim.swingAngle (impact -> out, standard -> in).
 */
export function walkDoorPivotZ(impact: boolean | undefined, faceZ: number): number {
  const front = faceZ - FIXTURE.panelGap;
  return impact ? front : front - FIXTURE.panelDepth;
}

/** World Y of a roll-up's clip plane: just above the opening top (sill + height). */
export const rollUpClipY = (sillHeight: number, h: number) => sillHeight + h + FIXTURE.clipAbove;

// ── "Is there sheeting around this opening?" (reveals only then) ──────────

const LAYOUT_COLORS: BuildingColors = { roof: 'GALVALUME', walls: 'GALVALUME', trim: 'GALVALUME', wainscot: 'GALVALUME' };

/**
 * Per main-building opening id: does sheeting surround it (both jambs sheeted
 * over its full height on the enhanced wall layout)? Only then does the
 * enhanced fixture draw its wall-colored reveal. Frame-outs never get one,
 * and neither does anything on an open wall, open bay or a gable-only /
 * eave-hung band that stops short of it.
 */
export function mainOpeningsSheeted(structure: StructureModel, openings: Opening[]): Record<string, boolean> {
  const layout = shellLayout({
    structure,
    openings,
    wallOrientation: 'Vertical',
    colors: LAYOUT_COLORS,
    wainscot: { enabled: false, heightFt: 0 },
  });
  const halfW = structure.width / 2;
  const halfL = structure.length / 2;
  // Along-wall world coordinate of an opening centre (shellLayout's holesFor).
  const along = (o: Opening) =>
    o.side === 'left' || o.side === 'right' ? -halfL + o.offset : o.side === 'back' ? halfW - o.offset : -halfW + o.offset;
  const out: Record<string, boolean> = {};
  for (const o of openings) {
    if (o.type === 'frameOut') {
      out[o.id] = false;
      continue;
    }
    const wall = layout.walls.find((w) => w.plane.id === o.side);
    if (!wall) {
      out[o.id] = false;
      continue;
    }
    const c = along(o);
    const y0 = o.sillHeight;
    const y1 = o.sillHeight + o.height;
    out[o.id] = [c - o.width / 2 - 0.1, c + o.width / 2 + 0.1].every((cc) => {
      const s = sheetSpanAt(wall, cc);
      return !!s && s[0] <= y0 + 0.05 && s[1] >= y1 - 0.3;
    });
  }
  return out;
}

/**
 * Lean-to opening: sheeting surrounds it only on a fully CLOSED wall (never a
 * frame-out). A storage section's partition is always closed, and so is the
 * storage stretch of the outer wall.
 */
export function leanToOpeningSheeted(
  o: Pick<LeanToOpening, 'type' | 'wall'> & { offsetFt?: number },
  walls: LeanToWallSettings,
): boolean {
  if (o.type === 'frameOut') return false;
  if (o.wall === 'partition') return !!walls.storage;
  if (o.wall === 'outer') return walls.side === 'closed' || inStorageSegment(o, walls.storage);
  return walls[o.wall] === 'closed';
}
