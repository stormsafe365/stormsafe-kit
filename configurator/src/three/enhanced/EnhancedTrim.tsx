import { useMemo } from 'react';
import type { StructureModel } from '@/engine/geometry';
import type { BuildingColors, Opening, PanelOrientation, Wainscot } from '@/types/building';
import { ShellMeshes } from './ShellMeshes';
import { openingsKey, structureKey, trimBatches } from './shellGeometry';

interface EnhancedTrimProps {
  structure: StructureModel;
  openings: Opening[];
  wallOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

/**
 * ENHANCED wall trim (render-upgrade Phase 5, HANDOFF Step 1): two-plate
 * corner L trims only where two sheeted edges meet, base trim only where the
 * sheet meets the slab (split at floor-level openings), a slim bottom trim on
 * hanging sheets, and the wainscot Z-trim (classic WainscotCap crossing rule).
 * Trim color = the trim selection (palette code, so Galvalume renders metal).
 * A lean-to never cuts the main corner trim: where a lean-to end wall
 * continues a main wall plane the main corner trim still runs full height
 * (golden classic / lab), and the lean-to butts against it (leanToShell.ts
 * breaks its own trims around it and closes its roof end at it).
 */
export function EnhancedTrim({ structure, openings, wallOrientation, colors, wainscot }: EnhancedTrimProps) {
  const key = [structureKey(structure), openingsKey(openings), colors.trim, wainscot.enabled ? wainscot.heightFt : 0].join('#');
  const batches = useMemo(
    () =>
      trimBatches({
        structure,
        openings,
        wallOrientation,
        colors,
        wainscot,
        trimColor: colors.trim,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers every geometry input
    [key],
  );
  return <ShellMeshes batches={batches} name="enhanced-trim" />;
}
