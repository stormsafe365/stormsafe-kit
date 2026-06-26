/**
 * Typed access to the data extracted verbatim from the builder
 * (scripts/extract-pricing.mjs → data/*.json). These numbers are guaranteed
 * identical to the builder, which is verified against Sensei (CCI) and
 * IdeaRoom (CA). To refresh after a price-sheet change: re-run the extractor.
 *
 * We cast the raw JSON to typed shapes with `as unknown as` so the rest of the
 * engine gets real types without TypeScript deeply analyzing the JSON literals.
 */

import sharedJson from './data/shared-tables.json';
import mfrJson from './data/manufacturers.json';
import type { MfrConfig } from './types';

/** A table keyed by a numeric tier/height → row of prices. */
export type NumRowTable = Record<number, number[]>;
/** A 2D table keyed by height → (length → price). */
export type Num2DTable = Record<number, Record<number, number>>;
/** A price map keyed by a string (door size, component label, etc.). */
export type PriceMap = Record<string, number>;

/** CCI 62'–100' wide closure tables (both-sides combined / per-end). */
export interface CciWideTable {
  cols: number[];
  rows: Record<number, number[]>;
}

/** Shared (manufacturer-independent) tables. */
export interface SharedTables {
  WIDTHS: number[];
  LENGTHS: number[];
  PV: NumRowTable;
  PR: NumRowTable;
  PB: NumRowTable;
  HU: NumRowTable;
  RDP_STD: PriceMap;
  RDP_CHAIN: PriceMap;
  RDP_HI: PriceMap;
  EXT_SH: NumRowTable;
  EXT_SH_30: NumRowTable;
  EXT_BSC_30: NumRowTable;
  EXT_L: number[];
  SC: Num2DTable;
  EC: Num2DTable;
  CCI_WIDE_SC: CciWideTable;
  CCI_WIDE_EC: CciWideTable;
  HI_LIFT_WIDTHS: number[];
  HI_LIFT_HEIGHTS: number[];
}

export const SHARED = sharedJson as unknown as SharedTables;

/** Per-manufacturer extracted data (functions were dropped during extraction;
 *  their logic is hand-ported in engine modules). `label` is the display name. */
export type MfrData = Omit<MfrConfig, 'key' | 'name'> & { label: string };

export const MFR_DATA = mfrJson as unknown as Record<'CA' | 'CCI', MfrData>;
