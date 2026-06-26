import type { BuildingType, FramingGauge, OpeningType, SheetingGauge } from '@/types/building';

/**
 * CPQ pricing knobs — calibration constants Jenna can tune so the estimator
 * lands on published reference prices (§8): garages from ~$6,600 single-bay up
 * to ~$23,200 (30x60 four-bay). Surface the disclaimer on every quote.
 */
export const PRICING = {
  baseFee: 900,

  framePerFt: { '14-gauge': 4.25, '12-gauge': 5.5 } as Record<FramingGauge, number>,
  sheetPerSqFt: { '29-gauge': 2.4, '26-gauge': 3.1 } as Record<SheetingGauge, number>,
  trimPerFt: 1.15,

  openingCost: {
    rollUpDoor: 780,
    garageDoor: 650,
    walkDoor: 300,
    window: 180,
    frameOut: 120,
  } as Record<OpeningType, number>,

  /** Multiplier on the open (carport) labor/material baseline by family. */
  typeFactor: { carport: 0.92, garage: 1.0, utility: 1.0 } as Record<BuildingType, number>,

  /** Wainscot band — extra panel + trim per linear ft of wall run. */
  wainscotPerFt: 6.5,

  /** Engineering envelope upcharges. */
  highWindUpcharge: 0.08, // wind ≥ 150 mph
  snowUpcharge: 0.12, // heavy roof snow

  marginMultiplier: 1.4,
} as const;

export const PRICE_DISCLAIMER =
  'Prices subject to change based on steel market conditions and local engineering requirements.';
