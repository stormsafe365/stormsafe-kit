/**
 * PricingConfig — the typed input the ported engine reads instead of the DOM.
 * Each field maps to a builder input (the `G('id').value` reads). The 3D
 * configurator will adapt its BuildingConfig into this shape.
 */

import type { RoofStyle } from './types';

export type WallStyle = 'Vertical' | 'Horizontal';
export type BuildingType = 'standard' | 'widespan' | 'carport' | 'gch';
/** Gable-end state (front/back). */
export type GableState = 'Closed' | 'Open' | 'Gable Only' | 'Half Closed';
/** Eave-side state (left/right). */
export type EaveState = 'Closed' | 'Open';
export type OcSpacing = '5oc' | '4oc';

/** Roll-up door type. `rollup` = merged STD/CHAIN by size; others explicit.
 *  CA Master Price Book 7/16/26 catalog lines: m750 / m3652 / m3100 / m3100im. */
export type RollUpType = 'standard' | 'chain' | 'hiimpact' | 'rollup' | 'm750' | 'm3652' | 'm3100' | 'm3100im';
/** Where a door/window sits — eave-side locations trigger the structural header. */
export type Location =
  | 'Front End'
  | 'Back End'
  | 'Left Eave Side'
  | 'Right Eave Side'
  | string;

export interface RollUpDoor {
  type: RollUpType;
  /** Size key like "10x10" (width x height in feet). */
  size: string;
  qty: number;
  location: Location;
  /** Chain-hoist add-on qty (only billed for sizes that don't already include it). */
  chainHoistQty?: number;
  /** Header-seal qty (billed as rate × door-width-ft). */
  headerSealQty?: number;
  /** Automatic opener qty — CCI only, $1,100 per door. */
  openerQty?: number;
  /** 45° angle cut (+$85/door). */
  angle45?: boolean;
  /** CCI color upgrade key (matches mfr.rudColors[].v). */
  color?: string;
}

export interface WalkDoor {
  /** Type key (matches mfr.wtdPrices). */
  type: string;
  qty: number;
  /** Side-frame area in sqft (billed at $425/sqft). */
  sideFrameSqFt?: number;
  /** Wall placement. Does NOT affect price for walk doors — placement only. */
  location?: Location;
}

export interface WindowUnit {
  /** Type key (matches mfr.winPrices). */
  type: string;
  qty: number;
  sideFrameSqFt?: number;
  /** Wall placement. Does NOT affect price for windows — placement only. */
  location?: Location;
}

/** Accessory mounted on a lean-to (door/window). */
export interface LeanToAccessory {
  type: 'rollup' | 'wtd' | 'win';
  /** Roll-up size key (e.g. "9x8"). */
  size?: string;
  qty: number;
  chainHoistQty?: number;
  headerSealQty?: number;
  /** Walk-through door type key (mfr.wtdPrices). */
  wtdType?: string;
  /** Window type key (mfr.winPrices). */
  winType?: string;
}

export type LtWallMode = 'open' | 'enclosed' | 'custom';
export type LtEndWall = 'open' | 'gable' | 'closed';
export type LtSideWall = 'open' | '1panel' | '2panel' | '3panel' | 'q1' | 'q2' | 'q3' | 'closed';

export interface LeanTo {
  width: number;
  length: number;
  /** Placement: 'Front Gable' | 'Back Gable' | eave side. */
  placement: string;
  /** 'freestanding' lean-tos don't incur a connection fee. */
  attachment?: 'attached' | 'freestanding';
  /** Low-leg (attached) height for the height upcharge. */
  height?: number;
  /** Tall-side height (used for free-standing lean-to pricing). */
  tallHeight?: number;
  /** Wall enclosure mode; 'custom' reads the per-wall fields below. */
  wallMode?: LtWallMode;
  frontWall?: LtEndWall;
  backWall?: LtEndWall;
  sideWall?: LtSideWall;
  accessories?: LeanToAccessory[];
}

export interface AdditionalComponent {
  /** Label key (matches mfr.acPrices). */
  label: string;
  qty: number;
  /** For "(Custom Size)" / "Custom — see notes" entries that price $0 + typed price. */
  customPrice?: number;
}

/** Carport / GCH side-panel selection. */
export interface SidePanelConfig {
  // carport
  qty?: number;
  half?: boolean;
  sides?: 'both' | 'left' | 'right';
  // gch: 'none' | 'full' | 'half' | a panel count
  gchPanels?: 'none' | 'full' | 'half' | number;
  gchSides?: 'both' | 'left' | 'right';
}

export type FramingGauge = '14' | '12';
export type Pitch = 'standard' | '4:12' | '5:12' | '6:12';
export type OverhangOption = 'none' | 'eaves' | 'gables' | 'both';

/** Permit / engineered-plans selection (plan cost is invoiced separately). */
export interface PermitConfig {
  required: boolean;
  /** Plan type key; defaults to the manufacturer's defaultPlan. */
  planType?: string;
  /** Commercial pricing path (affects CA As-Built cost). */
  isCommercial?: boolean;
}

/** Additional deposit-only discount. */
export interface AdditionalDiscount {
  amount: number;
  type: 'dollar' | 'pct';
}

export interface PricingConfig {
  /** Width in feet (odd widths price as next even — handled internally). */
  width: number;
  /** Length in feet. */
  length: number;
  /** Eave height in feet (≤6 → no leg upcharge). */
  height: number;
  roofStyle: RoofStyle;
  wallStyle: WallStyle;
  buildingType: BuildingType;

  frontGable: GableState;
  backGable: GableState;
  rightEave: EaveState;
  leftEave: EaveState;

  /** GCH only: enclosed (garage) length along the building. */
  gchEnclosedLength?: number;
  /** GCH only: open (carport) length — used for side-panel pricing. */
  gchOpenLength?: number;
  /** Truss centers — affects GCH commercial utility chart selection + 4'OC upcharge. */
  ocSpacing?: OcSpacing;

  /** Manual base-price override; > 0 wins over every table. */
  baseOverride?: number | null;

  rollUpDoors?: RollUpDoor[];
  walkDoors?: WalkDoor[];
  windows?: WindowUnit[];
  leanTos?: LeanTo[];
  additionalComponents?: AdditionalComponent[];
  sidePanels?: SidePanelConfig;

  // ── upgrades / options ──
  framingGauge?: FramingGauge;
  pitch?: Pitch;
  wainscot?: boolean;
  overhang?: OverhangOption;
  insulation?: 'none' | 'roof' | 'roof-walls';
  /** Manual 26ga wall sheeting upgrade (auto-free above the order threshold). */
  sheetingUpgrade?: boolean;
  /** Lee-county lap siding (+10% of base). */
  lapSiding?: boolean;
  /** Add fasteners line (only billable when not free). */
  fastenerAdd?: boolean;

  // ── money ──
  discountPct?: number;
  taxRatePct?: number;
  taxExempt?: boolean;
  /** Deposit percent (builder default 17). */
  depositPct?: number;
  additionalDiscount?: AdditionalDiscount;
  permit?: PermitConfig;
}
