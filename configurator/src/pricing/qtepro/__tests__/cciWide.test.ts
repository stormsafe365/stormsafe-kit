import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { getMfr } from '../manufacturers';
import { gBase } from '../engine';
import { gLeg, gWalls } from '../shell';
import { ecLookup, scLookup, scPairLookup, eaveHeaderCost } from '../closures';
import { cciWideUnits } from '../cciWide';
import { priceBuilding, planCost } from '../quote';
import type { PricingConfig } from '../config';

/**
 * The TS port (PriceCheck dev tool) = the pricing program for CCI wide span:
 *  - 62'–100' wide: CCI "Pricing for 62'-100' Buildings" (4/30/26) — connected units, HEIGHT chart,
 *    12GA included, freight 3%, Site Specific Plans max $6,500, gable ends, side openings.
 *  - 32'–60' wide: connected units (CCI Dealer Handbook p6) x Price Book 2 for base, legs, sides and 12-gauge at
 *    every length (10/9/26).
 * Parity is checked against the builder's OWN functions (public/quote-builder.html in a node vm).
 */
const CCI = getMfr('CCI');
const CA = getMfr('CA');
const html = readFileSync(fileURLToPath(new URL('../../../../public/quote-builder.html', import.meta.url)), 'utf8');

function matchEnd(from: number): number {
  let depth = 0;
  let inStr: string | null = null;
  let j = html.indexOf('{', from);
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && html[j + 1] === '/') { j = html.indexOf('\n', j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return j;
}
const grabVar = (name: string): string => {
  const m = new RegExp('\\n\\s*var ' + name + '\\s*=').exec(html);
  if (!m) throw new Error('no var ' + name);
  const i = html.indexOf('{', m.index);
  return 'var ' + name + '=' + html.slice(i, matchEnd(i) + 1) + ';\n';
};
const grabArr = (name: string): string => {
  const m = new RegExp('\\n\\s*var ' + name + '\\s*=\\s*(\\[[^\\]]*\\])').exec(html);
  if (!m) throw new Error('no array ' + name);
  return 'var ' + name + '=' + m[1] + ';\n';
};
const grabFn = (name: string): string => {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
};
const grabMfr = (mfr: 'CA' | 'CCI', prop: string): string => {
  const at = html.indexOf('\n  ' + mfr + ': {');
  const k = html.indexOf('\n    ' + prop + ':', at);
  if (at < 0 || k < 0) throw new Error('no ' + mfr + '.' + prop);
  const s = html.indexOf(':', k) + 1;
  const f = html.slice(s).search(/\S/) + s;
  return html.slice(f, matchEnd(f) + 1);
};

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: { btype: 'widespan', bw: '60', bl: '110', bh: '16', rs: 'Vertical' } };
vm.createContext(ctx);
vm.runInContext(
  ['EXT_SH', 'EC', 'CCI_WIDE_SC', 'CCI_WIDE_EC', 'CCI_WIDE_H'].map(grabVar).join('') +
    grabArr('EXT_L') +
    grabArr('CCI_COM_12GA') +
    ['cciWideOn', 'cciWideUnits', 'cciWideUnitSum', 'cciWideHeight', 'cciWideSCBothSides', 'cciWideEC', 'eBkt', 'gLeg', 'scLookup', 'scPairLookup', 'ecLookup', 'cciCom12GA']
      .map(grabFn)
      .join('') +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    'var CCI = { commercialBase: ' + grabMfr('CCI', 'commercialBase') + ', commercialBaseFn: ' + grabMfr('CCI', 'commercialBaseFn') +
    ', shIndexByLength: true, shExtThresh: 52 };\n' +
    'var EXT_BSC = ' + grabMfr('CCI', 'extBsc') + ';\n' +
    'function MFR(){ return CCI; }\n',
  ctx,
);
const run = (js: string) => vm.runInContext(js, ctx);
const prog = {
  base: (w: number, l: number): number => run(`CCI.commercialBaseFn(${w % 2 ? w + 1 : w},${l})`),
  legs: (w: number, l: number, h: number): number => run(`__f.bw='${w}'; __f.bl='${l}'; __f.bh='${h}'; gLeg()`),
  pair: (w: number, l: number, h: number): number => run(`__f.bw='${w}'; scPairLookup(${h},${l},${w})`),
  side: (w: number, l: number, h: number): number => run(`__f.bw='${w}'; scLookup(${h},${l},${w})`),
  end: (w: number, h: number): number => run(`ecLookup(${w % 2 ? w + 1 : w},${h})`),
};
const cfg = (over: Partial<PricingConfig>): PricingConfig => ({
  width: 60, length: 110, height: 16, roofStyle: 'Vertical', wallStyle: 'Vertical', buildingType: 'widespan',
  frontGable: 'Closed', backGable: 'Closed', rightEave: 'Closed', leftEave: 'Closed', ...over,
});

describe('TS port = the pricing program, CCI wide span (base / legs / sides / ends)', () => {
  const W = [32, 33, 40, 46, 52, 59, 60, 61, 62, 70, 72, 80, 90, 99, 100];
  const L = [20, 21, 40, 45, 49, 50, 52, 53, 56, 60, 61, 64, 65, 80, 85, 88, 90, 95, 100, 101, 104, 105, 106, 108, 110, 112, 115, 116, 120, 121, 124, 140, 156, 157, 160];
  it('every width x length x height', () => {
    for (const w of W) for (const l of L) {
      expect(gBase({ width: w, length: l, roofStyle: 'Vertical' }, CCI), `base ${w}x${l}`).toBe(prog.base(w, l));
      for (const h of [8, 10, 12, 13, 16, 18, 20]) {
        expect(gLeg(cfg({ width: w, length: l, height: h }), CCI), `legs ${w}x${l}x${h}`).toBe(prog.legs(w, l, h));
        expect(scPairLookup(h, l, w, CCI), `sides pair ${w}x${l}x${h}`).toBe(prog.pair(w, l, h));
        expect(scLookup(h, l, w, CCI), `one side ${w}x${l}x${h}`).toBe(prog.side(w, l, h));
      }
    }
    for (const w of W) for (const h of [8, 10, 14, 16, 20]) expect(ecLookup(w, h, CCI), `end ${w}x${h}`).toBe(prog.end(w, h));
  });
});

describe('CCI 32-60 wide = handbook combinations x Price Book 2', () => {
  it('12-gauge: TS priceBuilding = the program (brochure row, per unit past 52)', () => {
    for (const w of [32, 45, 60]) for (let l = 20; l <= 160; l += 3) {
      const q = priceBuilding(cfg({ width: w, length: l, height: 12, framingGauge: '12' }), CCI);
      expect(q.lineItems.framingUpgrade, w + 'x' + l).toBe(run('cciCom12GA(' + l + ')'));
    }
    expect(run('cciCom12GA(60)')).toBe(2280);
  });
  it('7-10 tall legs = the 10 row (40x60x10 = 1,295); 60x49x16 = 6,020 (no width stretch)', () => {
    expect(gLeg(cfg({ width: 40, length: 60, height: 10 }), CCI)).toBe(1295);
    expect(gLeg(cfg({ width: 60, length: 49, height: 16 }), CCI)).toBe(6020);
  });
  it('60x110: base 36+36+40 = $64,385, legs (16) $13,150, sides pair (16) $11,420', () => {
    expect([...cciWideUnits(110)].sort((a, b) => a - b)).toEqual([36, 36, 40]);
    expect(gBase({ width: 60, length: 110, roofStyle: 'Vertical' }, CCI)).toBe(64385);
    expect(gLeg(cfg({}), CCI)).toBe(13150);
    expect(scPairLookup(16, 110, 60, CCI)).toBe(11420);
    expect(gWalls(cfg({}), CCI)).toBe(2 * 5155 + 11420);
  });
  it('60x104 = 52+52', () => {
    expect(gBase({ width: 60, length: 104, roofStyle: 'Vertical' }, CCI)).toBe(26495 * 2);
  });
  it('CA wide span untouched', () => {
    expect(gBase({ width: 46, length: 60, roofStyle: 'Vertical' }, CA)).toBe(27890);
  });
});

describe('CCI 62-100 wide (sheet 4/30/26) in the TS quote', () => {
  it('Audrey 70x110x20: base 89,485 · height 35,375 · ends 2 x 7,125 · sides 23,045 · 12GA $0 · freight 3%', () => {
    const q = priceBuilding(cfg({ width: 70, height: 20, framingGauge: '12', permit: { required: true, planType: 'Generic Plans' } }), CCI);
    expect(q.lineItems.base).toBe(89485);
    expect(q.lineItems.leg).toBe(35375);
    expect(q.lineItems.walls).toBe(14250 + 23045);
    expect(q.lineItems.framingUpgrade).toBe(0);
    expect(q.lineItems.freight).toBe(Math.round((89485 + 35375 + 14250 + 23045) * 3) / 100);
    expect(q.subtotal).toBe(162155 + q.lineItems.freight);
    expect(q.planCost).toBe(6500); // Site Specific Plans forced, 5% capped at $6,500
  });
  it('gable ends by width band, side openings $750 / $1,250, plans cap only 62-100', () => {
    expect(gWalls(cfg({ width: 70, frontGable: 'Gable Only', backGable: 'Gable Only', rightEave: 'Open', leftEave: 'Open' }), CCI)).toBe(2 * 1050);
    expect(gWalls(cfg({ width: 92, frontGable: 'Gable Only', backGable: 'Open', rightEave: 'Open', leftEave: 'Open' }), CCI)).toBe(1500);
    expect(eaveHeaderCost(10, 70, CCI)).toBe(750);
    expect(eaveHeaderCost(10, 70, CA)).toBe(425);
    expect(eaveHeaderCost(10, 60, CCI)).toBe(425);
    const ac = priceBuilding(cfg({ width: 80, additionalComponents: [
      { label: "Framed Opening — Side Opening, No Door (12' Wide)", qty: 1, location: 'Left Eave Side' },
      { label: "Framed Opening — Garage Door (12' Wide)", qty: 1, location: 'Right Eave Side' },
      { label: "Framed Opening — Garage Door (12' Wide)", qty: 1, location: 'Front End' },
    ] }), CCI);
    expect(ac.lineItems.additionalComponents).toBe(1250 + 750 + (CCI.acPrices["Framed Opening — Garage Door (12' Wide)"] || 0));
    expect(planCost(CCI, 'Site Specific Plans', 164625, false, 70)).toBe(6500);
    expect(planCost(CCI, 'Site Specific Plans', 164625, false, 60)).toBe(8232);
  });
  it('no freight below 61 wide', () => {
    expect(priceBuilding(cfg({ width: 60 }), CCI).lineItems.freight).toBe(0);
  });
});
