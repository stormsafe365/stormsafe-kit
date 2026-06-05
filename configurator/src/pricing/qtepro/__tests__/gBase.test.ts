import { describe, expect, it } from 'vitest';
import { gBase, nearestStd, nearestWS, PV } from '../index';
import { getMfr } from '../manufacturers';
import type { BasePriceInput } from '../types';

const CA = getMfr('CA');
const CCI = getMfr('CCI');

/** Helper to build a base-price input with sane defaults. */
const inp = (width: number, length: number, roofStyle: BasePriceInput['roofStyle'] = 'Vertical'): BasePriceInput => ({
  width,
  length,
  roofStyle,
});

describe('tier rounding', () => {
  it('nearestStd rounds length UP to the next standard tier (cap 51)', () => {
    expect(nearestStd(20)).toBe(21);
    expect(nearestStd(21)).toBe(21);
    expect(nearestStd(44)).toBe(46);
    expect(nearestStd(51)).toBe(51);
    expect(nearestStd(60)).toBe(51); // capped
  });

  it('nearestWS rounds length UP to the next wide-span tier (cap 53)', () => {
    expect(nearestWS(54)).toBe(53); // capped
    expect(nearestWS(33)).toBe(33);
    expect(nearestWS(34)).toBe(37);
  });
});

describe('Vertical 26/46 correction', () => {
  it('copies standard-width columns from 25→26 and 45→46', () => {
    for (let i = 0; i < 10; i++) {
      expect(PV[26][i]).toBe(PV[25][i]);
      expect(PV[46][i]).toBe(PV[45][i]);
    }
  });
  it('22×46 Vertical = $5,890 (verified vs IdeaRoom/Sensei, not $6,030)', () => {
    // 22' is WIDTHS index 5; tier 46.
    expect(PV[46][5]).toBe(5890);
  });
});

describe('gBase — standard 12–30W', () => {
  it('22×44×Vertical rounds up to tier 46 → $5,890', () => {
    expect(gBase(inp(22, 44), CA)).toBe(5890);
    expect(gBase(inp(22, 44), CCI)).toBe(5890); // standard path is shared
  });

  it('12×21 Vertical → $1,895 (smallest tier)', () => {
    expect(gBase(inp(12, 21), CA)).toBe(1895);
  });

  it('odd widths price as the next even (21→22)', () => {
    expect(gBase(inp(21, 44), CA)).toBe(gBase(inp(22, 44), CA));
  });

  it('roof style selects the table (Regular < Vertical at 12×21)', () => {
    expect(gBase(inp(12, 21, 'Regular'), CA)).toBe(1395);
    expect(gBase(inp(12, 21, 'Boxed'), CA)).toBe(1595);
  });

  it('manual base override wins over the table', () => {
    expect(gBase({ ...inp(22, 44), baseOverride: 9999 }, CA)).toBe(9999);
  });

  it('returns 0 for empty dims', () => {
    expect(gBase(inp(0, 44), CA)).toBe(0);
    expect(gBase(inp(22, 0), CA)).toBe(0);
  });
});

describe('gBase — standard combinations (L > 51)', () => {
  it('12×66 → combo [36,31] summed', () => {
    // PV[36][0] + PV[31][0] = 3395 + 2895 = 6290
    expect(gBase(inp(12, 66), CA)).toBe(PV[36][0] + PV[31][0]);
    expect(gBase(inp(12, 66), CA)).toBe(6290);
  });

  it('length between combos rounds UP (L=64 → 66 combo)', () => {
    expect(gBase(inp(12, 64), CA)).toBe(gBase(inp(12, 66), CA));
  });
});

describe('gBase — CCI commercial (32–100W, Vertical)', () => {
  it('32×20 → direct table lookup $7,295', () => {
    expect(gBase(inp(32, 20), CCI)).toBe(7295);
  });

  it('46×60 → combLen [28,32] = $27,790 (matches Sensei)', () => {
    expect(gBase(inp(46, 60), CCI)).toBe(27790);
  });

  it('100×200 → recursive split [104,96] = $190,180 (matches Sensei)', () => {
    expect(gBase(inp(100, 200), CCI)).toBe(190180);
  });
});

describe('gBase — CA wide-span combinations (32–60W, L > 53)', () => {
  it('46×60 → CA combo [29,33], ~$100 above CCI', () => {
    // PV[29][17] + PV[33][17] = 13295 + 14595 = 27890
    expect(gBase(inp(46, 60), CA)).toBe(27890);
  });
});

describe('gBase — CA 62–70W provisional', () => {
  it('70×110 verified = $73,385', () => {
    expect(gBase(inp(70, 110), CA)).toBe(73385);
  });
  it('other 62–70W return 0 (force base override)', () => {
    expect(gBase(inp(64, 80), CA)).toBe(0);
  });
});
