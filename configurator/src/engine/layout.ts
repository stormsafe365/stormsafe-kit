import type { Opening } from '@/types/building';
import type { StructureModel, WallLayout } from './geometry';
import { TRUSS_CLEARANCE_FT } from '@/config/constants';

/**
 * Truss-collision logic shared by the 2D wall editor and the 3D nudge.
 * An opening "hits a truss" when its framed footprint (opening width + jamb
 * clearance on each side) overlaps a frame leg line on that wall.
 */
export interface CollisionResult {
  hit: boolean;
  /** Position (ft, wall-local) of the offending leg, if any. */
  legPosFt: number | null;
  /** Smallest edge-to-leg distance (ft); negative = direct overlap. */
  clearanceFt: number;
}

export function checkCollision(
  offset: number,
  width: number,
  wall: WallLayout,
  clearance = TRUSS_CLEARANCE_FT,
): CollisionResult {
  const left = offset - width / 2;
  const right = offset + width / 2;

  let nearest: number | null = null;
  let minClear = Infinity;
  let hit = false;

  for (const t of wall.trussLines) {
    // distance from the leg to the nearest framed edge (0 inside the opening)
    const edgeDist = t.posFt < left ? left - t.posFt : t.posFt > right ? t.posFt - right : -1;
    if (edgeDist < minClear) {
      minClear = edgeDist;
      nearest = t.posFt;
    }
    if (edgeDist <= clearance) hit = true;
  }

  return { hit, legPosFt: hit ? nearest : null, clearanceFt: round(minClear) };
}

/** Clamp an opening's centerline so it stays fully on the wall. */
export function clampOffset(offset: number, width: number, wall: WallLayout): number {
  const half = width / 2;
  return Math.max(half, Math.min(wall.spanFt - half, offset));
}

/** All openings on a wall, with collision state — used to flag the model. */
export function wallOpeningsWithCollision(
  openings: Opening[],
  wall: WallLayout,
): { opening: Opening; collision: CollisionResult }[] {
  return openings
    .filter((o) => o.side === wall.side)
    .map((opening) => ({ opening, collision: checkCollision(opening.offset, opening.width, wall) }));
}

/** Does ANY opening collide with a truss across the whole building? */
export function anyCollision(openings: Opening[], structure: StructureModel): boolean {
  return openings.some((o) => {
    const wall = structure.walls[o.side];
    return wall.available && checkCollision(o.offset, o.width, wall).hit;
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
