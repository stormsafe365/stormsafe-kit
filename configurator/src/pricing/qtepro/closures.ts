/**
 * Closure & wall-upgrade lookups, ported from the builder.
 *  - ecLookup        (line 3867) — each-end close, per end
 *  - scLookup        (line 3884) — side close, per side
 *  - eaveHeaderCost  (line 4123) — structural header for an eave-side roll-up
 *  - vertSideUpcharge/vertEndUpcharge (lines 3975/3988) — Vertical wall upgrade
 *
 * Some wide-span tables (SHT/BSC) are embedded INSIDE the builder's functions
 * (not module globals) — those are transcribed inline here, exactly as written.
 */

import type { MfrConfig } from './types';
import { SHARED } from './data';

const { EC, SC, EXT_BSC_30, EXT_L, CCI_WIDE_SC, CCI_WIDE_EC } = SHARED;

/** Bucket a standard width to an EC column. Builder `eBkt` line 3866. */
function eBkt(w: number): number {
  return w <= 12 ? 12 : w <= 18 ? 18 : w <= 20 ? 20 : w <= 22 ? 22 : w <= 24 ? 24 : w <= 26 ? 26 : w <= 28 ? 28 : 30;
}

/** CCI 62'–100' each-end close, per END. Builder `cciWideEC` line 3274. */
function cciWideEC(w: number, h: number): number {
  let weven = w % 2 === 0 ? w : w + 1;
  weven = Math.max(62, Math.min(100, weven));
  const row = CCI_WIDE_EC.rows[weven];
  if (!row) return 0;
  const cols = CCI_WIDE_EC.cols;
  let heven = h % 2 === 0 ? h : h + 1;
  heven = Math.max(8, Math.min(24, heven));
  let hi = cols.indexOf(heven);
  if (hi < 0) hi = cols.length - 1;
  return row[hi] || 0;
}

/** CCI 62'–100' side close, BOTH sides combined (caller halves). Builder line 3235. */
function cciWideSCBothSides(h: number, l: number, commercialBase?: MfrConfig['commercialBase']): number {
  let heven = h % 2 === 0 ? h : h + 1;
  heven = Math.max(8, Math.min(24, heven));
  const row = CCI_WIDE_SC.rows[heven];
  if (!row) return 0;
  const cols = CCI_WIDE_SC.cols;

  const idx = cols.indexOf(l);
  if (idx >= 0) return row[idx];

  const cb = commercialBase;
  if (l > 52 && l <= 104 && cb && cb.combLen) {
    if (cb.combLen[l]) {
      const pair = cb.combLen[l];
      const i1 = cols.indexOf(pair[0]);
      const i2 = cols.indexOf(pair[1]);
      if (i1 >= 0 && i2 >= 0) return row[i1] + row[i2];
    }
    const combLens = Object.keys(cb.combLen)
      .map(Number)
      .sort((a, b) => a - b);
    for (const k of combLens) {
      if (l <= k) {
        const p2 = cb.combLen[k];
        const c1 = cols.indexOf(p2[0]);
        const c2 = cols.indexOf(p2[1]);
        if (c1 >= 0 && c2 >= 0) return row[c1] + row[c2];
      }
    }
  }
  if (l > 104) {
    const p104 = row[cols.indexOf(52)] * 2;
    const pRem = cciWideSCBothSides(h, l - 104, commercialBase);
    return p104 + pRem;
  }
  for (let c = 0; c < cols.length; c++) {
    if (cols[c] >= l) return row[c];
  }
  return row[cols.length - 1];
}

/**
 * Each-end close, per END (Closed gable). Builder `ecLookup` line 3867.
 */
export function ecLookup(w: number, h: number, mfr: MfrConfig): number {
  if (mfr.key === 'CCI' && w >= 62 && w <= 100) return cciWideEC(w, h);
  if (mfr.key === 'CA' && w >= 62 && w <= 70) {
    if (w === 70 && h === 20) return 6115;
    return 0;
  }
  // Widths 12–30 use bucketed width; 32–60 use actual even width (odd → next even).
  let wk = w >= 32 ? (w % 2 === 0 ? w : w + 1) : eBkt(w);
  wk = Math.min(Math.max(wk, 12), 60);
  // Standard widths price ends to 16' tall; wide-span (32+) charts go to 20'.
  const hk = Math.min(h, w >= 32 ? 20 : 16);
  return (EC[wk] || EC[30])[hk] || 0;
}

// Wide-span both-sides side-close table (embedded in scLookup, builder line 3901).
const BSC: Record<number, number[]> = {
  8: [1030, 1235, 1440, 1645, 1850, 2050, 2255, 2460, 2665],
  10: [1175, 1405, 1630, 1870, 2100, 2350, 2580, 2810, 3035],
  12: [1320, 1585, 1850, 2110, 2375, 2640, 2905, 3170, 3430],
  14: [1465, 1755, 2050, 2340, 2635, 2930, 3220, 3515, 3805],
  16: [2040, 2450, 2855, 3265, 3670, 4080, 4490, 4895, 5305],
  18: [2470, 2970, 3460, 3955, 4450, 4945, 5440, 5935, 6425],
  20: [2905, 3485, 4065, 4645, 5225, 5810, 6390, 6970, 7550],
};
const SH_COLS = [20, 24, 28, 32, 36, 40, 44, 48, 52];
const SC_COLS = [20, 25, 30, 35, 40];

/**
 * Side close, per SIDE (Closed eave side). Builder `scLookup` line 3884.
 * Returns the per-side price (wide-span tables are both-sides and halved).
 */
export function scLookup(h: number, l: number, w: number, mfr: MfrConfig): number {
  let w2 = w || 0;
  if (w2 % 2 === 1) w2++;

  if (mfr.key === 'CCI' && w2 >= 62 && w2 <= 100) {
    const both = cciWideSCBothSides(h, l, mfr.commercialBase);
    return Math.round(both / 2);
  }
  if (mfr.key === 'CA' && w2 >= 62 && w2 <= 70) {
    if (w2 === 70 && l === 110 && h === 20) return 7839;
    return 0;
  }

  const hk = h <= 8 ? 8 : h <= 10 ? 10 : h <= 12 ? 12 : h <= 14 ? 14 : h <= 16 ? 16 : h <= 18 ? 18 : 20;

  // Wide span (32–60ft): BSC table, per-side (BSC/2).
  if (w2 >= 32) {
    if (l > mfr.shExtThresh) {
      const ebRow = mfr.extBsc[hk] || mfr.extBsc[16] || [];
      let ebI = ebRow.length - 1;
      for (let ebi = 0; ebi < EXT_L.length; ebi++) {
        if (EXT_L[ebi] >= l) {
          ebI = ebi;
          break;
        }
      }
      let ebVal = ebRow[ebI] || 0;
      if (l > 100) {
        const ebRate = (ebRow[ebRow.length - 1] - ebRow[ebRow.length - 2]) / (EXT_L[EXT_L.length - 1] - EXT_L[EXT_L.length - 2]);
        ebVal = Math.round(ebRow[ebRow.length - 1] + ebRate * (l - 100));
      }
      return Math.round(ebVal / 2);
    }
    const bscIdx = mfr.shIndexByLength ? l : w2;
    let ci: number;
    if (mfr.shIndexByLength) {
      ci = SH_COLS.length - 1;
      for (let i = 0; i < SH_COLS.length; i++) {
        if (SH_COLS[i] >= bscIdx) {
          ci = i;
          break;
        }
      }
    } else {
      ci = 0;
      for (let i = 0; i < SH_COLS.length; i++) {
        if (SH_COLS[i] <= bscIdx) ci = i;
        else break;
      }
    }
    let bscVal = (BSC[hk] || BSC[16] || [])[ci] || 0;
    if (w2 > 52 && ci === SH_COLS.length - 1) {
      const bscPrev = (BSC[hk] || BSC[16] || [])[ci - 1] || 0;
      const bscRate = (bscVal - bscPrev) / (SH_COLS[ci] - SH_COLS[ci - 1]);
      bscVal = Math.round(bscVal + bscRate * (w2 - SH_COLS[ci]));
    }
    return Math.round(bscVal / 2);
  }

  // Standard (12–30ft): SC table for l≤40, EXT_BSC_30 for w=30 l>40.
  if (l > 40 && w2 === 30 && EXT_BSC_30[hk]) {
    const ebr30 = EXT_BSC_30[hk];
    let ebi30 = ebr30.length - 1;
    for (let ei = 0; ei < EXT_L.length; ei++) {
      if (EXT_L[ei] >= l) {
        ebi30 = ei;
        break;
      }
    }
    let ebv30 = ebr30[ebi30] || 0;
    if (l > 100) {
      const rate30 = (ebr30[ebr30.length - 1] - ebr30[ebr30.length - 2]) / (EXT_L[EXT_L.length - 1] - EXT_L[EXT_L.length - 2]);
      ebv30 = Math.round(ebr30[ebr30.length - 1] + rate30 * (l - 100));
    }
    return Math.round(ebv30 / 2);
  }

  let sc_ci = SC_COLS.length - 1;
  for (let sci = 0; sci < SC_COLS.length; sci++) {
    if (SC_COLS[sci] >= l) {
      sc_ci = sci;
      break;
    }
  }
  let scVal = (SC[hk] || SC[16])[SC_COLS[sc_ci]] || 0;
  if (l > 40) {
    const scBase = (SC[hk] || SC[16])[20] || 0;
    const sc40v = (SC[hk] || SC[16])[40] || 0;
    const scRate = (sc40v - scBase) / 20;
    scVal = Math.round(sc40v + scRate * (l - 40));
  }
  return Math.round(scVal / 2);
}

/**
 * Structural-header cost for a roll-up door on an eave (side) wall.
 * Builder `eaveHeaderCost` line 4123 — width-bucketed by DOOR width.
 */
export function eaveHeaderCost(doorWidthFt: number, bldgWidthFt: number): number {
  const dw = Math.trunc(doorWidthFt) || 0;
  const bw = Math.trunc(bldgWidthFt) || 0;
  if (dw <= 0) return 0;
  if (bw >= 32) {
    if (dw <= 4) return 360;
    if (dw <= 16) return 425;
    return 850;
  }
  if (dw <= 12) return 200;
  if (dw <= 16) return 360;
  return 720;
}

// ── Vertical wall upgrade (≤30' builds; wide-span is already vertical) ────────

// Per-side upcharge by [height bucket][length bucket]. Builder `VERT_SIDE` line 3964.
const VERT_SIDE: Record<'low' | 'mid' | 'high', Record<number, number>> = {
  low: { 20: 360, 25: 420, 30: 480, 35: 540, 40: 600 }, // 6'–10' tall
  mid: { 20: 480, 25: 570, 30: 660, 35: 750, 40: 840 }, // 11'–15' tall
  high: { 20: 600, 25: 720, 30: 840, 35: 960, 40: 1080 }, // 16' tall
};

/** Per closed side wall, by height & length (extrapolates past 40'). Builder line 3975. */
export function vertSideUpcharge(h: number, l: number): number {
  const bucket = h <= 10 ? 'low' : h <= 15 ? 'mid' : 'high';
  const row = VERT_SIDE[bucket];
  let lk: number;
  if (l <= 20) lk = 20;
  else if (l <= 25) lk = 25;
  else if (l <= 30) lk = 30;
  else if (l <= 35) lk = 35;
  else if (l <= 40) lk = 40;
  else {
    const rate = (row[40] - row[35]) / 5;
    return Math.round(row[40] + rate * (l - 40));
  }
  return row[lk];
}

/** Per closed/gable-only end, by width (interpolates). Builder `vertEndUpcharge` line 3988. */
export function vertEndUpcharge(w: number, vertEnd: Record<number, number>): number {
  if (vertEnd[w]) return vertEnd[w];
  const widths = Object.keys(vertEnd)
    .map(Number)
    .sort((a, b) => a - b);
  for (let i = 0; i < widths.length - 1; i++) {
    if (w > widths[i] && w < widths[i + 1]) {
      const lo = widths[i];
      const hi = widths[i + 1];
      const rate = (vertEnd[hi] - vertEnd[lo]) / (hi - lo);
      return Math.round(vertEnd[lo] + rate * (w - lo));
    }
  }
  if (w < widths[0]) return vertEnd[widths[0]];
  return vertEnd[widths[widths.length - 1]];
}
