import type { StructureModel } from '@/engine/geometry';

/**
 * Whether the Spacing overlay draws the End Storage / GCH partition's chain.
 * That wall is INSIDE the building, so its labels only make sense where it can
 * be seen: from inside (the walk-in Interior, or the orbit camera pushed inside
 * the footprint) or when the shell is ghosted (Structure / Cutaway). From
 * outside in Exterior they would float over the front gable's own chain. The
 * viewer-side facing test in SpacingOverlay still applies on top of this.
 */
export function partitionSpacingVisible(
  cam: { x: number; y: number; z: number },
  structure: Pick<StructureModel, 'width' | 'length' | 'peakHeight'>,
  view: { viewMode: string; interiorView: boolean },
): boolean {
  if (view.interiorView || view.viewMode !== 'exterior') return true;
  return Math.abs(cam.x) < structure.width / 2 && Math.abs(cam.z) < structure.length / 2 && cam.y < structure.peakHeight;
}
