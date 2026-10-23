import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * 10-22b - CCI end-wall insulation "Add to Height" on higher pitches (CCI email 10/22/26, chart "End Insulation on
 * Higher Pitches"). The CHART below is transcribed independently from the PDF (every cell); the program's own insulEndAdd()
 * and gInsul() (public/quote-builder.html) run in a node vm with a DOM-ish G() and must agree with it.
 * Chart columns are [4:12, 5:12, 6:12]. 14' and 16' are not on the chart: 12' and 18' are both 2/2/2, so they use 2/2/2.
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
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
}
function grabVar(name: string): string {
  const m = new RegExp('\\nvar ' + name + '\\s*=\\s*\\{').exec(html);
  if (!m) throw new Error('no var ' + name);
  const i = html.indexOf('{', m.index);
  return 'var ' + name + '=' + html.slice(i, matchEnd(i) + 1) + ';\n';
}

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: {} };
vm.createContext(ctx);
vm.runInContext(
  grabFn('gInsul') + grabFn('insulEndAdd') + grabVar('INSUL_END_ADD_PITCH') +
    'var INSUL_RATE=1.50; var FS_INS_ROOF_RATE=1.6071, FS_INS_WALL_RATE=1.539; function fsLowSide(){ return 4; }\n' +
    'function G(id){ if(!(id in __f)) return null; return { id:id, value:__f[id], textContent:__f[id], checked:__f[id]===true, style:{}, dataset:{} }; }\n',
  ctx,
);
const run = (js: string, f: Record<string, unknown> = {}, mfr = 'CCI') =>
  vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; ${js}`, ctx) as unknown;

// The chart, cell by cell: width -> [4:12, 5:12, 6:12] "Add to Height" (feet).
const CHART: Record<number, [number, number, number]> = {
  12: [2, 2, 2], 18: [2, 2, 2], 20: [2, 2, 3], 22: [2, 2, 3], 24: [2, 3, 3],
  26: [2, 3, 3], 28: [2, 3, 4], 30: [3, 3, 4],
  32: [3, 3, 4], 34: [3, 4, 4], 36: [3, 4, 5], 38: [3, 4, 5], 40: [3, 4, 5],
  42: [4, 4, 5], 44: [4, 5, 6], 46: [4, 5, 6], 48: [4, 5, 6], 50: [4, 5, 6],
  52: [4, 5, 6], 54: [5, 6, 7], 56: [5, 6, 7], 58: [5, 6, 7], 60: [5, 6, 7],
};
const PITCHES = ['4:12', '5:12', '6:12'];
// Standard add (before this chart): +2, CCI 32'-60' wide +3 (<= 50) / +4 (> 50) - Dealer Handbook p22 (audit F31).
const stdAdd = (w: number) => { const e = w % 2 === 1 ? w + 1 : w; return e >= 32 && e <= 60 ? (e <= 50 ? 3 : 4) : 2; };
const add = (w: number, pitch: string, mfr = 'CCI', btype = 'standard') => run(`insulEndAdd(${w})`, { 'pitch-sel': pitch, btype }, mfr) as number;
const insul = (w: number, l: number, h: number, pitch: string, sel = 'roof-walls', extra: Record<string, unknown> = {}, mfr = 'CCI') =>
  run('gInsul()', { 'insul-sel': sel, btype: w >= 32 ? 'widespan' : 'standard', bw: String(w), bl: String(l), bh: String(h), 'pitch-sel': pitch, ...extra }, mfr) as number;
const expected = (w: number, l: number, h: number, a: number) => Math.round((w + 2) * l * 1.5) + Math.round(l * h * 2 * 1.5) + Math.round(w * (h + a) * 2 * 1.5);

describe('CCI end-wall insulation Add to Height on 4:12 / 5:12 / 6:12 (chart 10/22/26)', () => {
  it('every chart cell (23 widths x 3 pitches) - insulEndAdd', () => {
    for (const [ws, row] of Object.entries(CHART)) {
      PITCHES.forEach((p, i) => expect(add(Number(ws), p), `${ws}' ${p}`).toBe(row[i]));
    }
  });
  it('every chart cell prices through gInsul (roof + walls)', () => {
    for (const [ws, row] of Object.entries(CHART)) {
      const w = Number(ws);
      PITCHES.forEach((p, i) => {
        for (const [l, h] of [[30, 9], [40, 14], [60, 20]]) expect(insul(w, l, h, p), `${w}x${l}x${h} ${p}`).toBe(expected(w, l, h, row[i]));
      });
    }
  });
  it("14' and 16' are not on the chart: same as 12' / 18' = 2 / 2 / 2", () => {
    for (const w of [14, 16]) PITCHES.forEach((p) => expect(add(w, p), `${w}' ${p}`).toBe(2));
  });
  it('odd widths round up to the next even width (as the standard add does)', () => {
    for (let w = 13; w <= 59; w += 2) {
      if (w === 31) continue; // 31' is not offered, but its rounding is still defined
      PITCHES.forEach((p, i) => expect(add(w, p), `${w}' ${p}`).toBe(w + 1 === 14 || w + 1 === 16 ? 2 : CHART[w + 1][i]));
    }
    expect(add(31, '4:12')).toBe(CHART[32][0]);
  });
  it("3:12 / standard, and the 2:12 standard on 32'+, keep the standard add exactly", () => {
    for (let w = 12; w <= 60; w++) expect(add(w, 'standard'), `${w}' standard`).toBe(stdAdd(w));
    for (let w = 12; w <= 60; w++) expect(add(w, ''), `${w}' blank`).toBe(stdAdd(w));
    expect(insul(40, 60, 14, 'standard')).toBe(8340); // Sensei 40x60x14 roof + walls (F31)
    expect(insul(20, 25, 9, 'standard')).toBe(2160); // Dealer Handbook p22 example
  });
  it('roof only is unchanged at every pitch', () => {
    for (const w of [20, 30, 40, 52, 60]) for (const p of ['standard', ...PITCHES]) expect(insul(w, 40, 12, p, 'roof'), `${w} ${p}`).toBe(Math.round((w + 2) * 40 * 1.5));
    for (const p of PITCHES) expect(insul(40, 60, 14, p, 'none')).toBe(0);
  });
  it("widths over 60' are not on the chart and keep the standard add (+2)", () => {
    for (const w of [61, 62, 70, 100]) PITCHES.forEach((p) => expect(add(w, p, 'CCI', 'widespan'), `${w}' ${p}`).toBe(2));
  });
  it('CA is unchanged at every pitch (chart is CCI only)', () => {
    for (const w of [20, 40, 60]) for (const p of ['standard', ...PITCHES]) expect(add(w, p, 'CA'), `CA ${w} ${p}`).toBe(2);
    expect(insul(40, 60, 14, '6:12', 'roof-walls', {}, 'CA')).toBe(expected(40, 60, 14, 2));
  });
  it('free-standing lean-to keeps its own formula (pitch ignored)', () => {
    const fs = (p: string) => run('gInsul()', { 'insul-sel': 'roof-walls', btype: 'fslean', bw: '20', bl: '30', bh: '12', 'pitch-sel': p }) as number;
    expect(fs('6:12')).toBe(fs('standard'));
    expect(add(20, '6:12', 'CCI', 'fslean')).toBe(2);
  });
  it('GCH insulates the enclosed length only; the end-wall add still follows the pitch', () => {
    const g = (p: string) => run('gInsul()', { 'insul-sel': 'roof-walls', btype: 'gch', bw: '24', bl: '40', bh: '12', 'gch-enc': '20', 'pitch-sel': p }) as number;
    expect(g('standard')).toBe(expected(24, 20, 12, 2));
    expect(g('6:12')).toBe(expected(24, 20, 12, 3));
  });
  it('the on-screen note reads the same add as the price', () => {
    const src = html.slice(html.indexOf('var wallCost2='), html.indexOf('var wallCost2=') + 260);
    expect(src).toContain('Math.round(iw*(ih+insulEndAdd(iw))*2*INSUL_RATE)');
    expect(html).toContain('var _iAdd=insulEndAdd(w);');
  });
});
