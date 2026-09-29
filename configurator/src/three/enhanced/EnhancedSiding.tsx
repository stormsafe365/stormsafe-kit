import { useMemo } from 'react';
import type { StructureModel } from '@/engine/geometry';
import type { BuildingColors, Opening, PanelOrientation, Wainscot } from '@/types/building';
import { ShellMeshes } from './ShellMeshes';
import { openingsKey, structureKey, wallBatches } from './shellGeometry';

interface EnhancedSidingProps {
  structure: StructureModel;
  openings: Opening[];
  wallOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

/**
 * ENHANCED wall sheeting (render-upgrade Phase 5): the classic wall cuts and
 * enclosure branches (shellGeometry.ts) with outward faces, world-feet UVs,
 * the cached rib normal-map materials and the per-wall rib flip. The wainscot
 * is the lower run of the same wall plane.
 */
export function EnhancedSiding(props: EnhancedSidingProps) {
  const { structure, openings, wallOrientation, colors, wainscot } = props;
  const key = [
    structureKey(structure),
    openingsKey(openings),
    wallOrientation,
    colors.walls,
    colors.wainscot,
    wainscot.enabled ? wainscot.heightFt : 0,
  ].join('#');
  const batches = useMemo(
    () => wallBatches({ structure, openings, wallOrientation, colors, wainscot }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers every geometry input
    [key],
  );
  return <ShellMeshes batches={batches} name="enhanced-walls" />;
}
