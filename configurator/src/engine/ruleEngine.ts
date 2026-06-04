import type { BuildingConfig } from '@/types/building';
import { computeLoads, type LoadResult } from './loads';

/**
 * LAYER 2 — Parametric Rule Engine.
 *
 * Pure function: takes the raw config, runs the wind/snow load logic, applies
 * the hard construction rules, and returns a NORMALIZED config plus derived
 * structural facts. Everything downstream reads this `ResolvedBuilding`.
 */
export interface ResolvedBuilding {
  config: BuildingConfig;
  loads: LoadResult;

  /** Vertical sheeting needs horizontal hat channels. */
  requiresHatChannels: boolean;

  /** ft between trusses/frame loops (from the load engine). */
  legSpacing: number;
  /** Number of trusses (frame loops): ceil(length / spacing) + 1. */
  frameCount: number;

  notes: string[];
}

export function resolveBuilding(input: BuildingConfig): ResolvedBuilding {
  const config: BuildingConfig = { ...input };
  const notes: string[] = [];

  // --- Loads (PSF from MPH) ---
  const rise = (config.width / 2) * (config.roofPitch / 12);
  const meanRoofHeightFt = config.legHeight + rise / 2;
  const loads = computeLoads({
    windSpeedMph: config.windSpeedMph,
    exposureCategory: config.exposureCategory,
    groundSnowPsf: config.groundSnowPsf,
    meanRoofHeightFt,
    widthFt: config.width,
  });

  // Framing gauge is the user's choice — never locked or auto-forced.

  // RULE 1 — Vertical sheeting flags hat channels.
  const requiresHatChannels = config.panelOrientation === 'Vertical';
  if (requiresHatChannels) notes.push('Vertical sheeting — horizontal hat channels added to walls.');

  // RULE 2 — Truss spacing from the load engine.
  const legSpacing = loads.maxFrameSpacingFt;
  const frameCount = Math.ceil(config.length / legSpacing) + 1;
  if (loads.highWind || loads.heavySnow) {
    notes.push(`Load case — truss spacing tightened to ${legSpacing}ft (${frameCount} trusses).`);
  }

  return {
    config,
    loads,
    requiresHatChannels,
    legSpacing,
    frameCount,
    notes,
  };
}
