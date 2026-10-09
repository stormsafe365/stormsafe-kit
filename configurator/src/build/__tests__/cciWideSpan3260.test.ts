import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI 32'-60' wide buildings PAST 104' LONG = connected units, run through the pricing program's OWN
 * functions (public/quote-builder.html, extracted into a node vm).
 *
 * Authority: CCI Dealer Handbook (rev 7/14/21) p6 "Building Length Combinations — 32W-60W": 56 = 28+28 …
 * 104 = 52+52, 108 = 36+36+36, 112 = 36+36+40, 116 = 36+40+40, 120 = 40+40+40 ("no other length
 * combinations can be used"). Each unit is priced on the CCI FL Commercial 170 MPH brochure (Price Book 2,
 * p5 base, p6 SIDE HEIGHT and BOTH SIDES CLOSED, 20'-52' columns by 4').
 *
 * Before 10/9/26 the program split 105'+ as [52+52] + the rest: 105'-123' found no base (it fell back to an
 * extrapolation $1,600-$18,300 under the handbook — 60x110 $46,445 vs $64,385), 124'+ priced 52+52+rest, and
 * legs / sides past 100' were a straight-line extension of the 100' column.
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

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
function grabVar(name: string): string {
  const m = new RegExp('\\n\\s*var ' + name + '\\s*=').exec(html);
  if (!m) throw new Error('no var ' + name);
  const i = html.indexOf('{', m.index);
  return 'var ' + name + '=' + html.slice(i, matchEnd(i) + 1) + ';\n';
}
function grabArr(name: string): string {
  const m = new RegExp('\\n\\s*var ' + name + '\\s*=\\s*(\\[[^\\]]*\\])').exec(html);
  if (!m) throw new Error('no array ' + name);
  return 'var ' + name + '=' + m[1] + ';\n';
}
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
}
/** MANUFACTURERS.<mfr>.<prop>: { ... } or <prop>: function(...){...} */
function grabMfr(mfr: 'CA' | 'CCI', prop: string): string {
  const at = html.indexOf('\n  ' + mfr + ': {');
  if (at < 0) throw new Error('no MANUFACTURERS.' + mfr);
  const k = html.indexOf('\n    ' + prop + ':', at);
  if (k < 0) throw new Error('no ' + mfr + '.' + prop);
  const s = html.indexOf(':', k) + 1;
  const f = html.slice(s).search(/\S/) + s;
  return html.slice(f, matchEnd(f) + 1);
}

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: { btype: 'widespan', bw: '60', bl: '110', bh: '16' } };
vm.createContext(ctx);
vm.runInContext(
  ['EXT_SH', 'CCI_WIDE_SC', 'CCI_WIDE_EC', 'CCI_WIDE_H'].map(grabVar).join('') +
    grabArr('EXT_L') +
    ['cciWideOn', 'cciWideUnits', 'cciWideUnitSum', 'cciWideHeight', 'cciWideSCBothSides', 'cciWideEC', 'gLeg', 'scLookup', 'scPairLookup']
      .map(grabFn)
      .join('') +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    'var CCI = { commercialBase: ' + grabMfr('CCI', 'commercialBase') + ', commercialBaseFn: ' + grabMfr('CCI', 'commercialBaseFn') +
    ', shIndexByLength: true, shExtThresh: 52 };\n' +
    'var CA = { shIndexByLength: false, shExtThresh: 44 };\n' +
    'var EXT_BSC_CCI = ' + grabMfr('CCI', 'extBsc') + ', EXT_BSC_CA = ' + grabMfr('CA', 'extBsc') + ', EXT_BSC = EXT_BSC_CCI;\n' +
    'function MFR(){ return ACTIVE_MFR === "CA" ? CA : CCI; }\n' +
    'function setMfr(m){ ACTIVE_MFR = m; EXT_BSC = m === "CA" ? EXT_BSC_CA : EXT_BSC_CCI; }\n',
  ctx,
);
const run = (js: string) => vm.runInContext(js, ctx);
const base = (w: number, l: number): number => run(`CCI.commercialBaseFn(${w},${l})`);
const legs = (w: number, l: number, h: number): number => run(`__f.bw='${w}'; __f.bl='${l}'; __f.bh='${h}'; gLeg()`);
const sidePair = (w: number, l: number, h: number): number => run(`__f.bw='${w}'; scPairLookup(${h},${l},${w})`);
const sideOne = (w: number, l: number, h: number): number => run(`__f.bw='${w}'; scLookup(${h},${l},${w})`);

// The brochure, transcribed straight from Price Book 2 p6 (20'..52' columns).
const COLS = [20, 24, 28, 32, 36, 40, 44, 48, 52];
const SH: Record<number, number[]> = {
  10: [430, 520, 605, 690, 780, 865, 950, 1035, 1125],
  12: [865, 1035, 1210, 1380, 1555, 1730, 1900, 2075, 2245],
  14: [1535, 1845, 2150, 2460, 2765, 3070, 3380, 3685, 3995],
  16: [2450, 2895, 3340, 3785, 4235, 4680, 5125, 5575, 6020],
  18: [3360, 3840, 4320, 4800, 5280, 5760, 6240, 6720, 7200],
  20: [3790, 4470, 5115, 5830, 6510, 7190, 7865, 8545, 9225],
};
const BSC: Record<number, number[]> = {
  8: [1030, 1235, 1440, 1645, 1850, 2050, 2255, 2460, 2665],
  10: [1175, 1405, 1630, 1870, 2100, 2350, 2580, 2810, 3035],
  12: [1320, 1585, 1850, 2110, 2375, 2640, 2905, 3170, 3430],
  14: [1465, 1755, 2050, 2340, 2635, 2930, 3220, 3515, 3805],
  16: [2040, 2450, 2855, 3265, 3670, 4080, 4490, 4895, 5305],
  18: [2470, 2970, 3460, 3955, 4450, 4945, 5440, 5935, 6425],
  20: [2905, 3485, 4065, 4645, 5225, 5810, 6390, 6970, 7550],
};
const at = (row: number[], u: number) => row[COLS.indexOf(u)];
// Handbook p6 32W-60W combinations (the three-unit ones) + the in-between lengths rounding UP.
const HB3: Record<number, number[]> = { 108: [36, 36, 36], 112: [36, 36, 40], 116: [36, 40, 40], 120: [40, 40, 40] };
const hbUnits = (l: number): number[] => HB3[Object.keys(HB3).map(Number).find((k) => k >= l)!];

describe('CCI 32-60 wide, base past 104 = handbook combinations', () => {
  it('owner case 60x110: 36+36+40 = $64,385 (was $46,445)', () => {
    expect(base(60, 110)).toBe(20995 + 20995 + 22395);
    expect(base(60, 110)).toBe(64385);
  });
  it('105-120 at every width 32-60 = the handbook three-unit combinations', () => {
    for (let w = 32; w <= 60; w += 2) {
      const row = run(`CCI.commercialBase.rows[${w}]`) as number[];
      for (let l = 105; l <= 120; l++) {
        expect(base(w, l)).toBe(hbUnits(l).reduce((s, u) => s + at(row, u), 0));
      }
    }
  });
  it('past 120 (no handbook combination): the same rule, units of at most 52 split evenly', () => {
    expect([...(run('cciWideUnits(124)') as number[])].sort((a, b) => a - b)).toEqual([40, 40, 44]);
    expect(base(60, 124)).toBe(22395 + 22395 + 23795); // was 52+52+20 = $68,485
    expect(base(60, 156)).toBe(26495 * 3);
    expect(base(60, 160)).toBe(22395 * 4);
  });
  it('up to 104 nothing changes (combLen pairs, round up)', () => {
    const cb = run('CCI.commercialBase.combLen') as Record<number, number[]>;
    const keys = Object.keys(cb).map(Number).sort((a, b) => a - b);
    for (let w = 32; w <= 60; w += 2) {
      const row = run(`CCI.commercialBase.rows[${w}]`) as number[];
      for (let l = 20; l <= 104; l++) {
        let old: number;
        if (l <= 52) old = row[COLS.findIndex((c) => c >= l)];
        else { const k = keys.find((x) => x >= l)!; old = at(row, cb[k][0]) + at(row, cb[k][1]); }
        expect(base(w, l)).toBe(old);
      }
    }
  });
});

describe('CCI 32-60 wide, legs past 104 = SIDE HEIGHT chart per unit', () => {
  it('60x110x16 = 4,235 + 4,235 + 4,680 = $13,150', () => {
    expect(legs(60, 110, 16)).toBe(13150);
  });
  it('105-120, every height row, = the handbook units on the brochure chart', () => {
    for (const h of [10, 12, 14, 16, 18, 20]) for (let l = 105; l <= 120; l++) {
      expect(legs(40, l, h)).toBe(hbUnits(l).reduce((s, u) => s + at(SH[h], u), 0));
    }
  });
  it('odd heights round up; 8-10 tall read the 10 row (as up to 52)', () => {
    expect(legs(48, 110, 13)).toBe(legs(48, 110, 14));
    expect(legs(48, 110, 8)).toBe(780 + 780 + 865);
    expect(legs(48, 52, 8)).toBe(1125); // the same 10 row at 52'
  });
  it('up to 104 nothing changes (EXT_SH, straight-line past 100)', () => {
    const extL = run('EXT_L') as number[];
    for (const h of [12, 14, 16, 18, 20]) {
      const row = run(`EXT_SH[${h}]`) as number[];
      expect(legs(40, 100, h)).toBe(row[extL.indexOf(100)]);
      const rate = (row[row.length - 1] - row[row.length - 2]) / 5;
      expect(legs(40, 104, h)).toBe(Math.round(row[row.length - 1] + rate * 4));
    }
  });
});

describe('CCI 32-60 wide, sides past 104 = BOTH SIDES CLOSED chart per unit', () => {
  it('60x110x16: pair 3,670 + 3,670 + 4,080 = $11,420, one side $5,710', () => {
    expect(sidePair(60, 110, 16)).toBe(11420);
    expect(sideOne(60, 110, 16)).toBe(5710);
  });
  it('105-120, every height row: the pair straight from the chart (no $1 drift)', () => {
    for (const h of [8, 10, 12, 14, 16, 18, 20]) for (let l = 105; l <= 120; l++) {
      const pair = hbUnits(l).reduce((s, u) => s + at(BSC[h], u), 0);
      expect(sidePair(36, l, h)).toBe(pair);
      expect(sideOne(36, l, h)).toBe(Math.round(pair / 2));
    }
  });
  it('up to 104 nothing changes (extended chart, both sides = 2 x one side)', () => {
    expect(sidePair(40, 100, 20)).toBe(2 * Math.round(14520 / 2));
    expect(sidePair(40, 52, 20)).toBe(2 * Math.round(7550 / 2));
  });
});

describe('everything else unchanged', () => {
  it('CCI 62-100 wide keeps the 4/30/26 sheet (Audrey 70x110x20)', () => {
    expect(base(70, 110)).toBe(89485);
    expect(legs(70, 110, 20)).toBe(35375);
    expect(sidePair(70, 110, 20)).toBe(23045);
  });
  it('CA wide span past 104 keeps its straight-line legs / sides', () => {
    run('setMfr("CA")');
    const row = run('EXT_SH[16]') as number[];
    const rate = (row[row.length - 1] - row[row.length - 2]) / 5;
    expect(legs(40, 110, 16)).toBe(Math.round(row[row.length - 1] + rate * 10));
    const eb = run('EXT_BSC[16]') as number[];
    const ebRate = (eb[eb.length - 1] - eb[eb.length - 2]) / 5;
    expect(sidePair(40, 110, 16)).toBe(2 * Math.round(Math.round(eb[eb.length - 1] + ebRate * 10) / 2));
    run('setMfr("CCI")');
  });
  it('CCI tall standard width (30 wide, 18 tall) past 104 keeps its straight-line legs', () => {
    const row = run('EXT_SH[18]') as number[];
    const rate = (row[row.length - 1] - row[row.length - 2]) / 5;
    expect(legs(30, 110, 18)).toBe(Math.round(row[row.length - 1] + rate * 10));
  });
});
