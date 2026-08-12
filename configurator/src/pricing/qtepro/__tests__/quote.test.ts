import { describe, expect, it } from 'vitest';
import { getMfr } from '../manufacturers';
import { gInsul, gSidePanels, gLT, gAC } from '../extras';
import { priceBuilding, pitchUpgradeCost, planCost } from '../quote';
import type { PricingConfig } from '../config';

const CA = getMfr('CA');
const CCI = getMfr('CCI');

function cfg(over: Partial<PricingConfig>): PricingConfig {
  return {
    width: 20,
    length: 30,
    height: 6,
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

describe('gInsul (Astro-Armour $1.50/sqft)', () => {
  it('roof only: (w+2)×L×1.5', () => {
    expect(gInsul(cfg({ width: 20, length: 30, height: 8, insulation: 'roof' }))).toBe(990); // 22×30×1.5
  });
  it('roof + walls adds side + end walls', () => {
    // roof 990 + side 720 (30×8×2×1.5) + end 600 (20×10×2×1.5) = 2310
    expect(gInsul(cfg({ width: 20, length: 30, height: 8, insulation: 'roof-walls' }))).toBe(2310);
  });
});

describe('gSidePanels (carport)', () => {
  it('2 full panels both sides at tier 31 = $620', () => {
    const c = cfg({ buildingType: 'carport', width: 20, length: 30, sidePanels: { qty: 2, sides: 'both' } });
    expect(gSidePanels(c, CA)).toBe(2 * 2 * 155); // CA.sidePanels.full[31] = 155
  });
});

describe('gLT (lean-to body)', () => {
  it('base only: $7/sqft, no height/wall/accessory adders', () => {
    const c = cfg({ leanTos: [{ width: 12, length: 20, placement: 'Front Gable', height: 6, wallMode: 'open' }] });
    expect(gLT(c, CA)).toBe(Math.round(12 * 20 * 7)); // 1680
  });
  it('enclosed walls add the wall option prices', () => {
    const c = cfg({ leanTos: [{ width: 12, length: 20, placement: 'Front Gable', height: 6, wallMode: 'enclosed' }] });
    // base 1680 + front closed 200 + back closed 200 + side closed 700 = 2780
    expect(gLT(c, CA)).toBe(1680 + 200 + 200 + 700);
  });
});

describe('gAC (additional components)', () => {
  it('qty × catalog unit price', () => {
    const key = Object.keys(CA.acPrices).find((k) => CA.acPrices[k] > 0)!;
    const c = cfg({ additionalComponents: [{ label: key, qty: 2 }] });
    expect(gAC(c, CA)).toBe(2 * CA.acPrices[key]);
  });
  it('custom-size entry uses the typed custom price', () => {
    const c = cfg({ additionalComponents: [{ label: 'Custom — see notes', qty: 1, customPrice: 333 }] });
    expect(gAC(c, CA)).toBe(333);
  });
});

describe('pitchUpgradeCost', () => {
  it('CA = +50% of base for 4:12/5:12', () => {
    expect(pitchUpgradeCost(CA, 10000, 20, 30, '4:12')).toBe(5000);
    expect(pitchUpgradeCost(CA, 10000, 20, 30, 'standard')).toBe(0);
  });
  it('CCI tiered: 24W 30L 4:12 = $700', () => {
    // wb=0, pi=0, us=5, row=[500,100]; 500 + ceil(10/5)*100 = 700
    expect(pitchUpgradeCost(CCI, 10000, 24, 30, '4:12')).toBe(700);
  });
});

describe('planCost (invoiced separately)', () => {
  it('CA As Built: $400 ≤40W, $500 >40W, $750 commercial', () => {
    expect(planCost(CA, 'As Built Plans', 20000, false, 30)).toBe(400);
    expect(planCost(CA, 'As Built Plans', 20000, false, 50)).toBe(500);
    expect(planCost(CA, 'As Built Plans', 20000, true, 30)).toBe(750);
  });
  it('CCI Site Specific = max($175, 5% of subtotal)', () => {
    expect(planCost(CCI, 'Site Specific Plans', 20000, false, 30)).toBe(1000);
    expect(planCost(CCI, 'Site Specific Plans', 2000, false, 30)).toBe(175);
  });
});

describe('priceBuilding — money math (rc composition)', () => {
  it('CCI ≥ $10k → free sheeting + free fasteners; discount/tax/deposit/balance', () => {
    const q = priceBuilding(cfg({ baseOverride: 10000, discountPct: 10, taxRatePct: 7, depositPct: 17 }), CCI);
    expect(q.lineItems.base).toBe(10000);
    expect(q.subtotal).toBe(10000);
    expect(q.sheetingFree).toBe(true);
    expect(q.fastenerFree).toBe(true);
    expect(q.discount).toBe(1000); // 10%
    expect(q.afterDiscount).toBe(9000);
    expect(q.tax).toBe(630); // 7% of 9000
    expect(q.total).toBe(9630);
    expect(q.grossDeposit).toBe(1530); // 17% of 9000
    expect(q.deposit).toBe(1530);
    expect(q.balance).toBe(8100); // total − grossDeposit
    expect(q.splitPayment).toBeNull();
  });

  it('CA 8/10/2026: 26GA is never free — 10% of subtotal even at $10k+', () => {
    const q = priceBuilding(cfg({ baseOverride: 12000, sheetingUpgrade: true }), CA);
    expect(q.sheetingFree).toBe(false);
    expect(q.lineItems.sheetingUpgrade).toBe(1200); // 10% of 12,000 subtotal
    expect(q.subtotal).toBe(13200);
  });

  it('base < $10k → sheeting upgrade (+10% subtotal), lap siding (+10% base), billable fasteners (CA)', () => {
    const q = priceBuilding(
      cfg({ baseOverride: 5000, lapSiding: true, sheetingUpgrade: true, fastenerAdd: true }),
      CA,
    );
    // preSheet = base 5000 + lap 500 = 5500; +sheet 550 (10% of preSheet) + fasteners 150 = 6200
    expect(q.lineItems.lapSiding).toBe(500);
    expect(q.lineItems.sheetingUpgrade).toBe(550);
    expect(q.lineItems.fasteners).toBe(150);
    expect(q.subtotal).toBe(6200);
    expect(q.sheetingFree).toBe(false);
    expect(q.fastenerFree).toBe(false);
  });

  it('CCI fasteners are always free', () => {
    const q = priceBuilding(cfg({ baseOverride: 5000, fastenerAdd: true }), CCI);
    expect(q.fastenerFree).toBe(true);
    expect(q.lineItems.fasteners).toBe(0);
  });

  it('subtotal equals the sum of all line items', () => {
    const q = priceBuilding(
      cfg({
        width: 24,
        length: 36,
        height: 10,
        frontGable: 'Closed',
        backGable: 'Closed',
        rightEave: 'Closed',
        leftEave: 'Closed',
        rollUpDoors: [{ type: 'standard', size: '10x10', qty: 1, location: 'Front End' }],
      }),
      CA,
    );
    const sum = Object.values(q.lineItems).reduce((a, b) => a + b, 0);
    expect(q.subtotal).toBe(sum);
  });

  it('wide-span (32+ wide) does NOT charge a vertical-wall upgrade', () => {
    // Regression: a 36×40 with vertical walls + (wrongly) "standard" type was
    // charging a bogus vertical-wall upgrade extrapolated off the 12–30' table.
    const q = priceBuilding(
      cfg({
        width: 36,
        length: 40,
        height: 12,
        buildingType: 'standard', // intentionally wrong — rules must coerce it
        wallStyle: 'Vertical',
        frontGable: 'Closed',
        backGable: 'Closed',
        rightEave: 'Closed',
        leftEave: 'Closed',
      }),
      CA,
    );
    expect(q.lineItems.vertWallUpgrade).toBe(0);
    // base building for CA 36×40 Vertical = PV[41][col 36] = 14,795
    expect(q.lineItems.base).toBe(14795);
    // wide-span buildings are NOT eligible for free 26-ga sheeting
    expect(q.sheetingFree).toBe(false);
  });

  it('>24 wide buildings price 4-OC as standard (no OC upcharge)', () => {
    const q = priceBuilding(cfg({ width: 30, length: 40, ocSpacing: '4oc' }), CA);
    expect(q.lineItems.ocUpgrade).toBe(0);
  });

  it('over 35 long forces vertical roof (Regular input priced off PV)', () => {
    // CA 20×40, Regular requested → rules force Vertical → base = PV[41][col 20] = 4,795
    const q = priceBuilding(cfg({ width: 20, length: 40, roofStyle: 'Regular' }), CA);
    expect(q.lineItems.base).toBe(4795);
  });

  it('the 35-ft threshold forces vertical at exactly 36 long', () => {
    // 30×36 Regular → forced Vertical → PV[36][col 30] = 6,495 (not PR's 5,495)
    const q = priceBuilding(cfg({ width: 30, length: 36, roofStyle: 'Regular' }), CA);
    expect(q.lineItems.base).toBe(6495);
  });

  it('horizontal gables get L-trim; vertical gables do not', () => {
    // 24-wide horizontal, both gables closed → both-gables sheet price = $70
    const horiz = priceBuilding(
      cfg({ width: 24, length: 30, wallStyle: 'Horizontal', frontGable: 'Closed', backGable: 'Closed' }),
      CA,
    );
    expect(horiz.lineItems.gableLTrim).toBe(70);
    // one gable closed → half
    const oneGable = priceBuilding(
      cfg({ width: 24, length: 30, wallStyle: 'Horizontal', frontGable: 'Closed', backGable: 'Open' }),
      CA,
    );
    expect(oneGable.lineItems.gableLTrim).toBe(35);
    // vertical siding → trim included (no charge)
    const vert = priceBuilding(
      cfg({ width: 24, length: 30, wallStyle: 'Vertical', frontGable: 'Closed', backGable: 'Closed' }),
      CA,
    );
    expect(vert.lineItems.gableLTrim).toBe(0);
  });

  it('wide-span build always flags 50%-at-scheduling split', () => {
    const q = priceBuilding(cfg({ width: 40, length: 30, height: 12, frontGable: 'Closed', backGable: 'Closed' }), CCI);
    expect(q.splitPayment).not.toBeNull();
  });

  it('height clamps to the valid range (24 wide capped at 16)', () => {
    const tall = priceBuilding(cfg({ width: 24, length: 30, height: 20 }), CA);
    const capped = priceBuilding(cfg({ width: 24, length: 30, height: 16 }), CA);
    expect(tall.lineItems.leg).toBe(capped.lineItems.leg);
  });

  it('large balance triggers the split-payment note', () => {
    const q = priceBuilding(cfg({ baseOverride: 60000, depositPct: 17 }), CA);
    expect(q.balance).toBeGreaterThan(15000);
    expect(q.splitPayment).not.toBeNull();
    expect(q.splitPayment!.half + q.splitPayment!.remainder).toBe(q.balance);
  });
});
