import type { LeanToOpening } from '@/types/building';

/**
 * A lean-to's STORAGE SECTION as the drawing needs it (engine
 * LeanToStructure.storage; VIEW-ONLY — the program prices it). A partition
 * wall crosses the lean-to at world run coordinate `runAt`; the storage room
 * is the stretch between it and the `end` wall, which is drawn closed, and the
 * outer wall is closed along it: [segStart, segEnd] as offsets (ft) from
 * spanStart, the same axis as an outer-wall opening's offsetFt.
 */
export interface LeanToStorageSpan {
  end: 'front' | 'back';
  /** Storage length (ft) as drawn (clamped inside the lean-to's run). */
  lengthFt: number;
  /** World run coordinate of the partition wall's framing line. */
  runAt: number;
  segStart: number;
  segEnd: number;
  /**
   * Direction (along the run) the partition's sheeted face looks: toward the
   * open part of the lean-to, away from the storage end (-1 = toward
   * spanStart, +1 = toward spanEnd).
   */
  faces: -1 | 1;
}

/** A lean-to's resolved wall closures (+ its storage section, when it has one). */
export interface LeanToWallSettings {
  side: string;
  front: string;
  back: string;
  storage?: LeanToStorageSpan;
}

/** Is an OUTER-wall opening's centre inside the storage stretch of the outer wall? */
export function inStorageSegment(opening: { offsetFt?: number }, storage: LeanToStorageSpan | undefined): boolean {
  if (!storage || typeof opening.offsetFt !== 'number') return false;
  return opening.offsetFt >= storage.segStart - 1e-6 && opening.offsetFt <= storage.segEnd + 1e-6;
}

/**
 * Does a lean-to opening render its fixture (jambs / header / sill / panel)?
 *
 * This lives here, named and tested, because it has regressed repeatedly. The
 * gate used to be an inline `side !== 'open'` in LeanToSiding's render, which
 * is a SHEETING condition — correct for doors and windows (a door panel needs
 * a wall to hang in) and WRONG for a frame-out.
 *
 * A frame-out is bare framing. The engine's opening cut removes the outer post
 * inside it no matter how the wall is closed, so when the wall is Open and the
 * fixture is suppressed you get the worst of both: the post is gone and nothing
 * is drawn in its place — an empty bay. A frame-out therefore ALWAYS renders on
 * its wall; only the sheeting-dependent fixtures follow the wall closure.
 *
 * `side`: open | closed | q1 | q2 | q3 | 1panel | 2panel | 3panel
 * `front`/`back`: gable-end values; fixtures need a fully 'closed' end.
 * Storage section: a 'partition' opening renders while the lean-to has one;
 * an 'outer' opening whose centre is on the closed storage stretch renders
 * even when the rest of the outer wall is open (the storage END is already
 * 'closed' in the settings — leanToWallSettings).
 */
export function rendersLeanToFixture(
  opening: Pick<LeanToOpening, 'wall' | 'type'> & { offsetFt?: number },
  walls: { side: string; front: string; back: string; storage?: LeanToStorageSpan },
): boolean {
  const isFrameOut = opening.type === 'frameOut';
  switch (opening.wall) {
    case 'outer':
      // Partial (eave-down / panel) closures cut their band around the
      // fixture, so it must be drawn there too — only a fully open wall
      // suppresses a sheeting-dependent fixture.
      return isFrameOut || walls.side !== 'open' || inStorageSegment(opening, walls.storage);
    case 'front':
      return isFrameOut || walls.front === 'closed';
    case 'back':
      return isFrameOut || walls.back === 'closed';
    case 'partition':
      // The partition is always a fully closed wall; no storage = no wall
      // (the program blocks printing such an orphan opening).
      return !!walls.storage;
    default:
      return false;
  }
}

/**
 * A lean-to's resolved wall closures (outer side + front/back ends) from its
 * enclosure — the same rule as LeanToSiding's resolveWalls (a test holds them
 * equal). Lives here so the engine (geometry.ts) can ask rendersLeanToFixture
 * which END-wall openings are actually drawn before it frames around them.
 *
 * A storage section closes its END wall (the program prices that end closed)
 * and is passed along as `storage`; without one the result is exactly the
 * three closures (no `storage` key).
 */
export function leanToWallSettings(lt: {
  enclosure: string;
  customWalls?: { front: string; back: string; side: string };
  storage?: LeanToStorageSpan;
}): LeanToWallSettings {
  let walls: LeanToWallSettings;
  if (lt.enclosure === 'enclosed') walls = { side: 'closed', front: 'closed', back: 'closed' };
  else if (lt.enclosure === 'custom' && lt.customWalls) {
    walls = {
      side: lt.customWalls.side || 'open',
      front: lt.customWalls.front || 'open',
      back: lt.customWalls.back || 'open',
    };
  } else walls = { side: 'open', front: 'open', back: 'open' };
  if (lt.storage) {
    walls[lt.storage.end] = 'closed';
    walls.storage = lt.storage;
  }
  return walls;
}
