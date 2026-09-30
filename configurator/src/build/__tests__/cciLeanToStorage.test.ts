import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI attached lean-to — closed SIDE, closed END and STORAGE pricing, run
 * through the pricing program's OWN functions (public/quote-builder.html,
 * extracted into a node vm) against every row read live in Sensei on 9/30/26
 * (CCI, Florida, Standard Garages 12-24' mains, Metal / Horizontal, Right
 * lean-to Custom: Front Open · Back Closed · Side Open, storage at the back),
 * plus the CCI-corrected anchors the side price was calibrated on in July.
 * Everything must match to the cent.
 */

const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

function grabVar(name: string): string {
  const m = new RegExp('\\n\\s*var ' + name + '\\s*=').exec(html);
  if (!m) throw new Error('no var ' + name);
  const i = html.indexOf('=', m.index) + 1;
  let depth = 0;
  let j = i;
  let inStr: string | null = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth === 0) break;
  }
  return 'var ' + name + '=' + html.slice(i, j) + ';\n';
}
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  const i = m.index + 1;
  let j = html.indexOf('{', i);
  let depth = 0;
  let inStr: string | null = null;
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
  return html.slice(i, j + 1) + '\n';
}

const vertEnd = /CCI:\s*\{[\s\S]*?vertEnd:\s*(\{[^}]*\})/.exec(html)![1];
const cciCombos = /CCI:\s*\{[\s\S]*?standardCombinations:\s*(\{[\s\S]*?\})/.exec(html)![1];

let code = '';
for (const v of ['WIDTHS', 'LENGTHS', 'SC', 'EC', 'VERT_SIDE', 'LT_END_P', 'LT_SIDE_P', 'STD_TIERS', 'CCI_LT_CERT_RATE', 'CCI_LT_SIDE_SHORT']) code += grabVar(v);
for (const f of ['eBkt', 'ecLookup', 'vertEndUpcharge', 'cciLtSideSecs', 'cciLtSideClosed', 'cciLtShortSideMsg', 'ltPanelsHorizontal', 'nearestStd',
  'getLTWalls', 'ltWallsAs', 'ltStorOn', 'ltStorLenOptions', 'getTrussOC', 'ltStorage', 'ltUnit']) code += grabFn(f);
code += 'var VERT_END=' + vertEnd + ';\nvar _CCI_COMBOS=' + cciCombos + ';\n';
code += `
var ACTIVE_MFR='CCI', PV={}, PR={}, PB={}, HU_N={}, HU_M={}, HU={};
var _G={bw:{value:'24'},btype:{value:'standard'},ws:{value:'Horizontal'},rs:{value:'Vertical'},'oc-spacing':{value:'5oc'}};
function G(id){ return _G[id]||null; }
function MFR(){ return {standardCombinations:_CCI_COMBOS}; }
function mkEl(o){
  var f={'.ltw':o.w,'.ltl2':o.l,'.lt-type':'attached','.ltst':'step','.lth':o.h,'.lth-cont':o.h,
         '.lt-wm':'custom','.lt-wall-front':o.front||'open','.lt-wall-back':o.back||'closed','.lt-wall-side':o.side||'open',
         '.lt-stor':o.stor||'none','.lt-stor-len':o.slen==null?'':String(o.slen)};
  return {querySelector:function(s){ return (s in f)?{value:String(f[s])}:null; }};
}
function setMain(o){
  _G.bw.value=String(o.mw||24); _G['oc-spacing'].value=o.oc===4?'4oc':'5oc';
  _G.ws.value=o.vert?'Vertical':'Horizontal'; _G.btype.value=o.btype||'standard';
}
function price(o){
  setMain(o);
  var el=mkEl(o);
  var open3=ltUnit(el, ltWallsAs('open','open','open')).encAdj;
  return {
    back: ltUnit(el, ltWallsAs('open','closed','open')).encAdj - open3,
    side: ltUnit(el, ltWallsAs('open','open','closed')).encAdj - open3,
    unit: ltUnit(el),
    stor: ltStorage(el),
    opts: ltStorLenOptions(el)
  };
}
`;
type Stor = { valid: boolean; err: string; warn: string; total: number; partitionP: number; endP: number; outerP: number; len: number };
type Ctx = {
  cciLtSideClosed: (h: number, l: number, vertical: boolean) => number;
  price: (o: Record<string, unknown>) => { back: number; side: number; unit: { total: number; encAdj: number; err?: string }; stor: Stor; opts: number[] };
};
const ctx = vm.createContext({ Math, console }) as unknown as Ctx;
vm.runInContext(code, ctx as unknown as vm.Context);

/** Sensei rows, 9/30/26 (review/sensei-storage/notes-A.md + the sampler output). Lean-to 12' wide. */
type Row = { tag: string; mw: number; ml: number; mh: number; oc: 4 | 5; l: number; h: number; slen: number; stor: number; back?: number; side?: number };
const R: Row[] = [];
const add = (tag: string, mw: number, ml: number, mh: number, oc: 4 | 5, l: number, h: number, slen: number, stor: number, back?: number, side?: number) =>
  R.push({ tag, mw, ml, mh, oc, l, h, slen, stor, back, side });
// 24x40x14 + 12x40x10, storage sweep at 5' OC and 4' OC (owner screenshots 52/53 = the 20 ft rows)
for (const [s, p] of [[5, 822.5], [10, 920], [15, 1015], [20, 1102.5], [25, 1172.5], [30, 1260], [35, 1330]] as const) add('24x40x14 5OC', 24, 40, 14, 5, 40, 10, s, p, 717.5, 752.5);
for (const [s, p] of [[4, 822.5], [8, 920], [12, 1015], [16, 1102.5], [20, 1102.5], [24, 1172.5], [28, 1260], [32, 1330], [36, 1470]] as const) add('24x40x14 4OC', 24, 40, 14, 4, 40, 10, s, p, 717.5, 752.5);
// Main width / OC do not move it
for (const mw of [22, 20, 18, 12]) for (const oc of [5, 4] as const) add(mw + 'x40x14 ' + oc + 'OC', mw, 40, 14, oc, 40, 10, 20, 1102.5, 717.5);
// Lean length 20 / 30 / 50 at 4' OC (the extra lengths are the same live read's notes)
for (const [s, p] of [[4, 822.5], [8, 920], [12, 1015], [16, 1102.5]] as const) add('24x20x14 4OC', 24, 20, 14, 4, 20, 10, s, p, 717.5, 385);
for (const [s, p] of [[12, 1015], [20, 1102.5], [24, 1172.5]] as const) add('24x30x14 4OC', 24, 30, 14, 4, 30, 10, s, p, 717.5, 542.5);
for (const [s, p] of [[20, 1102.5], [24, 1172.5], [36, 1470], [40, 1470], [44, 1557.5]] as const) add('24x50x14 4OC', 24, 50, 14, 4, 50, 10, s, p, 717.5, 910);
// Main wall height does not move it; a 10' main forces the lean down to 8'
add('24x40x16 4OC', 24, 40, 16, 4, 40, 10, 20, 1102.5, 717.5, 752.5);
add('24x40x12 4OC', 24, 40, 12, 4, 40, 10, 20, 1102.5, 717.5);
add('24x40x10 4OC lean 8', 24, 40, 10, 4, 40, 8, 20, 930, 600, 645);
// Lean height sweep, storage 20
for (const [h, b, s, p] of [[6, 485, 430, 705], [7, 537.5, 537.5, 812.5], [8, 600, 645, 930], [9, 600, 645, 930], [11, 895, 860, 1335], [12, 895, 860, 1335], [13, 1007.5, 967.5, 1502.5], [14, 1202.5, 1075, 1752.5]] as const)
  add('24x40x16 4OC lean H' + h, 24, 40, 16, 4, 40, h, 20, p, b, s);

describe('CCI lean-to storage = one closed lean end + the side price at ceil5(storage length) (Sensei 9/30/26)', () => {
  it.each(R.map((r) => [r.tag + ' · storage ' + r.slen + ' ft', r] as const))('%s', (_n, r) => {
    const p = ctx.price({ w: 12, l: r.l, h: r.h, back: 'closed', stor: 'back', slen: r.slen, mw: r.mw, oc: r.oc });
    expect(p.stor.err).toBe('');
    expect(p.stor.valid).toBe(true);
    // Back already Closed → the storage adds the partition + the outer wall only.
    expect(p.stor.endP).toBe(0);
    expect(p.stor.total).toBe(r.stor);
    expect(p.stor.partitionP + p.stor.outerP).toBe(r.stor);
    if (r.back != null) expect(p.back).toBe(r.back);
    if (r.side != null) expect(p.side).toBe(r.side);
  });

  it('covers every sampled row', () => {
    expect(R.length).toBe(47); // 39 table rows + 8 lengths read in the same run's notes
  });
});

describe('cciLtSideClosed — half-of-2W, 5 ft round-up, sections', () => {
  const S = (h: number, l: number, v = false) => ctx.cciLtSideClosed(h, l, v);
  it('CCI-corrected anchors still exact', () => {
    expect(S(10, 60)).toBe(1085);
    expect(S(12, 60)).toBe(1240);
    expect(S(12, 60, true)).toBe(1900);
    expect(S(12, 100, true)).toBe(3100);
  });
  it('Sensei side values at a 10 ft lean height (horizontal)', () => {
    expect([5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((l) => S(10, l))).toEqual([105, 202.5, 297.5, 385, 455, 542.5, 612.5, 752.5, 840, 910]);
    // 5 ft round-up: 4→5, 8→10, 12→15, 16→20, 36→40, 44→45
    expect([4, 8, 12, 16, 36, 44].map((l) => S(10, l))).toEqual([105, 202.5, 297.5, 385, 752.5, 840]);
  });
  it('40 ft side at every sampled lean height keeps cents', () => {
    expect([6, 7, 8, 9, 10, 11, 12, 13, 14].map((h) => S(h, 40))).toEqual([430, 537.5, 645, 645, 752.5, 860, 860, 967.5, 1075]);
  });
  it('past 50 ft: CCI standardCombinations, each roof tier minus 1', () => {
    expect(S(10, 55)).toBe((1085 + 910) / 2); // 30 + 25
    expect(S(10, 80)).toBe(1505); // 40 + 40
    expect(S(10, 100)).toBe((1225 + 1225 + 1085) / 2); // 35 + 35 + 30
    expect(S(10, 105)).toBe((1225 * 3) / 2); // 35 + 35 + 35
  });
  it('past the table keeps the old CCI growth rate ($54/ft per $2,560 of 40 ft column), in cents', () => {
    expect(S(12, 110, true)).toBe(Math.round((2560 + 15 * 54) * 100) / 100);
    expect(S(10, 110)).toBe(Math.round((1505 + 15 * 54 * (1505 / 2560)) * 100) / 100);
  });
  it('sections under 20 ft are known only at a 10 ft lean height, horizontal — anything else is NaN (not priced)', () => {
    expect(S(10, 15)).toBe(297.5);
    for (const h of [6, 7, 8, 9, 11, 12, 13, 14, 15, 16]) expect(S(h, 15)).toBeNaN();
    expect(S(10, 15, true)).toBeNaN();
    expect(S(10, 20, true)).toBe((770 + 360) / 2);
  });
});

describe('storage rules around the formula', () => {
  it('closed ends keep cents (W12: H7 537.50, H10 717.50, H13 1,007.50, H14 1,202.50)', () => {
    expect([7, 10, 13, 14].map((h) => ctx.price({ w: 12, l: 40, h }).back)).toEqual([537.5, 717.5, 1007.5, 1202.5]);
  });
  it('storage lengths = frame-line steps OC × k, k = 1 .. floor(L/OC) − 1', () => {
    expect(ctx.price({ w: 12, l: 40, h: 10, oc: 5 }).opts).toEqual([5, 10, 15, 20, 25, 30, 35]);
    expect(ctx.price({ w: 12, l: 40, h: 10, oc: 4 }).opts).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36]);
    expect(ctx.price({ w: 12, l: 20, h: 10, oc: 4 }).opts).toEqual([4, 8, 12, 16]);
    expect(ctx.price({ w: 12, l: 50, h: 10, oc: 4 }).opts.slice(-1)).toEqual([44]);
    expect(ctx.price({ w: 12, l: 40, h: 10, mw: 30, oc: 5 }).opts[0]).toBe(4); // 26'+ mains are always 4' OC
    const off = ctx.price({ w: 12, l: 40, h: 10, back: 'closed', stor: 'back', slen: 10, oc: 4 }).stor;
    expect(off.valid).toBe(false); // 10 ft is not on a 4 ft frame line
  });
  it('storage end top-up: back Open → the storage closes it (one closed end) on top of the partition', () => {
    const s = ctx.price({ w: 12, l: 40, h: 10, back: 'open', stor: 'back', slen: 20 }).stor;
    expect([s.partitionP, s.endP, s.outerP, s.total]).toEqual([717.5, 717.5, 385, 1820]);
  });
  it('no double charge: side already Closed → no second side, rep-only Sensei note', () => {
    const s = ctx.price({ w: 12, l: 40, h: 10, back: 'closed', side: 'closed', stor: 'back', slen: 20 }).stor;
    expect([s.partitionP, s.endP, s.outerP, s.total]).toEqual([717.5, 0, 0, 717.5]);
    expect(s.warn).toMatch(/Sensei charges the storage side again when the side is closed; verify with CCI/);
  });
  it('storage under 20 ft away from a 10 ft lean height, or vertical, is not priced', () => {
    const a = ctx.price({ w: 12, l: 40, h: 8, back: 'closed', stor: 'back', slen: 12, oc: 4 }).stor;
    expect(a.valid).toBe(false);
    expect(a.total).toBe(0);
    expect(a.err).toMatch(/^Storage under 20 ft at this height isn't priced yet — verify with CCI/);
    const v = ctx.price({ w: 12, l: 40, h: 10, back: 'closed', stor: 'back', slen: 12, oc: 4, vert: true }).stor;
    expect(v.valid).toBe(false);
    expect(v.err).toMatch(/^Storage under 20 ft with vertical panels isn't priced yet — verify with CCI/);
    // 20 ft and up is priced at any height
    expect(ctx.price({ w: 12, l: 40, h: 8, back: 'closed', stor: 'back', slen: 20, oc: 4 }).stor.total).toBe(930);
  });
  it('a lean-to whose own closed side is under 20 ft with no known price is flagged, never NaN', () => {
    const u = ctx.price({ w: 12, l: 12, h: 8, side: 'closed', back: 'open' }).unit;
    expect(Number.isFinite(u.total)).toBe(true);
    expect(u.err).toMatch(/^Lean-to side under 20 ft at this height isn't priced yet — verify with CCI/);
    const ok = ctx.price({ w: 12, l: 12, h: 10, side: 'closed', back: 'open' }).unit;
    expect(ok.err).toBeUndefined();
  });
});
