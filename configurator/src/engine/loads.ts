import type { ExposureCategory, FramingGauge } from '@/types/building';

/**
 * LAYER 2 (cont.) — Wind / Snow Load Logic (PSF from MPH).
 *
 * A simplified, ASCE 7-16-style velocity-pressure model. It converts a design
 * wind speed + exposure + roof height into design pressures (psf), and ground
 * snow into a roof snow load, then derives a recommended framing gauge and the
 * max allowable frame spacing.
 *
 * ⚠️ PRELIMINARY — engineering guidance only, NOT a stamped/sealed calculation.
 *    Final gauge, spacing, and anchorage must be confirmed by a licensed FL
 *    engineer against the local code and site conditions.
 */

/** ASCE 7-16 Table 26.11-1 terrain-exposure constants (α, zg in ft). */
const EXPOSURE_CONSTANTS: Record<ExposureCategory, { alpha: number; zg: number }> = {
  B: { alpha: 7.0, zg: 1200 },
  C: { alpha: 9.5, zg: 900 },
  D: { alpha: 11.5, zg: 700 },
};

const KD = 0.85; // wind directionality (buildings)
const KZT = 1.0; // topographic factor (flat terrain assumed)

/** Velocity-pressure exposure coefficient Kz at height z (min 15 ft). */
function velocityExposureCoeff(exposure: ExposureCategory, heightFt: number): number {
  const { alpha, zg } = EXPOSURE_CONSTANTS[exposure];
  const z = Math.max(15, heightFt);
  return 2.01 * Math.pow(z / zg, 2 / alpha);
}

export interface LoadInputs {
  windSpeedMph: number;
  exposureCategory: ExposureCategory;
  groundSnowPsf: number;
  /** Mean roof height (ft) — eave height + half the rise. */
  meanRoofHeightFt: number;
  /** Clear-span width (ft) — wide spans push toward heavier framing. */
  widthFt: number;
}

export interface LoadResult {
  /** qh = 0.00256·Kz·Kzt·Kd·V²  (psf). */
  velocityPressurePsf: number;
  /** Representative C&C wall design pressure (psf). */
  designWallPressurePsf: number;
  /** Representative roof corner uplift (psf) — governs anchorage. */
  roofUpliftPsf: number;
  /** Flat-roof snow load pf = 0.7·Ce·Ct·Is·pg (psf). */
  roofSnowPsf: number;

  /** Heavy snow triggers tighter framing. */
  heavySnow: boolean;
  /** High wind triggers tighter framing. */
  highWind: boolean;

  /** Advisory minimum framing gauge for these loads. */
  recommendedGauge: FramingGauge;
  /** Max structural frame spacing (ft) the loads allow. */
  maxFrameSpacingFt: number;
}

const HEAVY_SNOW_PSF = 20; // roof snow at/above which spacing tightens
const HIGH_WIND_MPH = 150; // at/above which spacing tightens

export function computeLoads(input: LoadInputs): LoadResult {
  const { windSpeedMph: V, exposureCategory, groundSnowPsf, meanRoofHeightFt, widthFt } = input;

  // --- Wind ---
  const kz = velocityExposureCoeff(exposureCategory, meanRoofHeightFt);
  const qh = 0.00256 * kz * KZT * KD * V * V;
  const designWallPressurePsf = qh * 1.18; // |GCp|≈1.0 wall + GCpi 0.18 (enclosed)
  const roofUpliftPsf = qh * 1.98; // representative corner zone uplift

  // --- Snow (ASCE 7: Ce 0.9 exposed, Ct 1.0, Is 1.0) ---
  const roofSnowPsf = 0.7 * 0.9 * 1.0 * 1.0 * groundSnowPsf;

  const heavySnow = roofSnowPsf >= HEAVY_SNOW_PSF;
  const highWind = V >= HIGH_WIND_MPH;

  // --- Derived structural guidance ---
  // 14-gauge is the StormSafe standard (rated to 170+ mph in exposure C).
  // 12-gauge is advised only in the most severe envelopes.
  const recommendedGauge: FramingGauge =
    V >= 180 || (exposureCategory === 'D' && V >= 150) || widthFt >= 30 ? '12-gauge' : '14-gauge';

  const maxFrameSpacingFt = highWind || heavySnow || widthFt >= 28 ? 4 : 5;

  return {
    velocityPressurePsf: round(qh),
    designWallPressurePsf: round(designWallPressurePsf),
    roofUpliftPsf: round(roofUpliftPsf),
    roofSnowPsf: round(roofSnowPsf),
    heavySnow,
    highWind,
    recommendedGauge,
    maxFrameSpacingFt,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
