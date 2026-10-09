import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI 32'-60' wide buildings = CCI's own documents at EVERY length, run through the pricing program's OWN
 * functions (public/quote-builder.html, extracted into a node vm).
 *
 * Authority: CCI Dealer Handbook (rev 7/14/21) p6 "Building Length Combinations — 32W-60W": 56 = 28+28 …
 * 104 = 52+52, 108 = 36+36+36, 112 = 36+36+40, 116 = 36+40+40, 120 = 40+40+40 ("no other length
 * combinations can be used"). Each unit is priced on the CCI FL Commercial 170 MPH brochure (Price Book 2,
 * p5 base, p6 SIDE HEIGHT / BOTH SIDES CLOSED / 12 Gauge, 20'-52' columns by 4').
 *
 * 10/9/26 (10-9b): past 104' the base had no price for 105'-123' (60x110 $46,445 vs $64,385) and 124'+ was
 * 52+52+rest; legs / sides past 52' came from 5'-column extended charts (7'-10' tall read the 16' row, the
 * 85'-100' 18'/20' leg rows were a 30'-wide Sensei re-sample), straight lines past 100', a CA width stretch at
 * 54'-60' x 49'-52'; 12-gauge was the CA series; 3 base cells were $100 under the book.
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
    grabArr('CCI_COM_12GA') +
    ['cciWideOn', 'cciWideUnits', 'cciWideUnitSum', 'cciWideHeight', 'cciWideSCBothSides', 'cciWideEC', 'gLeg', 'scLookup', 'scPairLookup', 'cciCom12GA']
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

// The brochure (Price Book 2), typed in from the PDF: p5 base (width -> 20'..52'), p6 SIDE HEIGHT, BOTH SIDES
// CLOSED and the 12 Gauge option row.
const COLS = [20, 24, 28, 32, 36, 40, 44, 48, 52];
const BOOK_BASE: Record<number, number[]> = {
  32: [7295, 8595, 9795, 11095, 12395, 13595, 14895, 16095, 17395], 34: [7695, 8995, 10295, 11595, 12995, 14295, 15595, 16895, 18195],
  36: [8195, 9495, 10795, 12095, 13395, 14795, 16095, 17395, 18695], 38: [8595, 9995, 11295, 12595, 13895, 15195, 16595, 17895, 19195],
  40: [9195, 10595, 11895, 13195, 14495, 15795, 17195, 18495, 19795], 42: [9595, 10895, 12195, 13595, 14895, 16195, 17495, 18795, 20195],
  44: [10095, 11395, 12695, 13995, 15395, 16695, 17995, 19295, 20595], 46: [10695, 11995, 13295, 14595, 15995, 17295, 18595, 19895, 21195],
  48: [11295, 12695, 13995, 15395, 16795, 18195, 19595, 20895, 22295], 50: [11995, 13395, 14795, 16095, 17495, 18895, 20295, 21695, 22995],
  52: [12495, 13895, 15195, 16595, 17995, 19395, 20795, 22095, 23495], 54: [13295, 14695, 16095, 17495, 18795, 20195, 21595, 22995, 24395],
  56: [13995, 15395, 16795, 18195, 19595, 20895, 22295, 23695, 25095], 58: [14795, 16095, 17495, 18895, 20295, 21695, 22995, 24395, 25795],
  60: [15495, 16895, 18195, 19595, 20995, 22395, 23795, 25095, 26495],
};
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
const BOOK_12GA = [840, 960, 1080, 1200, 1320, 1440, 1560, 1680, 1800];
const at = (row: number[], u: number) => row[COLS.indexOf(u)];
// Handbook p6 32W-60W combinations, verbatim (its "96 = 48 + 98" read as 48 + 48), lengths between round UP;
// up to 52' = one unit (the next 4' column); past 120' (no handbook combination) = the program's even split.
const HB: Record<number, number[]> = {
  56: [28, 28], 60: [28, 32], 64: [32, 32], 68: [32, 36], 72: [36, 36], 76: [36, 40], 80: [40, 40], 84: [44, 40], 88: [44, 44],
  92: [44, 48], 96: [48, 48], 100: [48, 52], 104: [52, 52], 108: [36, 36, 36], 112: [36, 36, 40], 116: [36, 40, 40], 120: [40, 40, 40],
};
const hbUnits = (l: number): number[] => {
  if (l <= 52) return [COLS.find((c) => c >= l)!];
  const k = Object.keys(HB).map(Number).find((x) => x >= l);
  return k ? HB[k] : (run(`cciWideUnits(${l})`) as number[]);
};
const shRow = (h: number) => (h <= 10 ? 10 : h <= 12 ? 12 : h <= 14 ? 14 : h <= 16 ? 16 : h <= 18 ? 18 : 20);
const bscRow = (h: number) => (h <= 8 ? 8 : shRow(h));
const W = [32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60];

describe('CCI 32-60 wide base = Price Book 2 x handbook combinations', () => {
  it('the program table = the book, cell for cell (42x48 18,795 · 46x28 13,295 · 58x48 24,395)', () => {
    for (const w of W) expect(run(`CCI.commercialBase.rows[${w}]`), `row ${w}`).toEqual(BOOK_BASE[w]);
  });
  it('owner case 60x110: 36+36+40 = $64,385 (was $46,445)', () => {
    expect(base(60, 110)).toBe(20995 + 20995 + 22395);
  });
  it('every width x every length 20-160', () => {
    for (const w of W) for (let l = 20; l <= 160; l++) {
      expect(base(w, l), `${w}x${l}`).toBe(hbUnits(l).reduce((s, u) => s + at(BOOK_BASE[w], u), 0));
    }
  });
  it('past 120: units of at most 52 split evenly (124 = 44+40+40, 160 = 40x4)', () => {
    expect([...(run('cciWideUnits(124)') as number[])].sort((a, b) => a - b)).toEqual([40, 40, 44]);
    expect(base(60, 124)).toBe(22395 + 22395 + 23795);
    expect(base(60, 160)).toBe(22395 * 4);
  });
});

describe('CCI 32-60 wide legs = SIDE HEIGHT chart x handbook units, every length', () => {
  it('7-10 tall read the 10 row (40x60x10 = 605 + 690 = $1,295, was the 16 row $7,125)', () => {
    expect(legs(40, 60, 10)).toBe(1295);
    expect(legs(40, 60, 8)).toBe(1295);
    expect(legs(40, 110, 10)).toBe(780 + 780 + 865);
  });
  it('17-20 tall at 85-100 follow the 32W-60W combinations (100 = 48+52), not the 30-wide re-sample', () => {
    expect(legs(40, 100, 20)).toBe(8545 + 9225);
    expect(legs(40, 85, 18)).toBe(6240 + 6240); // 88 = 44+44
  });
  it('54-60 wide at 49-52 long: the CCI chart column, no width stretch (60x49x16 = $6,020)', () => {
    expect(legs(60, 49, 16)).toBe(6020);
    expect(legs(54, 52, 20)).toBe(9225);
  });
  it('every width x length 20-160 x height', () => {
    for (const w of [32, 45, 54, 60]) for (let l = 20; l <= 160; l++) for (const h of [7, 8, 10, 11, 12, 14, 16, 17, 18, 20]) {
      expect(legs(w, l, h), `${w}x${l}x${h}`).toBe(hbUnits(l).reduce((s, u) => s + at(SH[shRow(h)], u), 0));
    }
  });
});

describe('CCI 32-60 wide sides = BOTH SIDES CLOSED chart x handbook units, every length', () => {
  it('60x110x16: pair 3,670 + 3,670 + 4,080 = $11,420, one side $5,710', () => {
    expect(sidePair(60, 110, 16)).toBe(11420);
    expect(sideOne(60, 110, 16)).toBe(5710);
  });
  it('the pair straight from the chart (40x20x20 = $2,905, no $1 drift), 60x49x20 = $7,550 (no width stretch)', () => {
    expect(sidePair(40, 20, 20)).toBe(2905);
    expect(sidePair(60, 49, 20)).toBe(7550);
  });
  it('every width x length 20-160 x height', () => {
    for (const w of [32, 45, 54, 60]) for (let l = 20; l <= 160; l++) for (const h of [8, 9, 10, 12, 14, 16, 18, 20]) {
      const pair = hbUnits(l).reduce((s, u) => s + at(BSC[bscRow(h)], u), 0);
      expect(sidePair(w, l, h), `${w}x${l}x${h}`).toBe(pair);
      expect(sideOne(w, l, h), `${w}x${l}x${h}`).toBe(Math.round(pair / 2));
    }
  });
});

describe('CCI 32-60 wide 12-gauge = the brochure row, per unit past 52', () => {
  it('20 $840 · 52 $1,800 · 60 = 28+32 $2,280 · 110 = 36+36+40 $4,080', () => {
    expect(run('cciCom12GA(20)')).toBe(840);
    expect(run('cciCom12GA(52)')).toBe(1800);
    expect(run('cciCom12GA(60)')).toBe(1080 + 1200);
    expect(run('cciCom12GA(110)')).toBe(1320 + 1320 + 1440);
  });
  it('every length 20-160', () => {
    for (let l = 20; l <= 160; l++) expect(run(`cciCom12GA(${l})`), `${l}`).toBe(hbUnits(l).reduce((s, u) => s + at(BOOK_12GA, u), 0));
  });
});

describe('everything else unchanged', () => {
  it('CCI 62-100 wide keeps the 4/30/26 sheet (Audrey 70x110x20)', () => {
    expect(base(70, 110)).toBe(89485);
    expect(legs(70, 110, 20)).toBe(35375);
    expect(sidePair(70, 110, 20)).toBe(23045);
  });
  it('CA wide span keeps its extended charts (straight line past 100)', () => {
    run('setMfr("CA")');
    const row = run('EXT_SH[16]') as number[];
    const rate = (row[row.length - 1] - row[row.length - 2]) / 5;
    expect(legs(40, 110, 16)).toBe(Math.round(row[row.length - 1] + rate * 10));
    const eb = run('EXT_BSC[16]') as number[];
    const ebRate = (eb[eb.length - 1] - eb[eb.length - 2]) / 5;
    expect(sidePair(40, 110, 16)).toBe(2 * Math.round(Math.round(eb[eb.length - 1] + ebRate * 10) / 2));
    run('setMfr("CCI")');
  });
  it('CCI tall standard width (30 wide, 18 tall) keeps EXT_SH (85-100 Sensei rows, straight line past 100)', () => {
    const row = run('EXT_SH[18]') as number[];
    const rate = (row[row.length - 1] - row[row.length - 2]) / 5;
    expect(legs(30, 110, 18)).toBe(Math.round(row[row.length - 1] + rate * 10));
    expect(legs(30, 100, 18)).toBe(15360);
  });
});
