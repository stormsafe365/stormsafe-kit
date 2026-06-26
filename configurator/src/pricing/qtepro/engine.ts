/**
 * QTEPRO pricing engine — pure functions ported from the builder's `g*()`
 * pricing functions. Each takes typed inputs + an MfrConfig instead of reading
 * the DOM. Numbers come from tables.ts / manufacturers.ts (transcribed 1:1).
 *
 * Ported so far:
 *  - commercialBaseFn (builder line 2565)
 *  - gBase            (builder line 3656)
 *
 * Not yet ported (tracked in BUILDER_SPEC §4): gLeg, gWalls, gRUD, gWTD, gWIN,
 * gAC, gSidePanels, gConnectionFees, gLT, scLookup, ecLookup, eaveHeaderCost.
 */

import type { BasePriceInput, CommercialBase, MfrConfig } from './types';
import { WIDTHS, baseTableFor, nearestStd, nearestWS } from './tables';

/**
 * CCI commercial base lookup (32'–100' wide). Returns null when the width is
 * outside the table (caller falls through to the legacy path).
 * Faithful port of `commercialBaseFn` — builder line 2565.
 */
export function commercialBaseFn(t: CommercialBase, w: number, l: number): number | null {
  if (!t || !t.rows[w]) return null; // width outside table

  // Direct length match (table columns).
  const idx = t.cols.indexOf(l);
  if (idx >= 0) return t.rows[w][idx];

  // Combination match (L > 52').
  if (t.combLen[l]) {
    const pair = t.combLen[l];
    const i1 = t.cols.indexOf(pair[0]);
    const i2 = t.cols.indexOf(pair[1]);
    if (i1 >= 0 && i2 >= 0) return t.rows[w][i1] + t.rows[w][i2];
  }

  // Round UP to next table column when L falls between steps (matches Sensei).
  if (l >= t.cols[0] && l <= t.cols[t.cols.length - 1]) {
    for (let c = 0; c < t.cols.length; c++) {
      if (t.cols[c] >= l) return t.rows[w][c];
    }
  }

  // Lengths not on a combination grid step (54, 58, 62, …) — round up to next combo.
  if (l > 52 && l <= 104) {
    const combLens = Object.keys(t.combLen)
      .map(Number)
      .sort((a, b) => a - b);
    for (const key of combLens) {
      if (l <= key) {
        const pair2 = t.combLen[key];
        const ci1 = t.cols.indexOf(pair2[0]);
        const ci2 = t.cols.indexOf(pair2[1]);
        if (ci1 >= 0 && ci2 >= 0) return t.rows[w][ci1] + t.rows[w][ci2];
      }
    }
  }

  // L > 104: recursively split as [104, l-104] sections (matches Sensei).
  if (l > 104) {
    const p104 = t.rows[w][t.cols.indexOf(52)] * 2; // [52,52]
    const pRem = commercialBaseFn(t, w, l - 104);
    if (pRem != null) return p104 + pRem;
  }

  return null;
}

/**
 * Base building price — the dominant line item. Faithful port of `gBase`
 * (builder line 3656). Table-driven with round-UP tiering and section
 * combinations; the per-foot extrapolation at the end is the legacy escape
 * hatch only (almost every real quote hits a tier or combination).
 */
export function gBase(input: BasePriceInput, mfr: MfrConfig): number {
  let w = input.width;
  const l = input.length;
  if (!w || !l) return 0;

  // CA/CCI only build EVEN widths — odd widths price as the next even (45→46).
  if (w % 2 === 1) w++;

  // Manual base-price override wins over every table.
  if (input.baseOverride && input.baseOverride > 0) return input.baseOverride;

  // ── CA 62'–70' wide (PROVISIONAL) — only 70×110 verified vs IdeaRoom ──
  if (mfr.key === 'CA' && w >= 62 && w <= 70) {
    if (w === 70 && l === 110) return 73385;
    return 0;
  }

  // ── CCI commercial (32'–60'+ wide, Vertical only) ──
  if (mfr.commercialBase && w >= 32 && input.roofStyle === 'Vertical') {
    const cciPrice = commercialBaseFn(mfr.commercialBase, w, l);
    if (cciPrice !== null && cciPrice > 0) return cciPrice;
  }

  const wi = (WIDTHS as readonly number[]).indexOf(w);
  if (wi < 0) return 0;
  const T = baseTableFor(input.roofStyle);
  const isWS = w >= 32;

  if (l <= 51 && !isWS) {
    // Standard tiers [21,26,31,36,41,46,51].
    const pl = nearestStd(l);
    return (T[pl] || [])[wi] || 0;
  } else if (l <= 53 && isWS) {
    // Wide-span tiers [21,25,29,33,37,41,45,49,53].
    const pl = nearestWS(l);
    return (T[pl] || [])[wi] || 0;
  }

  // ── Standard 12'–30' wide, L > 51' — use combinations ──
  if (!isWS && l > 51 && mfr.standardCombinations) {
    const targetKey = firstKeyGte(mfr.standardCombinations, l);
    if (targetKey != null) {
      const sum = sumSections(T, mfr.standardCombinations[targetKey], wi);
      if (sum > 0) return sum;
    }
  }

  // ── Wide-span 32'–60' wide, L > 53' — use combinations (CA path) ──
  if (isWS && l > 53 && mfr.wideSpanCombinations) {
    const wsTarget = firstKeyGte(mfr.wideSpanCombinations, l);
    if (wsTarget != null) {
      const wsSum = sumSections(T, mfr.wideSpanCombinations[wsTarget], wi);
      if (wsSum > 0) return wsSum;
    }
  }

  // ── Legacy escape hatch: extrapolate beyond the last tier ──
  const lastTier = isWS ? 53 : 51;
  const prevTier = isWS ? 49 : 46;
  const pLast = (T[lastTier] || [])[wi] || 0;
  const pPrev = (T[prevTier] || [])[wi] || 0;
  if (!pLast || !pPrev) return 0;
  const ratePerFt = (pLast - pPrev) / (lastTier - prevTier);
  return Math.round(pLast + ratePerFt * (l - lastTier));
}

/** First combination key ≥ l (rounds length up to the next valid combination). */
function firstKeyGte(combos: Record<number, number[]>, l: number): number | null {
  const keys = Object.keys(combos)
    .map(Number)
    .sort((a, b) => a - b);
  for (const k of keys) if (k >= l) return k;
  return null;
}

/** Sum the section tier prices for a combination at width column `wi`. */
function sumSections(T: Record<number, number[]>, parts: number[], wi: number): number {
  let sum = 0;
  for (const partL of parts) sum += (T[partL] || [])[wi] || 0;
  return sum;
}
