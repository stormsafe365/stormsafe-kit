/**
 * Door & window pricing, ported from the builder:
 *  - getDoorPrice / doorHasChainIncluded / doorNeedsLift (lines 4086–4149)
 *  - gRUD (line 4151) — roll-up doors (+ hoist, seal, 45° cut, color, eave header)
 *  - gWTD (line 4198) — walk-through doors
 *  - gWIN (line 4211) — windows
 */

import type { MfrConfig } from './types';
import type { PricingConfig, RollUpType } from './config';
import { SHARED } from './data';
import { eaveHeaderCost } from './closures';

const { RDP_STD, RDP_CHAIN, RDP_HI, HI_LIFT_WIDTHS, HI_LIFT_HEIGHTS } = SHARED;

/** Side-frame area rate, $/sqft (builder `window._sf_dw`, constant 425). */
const SF_DW = 425;

/** Unit price for a roll-up door (type, size). Builder `getDoorPrice` line 4086.
 *  Pass `mfr` so a manufacturer certified sheet (CA July 15, 2026 `certRud`)
 *  can override the shared tables; hi-impact keeps its own chart. */
export function getDoorPrice(type: RollUpType, size: string, mfr?: MfrConfig): number {
  // CA Master Price Book 7/16/26: four-line door catalog.
  if (mfr?.rudCatalog && mfr.rudCatalog[type]) return mfr.rudCatalog[type].prices[size] || 0;
  if (type === 'standard') return RDP_STD[size] || 0;
  if (type === 'chain') return RDP_CHAIN[size] || RDP_CHAIN['*' + size] || 0;
  if (type === 'hiimpact') return RDP_HI[size] || RDP_HI['*' + size] || 0;
  if (type === 'rollup') {
    if (RDP_STD[size]) return RDP_STD[size];
    return RDP_CHAIN[size] || RDP_CHAIN['*' + size] || 0;
  }
  return 0;
}

/** Does this (type,size) already include a chain hoist? Builder line 4101. */
export function doorHasChainIncluded(type: RollUpType, size: string, mfr?: MfrConfig): boolean {
  // CA catalog: m750 none · m3652 included above 10x10 · m3100/m3100im always.
  const line = mfr?.rudCatalog?.[type];
  if (line) {
    if (line.hoist === 'incl') return true;
    if (line.hoist === 'none') return false;
    const [w, h] = (size || '').split('x').map((n) => parseInt(n, 10) || 0);
    return w > 10 || h > 10;
  }
  if (type === 'hiimpact') return true;
  if (type === 'chain') return true;
  if (type === 'rollup') {
    if (RDP_STD[size]) return false;
    return !!(RDP_CHAIN[size] || RDP_CHAIN['*' + size]);
  }
  return false;
}

/** Does this (type,size) need a lift on site? Builder `doorNeedsLift` line 4138. */
export function doorNeedsLift(type: RollUpType, size: string, mfr?: MfrConfig): boolean {
  // CA Master Price Book: Genie lift at 14'+ tall or 16'+ wide (any line).
  if (mfr?.rudCatalog?.[type]) {
    const [w, h] = (size || '').split('x').map((n) => parseInt(n, 10) || 0);
    return h >= 14 || w >= 16;
  }
  if (type === 'standard') return false;
  if (type === 'chain') return !!RDP_CHAIN['*' + size];
  if (type === 'rollup') {
    if (RDP_STD[size]) return false;
    return !!RDP_CHAIN['*' + size];
  }
  if (type === 'hiimpact') {
    const [pw, ph] = size.split('x').map((n) => parseInt(n, 10));
    return HI_LIFT_WIDTHS.indexOf(pw) >= 0 || HI_LIFT_HEIGHTS.indexOf(ph) >= 0;
  }
  return false;
}

/** Roll-up doors total. Builder `gRUD` line 4151. */
export function gRUD(config: PricingConfig, mfr: MfrConfig): number {
  let t = 0;
  const bldgW = config.width || 0;
  for (const d of config.rollUpDoors || []) {
    const dtype = d.type || 'standard';
    const sz = d.size;
    const qty = d.qty || 0;
    const ea = d.location === 'Left Eave Side' || d.location === 'Right Eave Side';

    t += getDoorPrice(dtype, sz, mfr) * qty;

    // Chain-hoist add-on — only where a hoist is offered and not already included.
    const catLine = mfr.rudCatalog?.[dtype];
    const hoistAddable = catLine
      ? catLine.hoist === 'small-add' && !doorHasChainIncluded(dtype, sz, mfr)
      : dtype === 'standard' || (dtype === 'rollup' && !doorHasChainIncluded(dtype, sz, mfr));
    if (hoistAddable) {
      t += (d.chainHoistQty || 0) * (mfr.chain || 325);
    }
    // Header seal: rate × door-width-ft.
    const sealDw = parseInt((sz || '').split('x')[0], 10) || 0;
    t += (d.headerSealQty || 0) * Math.round(sealDw * (mfr.seal || 9.85));
    // Automatic opener — CCI only: $1,100/door, $1,200 for 12'+ doors (either
    // dimension ≥12; owner 8/17/26 — resolves CCI's corrected Tejada 16x16
    // bundle exactly: 2700 + seal 192 + opener 1200 + black 100 = 4192).
    if (mfr.key === 'CCI') {
      const odw = parseFloat((sz || '').split('x')[0]) || 0;
      const odh = parseFloat((sz || '').split('x')[1]) || 0;
      t += (d.openerQty || 0) * (odw >= 12 || odh >= 12 ? 1200 : 1100);
    }
    // 45° angle cut: $85/door.
    if (d.angle45) t += 85 * qty;
    // CCI color upgrade.
    if (d.color && mfr.rudColors) {
      const rc = mfr.rudColors.find((c) => c.v === d.color);
      if (rc && rc.price) t += rc.price * qty;
    }
    // Eave-side structural header.
    if (ea) {
      const doorW = parseInt((sz || '').split('x')[0], 10) || 0;
      t += eaveHeaderCost(doorW, bldgW) * qty;
    }
  }
  return t;
}

/** Walk-through doors total (+ side-frame sqft). Builder `gWTD` line 4198. */
export function gWTD(config: PricingConfig, mfr: MfrConfig): { wtd: number; sf: number } {
  let t = 0;
  let sf = 0;
  for (const wd of config.walkDoors || []) {
    const qty = wd.qty || 0;
    t += qty * (mfr.wtdPrices[wd.type] ?? mfr.wtd_std ?? 400);
    sf += wd.sideFrameSqFt || 0;
  }
  return { wtd: t, sf: sf * SF_DW };
}

/** Windows total (+ side-frame sqft). Builder `gWIN` line 4211. */
export function gWIN(config: PricingConfig, mfr: MfrConfig): { win: number; sf: number } {
  let t = 0;
  let sf = 0;
  for (const win of config.windows || []) {
    const qty = win.qty || 0;
    t += qty * (mfr.winPrices[win.type] ?? mfr.win_std ?? 200);
    sf += win.sideFrameSqFt || 0;
  }
  return { win: t, sf: sf * SF_DW };
}
