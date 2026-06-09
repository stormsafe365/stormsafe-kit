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

  // RULE 2 — Truss spacing.
  // The pricing program is the source of truth: when it forwards a spacing
  // (config.trussSpacingFt > 0) the 3D MUST mirror it exactly, or the trusses
  // won't line up with the program's quote and its collision warnings. Only
  // when no program value is present (standalone 3D) do we fall back to the
  // load engine. Frame count mirrors the program's rule: floor(L/spacing)+1.
  const programSpacing = config.trussSpacingFt && config.trussSpacingFt > 0 ? config.trussSpacingFt : 0;
  const legSpacing = programSpacing || loads.maxFrameSpacingFt;
  const frameCount = programSpacing
    ? Math.floor(config.length / legSpacing) + 1
    : Math.ceil(config.length / legSpacing) + 1;
  if (!programSpacing && (loads.highWind || loads.heavySnow)) {
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
