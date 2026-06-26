/**
 * Base price tables + tier helpers.
 *
 * PV/PR/PB and WIDTHS/LENGTHS come from the extracted data (data.ts → builder),
 * so there is a single source of truth. Only the Vertical 26'/46' correction and
 * the tier-rounding helpers (logic, not data) live here.
 *
 * Builder source: PV/PR/PB lines 3133–3142; tiers 3644–3654.
 */

import type { RoofStyle } from './types';
import { SHARED, type NumRowTable } from './data';

/** Width columns for PV/PR/PB rows. Index → width in feet. Builder line 3131. */
export const WIDTHS: number[] = SHARED.WIDTHS;

/** Length tier row keys present in PV/PR/PB (std ∪ wide-span). Builder line 3132. */
export const LENGTHS: number[] = SHARED.LENGTHS;

/**
 * Vertical base correction (builder line 3140): the 26'/46' standard-length rows
 * held inflated values; the correct CA-published prices live in the 25'/45' rows.
 * Copy standard-width columns (indices 0–9 = widths 12–30) from 25→26 and 45→46.
 * Wide-span columns (10+) untouched. Verified: 22×46 Vert = $5,890. ONLY PV.
 */
function applyVerticalCorrection(pv: NumRowTable): NumRowTable {
  const t: NumRowTable = JSON.parse(JSON.stringify(pv));
  for (let i = 0; i < 10; i++) {
    t[26][i] = t[25][i];
    t[46][i] = t[45][i];
  }
  return t;
}

/** Vertical base table, with the 26'/46' correction applied (matches builder). */
export const PV: NumRowTable = applyVerticalCorrection(SHARED.PV);
/** Regular base table (uncorrected — see ≥36 flatline caveat, BUILDER_SPEC §9b). */
export const PR: NumRowTable = SHARED.PR;
/** Boxed base table (uncorrected — see ≥36 flatline caveat). */
export const PB: NumRowTable = SHARED.PB;

/** Pick the base table for a roof style. Builder: `gBase` line 3682. */
export function baseTableFor(roofStyle: RoofStyle): NumRowTable {
  return roofStyle === 'Vertical' ? PV : roofStyle === 'Regular' ? PR : PB;
}

// ── Length tiers ─────────────────────────────────────────────────────────────

/** Standard building tiers (CA sheet). Builder line 3645. */
export const STD_TIERS = [21, 26, 31, 36, 41, 46, 51] as const;

/** Wide-span tiers (CA sheet, 4-ft increments). Builder line 3651. */
export const WS_TIERS = [21, 25, 29, 33, 37, 41, 45, 49, 53] as const;

/** First standard tier ≥ l (rounds UP), capped at 51. Builder `nearestStd` line 3646. */
export function nearestStd(l: number): number {
  for (const t of STD_TIERS) if (t >= l) return t;
  return STD_TIERS[STD_TIERS.length - 1];
}

/** First wide-span tier ≥ l (rounds UP), capped at 53. Builder `nearestWS` line 3652. */
export function nearestWS(l: number): number {
  for (const t of WS_TIERS) if (t >= l) return t;
  return WS_TIERS[WS_TIERS.length - 1];
}
