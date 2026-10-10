/**
 * CCI wide-span CONNECTED UNITS + the 62'–100' HEIGHT chart — ported from the builder
 * (public/quote-builder.html: cciWideOn / cciWideUnits / cciWideUnitSum / cciWideHeight).
 *
 * CCI prices anything longer than its 52' charts as connected units of at most 52' on the
 * charts' 4' columns, split as evenly as possible, lengths between columns rounding UP:
 * CCI Dealer Handbook p6 "32W-60W Combinations" (56 = 28+28 … 104 = 52+52, 108 = 36+36+36,
 * 112 = 36+36+40, 116 = 36+40+40, 120 = 40+40+40) and Sensei (70x110 = 36+36+40,
 * 100x200 = 52+52+48+48). Past 120' the handbook lists no combinations — same rule extended.
 *
 * Where the program uses it:
 *  - 62'–100' wide (CCI "Pricing for 62'-100' Buildings", 4/30/26): base, height, sides at every length.
 *  - 32'–60' wide (10/9/26): base, legs, sides and 12-gauge at every length (base up to 104' via the
 *    combLen pairs = the handbook pairs).
 */

import type { MfrConfig } from './types';
import { SHARED } from './data';

/** The 4' length columns every CCI wide-span chart uses (20'..52'). */
export const CCI_WIDE_COLS = [20, 24, 28, 32, 36, 40, 44, 48, 52];

/** CCI 62'–100' wide (sheet 4/30/26) — widths 61–100 (odd widths price as the next even). */
export function cciWideOn(mfr: Pick<MfrConfig, 'key'> | null | undefined, w: number): boolean {
  return !!mfr && mfr.key === 'CCI' && w >= 61 && w <= 100;
}

/** Connected units (feet) for a building length — units ≤ 52', on 4' columns, as even as possible. */
export function cciWideUnits(L: number): number[] {
  const l4 = Math.max(20, Math.ceil(L / 4) * 4);
  const n = Math.ceil(l4 / 52);
  const steps = l4 / 4;
  const base = Math.floor(steps / n);
  const extra = steps % n;
  const u: number[] = [];
  for (let i = 0; i < n; i++) u.push((base + (i < extra ? 1 : 0)) * 4);
  return u;
}

/** A chart row (columns 20'..52' by 4') summed over the connected units of length L. */
export function cciWideUnitSum(L: number, row: number[]): number {
  return cciWideUnits(L).reduce((s, u) => s + (row[(u - 20) / 4] || 0), 0);
}

/**
 * 62'–100' wide leg HEIGHT (sheet p3, by length, width-independent). Odd heights round UP;
 * 8' and under = $0 (base building); over 24' = the 24' row.
 */
export function cciWideHeight(h: number, l: number): number {
  if (!(h > 8) || !l) return 0;
  const hk = Math.min(24, Math.max(10, Math.ceil(h / 2) * 2));
  return cciWideUnitSum(l, SHARED.CCI_WIDE_H.rows[hk]);
}

/**
 * CCI 32'–60' wide 12-GAUGE framing — Price Book 2 p6 (FL Commercial 170 MPH, "OPTIONS"): 12 Gauge 20' $840 ·
 * 24' $960 · 28' $1,080 · 32' $1,200 · 36' $1,320 · 40' $1,440 · 44' $1,560 · 48' $1,680 · 52' $1,800; per
 * connected unit past 52' (handbook p6). Builder `cciCom12GA` (10/9/26; it was the CA book series).
 */
export const CCI_COM_12GA = [840, 960, 1080, 1200, 1320, 1440, 1560, 1680, 1800];
export function cciCom12GA(l: number): number {
  return l ? cciWideUnitSum(l, CCI_COM_12GA) : 0;
}

/** 62'–100' gable-only (per end) by width band: 62-70 $1,050 · 72-80 $1,200 · 82-90 $1,350 · 92-100 $1,500. */
/** CCI 32'–60' wide "Gable End" per end (Price Book 2 p6): 32'–40' $600 · 42'–50' $750 · 52'–60' $900 (10-9b audit M3/M7). */
export function cciComGableEnd(w: number): number {
  const we = w % 2 === 1 ? w + 1 : w;
  return we <= 40 ? 600 : we <= 50 ? 750 : 900;
}

export function cciWideGableOnly(w: number): number {
  const we = w % 2 === 1 ? w + 1 : w;
  return we <= 70 ? 1050 : we <= 80 ? 1200 : we <= 90 ? 1350 : 1500;
}
