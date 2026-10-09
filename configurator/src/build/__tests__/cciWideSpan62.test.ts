import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI 62'-100' wide buildings = CCI's "Pricing for 62'-100' Buildings" sheet (letter + 2 chart
 * pages, April 30, 2026 — Desktop\INFO\CCI\CCI_62' -100' Wide Pricing (1).pdf), run through the
 * pricing program's OWN functions (public/quote-builder.html, extracted into a node vm).
 *
 * Owner case 10/9/26 (Audrey Dunayer, CCI 70x110x20, vertical, fully enclosed): Sensei = base
 * 89,485 / height 35,375 / ends 14,250 / sides 23,045 / 12GA $0 — the program had printed NO base
 * line, height $40,420, sides 2 x 12,855 and a $1,800 12GA charge.
 *
 * Lengths over 52' are CONNECTED UNITS (CCI Dealer Handbook p6, 32W-60W combinations, and Sensei):
 * units of at most 52' on the 4' columns, split as evenly as possible, rounded up.
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
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
}
/** MANUFACTURERS.CCI.<prop>: { ... } or <prop>: function(...){...} */
function grabCci(prop: string): string {
  const at = html.indexOf('\n  CCI: {');
  if (at < 0) throw new Error('no MANUFACTURERS.CCI');
  const k = html.indexOf('\n    ' + prop + ':', at);
  if (k < 0) throw new Error('no CCI.' + prop);
  const s = html.indexOf(':', k) + 1;
  const f = html.slice(s).search(/\S/) + s;
  return html.slice(f, matchEnd(f) + 1);
}

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __bw: '70' };
vm.createContext(ctx);
vm.runInContext(
  ['CCI_WIDE_SC', 'CCI_WIDE_EC', 'CCI_WIDE_H'].map(grabVar).join('') +
    ['cciWideOn', 'cciWideUnits', 'cciWideUnitSum', 'cciWideHeight', 'cciWideSCBothSides', 'cciWideEC'].map(grabFn).join('') +
    'function G(id){ return id==="bw" ? { value: __bw } : null; }\n' +
    'var CCI = { commercialBase: ' + grabCci('commercialBase') + ', commercialBaseFn: ' + grabCci('commercialBaseFn') +
    ', planCostFn: ' + grabCci('planCostFn') + ' };\n',
  ctx,
);
const run = (js: string) => vm.runInContext(js, ctx);
const base = (w: number, l: number): number => run(`CCI.commercialBaseFn(${w},${l})`);
const height = (h: number, l: number): number => run(`cciWideHeight(${h},${l})`);
const sides = (h: number, l: number): number => run(`cciWideSCBothSides(${h},${l})`);
const units = (l: number): number[] => run(`cciWideUnits(${l})`);

describe('CCI 62-100 wide: Audrey 70x110x20 = Sensei / the CCI sheet', () => {
  it('connected units 110 = 36 + 36 + 40', () => {
    expect([...units(110)].sort((a, b) => a - b)).toEqual([36, 36, 40]);
  });
  it('base 89,485 · height 35,375 · each end 7,125 · sides (both) 23,045', () => {
    expect(base(70, 110)).toBe(29295 + 29295 + 30895);
    expect(base(70, 110)).toBe(89485);
    expect(height(20, 110)).toBe(35375);
    expect(run('cciWideEC(70,20)')).toBe(7125);
    expect(sides(20, 110)).toBe(23045);
  });
  it('Sensei 100x200x20 height = $62,200 (52+52+48+48)', () => {
    expect([...units(200)].sort((a, b) => a - b)).toEqual([48, 48, 52, 52]);
    expect(height(20, 200)).toBe(62200);
  });
});

describe('connected units follow the handbook combinations', () => {
  const HB: Record<number, number[]> = {
    56: [28, 28], 60: [28, 32], 64: [32, 32], 68: [32, 36], 72: [36, 36], 76: [36, 40], 80: [40, 40], 84: [40, 44],
    88: [44, 44], 92: [44, 48], 96: [48, 48], 100: [48, 52], 104: [52, 52], 108: [36, 36, 36], 112: [36, 36, 40],
    116: [36, 40, 40], 120: [40, 40, 40],
  };
  it.each(Object.keys(HB).map(Number))('%i', (l) => {
    expect([...units(l)].sort((a, b) => a - b)).toEqual(HB[l]);
  });
  it('in-between lengths round UP (21 -> 24, 53 -> 28+28, 105 -> 36x3, 110 -> 112)', () => {
    expect(units(21)).toEqual([24]);
    expect([...units(53)].sort()).toEqual([28, 28]);
    expect(units(105)).toEqual([36, 36, 36]);
    expect(units(110).reduce((a, b) => a + b, 0)).toBe(112);
  });
  it('up to 104 the sides chart equals the old combLen rule (no change there)', () => {
    const cb = run('CCI.commercialBase.combLen') as Record<number, number[]>;
    const cols = [20, 24, 28, 32, 36, 40, 44, 48, 52];
    for (let l = 20; l <= 104; l++) {
      const row = run('CCI_WIDE_SC.rows[20]') as number[];
      let old: number;
      if (l <= 52) old = row[cols.findIndex((c) => c >= l)];
      else { const k = Object.keys(cb).map(Number).sort((a, b) => a - b).find((x) => x >= l)!; old = row[cols.indexOf(cb[k][0])] + row[cols.indexOf(cb[k][1])]; }
      expect(sides(20, l)).toBe(old);
    }
  });
});

describe('sheet details', () => {
  it('height: odd heights round up, 8 and under $0, 52-long column', () => {
    expect(height(19, 40)).toBe(height(20, 40));
    expect(height(9, 52)).toBe(1970);
    expect(height(8, 40)).toBe(0);
    expect(height(24, 52)).toBe(23230);
  });
  it('base covers every width 62-100 in 2s', () => {
    for (let w = 62; w <= 100; w += 2) expect(base(w, 52)).toBeGreaterThan(0);
    expect(base(100, 52)).toBe(49495);
    expect(base(92, 20)).toBe(31395); // printed "90x20" in the 4th block of the sheet
  });
  it('32-60 wide unchanged by the 62-100 rule', () => {
    expect(base(40, 60)).toBe(11895 + 13195); // combLen 60 = 28 + 32
    expect(base(60, 104)).toBe(26495 * 2);
  });
  it('cciWideOn: CCI 61-100 only', () => {
    expect(run('cciWideOn(61)')).toBe(true);
    expect(run('cciWideOn(100)')).toBe(true);
    expect(run('cciWideOn(60)')).toBe(false);
    run('ACTIVE_MFR="CA"');
    expect(run('cciWideOn(70)')).toBe(false);
    run('ACTIVE_MFR="CCI"');
  });
  it('site specific plans: 5% capped at $6,500 for 62-100 wide (CCI letter); uncapped below', () => {
    run('__bw="70"');
    expect(run('CCI.planCostFn("Site Specific Plans", 164625, false)')).toBe(6500);
    expect(run('CCI.planCostFn("Site Specific Plans", 60000, false)')).toBe(3000);
    run('__bw="60"');
    expect(run('CCI.planCostFn("Site Specific Plans", 164625, false)')).toBe(8232);
  });
});
