import { useMemo } from 'react';
import { useBuildingStore } from '@/store/useBuildingStore';
import type { BuildingConfig } from '@/types/building';
import { resolveBuilding, type ResolvedBuilding } from './ruleEngine';
import { deriveStructure, type StructureModel } from './geometry';
import { generateBOM, generateQuote, type BillOfMaterials, type Quote } from './bom';
import { anyCollision } from './layout';

export interface ConfiguratorPipeline {
  resolved: ResolvedBuilding;
  structure: StructureModel;
  bom: BillOfMaterials;
  quote: Quote;
  hasCollision: boolean;
}

/**
 * The full reactive pipeline:
 *   store -> rule engine (+loads) -> geometry -> BOM -> quote -> collision check
 * Memoized on the raw config so every view reads the same derived truth.
 */
export function useResolvedBuilding(): ConfiguratorPipeline {
  const config = useBuildingStore(selectConfig);

  return useMemo(() => {
    const resolved = resolveBuilding(config);
    const structure = deriveStructure(resolved);
    const bom = generateBOM(resolved, structure);
    const quote = generateQuote(resolved, bom);
    const hasCollision = anyCollision(resolved.config.openings, structure);
    return { resolved, structure, bom, quote, hasCollision };
  }, [config]);
}

function selectConfig(s: ReturnType<typeof useBuildingStore.getState>): BuildingConfig {
  return {
    buildingType: s.buildingType,
    width: s.width,
    length: s.length,
    legHeight: s.legHeight,
    enclosedLengthFt: s.enclosedLengthFt,
    openEnd: s.openEnd,
    openEndGableSheeting: s.openEndGableSheeting,
    wallOverrides: s.wallOverrides,
    framingGauge: s.framingGauge,
    sheetingGauge: s.sheetingGauge,
    panelOrientation: s.panelOrientation,
    roofOrientation: s.roofOrientation,
    roofPitch: s.roofPitch,
    roofOverhangFt: s.roofOverhangFt,
    colors: s.colors,
    wainscot: s.wainscot,
    eavePanelFt: s.eavePanelFt,
    walls: s.walls,
    windSpeedMph: s.windSpeedMph,
    exposureCategory: s.exposureCategory,
    groundSnowPsf: s.groundSnowPsf,
    leanTos: s.leanTos,
    openings: s.openings,
  };
}
