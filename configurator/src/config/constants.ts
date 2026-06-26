import type { BuildingConfig, BuildingType, ExposureCategory } from '@/types/building';

/**
 * Dimension domains + engineering input ranges. The sidebar reads these to
 * build sliders/steps; the rule engine clamps against them.
 */
export const WIDTH_RANGE = { min: 12, max: 100, step: 2 } as const;
export const LEG_HEIGHT_RANGE = { min: 6, max: 24, step: 1 } as const;
/** "As long as you want" — slider caps high; any length is buildable in panel multiples. */
export const LENGTH_RANGE = { min: 16, max: 300, step: 1 } as const;
/** Wainscot band height options (ft). */
export const WAINSCOT_RANGE = { min: 1, max: 6, step: 0.5 } as const;

/** Certification: preset 150 mph, upgradeable to 170 mph. */
export const WIND_RANGE = { min: 150, max: 170, step: 5 } as const;
export const SNOW_RANGE = { min: 0, max: 70, step: 5 } as const;

export const EXPOSURE_OPTIONS: { value: ExposureCategory; label: string; hint: string }[] = [
  { value: 'B', label: 'B', hint: 'Suburban / wooded' },
  { value: 'C', label: 'C', hint: 'Open terrain' },
  { value: 'D', label: 'D', hint: 'Coastal / flat' },
];

export const BUILDING_TYPES: { value: BuildingType; label: string; blurb: string }[] = [
  { value: 'carport', label: 'Carport', blurb: 'Open posts + roof' },
  { value: 'garage', label: 'Garage', blurb: 'Fully enclosed' },
  { value: 'utility', label: 'Utility', blurb: 'Enclosed + open bay' },
];

/** Truss-clearance rule: warn when an opening comes within this of a leg (ft). */
export const TRUSS_CLEARANCE_FT = 2 / 12; // 2" jamb clearance each side (truss within 2" of a door edge needs a side frame)

export const DEFAULT_CONFIG: BuildingConfig = {
  buildingType: 'garage',
  width: 24,
  length: 36,
  legHeight: 10,
  enclosedLengthFt: 20,
  openEnd: 'front',
  openEndGableSheeting: false,
  wallOverrides: { leftOpen: false, rightOpen: false },
  framingGauge: '14-gauge',
  sheetingGauge: '29-gauge',
  panelOrientation: 'Horizontal',
  roofOrientation: 'Vertical',
  roofPitch: 3,
  roofOverhangFt: 0.5, // 6" standard overhang
  // Defaults mirror the real StormSafe quote palette.
  colors: { roof: 'WXA0090L', walls: 'WXA0095L', trim: 'WXB107L', wainscot: 'WXA0090L' },
  wainscot: { enabled: false, heightFt: 3 },
  eavePanelFt: { left: 0, right: 0 },
  // Default = fully enclosed (garage). Type presets overwrite this.
  walls: {
    preset: 'enclosed',
    front: 'closed',
    back: 'closed',
    left: 'closed',
    right: 'closed',
    storage: { mode: 'none', lengthFt: 0 },
  },
  windSpeedMph: 150,
  exposureCategory: 'C',
  groundSnowPsf: 0,
  leanTos: [],
  openings: [
    { id: 'gd-1', type: 'garageDoor', side: 'front', offset: 12, width: 9, height: 8, sillHeight: 0 },
    { id: 'wd-1', type: 'walkDoor', side: 'left', offset: 10, width: 3, height: 6.7, sillHeight: 0 },
    { id: 'win-1', type: 'window', side: 'left', offset: 22, width: 2.5, height: 2.5, sillHeight: 4 },
  ],
};

/** Snap an arbitrary value to the nearest allowed step within a range. */
export function snap(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round((clamped - min) / step) * step + min;
}

/** Snap to the nearest entry in a discrete option list. */
export function snapToOptions(value: number, options: readonly number[]): number {
  return options.reduce((best, opt) =>
    Math.abs(opt - value) < Math.abs(best - value) ? opt : best,
  );
}
