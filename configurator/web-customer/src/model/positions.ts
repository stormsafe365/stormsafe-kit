/**
 * Opening positions: the customer / program number ⇄ the 3D centerline.
 *
 * A main-building opening's `pos` is the number a rep types in the program —
 * feet from the wall's reference end (the program's LEFT position button) to
 * the opening's NEAR edge. build/positionMap.ts is the one definition of how
 * that maps onto the 3D (both ways); this file only picks the wall's program
 * location and length.
 *
 * A lean-to opening's `pos` is the program's lean-to "Custom offset (ft from
 * left)": the left edge measured from the start of the 3D wall run.
 */
import type { WallSide } from '@/types/building';
import { offset3DToProgramX, programXTo3DOffset, programXToTyped, type ProgramLoc } from '@/build/positionMap';
import { clampWallCenter, wallSpotOk, type WallSpan } from '@/engine/wallFit';
import type { LeanToWall, WebDesign, WebLeanTo, WebLeanToOpening, WebOpening, WebWall } from './design';
import { comboBlockedFromFront, CORNER_CLEAR, GAP, leanToWallLength, wallLength } from './rules';

export const PROGRAM_LOC: Record<WebWall, ProgramLoc> = {
  front: 'Front Gable End',
  back: 'Back Gable End',
  left: 'Left Eave Side',
  right: 'Right Eave Side',
  partition: 'Partition Wall',
};

/** Customer wall → the 3D wall (program Left Eave = the 3D 'right' wall, BuildHost SIDE_MAP). */
export const SIDE_3D: Record<WebWall, WallSide> = {
  front: 'front',
  back: 'back',
  left: 'right',
  right: 'left',
  partition: 'partition',
};

/** The program's words for what a typed position is measured from (posRefName, left button). */
export const PROGRAM_REF: Record<WebWall, string> = {
  front: 'left eave corner',
  back: 'right eave corner',
  left: 'front gable',
  right: 'front gable',
  partition: 'left eave corner',
};

/** The same reference in customer words (left / right as seen from the front). */
export const CUSTOMER_REF: Record<WebWall, string> = {
  front: 'the front-left corner',
  back: 'the back-right corner',
  left: 'the front end',
  right: 'the front end',
  partition: 'the left side',
};

/** Snap to the 1/8″ grid every dimension lives on. */
export const q8 = (ft: number) => Math.round(ft * 96) / 96;

/** Typed position (near edge from the reference end) → 3D centerline offset. */
export function posToOffset3D(d: Pick<WebDesign, 'width' | 'length'>, wall: WebWall, pos: number, w: number): number {
  const loc = PROGRAM_LOC[wall];
  const face = wallLength(d, wall);
  const x = programXToTyped(loc, pos, w, face, 'left'); // typed ⇄ x is its own inverse
  return programXTo3DOffset(loc, x, w, face);
}

/** 3D centerline offset → typed position (1/8″ grid). */
export function offset3DToPos(d: Pick<WebDesign, 'width' | 'length'>, wall: WebWall, offset: number, w: number): number {
  const loc = PROGRAM_LOC[wall];
  const face = wallLength(d, wall);
  const x = offset3DToProgramX(loc, offset, w, face);
  return q8(Math.max(0, programXToTyped(loc, x, w, face, 'left')));
}

/** Everything else on that wall, in the 3D frame (wallFit's input) — plus the open carport bay of a Garage + Carport side. */
function mainSiblings(d: Pick<WebDesign, 'type' | 'width' | 'length' | 'enclosedLength' | 'openings'>, wall: WebWall, excludeId: string | null): WallSpan[] {
  const sibs: WallSpan[] = d.openings
    .filter((o) => o.wall === wall && o.id !== excludeId)
    .map((o) => ({ offset: posToOffset3D(d, wall, o.pos, o.w), width: o.w }));
  const blocked = comboBlockedFromFront(d, wall);
  if (blocked !== null && blocked > 0) {
    // Eave offsets run from the FRONT in the 3D. Ending the blocked span at
    // `blocked` keeps the opening GAP (= the 1′ corner rule) off the divider post.
    const right = blocked + CORNER_CLEAR - GAP;
    sibs.push({ offset: (right - 10) / 2, width: right + 10 });
  }
  return sibs;
}

/**
 * Where a main opening of width `w` may sit on `wall`, nearest to `wantPos`
 * (the no-overlap rule: 1′ from each corner and every other opening).
 * null = no room on that wall.
 */
export function fitMainPos(
  d: Pick<WebDesign, 'type' | 'width' | 'length' | 'enclosedLength' | 'openings'>,
  wall: WebWall,
  w: number,
  wantPos: number,
  excludeId: string | null,
): number | null {
  const face = wallLength(d, wall);
  const raw = posToOffset3D(d, wall, wantPos, w);
  const c = clampWallCenter(raw, w, face, mainSiblings(d, wall, excludeId), Number.NaN);
  return Number.isFinite(c) ? offset3DToPos(d, wall, c, w) : null;
}

/** A free spot for a NEW opening: try the middle of the wall, then the ends. */
export function freeMainPos(d: Pick<WebDesign, 'type' | 'width' | 'length' | 'enclosedLength' | 'openings'>, wall: WebWall, w: number): number | null {
  const face = wallLength(d, wall);
  for (const want of [(face - w) / 2, CORNER_CLEAR, face - w - CORNER_CLEAR]) {
    const p = fitMainPos(d, wall, w, Math.max(0, want), null);
    if (p !== null) return p;
  }
  return null;
}

// ─── Lean-to openings ───────────────────────────────────────────────────────

export function fitLeanToPos(
  d: Pick<WebDesign, 'width' | 'length'>,
  lt: WebLeanTo,
  wall: LeanToWall,
  w: number,
  wantPos: number,
  excludeId: string | null,
): number | null {
  const len = leanToWallLength(d, lt, wall);
  const sibs = lt.openings.filter((o) => o.wall === wall && o.id !== excludeId).map((o) => ({ offset: o.pos + o.w / 2, width: o.w }));
  const c = clampWallCenter(wantPos + w / 2, w, len, sibs, Number.NaN);
  return Number.isFinite(c) ? q8(c - w / 2) : null;
}

export function freeLeanToPos(d: Pick<WebDesign, 'width' | 'length'>, lt: WebLeanTo, wall: LeanToWall, w: number): number | null {
  const len = leanToWallLength(d, lt, wall);
  for (const want of [(len - w) / 2, CORNER_CLEAR, len - w - CORNER_CLEAR]) {
    const p = fitLeanToPos(d, lt, wall, w, Math.max(0, want), null);
    if (p !== null) return p;
  }
  return null;
}

/** Does a main opening keep the no-overlap rule where it is (1′ from corners and every other opening)? */
export function mainSpotOk(d: Pick<WebDesign, 'type' | 'width' | 'length' | 'enclosedLength' | 'openings'>, o: Pick<WebOpening, 'id' | 'wall' | 'pos' | 'w'>): boolean {
  return wallSpotOk(posToOffset3D(d, o.wall, o.pos, o.w), o.w, wallLength(d, o.wall), mainSiblings(d, o.wall, o.id));
}

/** The same for a lean-to opening. */
export function leanToSpotOk(d: Pick<WebDesign, 'width' | 'length'>, lt: WebLeanTo, o: Pick<WebLeanToOpening, 'id' | 'wall' | 'pos' | 'w'>): boolean {
  const sibs = lt.openings.filter((x) => x.wall === o.wall && x.id !== o.id).map((x) => ({ offset: x.pos + x.w / 2, width: x.w }));
  return wallSpotOk(o.pos + o.w / 2, o.w, leanToWallLength(d, lt, o.wall), sibs);
}
