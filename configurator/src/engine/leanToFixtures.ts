import type { LeanToOpening } from '@/types/building';

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
 */
export function rendersLeanToFixture(
  opening: Pick<LeanToOpening, 'wall' | 'type'>,
  walls: { side: string; front: string; back: string },
): boolean {
  const isFrameOut = opening.type === 'frameOut';
  switch (opening.wall) {
    case 'outer':
      // Partial (eave-down / panel) closures cut their band around the
      // fixture, so it must be drawn there too — only a fully open wall
      // suppresses a sheeting-dependent fixture.
      return isFrameOut || walls.side !== 'open';
    case 'front':
      return isFrameOut || walls.front === 'closed';
    case 'back':
      return isFrameOut || walls.back === 'closed';
    default:
      return false;
  }
}
