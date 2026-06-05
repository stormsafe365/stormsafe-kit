/**
 * Building-shell pricing, ported from the builder:
 *  - gLeg            (line 3743) — leg/eave-height upcharge
 *  - utilitySides    (CA line 2213 / CCI line 2647) — GCH open-sides chart
 *  - gVertUpgrade    (line 4007) — Vertical wall upgrade (≤30' builds)
 *  - gWalls          (line 4029) — gable ends + side closure + GCH utility storage
 *  - gConnectionFees (line 3837) — lean-to attachment fees
 */

import type { MfrConfig, UtilityChart } from './types';
import type { PricingConfig } from './config';
import { SHARED } from './data';
import { nearestStd, LENGTHS } from './tables';
import { ecLookup, scLookup, vertSideUpcharge, vertEndUpcharge } from './closures';

const { HU, EXT_SH, EXT_SH_30, EXT_L } = SHARED;

// Wide-span leg-height table (embedded in gLeg, builder line 3774).
const SHC = [20, 24, 28, 32, 36, 40, 44, 48, 52];
const SHT: Record<number, number[]> = {
  10: [430, 520, 605, 690, 780, 865, 950, 1035, 1125],
  12: [865, 1035, 1210, 1380, 1555, 1730, 1900, 2075, 2245],
  14: [1535, 1845, 2150, 2460, 2765, 3070, 3380, 3685, 3995],
  16: [2450, 2895, 3340, 3785, 4235, 4680, 5125, 5575, 6020],
  18: [3360, 3840, 4320, 4800, 5280, 5760, 6240, 6720, 7200],
  20: [3790, 4470, 5115, 5830, 6510, 7190, 7865, 8545, 9225],
};

/** Round odd widths UP to the next even (CA/CCI only build even widths). */
const evenW = (w: number): number => (w % 2 === 1 ? w + 1 : w);

/** Leg/eave-height upcharge. Builder `gLeg` line 3743. */
export function gLeg(config: PricingConfig, mfr: MfrConfig): number {
  let w = config.width || 0;
  const h = config.height || 6;
  const l = config.length;
  if (h <= 6 || !l || !w) return 0;
  w = evenW(w);

  if (mfr.key === 'CA' && w >= 62 && w <= 70) {
    if (w === 70 && l === 110 && h === 20) return 19455;
    return 0;
  }

  const hk = h <= 10 ? 10 : h <= 12 ? 12 : h <= 14 ? 14 : h <= 16 ? 16 : h <= 18 ? 18 : 20;

  // Wide span (32–60ft+): SH table; EXT_SH for l > shExtThresh.
  if (w >= 32) {
    if (l > mfr.shExtThresh) {
      const extRow = EXT_SH[hk] || EXT_SH[16] || [];
      let bestI = extRow.length - 1;
      for (let ei = 0; ei < EXT_L.length; ei++) {
        if (EXT_L[ei] >= l) {
          bestI = ei;
          break;
        }
      }
      let extVal = extRow[bestI] || 0;
      if (l > 100) {
        const extRate = (extRow[extRow.length - 1] - extRow[extRow.length - 2]) / (EXT_L[EXT_L.length - 1] - EXT_L[EXT_L.length - 2]);
        extVal = Math.round(extRow[extRow.length - 1] + extRate * (l - 100));
      }
      // PROVISIONAL: CCI 62–100 wide ≈ 2× (verified at 100×200×20 ≈ $62,740).
      if (mfr.key === 'CCI' && w >= 62 && w <= 100) extVal = Math.round(extVal * 2);
      return extVal;
    }
    const shIdx = mfr.shIndexByLength ? l : w;
    let ci: number;
    if (mfr.shIndexByLength) {
      ci = SHC.length - 1;
      for (let i = 0; i < SHC.length; i++) {
        if (SHC[i] >= shIdx) {
          ci = i;
          break;
        }
      }
    } else {
      ci = 0;
      for (let i = 0; i < SHC.length; i++) {
        if (SHC[i] <= shIdx) ci = i;
        else break;
      }
    }
    let shVal = (SHT[hk] || SHT[16] || [])[ci] || 0;
    if (w > 52 && ci === SHC.length - 1) {
      const shPrev = (SHT[hk] || SHT[16] || [])[ci - 1] || 0;
      const shRate = (shVal - shPrev) / (SHC[ci] - SHC[ci - 1]);
      shVal = Math.round(shVal + shRate * (w - SHC[ci]));
    }
    return shVal;
  }

  // Standard (12–30ft): HU tables for l≤40, EXT_SH_30 for w=30, extrapolate others.
  const hk2 = h <= 16 ? h : h <= 18 ? 18 : 20;
  const huT = w <= 24 ? mfr.huN : w <= 30 ? mfr.huM : HU;
  if (l <= 40) {
    const pls = nearestStd(l);
    const lis = LENGTHS.indexOf(pls);
    if (lis < 0) return 0;
    return (huT[hk2] || huT[16] || [])[lis] || 0;
  }
  if (w === 30 && EXT_SH_30[hk2]) {
    const extRow30 = EXT_SH_30[hk2];
    let bestI30 = extRow30.length - 1;
    for (let ei = 0; ei < EXT_L.length; ei++) {
      if (EXT_L[ei] >= l) {
        bestI30 = ei;
        break;
      }
    }
    let extVal30 = extRow30[bestI30] || 0;
    if (l > 100) {
      const rate30 = (extRow30[extRow30.length - 1] - extRow30[extRow30.length - 2]) / (EXT_L[EXT_L.length - 1] - EXT_L[EXT_L.length - 2]);
      extVal30 = Math.round(extRow30[extRow30.length - 1] + rate30 * (l - 100));
    }
    return extVal30;
  }
  const sh40s = (huT[hk2] || huT[16] || [])[LENGTHS.indexOf(41)] || 0;
  const sh20s = (huT[hk2] || huT[16] || [])[LENGTHS.indexOf(21)] || 0;
  if (!sh40s || !sh20s) return 0;
  return Math.round(sh40s + ((sh40s - sh20s) / 20) * (l - 40));
}

/**
 * GCH open-sides chart price (covers BOTH sides). Returns null when no chart
 * applies (CA ≥32' wide) so the caller falls back to scLookup.
 * Ports CA `utilitySidesFn` (line 2213) and CCI's (line 2647) — the two differ
 * in how height is resolved (CA interpolates; CCI snaps to the nearest column).
 */
export function utilitySides(mfr: MfrConfig, w: number, h: number, encL: number, ocSpacing: string): number | null {
  const up = mfr.utilityPricing;
  let chart: UtilityChart | undefined;
  if (w >= 32) chart = up.commercial; // CA has none → undefined → null
  else if (ocSpacing === '4oc' && up.residential4OC) chart = up.residential4OC;
  else chart = up.residential5OC;
  if (!chart) return null;

  const heights = chart.cols;
  const lengths = Object.keys(chart.rows)
    .map(Number)
    .sort((a, b) => a - b);

  if (mfr.key === 'CA') {
    // CA: interpolate/extrapolate in BOTH dimensions.
    const priceAtHeight = (lengthKey: number): number => {
      const row = chart!.rows[lengthKey];
      const hIdx = heights.indexOf(h);
      if (hIdx >= 0) return row[hIdx];
      if (h <= heights[0]) return row[0];
      if (h >= heights[heights.length - 1]) {
        const n = heights.length;
        const rate = (row[n - 1] - row[n - 2]) / (heights[n - 1] - heights[n - 2]);
        return Math.round(row[n - 1] + rate * (h - heights[n - 1]));
      }
      for (let i = 0; i < heights.length - 1; i++) {
        if (h >= heights[i] && h <= heights[i + 1]) {
          const span = heights[i + 1] - heights[i];
          return Math.round(row[i] + ((h - heights[i]) / span) * (row[i + 1] - row[i]));
        }
      }
      return 0;
    };
    if (chart.rows[encL]) return priceAtHeight(encL);
    if (encL < lengths[0]) return Math.round((priceAtHeight(lengths[0]) * encL) / lengths[0]);
    if (encL > lengths[lengths.length - 1]) {
      const lastL = lengths[lengths.length - 1];
      const prevL = lengths[lengths.length - 2];
      const pLast = priceAtHeight(lastL);
      const pPrev = priceAtHeight(prevL);
      const rate = (pLast - pPrev) / (lastL - prevL);
      return Math.round(pLast + rate * (encL - lastL));
    }
    for (let i = 0; i < lengths.length - 1; i++) {
      if (encL >= lengths[i] && encL <= lengths[i + 1]) {
        const span = lengths[i + 1] - lengths[i];
        const p1 = priceAtHeight(lengths[i]);
        const p2 = priceAtHeight(lengths[i + 1]);
        return Math.round(p1 + ((encL - lengths[i]) / span) * (p2 - p1));
      }
    }
    return 0;
  }

  // CCI: snap height to nearest column (round up within range), interpolate length.
  let hIdx = heights.indexOf(h);
  if (hIdx < 0) {
    if (h < heights[0]) hIdx = 0;
    else if (h > heights[heights.length - 1]) hIdx = heights.length - 1;
    else {
      for (let i = 0; i < heights.length; i++) {
        if (heights[i] >= h) {
          hIdx = i;
          break;
        }
      }
    }
  }
  if (chart.rows[encL]) return chart.rows[encL][hIdx];
  if (encL < lengths[0]) return Math.round((chart.rows[lengths[0]][hIdx] * encL) / lengths[0]);
  if (encL > lengths[lengths.length - 1]) {
    const lastL = lengths[lengths.length - 1];
    const prevL = lengths[lengths.length - 2];
    const pLast = chart.rows[lastL][hIdx];
    const pPrev = chart.rows[prevL][hIdx];
    const rate = (pLast - pPrev) / (lastL - prevL);
    return Math.round(pLast + rate * (encL - lastL));
  }
  for (let i = 0; i < lengths.length - 1; i++) {
    if (encL >= lengths[i] && encL <= lengths[i + 1]) {
      const span = lengths[i + 1] - lengths[i];
      const p1 = chart.rows[lengths[i]][hIdx];
      const p2 = chart.rows[lengths[i + 1]][hIdx];
      return Math.round(p1 + ((encL - lengths[i]) / span) * (p2 - p1));
    }
  }
  return 0;
}

/**
 * Vertical wall upgrade (only ≤30' builds — wide-span is already vertical).
 * Charges per closed wall only. Builder `gVertUpgrade` line 4007.
 */
export function gVertUpgrade(config: PricingConfig, mfr: MfrConfig): number {
  if (config.buildingType === 'widespan') return 0;
  // 32'+ wide buildings are vertical-walled as standard (commercial) — the
  // vertical orientation is included, NOT an upcharge. (Also avoids extrapolating
  // the 12'–30' VERT_END/VERT_SIDE tables off their range.)
  if ((config.width || 0) >= 32) return 0;
  if (config.wallStyle !== 'Vertical') return 0;
  let w = config.width || 0;
  const h = config.height || 6;
  const l = config.length || 0;
  if (!w || !l) return 0;
  w = evenW(w);

  let t = 0;
  const numSidesClosed = (config.rightEave === 'Closed' ? 1 : 0) + (config.leftEave === 'Closed' ? 1 : 0);
  if (numSidesClosed > 0) {
    if (mfr.vertSideCombined) t += Math.round((vertSideUpcharge(h, l) * numSidesClosed) / 2);
    else t += vertSideUpcharge(h, l) * numSidesClosed;
  }
  if (config.frontGable === 'Closed' || config.frontGable === 'Gable Only') t += vertEndUpcharge(w, mfr.vertEnd);
  if (config.backGable === 'Closed' || config.backGable === 'Gable Only') t += vertEndUpcharge(w, mfr.vertEnd);
  return Math.round(t);
}

/**
 * Gable ends + side closure + GCH utility storage. Builder `gWalls` line 4029.
 */
export function gWalls(config: PricingConfig, mfr: MfrConfig): number {
  let w = config.width || 0;
  const h = config.height || 6;
  const l = config.length || 0;
  if (!w || !l) return 0;
  w = evenW(w);

  let t = 0;
  const { frontGable: fgv, backGable: bgv, rightEave: rev, leftEave: lev } = config;
  const gablP = mfr.gableOnlyPrice || 300;
  const halfP = mfr.halfGablePrice || 0;

  // Gables (front + back).
  if (fgv === 'Closed') t += ecLookup(w, h, mfr);
  else if (fgv === 'Gable Only') t += gablP;
  else if (fgv === 'Half Closed') t += halfP;
  if (bgv === 'Closed') t += ecLookup(w, h, mfr);
  else if (bgv === 'Gable Only') t += gablP;
  else if (bgv === 'Half Closed') t += halfP;

  if (config.buildingType === 'gch') {
    const encL = config.gchEnclosedLength || 0;
    if (encL > 0) {
      let sideOpenCount = 0;
      if (rev === 'Closed') t += scLookup(h, l, w, mfr);
      else sideOpenCount++;
      if (lev === 'Closed') t += scLookup(h, l, w, mfr);
      else sideOpenCount++;
      // Internal divider end wall — always.
      t += ecLookup(w, h, mfr);
      if (sideOpenCount > 0) {
        let utilSidesPair = utilitySides(mfr, w, h, encL, config.ocSpacing || '5oc');
        if (utilSidesPair === null || utilSidesPair === 0) {
          utilSidesPair = scLookup(h, encL, w, mfr); // CA ≥32' fallback
        }
        t += Math.round((utilSidesPair * sideOpenCount) / 2);
      }
    }
  } else {
    if (rev === 'Closed') t += scLookup(h, l, w, mfr);
    if (lev === 'Closed') t += scLookup(h, l, w, mfr);
  }
  return Math.round(t);
}

// L-Trim on gable ends — charged only on HORIZONTAL gable panels (vertical
// gables include trim). Source: StormSafe CA/CCI gable-trim price sheet, keyed
// by building width; listed price covers BOTH gables.
const L_TRIM_BOTH_GABLES: ReadonlyArray<readonly [number, number]> = [
  [20, 60], // 12'–20'
  [26, 70], // 22'–26'
  [30, 85], // 28'–30'
  [36, 95], // 32'–36'
  [40, 110], // 38'–40'
];
function lTrimBothGables(w: number): number {
  for (const [maxW, price] of L_TRIM_BOTH_GABLES) if (w <= maxW) return price;
  return L_TRIM_BOTH_GABLES[L_TRIM_BOTH_GABLES.length - 1][1];
}

/**
 * Gable-end L-trim. Only applies with HORIZONTAL siding (vertical gables include
 * trim, and 32'+ builds are always vertical-sided). The sheet price is for both
 * gables, so each sheeted gable end (Closed / Gable Only / Half Closed) bills
 * half — both ends = full sheet price.
 */
export function gableLTrimCost(config: PricingConfig): number {
  if (config.wallStyle !== 'Horizontal') return 0; // vertical → trim included
  if ((config.width || 0) >= 32) return 0; // 32'+ is vertical-sided
  const perGable = lTrimBothGables(config.width || 0) / 2;
  let count = 0;
  for (const g of [config.frontGable, config.backGable]) {
    if (g === 'Closed' || g === 'Gable Only' || g === 'Half Closed') count++;
  }
  return Math.round(perGable * count);
}

/** Lean-to attachment fees (free-standing lean-tos don't connect). Builder line 3837. */
export function gConnectionFees(config: PricingConfig): number {
  const bw = config.width || 0;
  const isWS = bw >= 32 || config.buildingType === 'widespan';
  let total = 0;
  for (const lt of config.leanTos || []) {
    if (lt.attachment === 'freestanding') continue;
    const lw = lt.width || 0;
    const ll = lt.length || 0;
    if (!lw || !ll) continue;
    const connLen = ll; // always the lean-to length (runs along the attached wall)
    const isGable = lt.placement === 'Front Gable' || lt.placement === 'Back Gable';
    if (isWS) {
      total += 300 + Math.ceil(Math.max(0, connLen - 20) / 4) * 25;
    } else if (isGable) {
      total += 700 + Math.ceil(Math.max(0, connLen - 21) / 5) * 25;
    } else {
      total += 100 + Math.ceil(Math.max(0, connLen - 21) / 5) * 25;
    }
  }
  return total;
}
