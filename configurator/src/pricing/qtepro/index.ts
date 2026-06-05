/**
 * QTEPRO pricing engine (ported) — public surface.
 *
 * Faithful TypeScript port of the StormSafe quote builder's pricing engine,
 * verified against Sensei (CCI) and IdeaRoom (CA). See BUILDER_SPEC.md for the
 * full function/line map and the port roadmap.
 *
 * The full pricing path is ported: gBase, gLeg, gWalls (+GCH/utility),
 * gVertUpgrade, gConnectionFees, gRUD/gWTD/gWIN, gInsul, gSidePanels, gLT, gAC,
 * the rc()-inline upcharges (12ga/4OC/pitch/wainscot/overhang/plans), and the
 * `priceBuilding` composition (subtotal → discount → tax → deposit/balance).
 *
 * Primary entry point: `priceBuilding(config, mfr) → PricedQuote`.
 */

export type { MfrKey, RoofStyle, MfrConfig, CommercialBase, BasePriceInput } from './types';
export type {
  PricingConfig,
  WallStyle,
  BuildingType,
  GableState,
  EaveState,
  OcSpacing,
  RollUpType,
  RollUpDoor,
  WalkDoor,
  WindowUnit,
  LeanTo,
  LeanToAccessory,
  AdditionalComponent,
  SidePanelConfig,
  FramingGauge,
  Pitch,
  OverhangOption,
  PermitConfig,
  AdditionalDiscount,
} from './config';
export type { QuoteLineItems, PricedQuote } from './quote';

export { MANUFACTURERS, getMfr } from './manufacturers';
export { SHARED, MFR_DATA } from './data';
export { WIDTHS, LENGTHS, PV, PR, PB, STD_TIERS, WS_TIERS, nearestStd, nearestWS, baseTableFor } from './tables';

export { gBase, commercialBaseFn } from './engine';
export {
  ecLookup,
  scLookup,
  eaveHeaderCost,
  vertSideUpcharge,
  vertEndUpcharge,
} from './closures';
export { gLeg, gVertUpgrade, gWalls, gConnectionFees, gableLTrimCost, utilitySides } from './shell';
export { gRUD, gWTD, gWIN, getDoorPrice, doorHasChainIncluded, doorNeedsLift } from './openings';
export { gInsul, gSidePanels, gLT, gAC } from './extras';
export { priceBuilding, pitchUpgradeCost, planCost } from './quote';
export { applyBuildingRules, isWideSpan, isAutoFourOC } from './rules';
