import { useMemo } from 'react';
import type { StructureModel } from '@/engine/geometry';
import type { BuildingColors, Opening, PanelOrientation, Wainscot } from '@/types/building';
import { ShellMeshes } from './ShellMeshes';
import { openingsKey, shellLayout, structureKey, trimBatches } from './shellGeometry';
import { applyCornerCuts, leanToCornerCuts, leanToShapeKey } from './leanToShell';

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
 * Where a lean-to end wall continues a main wall plane (the lean-to runs to
 * that corner), the main corner trim is cut over that wall and through the
 * lean-to roof / flashing (Phase 6, leanToCornerCuts).
 */
export function EnhancedTrim({ structure, openings, wallOrientation, colors, wainscot }: EnhancedTrimProps) {
  const key = [structureKey(structure), openingsKey(openings), colors.trim, wainscot.enabled ? wainscot.heightFt : 0, leanToShapeKey(structure)].join('#');
  const batches = useMemo(
    () => {
      const inp = { structure, openings, wallOrientation, colors, wainscot, trimColor: colors.trim };
      return trimBatches(inp, applyCornerCuts(shellLayout(inp), leanToCornerCuts(structure)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers every geometry input
    [key],
  );
  return <ShellMeshes batches={batches} name="enhanced-trim" />;
}
