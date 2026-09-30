import { useMemo } from 'react';
import type { StructureModel } from '@/engine/geometry';
import type { PanelOrientation } from '@/types/building';
import { ShellMeshes } from './ShellMeshes';
import { roofBatches } from './shellGeometry';
import { leanToRoofCuts } from './leanToShell';

interface EnhancedRoofProps {
  structure: StructureModel;
  roofOrientation: PanelOrientation;
  roofColor: string;
  /** Trim color code (palette code or hex; Galvalume supported). */
  trimColor: string;
}

/**
 * ENHANCED roof (render-upgrade Phase 5, HANDOFF Step 1): colored top skin +
 * bare Galvalume underside, both slopes meeting exactly on the ridge line,
 * overhang = structure.roofOverhangFt on eaves and gables, ridge cap (pitched
 * gables only), eave + rake L trims (mono: high-side trim, rakes low -> high).
 * Nothing here casts a shadow. Lean-to cut-backs (Phase 6, leanToRoofCuts):
 * along a FLUSH eave lean-to the eave overhang + trim are skipped, and a gable
 * lean-to trims the gable overhang / rake only where they would hit its roof.
 */
export function EnhancedRoof({ structure: s, roofOrientation, roofColor, trimColor }: EnhancedRoofProps) {
  const { width, length, legHeight, peakHeight, rise, monoDropFt, roofOverhangFt } = s;
  const cuts = leanToRoofCuts(s);
  const cutsKey = JSON.stringify(cuts);
  const batches = useMemo(
    () =>
      roofBatches({
        structure: { width, length, legHeight, peakHeight, rise, monoDropFt, roofOverhangFt },
        roofOrientation,
        colors: { roof: roofColor, trim: trimColor },
        cuts,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cutsKey covers cuts
    [width, length, legHeight, peakHeight, rise, monoDropFt, roofOverhangFt, roofOrientation, roofColor, trimColor, cutsKey],
  );
  return <ShellMeshes batches={batches} name="enhanced-roof" />;
}
