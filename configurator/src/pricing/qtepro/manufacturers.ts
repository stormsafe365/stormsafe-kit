/**
 * Per-manufacturer configs, assembled from the extracted builder data
 * (data.ts). CA = Carports Anywhere (verified vs IdeaRoom); CCI = Carolina
 * Carports Inc (verified vs Sensei). INPUT mode bypasses the engine entirely.
 */

import type { MfrConfig, MfrKey } from './types';
import { MFR_DATA, type MfrData } from './data';

type MfrRealKey = Exclude<MfrKey, 'INPUT'>;

function build(key: MfrRealKey, data: MfrData): MfrConfig {
  // `data` carries every extracted field (including `label`); key/name override.
  return { ...(data as unknown as MfrConfig), key, name: data.label };
}

export const MANUFACTURERS: Record<MfrRealKey, MfrConfig> = {
  CA: build('CA', MFR_DATA.CA),
  CCI: build('CCI', MFR_DATA.CCI),
};

/** Resolve a manufacturer config by key. INPUT mode bypasses the engine. */
export function getMfr(key: MfrRealKey): MfrConfig {
  return MANUFACTURERS[key];
}
