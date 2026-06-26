/**
 * Secondary line items, ported from the builder:
 *  - gInsul      (line 4231) — Astro-Armour insulation ($1.50/sqft)
 *  - gSidePanels (line 4331) — carport/GCH side panels (+ panelTier)
 *  - gLT         (line 4437) — lean-to body pricing (base + height + walls + accessories)
 *  - gAC         (line 4956) — additional components / framed openings
 */

import type { MfrConfig } from './types';
import type { PricingConfig, LeanTo } from './config';
import { nearestStd, LENGTHS } from './tables';
import { scLookup } from './closures';
import { getDoorPrice } from './openings';

/** Astro-Armour insulation rate, $/sqft. Builder `INSUL_RATE` line 4230. */
const INSUL_RATE = 1.5;

/** Insulation (Vertical-roof buildings). Builder `gInsul` line 4231. */
export function gInsul(config: PricingConfig): number {
  const mode = config.insulation || 'none';
  if (mode === 'none') return 0;
  const w = config.width || 0;
  const l = config.length || 0;
  const h = config.height || 6;
  if (!w || !l) return 0;
  let insulL = l;
  if (config.buildingType === 'gch') {
    const encL = config.gchEnclosedLength || 0;
    if (encL > 0 && encL < l) insulL = encL;
  }
  const roofCost = Math.round((w + 2) * insulL * INSUL_RATE);
  let wallCost = 0;
  if (mode === 'roof-walls') {
    const sideWall = Math.round(insulL * h * 2 * INSUL_RATE);
    const endWall = Math.round(w * (h + 2) * 2 * INSUL_RATE);
    wallCost = sideWall + endWall;
  }
  return roofCost + wallCost;
}

/** Round building length UP to the nearest panel tier. Builder `panelTier` line 2345. */
function panelTier(mfr: MfrConfig, l: number): number {
  const t = mfr.sidePanels?.tiers || [21, 26, 31, 36];
  for (const x of t) if (x >= l) return x;
  return t[t.length - 1];
}

/** Panel length to price against (GCH uses the open-section length). Builder line 4320. */
function sidePanelLength(config: PricingConfig): number {
  if (config.buildingType === 'gch') {
    const o = config.gchOpenLength || 0;
    if (o > 0) return o;
  }
  return config.length || 0;
}

/** Carport/GCH side panels. Builder `gSidePanels` line 4331. */
export function gSidePanels(config: PricingConfig, mfr: MfrConfig): number {
  const bt = config.buildingType;
  if (bt !== 'carport' && bt !== 'gch') return 0;
  const sp = mfr.sidePanels;
  if (!sp) return 0;
  const l = sidePanelLength(config);
  if (l <= 0) return 0;
  const tier = panelTier(mfr, l);
  const spc = config.sidePanels || {};

  if (bt === 'gch') {
    const val = spc.gchPanels ?? 'none';
    if (val === 'none') return 0;
    const sides = spc.gchSides || 'both';
    const revG = config.rightEave || 'Open';
    const levG = config.leftEave || 'Open';
    const applyR = (sides === 'both' || sides === 'right') && revG !== 'Closed';
    const applyL = (sides === 'both' || sides === 'left') && levG !== 'Closed';
    const activeSides = (applyR ? 1 : 0) + (applyL ? 1 : 0);
    if (activeSides === 0) return 0;
    if (val === 'full') {
      const openL2 = config.gchOpenLength || 0;
      const hG = config.height || 0;
      const wG = config.width || 0;
      if (!openL2 || !hG || !wG) return 0;
      return scLookup(hG, openL2, wG, mfr) * activeSides;
    }
    if (val === 'half') return Math.round((sp.halfTrim[tier] || 0) * (activeSides / 2));
    const qty = typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
    return qty * activeSides * (sp.full[tier] || 0);
  }

  // carport
  const qty = spc.qty || 0;
  const isHalf = !!spc.half;
  const sides = spc.sides || 'both';
  const sideMult = sides === 'both' ? 2 : 1;
  let total = qty * sideMult * (sp.full[tier] || 0);
  if (isHalf) total += Math.round((sp.halfTrim[tier] || 0) * (sideMult / 2));
  return total;
}

// ── Lean-tos ─────────────────────────────────────────────────────────────────

/** Lean-to base price: $7.00/sqft. Builder `ltBasePrice` line 4433. */
function ltBasePrice(w: number, l: number): number {
  return Math.round(w * l * 7.0);
}

// Lean-to wall option prices (builder lines 4714–4715).
const LT_END_P: Record<string, number> = { open: 0, gable: 150, closed: 200 };
const LT_SIDE_P: Record<string, number> = {
  open: 0,
  '1panel': 100,
  '2panel': 200,
  '3panel': 300,
  q1: 175,
  q2: 350,
  q3: 525,
  closed: 700,
};

/** Resolve lean-to wall prices from its mode/per-wall settings. Builder `getLTWalls` line 4716. */
function getLTWalls(lt: LeanTo): { frontP: number; backP: number; sideP: number } {
  const mode = lt.wallMode || 'open';
  const fv = mode === 'enclosed' ? 'closed' : mode === 'custom' ? lt.frontWall || 'open' : 'open';
  const bv = mode === 'enclosed' ? 'closed' : mode === 'custom' ? lt.backWall || 'open' : 'open';
  const sv = mode === 'enclosed' ? 'closed' : mode === 'custom' ? lt.sideWall || 'open' : 'open';
  return { frontP: LT_END_P[fv] || 0, backP: LT_END_P[bv] || 0, sideP: LT_SIDE_P[sv] || 0 };
}

/** Lean-to total: base + height adj + enclosure + accessories. Builder `gLT` line 4437. */
export function gLT(config: PricingConfig, mfr: MfrConfig): number {
  let t = 0;
  for (const lt of config.leanTos || []) {
    const w = lt.width || 0;
    const l = lt.length || 0;
    if (!w || !l) continue;
    const isFree = lt.attachment === 'freestanding';
    const h = isFree ? lt.tallHeight || 10 : lt.height || 6;

    const bp = ltBasePrice(w, l);

    // Height adjustment: CA SH (leg) table for nearest std width, halved.
    let heightAdj = 0;
    if (h > 6) {
      const ltW2 = w <= 12 ? 12 : w <= 14 ? 14 : w <= 16 ? 16 : w <= 18 ? 18 : 20;
      const hk = h <= 16 ? h : h <= 18 ? 18 : 20;
      const huT2 = ltW2 <= 24 ? mfr.huN : mfr.huM;
      const shCol = l <= 40 ? nearestStd(l) : 41;
      const li2 = LENGTHS.indexOf(shCol);
      let shFull = li2 >= 0 ? (huT2[hk] || huT2[16] || [])[li2] || 0 : 0;
      if (l > 40 && shFull) {
        const sh20 = (huT2[hk] || huT2[16] || [])[LENGTHS.indexOf(21)] || 0;
        const sh40 = (huT2[hk] || huT2[16] || [])[LENGTHS.indexOf(41)] || 0;
        shFull = Math.round(sh40 + ((sh40 - sh20) / 20) * (l - 40));
      }
      heightAdj = Math.round(shFull / 2);
    }

    const walls = getLTWalls(lt);
    const encAdj = walls.frontP + walls.backP + walls.sideP;

    let accAdj = 0;
    for (const ae of lt.accessories || []) {
      const atype = ae.type || 'rollup';
      const aqty = ae.qty || 1;
      if (atype === 'rollup') {
        const asz = ae.size || '9x8';
        accAdj += getDoorPrice('standard', asz) * aqty;
        accAdj += (ae.chainHoistQty || 0) * (mfr.chain || 325);
        const sealDw = parseInt((asz || '').split('x')[0], 10) || 0;
        accAdj += (ae.headerSealQty || 0) * Math.round(sealDw * (mfr.seal || 9.85));
      } else if (atype === 'wtd') {
        accAdj += aqty * (mfr.wtdPrices[ae.wtdType || 'std'] ?? mfr.wtd_std ?? 300);
      } else if (atype === 'win') {
        accAdj += aqty * (mfr.winPrices[ae.winType || 'std'] ?? mfr.win_std ?? 200);
      }
    }
    t += bp + heightAdj + encAdj + accAdj;
  }
  return t;
}

/** Additional components / framed openings. Builder `gAC` line 4956. */
export function gAC(config: PricingConfig, mfr: MfrConfig): number {
  let t = 0;
  for (const c of config.additionalComponents || []) {
    const comp = c.label;
    const qty = c.qty || 1;
    let unitP = mfr.acPrices[comp] !== undefined ? mfr.acPrices[comp] : 0;
    if (comp === 'Custom — see notes' || comp.indexOf('(Custom Size)') >= 0) unitP = c.customPrice || 0;
    t += unitP * qty;
  }
  return t;
}
