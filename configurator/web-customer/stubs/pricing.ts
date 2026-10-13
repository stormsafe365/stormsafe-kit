/**
 * Customer web build ONLY (vite.web.config.ts aliases '@/config/pricing' here).
 *
 * The shared 3D pipeline (engine/bom.ts → useResolvedBuilding) computes a
 * placeholder estimate from src/config/pricing.ts. The customer page shows no
 * prices, so every number is zeroed here and the real constants never reach
 * the public bundle. Same shape, so the shared code compiles unchanged.
 */
import type { BuildingType, FramingGauge, OpeningType, SheetingGauge } from '@/types/building';

export const PRICING = {
  baseFee: 0,
  framePerFt: { '14-gauge': 0, '12-gauge': 0 } as Record<FramingGauge, number>,
  sheetPerSqFt: { '29-gauge': 0, '26-gauge': 0 } as Record<SheetingGauge, number>,
  trimPerFt: 0,
  openingCost: { rollUpDoor: 0, garageDoor: 0, walkDoor: 0, window: 0, frameOut: 0 } as Record<OpeningType, number>,
  typeFactor: { carport: 0, garage: 0, utility: 0 } as Record<BuildingType, number>,
  wainscotPerFt: 0,
  highWindUpcharge: 0,
  snowUpcharge: 0,
  marginMultiplier: 0,
} as const;

export const PRICE_DISCLAIMER = '';
