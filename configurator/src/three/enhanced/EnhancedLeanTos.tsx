import { useMemo } from 'react';
import type { StructureModel } from '@/engine/geometry';
import { rendersLeanToFixture } from '@/engine/leanToFixtures';
import type { BuildingColors, Opening, PanelOrientation, Wainscot } from '@/types/building';
import { DraggableLeanToOpening, eaveSurfaces, gableSurfaces, resolveWalls } from '../LeanToSiding';
import { ShellMeshes } from './ShellMeshes';
import { leanToBatches, leanToBatchKey, type LeanToShellInput } from './leanToShell';

interface EnhancedLeanTosProps {
  structure: StructureModel;
  mainOpenings: Opening[];
  wallOrientation: PanelOrientation;
  roofOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
  /** Trim color as the classic fixtures take it (hex). */
  trimHex: string;
}

/**
 * ENHANCED lean-tos (render-upgrade Phase 6): the sheeting, roof and trim come
 * from leanToShell.ts (the classic lean-to geometry wrapped with the Phase-5
 * materials and trims), merged into one mesh per material for all lean-tos.
 * The door / window / roll-up / frame-out fixtures are the CLASSIC
 * DraggableLeanToOpening on the classic surface set (eaveSurfaces /
 * gableSurfaces), same props and visibility rule as LeanToSiding, so their
 * placement, drag, click threshold, guides and write-back are untouched.
 */
export function EnhancedLeanTos({ structure, mainOpenings, wallOrientation, roofOrientation, colors, wainscot, trimHex }: EnhancedLeanTosProps) {
  const inp: LeanToShellInput = { structure, mainOpenings, wallOrientation, roofOrientation, colors, wainscot };
  const key = leanToBatchKey(inp);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers every geometry input
  const batches = useMemo(() => leanToBatches(inp), [key]);
  const overhangFt = structure.roofOverhangFt;
  return (
    <group>
      <ShellMeshes batches={batches} name="enhanced-lean-tos" />
      {structure.leanTos.map((lt) => {
        const walls = resolveWalls(lt);
        const geo = lt.attachedSide.includes('Eave') ? eaveSurfaces(lt, overhangFt, walls) : gableSurfaces(lt, overhangFt, walls);
        return (
          <group key={lt.id}>
            {lt.openings
              .filter((o) => rendersLeanToFixture(o, walls))
              .map((o) => (
                <DraggableLeanToOpening key={`of-${o.id}`} geo={geo} lt={lt} opening={o} trimColor={trimHex} />
              ))}
          </group>
        );
      })}
    </group>
  );
}
