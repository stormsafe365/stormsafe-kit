/**
 * QTEPRO pricing port — shared types.
 *
 * This module is a faithful TypeScript re-implementation of the pricing engine
 * inside `stormsafe_merged_qtepro - …​.html` (the StormSafe quote builder). The
 * builder is the source of truth and is verified against Sensei (CCI) and
 * IdeaRoom (CA). Every numeric table here is transcribed 1:1 from that file —
 * see BUILDER_SPEC.md for the function/line index.
 *
 * Port rules (from the builder's own CLAUDE.md):
 *  - Data is transcribed exactly, never recomputed.
 *  - Pricing is table-driven with round-UP tiering and section combinations —
 *    NEVER linearly extrapolated per foot (that is the legacy escape hatch only).
 *  - Functions are pure: they take (input, mfrConfig) instead of reading the DOM.
 */

/** Active manufacturer. `INPUT` = manual per-category override (engine bypassed). */
export type MfrKey = 'CA' | 'CCI' | 'INPUT';

/** Roof style selects which base table (PV/PR/PB) is used. */
export type RoofStyle = 'Vertical' | 'Regular' | 'Boxed';

/**
 * CCI commercial base table (32'–100' wide). CA has no equivalent — CA wide-span
 * resolves through PV/PR/PB columns + `wideSpanCombinations`.
 * Builder: `commercialBase` @ line 2504.
 */
export interface CommercialBase {
  /** Length-tier columns, in feet. */
  cols: number[];
  /** width → row of prices aligned to `cols`. */
  rows: Record<number, number[]>;
  /** L > 52' built as a 2-section combination of [a, b] feet. */
  combLen: Record<number, number[]>;
}

/** Utility (GCH) sides chart — price covers BOTH open sides of the carport portion. */
export interface UtilityChart {
  /** Building-height columns. */
  cols: number[];
  /** enclosed-length → row of prices aligned to `cols`. */
  rows: Record<number, number[]>;
}
export interface UtilityPricing {
  residential5OC?: UtilityChart;
  residential4OC?: UtilityChart;
  commercial?: UtilityChart;
}

/** CCI roll-up door color upgrade tier. */
export interface RudColor {
  v: string;
  label: string;
  hex?: string;
  price: number;
}

/** A palette entry. `c` = manufacturer paint code (CA only); `h` = render hex. */
export interface BuildingColor {
  n: string;
  h: string;
  c?: string;
}

/**
 * Per-manufacturer config. Mirrors one entry of the builder's `MANUFACTURERS`
 * object (@ line 2194), built from the extracted data. Fields the ported engine
 * reads are typed; extra builder keys (planOptions, wtdTypes, …) pass through
 * untyped via the `as unknown as` cast in data.ts.
 */
export interface MfrConfig {
  key: Exclude<MfrKey, 'INPUT'>;
  name: string;

  // ── base / combination tables ──
  /** Standard combinations for 12'–30' wide, L > 51'. CA and CCI are identical. */
  standardCombinations: Record<number, number[]>;
  /** CA wide-span combinations for 32'–60' wide, L > 53'. CCI uses commercialBase instead. */
  wideSpanCombinations?: Record<number, number[]>;
  /** CCI commercial table (32'–100' wide). Absent on CA. */
  commercialBase?: CommercialBase;

  // ── engineering flags (drive lookup axis / thresholds) ──
  /** Length threshold above which extended (EXT_*) closure/leg tables apply. CA 44, CCI 52. */
  shExtThresh: number;
  /** true → SH/BSC tables indexed by length (CCI); false → by width (CA). */
  shIndexByLength: boolean;
  /** true → vertical side table is both-sides-combined and halved (CCI). */
  vertSideCombined: boolean;
  /** true → manufacturer offers a Hi-Impact roll-up tier (CA). */
  hiImpactRollup: boolean;
  /** true → fasteners always free (CCI); false → free only above freeThresh (CA). */
  fastenerAlwaysFree: boolean;

  // ── scalar prices ──
  gableOnlyPrice: number;
  halfGablePrice: number;
  /** Header-seal rate, $/ft of door width. CA 9.85, CCI 12.00. */
  seal: number;
  /** Chain-hoist add-on, both $325. */
  chain: number;
  /** Order subtotal at/above which fasteners (and 26ga) are free. */
  freeThresh: number;
  wtd_std: number;
  wtd_hi: number;
  win_std: number;
  win_hi: number;

  // ── tables ──
  /** Per-end vertical upgrade by width. */
  vertEnd: Record<number, number>;
  /** Leg-height table, 12'–24' wide — height → row by LENGTHS index. */
  huN: Record<number, number[]>;
  /** Leg-height table, 26'–30' wide. */
  huM: Record<number, number[]>;
  /** Extended side-close commercial table (l > shExtThresh) — height → row by EXT_L. */
  extBsc: Record<number, number[]>;
  utilityPricing: UtilityPricing;
  wtdPrices: Record<string, number>;
  winPrices: Record<string, number>;
  acPrices: Record<string, number>;
  /** CA July 15, 2026 certified sheet: per-size certified garage-door price
   *  that REPLACES the shared STD/CHAIN tables (hi-impact keeps its chart). */
  certRud?: Record<string, number>;
  /** Sizes whose certified price includes the chain hoist (12x12 and up). */
  certHoist?: Record<string, boolean>;
  rudColors?: RudColor[];
  colors: BuildingColor[];

  // ── side panels / overhang / plans ──
  /** Carport/GCH side-panel pricing by panel tier. */
  sidePanels?: {
    tiers: number[];
    full: Record<number, number>;
    halfTrim: Record<number, number>;
    cutFee?: Record<number, number>;
  };
  /** CCI 1' overhang pricing by width bucket. */
  overhang?: Record<'small' | 'mid' | 'large', { ends: number; sides: number }>;
  /** Default permit plan type for this manufacturer. */
  defaultPlan?: string;
  plans?: Record<string, number>;
  planLabels?: Record<string, string>;
  countyPlans?: Record<string, string>;
}

/** Inputs to the base-price lookup (`gBase`). Mirrors the builder's bw/bl/rs reads. */
export interface BasePriceInput {
  /** Building width in feet (odd widths price as the next even — handled internally). */
  width: number;
  /** Building length in feet. */
  length: number;
  /** Roof style — selects PV/PR/PB. */
  roofStyle: RoofStyle;
  /** Manual base-price override; when > 0 it wins over every table. */
  baseOverride?: number | null;
}
