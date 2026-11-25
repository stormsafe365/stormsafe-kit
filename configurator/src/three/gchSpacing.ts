// GCH eave spacing (owner 11/25/26): the enclosed bay on a garage / carport combo's eave - its edge joins the Spacing chain,
// the open bay's gap reads 'open', the bay gets its own 'enclosed' line (three/Openings.tsx WallSpacing).
import type { WallSide } from '@/types/building';
import type { StructureModel } from '@/engine/geometry';
import { ftIn } from './dimLabels';

/**
 * A GCH (garage / carport combo) eave: the sheeted (enclosed) bay as `{a, b}` along the wall (eave offsets run from the
 * building FRONT, openingWorldTransform), or null for any other wall / building / a GCH with no open bay.
 */
export function gchEaveEnclosed(side: WallSide, structure: StructureModel): { a: number; b: number } | null {
  if (side !== 'left' && side !== 'right') return null;
  const e = structure.enclosure;
  if (e.type !== 'utility' || !e.sideZ || e.partitionZ === null || e.partitionKind === 'storage') return null;
  const halfL = structure.length / 2;
  const span = structure.walls[side].spanFt;
  const r = (v: number) => Math.round(v * 96) / 96;
  const a = Math.max(0, r(e.sideZ.start + halfL)), b = Math.min(span, r(e.sideZ.end + halfL));
  return b - a > 1 / 192 && (a > 1 / 192 || b < span - 1 / 192) ? { a, b } : null;
}
/** A spacing-chain gap on a GCH eave: "24' open" in the open bay, "8' enclosed" when it IS the whole bay, else the length. */
export function gchGapLabel(a: number, b: number, enc: { a: number; b: number }): string {
  const mid = (a + b) / 2;
  if (mid < enc.a || mid > enc.b) return `${ftIn(b - a)} open`;
  if (Math.abs(a - enc.a) < 0.02 && Math.abs(b - enc.b) < 0.02) return `${ftIn(b - a)} enclosed`;
  return ftIn(b - a);
}
