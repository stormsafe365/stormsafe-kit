import { describe, expect, it } from 'vitest';
import { getMfr } from '../manufacturers';
import { eaveHeaderCost, ecLookup, scLookup } from '../closures';
import { gLeg, gWalls, gConnectionFees } from '../shell';
import { gRUD, gWTD, gWIN, getDoorPrice, doorHasChainIncluded, doorNeedsLift } from '../openings';
import type { PricingConfig } from '../config';

const CA = getMfr('CA');
const CCI = getMfr('CCI');

/** Minimal building config with sensible defaults; override per test. */
function cfg(over: Partial<PricingConfig>): PricingConfig {
  return {
    width: 20,
    length: 30,
    height: 8,
    roofStyle: 'Vertical',
    wallStyle: 'Horizontal',
    buildingType: 'standard',
    frontGable: 'Open',
    backGable: 'Open',
    rightEave: 'Open',
    leftEave: 'Open',
    ...over,
  };
}

describe('eaveHeaderCost (structural header for eave-side roll-up)', () => {
  it('standard building (12–30W) tiers', () => {
    expect(eaveHeaderCost(10, 24)).toBe(200);
    expect(eaveHeaderCost(14, 24)).toBe(360);
    expect(eaveHeaderCost(18, 24)).toBe(720);
  });
  it('wide-span building (32W+) tiers', () => {
    expect(eaveHeaderCost(4, 40)).toBe(360);
    expect(eaveHeaderCost(10, 40)).toBe(425);
    expect(eaveHeaderCost(18, 40)).toBe(850);
  });
});

describe('closure lookups', () => {
  it('ecLookup CA 12W×6H per end = $540', () => {
    expect(ecLookup(12, 6, CA)).toBe(540);
  });
  it('ecLookup CA 20W×8H per end = $940', () => {
    expect(ecLookup(20, 8, CA)).toBe(940);
  });
  it('scLookup CA 20W 8H 20L per side = $330 (SC[8][20]/2)', () => {
    expect(scLookup(8, 20, 20, CA)).toBe(330);
  });
});

describe('gLeg (leg/eave-height upcharge)', () => {
  it('h≤6 → $0', () => {
    expect(gLeg(cfg({ height: 6 }), CA)).toBe(0);
  });
  it('CCI 100×200×20 widespan ≈ $62,740 (verified vs Sensei)', () => {
    expect(gLeg(cfg({ width: 100, length: 200, height: 20, buildingType: 'widespan' }), CCI)).toBe(62740);
  });
  it('standard path is wired to huN (12–24W)', () => {
    const got = gLeg(cfg({ width: 12, length: 21, height: 10 }), CA);
    expect(got).toBe(CA.huN[10][0]); // LENGTHS index 0 = tier 21
    expect(got).toBeGreaterThan(0);
  });
});

describe('gWalls (gables + sides + GCH)', () => {
  it('CA 20×30×8 fully closed = $2,810', () => {
    const c = cfg({ frontGable: 'Closed', backGable: 'Closed', rightEave: 'Closed', leftEave: 'Closed' });
    // 2×ecLookup(20,8)=1880  +  2×(scLookup(8,30,20))=930  = 2810
    expect(gWalls(c, CA)).toBe(2810);
  });
  it('Gable Only: CA July 15, 2026 = $225 ≤24w / $300 26w+, vertical adds $50/$85', () => {
    expect(gWalls(cfg({ frontGable: 'Gable Only' }), CA)).toBe(225); // 20w horizontal
    expect(gWalls(cfg({ frontGable: 'Gable Only', wallStyle: 'Vertical' }), CA)).toBe(275);
    expect(gWalls(cfg({ width: 26, frontGable: 'Gable Only' }), CA)).toBe(300);
    expect(gWalls(cfg({ width: 26, frontGable: 'Gable Only', wallStyle: 'Vertical' }), CA)).toBe(385);
    expect(gWalls(cfg({ frontGable: 'Gable Only' }), CA)).toBeLessThan(ecLookup(20, 8, CA));
    // CCI keeps its flat price
    expect(gWalls(cfg({ frontGable: 'Gable Only' }), CCI)).toBe(CCI.gableOnlyPrice);
  });
  it('GCH always adds the internal divider end wall', () => {
    const open = cfg({ buildingType: 'gch', gchEnclosedLength: 0 });
    const enc = cfg({ buildingType: 'gch', gchEnclosedLength: 10, rightEave: 'Closed', leftEave: 'Closed' });
    // enc adds: 2 closed sides scLookup + divider ecLookup; open adds nothing (encL=0)
    expect(gWalls(open, CA)).toBe(0);
    expect(gWalls(enc, CA)).toBe(scLookup(8, 30, 20, CA) * 2 + ecLookup(20, 8, CA));
  });
});

describe('gConnectionFees (lean-to attachment)', () => {
  it('30ft gable lean-to on a standard building = $750 (matches Sensei)', () => {
    const c = cfg({ width: 30, leanTos: [{ width: 12, length: 30, placement: 'Front Gable' }] });
    expect(gConnectionFees(c)).toBe(750);
  });
  it('free-standing lean-tos do not connect', () => {
    const c = cfg({ leanTos: [{ width: 12, length: 30, placement: 'Front Gable', attachment: 'freestanding' }] });
    expect(gConnectionFees(c)).toBe(0);
  });
});

describe('gRUD (roll-up doors)', () => {
  it('CA Master Price Book catalog: line prices resolve per size', () => {
    expect(getDoorPrice('m750', '10x10', CA)).toBe(1250);
    expect(getDoorPrice('m3652', '10x10', CA)).toBe(1650);
    expect(getDoorPrice('m3652', '18x14', CA)).toBe(2675);
    expect(getDoorPrice('m3100', '20x14', CA)).toBe(3600);
    expect(getDoorPrice('m3100im', '20x18', CA)).toBe(4250);
    // legacy types fall back to the shared tables
    expect(getDoorPrice('standard', '10x10', CA)).toBe(1050);
  });
  it('catalog door on an eave side adds the structural header', () => {
    const c = cfg({ width: 24, rollUpDoors: [{ type: 'm3652', size: '10x10', qty: 1, location: 'Left Eave Side' }] });
    expect(gRUD(c, CA)).toBe(1650 + 200); // + eaveHeaderCost(10,24)
  });
  it('catalog hoist rules: m750 none · m3652 small-add · m3100 included', () => {
    expect(doorHasChainIncluded('m750', '10x10', CA)).toBe(false);
    expect(doorHasChainIncluded('m3652', '10x10', CA)).toBe(false);
    expect(doorHasChainIncluded('m3652', '12x10', CA)).toBe(true);
    expect(doorHasChainIncluded('m3100', '8x8', CA)).toBe(true);
    // billable only on m3652 at/below 10x10; ignored where none/included
    const add = cfg({ rollUpDoors: [{ type: 'm3652', size: '10x10', qty: 1, location: 'Front End', chainHoistQty: 1 }] });
    expect(gRUD(add, CA)).toBe(1650 + 325);
    const incl = cfg({ rollUpDoors: [{ type: 'm3652', size: '12x12', qty: 1, location: 'Front End', chainHoistQty: 1 }] });
    expect(gRUD(incl, CA)).toBe(1950);
    const none = cfg({ rollUpDoors: [{ type: 'm750', size: '10x10', qty: 1, location: 'Front End', chainHoistQty: 1 }] });
    expect(gRUD(none, CA)).toBe(1250);
    // lift rule: 14'+ tall or 16'+ wide
    expect(doorNeedsLift('m3100', '8x14', CA)).toBe(true);
    expect(doorNeedsLift('m3652', '16x10', CA)).toBe(true);
    expect(doorNeedsLift('m3652', '12x12', CA)).toBe(false);
    // CCI untouched — shared chart resolution unchanged
    expect(getDoorPrice('standard', '10x10', CCI)).toBe(1050);
  });
  it('automatic opener: $1,100/door on CCI only', () => {
    const doors = [{ type: 'standard' as const, size: '10x10', qty: 2, location: 'Front End', openerQty: 2 }];
    const base = gRUD(cfg({ rollUpDoors: doors.map((d) => ({ ...d, openerQty: 0 })) }), CCI);
    expect(gRUD(cfg({ rollUpDoors: doors }), CCI)).toBe(base + 2 * 1100);
    // CA never bills the opener even if the flag sneaks in
    const caBase = gRUD(cfg({ rollUpDoors: doors.map((d) => ({ ...d, openerQty: 0 })) }), CA);
    expect(gRUD(cfg({ rollUpDoors: doors }), CA)).toBe(caBase);
  });
});

describe('gWTD / gWIN (walk doors & windows)', () => {
  it('walk doors: qty × price + side-frame sqft × $425', () => {
    const key = Object.keys(CA.wtdPrices)[0];
    const c = cfg({ walkDoors: [{ type: key, qty: 2, sideFrameSqFt: 3 }] });
    const r = gWTD(c, CA);
    expect(r.wtd).toBe(2 * CA.wtdPrices[key]);
    expect(r.sf).toBe(3 * 425);
  });
  it('windows: qty × price', () => {
    const key = Object.keys(CA.winPrices)[0];
    const c = cfg({ windows: [{ type: key, qty: 2 }] });
    expect(gWIN(c, CA).win).toBe(2 * CA.winPrices[key]);
  });
});
