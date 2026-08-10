/**
 * Quote composition — the pure equivalent of the builder's `rc()` master recalc
 * (line 5139), minus all DOM/display side-effects. Sums every line item, applies
 * the free-sheeting / free-fastener thresholds, then discount → tax → deposit /
 * balance, and computes the permit plan cost (invoiced separately).
 *
 * Also ports the rc()-inline upcharges: 12-ga framing, 4'OC spacing, roof pitch,
 * wainscot, overhang, plan cost (the per-MFR pitchUpgradeFn/wainscotBuckets/
 * overhangBucket/planCostFn from MANUFACTURERS lines 2345–2795).
 */

import type { MfrConfig, MfrKey } from './types';
import type { PricingConfig, Pitch } from './config';
import { applyBuildingRules } from './rules';
import { gBase } from './engine';
import { gLeg, gVertUpgrade, gWalls, gConnectionFees, gableLTrimCost } from './shell';
import { gRUD, gWTD, gWIN } from './openings';
import { gInsul, gSidePanels, gLT, gAC } from './extras';

export interface QuoteLineItems {
  base: number;
  leg: number;
  framingUpgrade: number;
  ocUpgrade: number;
  pitchUpgrade: number;
  walls: number;
  vertWallUpgrade: number;
  gableLTrim: number;
  rollUpDoors: number;
  walkDoors: number;
  windows: number;
  sideFrame: number;
  lapSiding: number;
  sheetingUpgrade: number;
  wainscot: number;
  leanTos: number;
  connectionFees: number;
  additionalComponents: number;
  insulation: number;
  fasteners: number;
  overhang: number;
  sidePanels: number;
}

export interface PricedQuote {
  manufacturer: MfrKey;
  lineItems: QuoteLineItems;
  subtotal: number;
  discountPct: number;
  discount: number;
  afterDiscount: number;
  taxRatePct: number;
  taxExempt: boolean;
  tax: number;
  total: number;
  depositPct: number;
  /** Gross deposit before any additional deposit-only discount. */
  grossDeposit: number;
  additionalDiscount: number;
  deposit: number;
  balance: number;
  /** Displayed grand total (total − additional deposit discount). */
  displayedTotal: number;
  splitPayment: { half: number; remainder: number } | null;
  /** Permit plan cost — invoiced separately, NOT part of `total`. */
  planCost: number;
  sheetingFree: boolean;
  fastenerFree: boolean;
}

// ── rc()-inline upcharges ────────────────────────────────────────────────────

/** 12-ga framing upgrade. Builder rc() line 5158. */
function framingUpgradeCost(config: PricingConfig): number {
  if (config.framingGauge !== '12') return 0;
  const w = config.width || 0;
  const l = config.length || 0;
  if (config.buildingType === 'widespan') {
    const GA12C = [20, 24, 28, 32, 36, 40, 44, 48, 52];
    const GA12V = [840, 960, 1080, 1200, 1320, 1440, 1560, 1680, 1800];
    let gci = 0;
    for (let gi = 0; gi < GA12C.length; gi++) {
      if (GA12C[gi] <= l) gci = gi;
      else break;
    }
    return GA12V[gci];
  }
  const GA12S = [20, 25, 30, 35, 40];
  const GA12SV = w <= 24 ? [360, 480, 600, 720, 840] : [410, 530, 650, 770, 890];
  let gcis = 0;
  for (let gis = 0; gis < GA12S.length; gis++) {
    if (GA12S[gis] <= l) gcis = gis;
    else break;
  }
  if (l > 40) {
    const rate = (GA12SV[4] - GA12SV[3]) / 5;
    return Math.round(GA12SV[4] + rate * (l - 40));
  }
  return GA12SV[gcis];
}

/** 4'OC spacing upgrade (≤24' wide, non-widespan). Builder rc() line 5181. */
function ocUpgradeCost(config: PricingConfig): number {
  if (config.ocSpacing !== '4oc') return 0;
  const w = config.width || 0;
  const l = config.length || 0;
  if (!(w <= 24 && config.buildingType !== 'widespan')) return 0;
  const OC4S = [20, 25, 30, 35, 40];
  const OC4V = [300, 325, 350, 375, 400];
  let oci = 0;
  for (let oi = 0; oi < OC4S.length; oi++) {
    if (OC4S[oi] <= l) oci = oi;
    else break;
  }
  if (l > 40) {
    const rate = (OC4V[4] - OC4V[3]) / 5;
    return Math.round(OC4V[4] + rate * (l - 40));
  }
  return OC4V[oci];
}

/** Roof-pitch upgrade. CA = +50% of base; CCI = tiered table. Builder `pitchUpgradeFn` lines 2353/2739. */
export function pitchUpgradeCost(mfr: MfrConfig, base: number, w: number, l: number, pitch: Pitch): number {
  if (mfr.key === 'CA') return pitch === '4:12' || pitch === '5:12' ? Math.round(base * 0.5) : 0;
  // CCI tiered
  if (pitch !== '4:12' && pitch !== '5:12' && pitch !== '6:12') return 0;
  const PITCH_T = [
    [[500, 100], [600, 120], [700, 140]],
    [[700, 120], [800, 140], [900, 160]],
    [[900, 150], [1000, 175], [1100, 200]],
    [[900, 200], [1000, 350], [1100, 500]],
    [[1800, 300], [2000, 500], [2200, 700]],
  ];
  const wb = w <= 24 ? 0 : w <= 30 ? 1 : w <= 40 ? 2 : w <= 50 ? 3 : 4;
  const pi = pitch === '4:12' ? 0 : pitch === '5:12' ? 1 : 2;
  const us = w <= 30 ? 5 : 4;
  const row = PITCH_T[wb][pi];
  return row[0] + Math.ceil(Math.max(0, l - 20) / us) * row[1];
}

/** Wainscot (Vertical walls only). Builder `wainscotBuckets` lines 2364/2762 + rc() 5204. */
function wainscotCost(mfr: MfrConfig, config: PricingConfig, w: number, l: number): number {
  if (!config.wainscot) return 0;
  if (config.wallStyle !== 'Vertical') return 0;
  const bucket =
    mfr.key === 'CA'
      ? { cols: [20, 24, 28, 32, 36, 40, 44, 48, 52], vals: [300, 350, 400, 450, 500, 550, 600, 650, 700] }
      : w <= 30
        ? { cols: [20, 25, 30, 35, 40], vals: [300, 350, 400, 450, 500] }
        : { cols: [20, 24, 28, 32, 36, 40, 44, 48, 52], vals: [300, 350, 400, 450, 500, 550, 600, 650, 700] };
  let wci = 0;
  for (let i = 0; i < bucket.cols.length; i++) {
    if (bucket.cols[i] <= l) wci = i;
    else break;
  }
  return bucket.vals[wci];
}

/** 1' overhang (CCI only). Builder `overhangBucket` line 2734 + rc() 5221. */
function overhangCost(mfr: MfrConfig, config: PricingConfig, w: number): number {
  if (mfr.key !== 'CCI') return 0;
  const sel = config.overhang || 'none';
  if (sel === 'none' || !mfr.overhang) return 0;
  const bk = w <= 24 ? 'small' : w <= 30 ? 'mid' : 'large';
  const r = mfr.overhang[bk] || { ends: 0, sides: 0 };
  if (sel === 'eaves') return r.sides;
  if (sel === 'gables') return r.ends;
  if (sel === 'both') return r.sides + r.ends;
  return 0;
}

/** Permit plan cost (invoiced separately). Builder `planCostFn` lines 2376/2777. */
export function planCost(mfr: MfrConfig, planType: string, sub: number, isCommercial: boolean, w: number): number {
  if (planType === 'No Permit Required') return 0;
  if (mfr.key === 'CA') {
    if (planType === 'Generic Plans' || planType === 'Master Files') return 250;
    if (isCommercial) return 750;
    return w > 40 ? 500 : 400;
  }
  // CCI
  if (planType === 'Site Specific Plans') return Math.max(175, Math.ceil(sub * 0.05));
  if (planType === 'Generic Plans') return 175;
  return 0; // Master Files = $0
}

/**
 * Price a full building. Pure port of `rc()`'s money math (lines 5139–5273).
 * Returns the line-item breakdown + totals; `planCost` is separate from `total`.
 */
export function priceBuilding(input: PricingConfig, mfr: MfrConfig): PricedQuote {
  // Apply automatic structural rules first (wide-span → vertical roof/walls +
  // widespan type; >24' wide → 4' OC) so downstream pricing & gates are correct
  // no matter how the caller set width vs. type.
  const config = applyBuildingRules(input);
  const w = config.width || 0;
  const l = config.length || 0;

  const base = gBase(
    { width: config.width, length: config.length, roofStyle: config.roofStyle, baseOverride: config.baseOverride },
    mfr,
  );
  const leg = gLeg(config, mfr);
  const walls = gWalls(config, mfr);
  const vertWallUpgrade = gVertUpgrade(config, mfr);
  const gableLTrim = gableLTrimCost(config);
  const rud = gRUD(config, mfr);
  const wd = gWTD(config, mfr);
  const wn = gWIN(config, mfr);
  const wtd = wd.wtd;
  const win = wn.win;
  const sf = wd.sf + wn.sf; // gRUD never contributes side-frame
  const lapSiding = config.lapSiding ? Math.round(base * 0.1) : 0;
  const framingUpgrade = framingUpgradeCost(config);
  const ocUpgrade = ocUpgradeCost(config);
  const pitchUpgrade = pitchUpgradeCost(mfr, base, w, l, config.pitch || 'standard');
  const wainscot = wainscotCost(mfr, config, w, l);
  const leanTos = gLT(config, mfr);
  const connectionFees = gConnectionFees(config);
  const additionalComponents = gAC(config, mfr);
  const insulation = gInsul(config);
  const sidePanels = gSidePanels(config, mfr);
  const overhang = overhangCost(mfr, config, w);

  const freeThresh = mfr.freeThresh || 10000;
  const preSheetSub =
    base + leg + framingUpgrade + ocUpgrade + pitchUpgrade + walls + vertWallUpgrade + gableLTrim + rud + wtd + win + sf +
    lapSiding + wainscot + leanTos + connectionFees + additionalComponents + insulation + overhang + sidePanels;

  const sheetingFree = preSheetSub >= freeThresh && config.buildingType !== 'widespan';
  const sheetingUpgrade =
    !sheetingFree && config.sheetingUpgrade && config.buildingType !== 'widespan' ? preSheetSub * 0.1 : 0;

  const subPreFastener = preSheetSub + sheetingUpgrade;
  const fastenerFree = !!mfr.fastenerAlwaysFree || subPreFastener >= freeThresh;
  const fasteners = config.fastenerAdd && !fastenerFree ? 150 : 0;

  const subtotal = preSheetSub + sheetingUpgrade + fasteners;

  const discountPct = config.discountPct || 0;
  const discount = Math.round(subtotal * (discountPct / 100));
  const afterDiscount = subtotal - discount;

  const taxRatePct = config.taxRatePct || 0;
  const taxExempt = !!config.taxExempt;
  const tax = taxExempt ? 0 : Math.round(afterDiscount * (taxRatePct / 100));
  const total = afterDiscount + tax;

  const depositPct = config.depositPct ?? 17;
  const grossDeposit = Math.round(afterDiscount * (depositPct / 100));
  const ad = config.additionalDiscount;
  const additionalDiscount = ad ? (ad.type === 'pct' ? Math.round(grossDeposit * (ad.amount / 100)) : ad.amount) : 0;
  const deposit = Math.max(0, grossDeposit - additionalDiscount);
  const balance = total - grossDeposit;
  const displayedTotal = total - additionalDiscount;

  // 50%-at-scheduling applies to orders $15K+, ANY wide-span (32–60') build, or
  // any remaining balance over $15K. The balance is split 50/50.
  const needsScheduling = total >= 15000 || config.buildingType === 'widespan' || balance > 15000;
  const splitPayment =
    needsScheduling && balance > 0 ? { half: Math.round(balance / 2), remainder: balance - Math.round(balance / 2) } : null;

  let plan = 0;
  if (config.permit?.required) {
    const planType = config.permit.planType || mfr.defaultPlan || 'No Permit Required';
    plan = planCost(mfr, planType, subtotal, config.permit.isCommercial || false, w);
  }

  const lineItems: QuoteLineItems = {
    base,
    leg,
    framingUpgrade,
    ocUpgrade,
    pitchUpgrade,
    walls,
    vertWallUpgrade,
    gableLTrim,
    rollUpDoors: rud,
    walkDoors: wtd,
    windows: win,
    sideFrame: sf,
    lapSiding,
    sheetingUpgrade,
    wainscot,
    leanTos,
    connectionFees,
    additionalComponents,
    insulation,
    fasteners,
    overhang,
    sidePanels,
  };

  return {
    manufacturer: mfr.key,
    lineItems,
    subtotal,
    discountPct,
    discount,
    afterDiscount,
    taxRatePct,
    taxExempt,
    tax,
    total,
    depositPct,
    grossDeposit,
    additionalDiscount,
    deposit,
    balance,
    displayedTotal,
    splitPayment,
    planCost: plan,
    sheetingFree,
    fastenerFree,
  };
}
