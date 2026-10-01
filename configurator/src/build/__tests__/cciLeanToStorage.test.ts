import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI attached lean-to — closed SIDE, closed END, STORAGE, PARTIAL SIDES (+ the
 * automatic Side J Trim), 4' OC on the lean and mobile-home anchors, run
 * through the pricing program's OWN functions (public/quote-builder.html,
 * extracted into a node vm) against every row read live in Sensei on 9/30/26
 * (CCI, Florida, Standard Garages 12-24' mains unless noted, Metal / Horizontal
 * unless noted, Right lean-to Custom: Front Open · Back Closed · Side Open,
 * storage at the back): round 1 (review/sensei-storage/notes-A.md) and round 3
 * (review/sensei-storage/notes-round3.md), plus the CCI-corrected anchors the
 * side price was calibrated on in July. Everything must match to the cent,
 * except the documented "item 7" cases (lean widths 6 / 13-24 and leans on
 * 26-30' Triple Wide mains: Sensei's END price differs; widths 7 / 8: Sensei's
 * base differs — prices deliberately unchanged, rep-only note) — their SIDE
 * parts are still checked to the cent.
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
for (const v of ['WIDTHS', 'LENGTHS', 'SC', 'EC', 'VERT_SIDE', 'LT_END_P', 'LT_SIDE_P', 'STD_TIERS', 'CCI_LT_CERT_RATE', 'CCI_LT_SIDE_SHORT',
  'CCI_LT_PANEL', 'CCI_LT_SIDE_FRAC', 'ANCHOR_UNIT']) code += grabVar(v);
for (const f of ['eBkt', 'ecLookup', 'vertEndUpcharge', 'cciLtSideSecs', 'cciLtSideClosed', 'cciLtShortSideMsg', 'ltPanelsHorizontal', 'nearestStd',
  'cciLtSidePanels', 'cciLtMaxPanels', 'cciLtRunSum', 'cciLtSidePartial', 'cciUnits', 'cciUnitSum', 'cciOC4Leans', 'cciCombo12x4',
  'gAnchorLegs', 'gAnchors', 'ltSenseiDiffers',
  'getLTWalls', 'ltWallsAs', 'ltStorOn', 'ltStorLenOptions', 'getTrussOC', 'ltStorage', 'ltUnit']) code += grabFn(f);
code += 'var VERT_END=' + vertEnd + ';\nvar _CCI_COMBOS=' + cciCombos + ';\n';
code += `
var ACTIVE_MFR='CCI', PV={}, PR={}, PB={}, HU_N={}, HU_M={}, HU={};
var _G={bw:{value:'24'},btype:{value:'standard'},ws:{value:'Horizontal'},rs:{value:'Vertical'},'oc-spacing':{value:'5oc'},foundation:{value:'concrete'}};
function G(id){ return _G[id]||null; }
function MFR(){ return {standardCombinations:_CCI_COMBOS}; }
var _LTS=[], _TRUSS=0;
var document={querySelectorAll:function(s){ return s==='.lte'?_LTS:[]; }};
function getTrussInfo(){ return {count:_TRUSS}; }
function mkEl(o){
  var f={'.ltw':o.w,'.ltl2':o.l,'.lt-type':o.type||'attached','.ltst':'step','.lth':o.h,'.lth-cont':o.h,
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
    opts: ltStorLenOptions(el),
    sensei: ltSenseiDiffers(el)
  };
}
// Side wall set to v, every other wall as the lean-to has it: the side's price
// (partial + J trim) = encAdj minus the same lean-to with the side Open.
function sideAs(o, v){
  setMain(o);
  var el=mkEl(Object.assign({}, o, {side:v}));
  var u=ltUnit(el), base=ltUnit(mkEl(Object.assign({}, o, {side:'open'})));
  return {side:Math.round((u.encAdj-base.encAdj)*100)/100, j:u.jTrim||0, err:u.err, stor:ltStorage(el)};
}
function senseiNote(o){ setMain(o); return ltSenseiDiffers(mkEl(o)); }
function oc4Leans(leans, mw){ setMain({mw:mw||24, oc:4}); _LTS=leans.map(mkEl); var t=cciOC4Leans(); _LTS=[]; return t; }
function anchors(found, truss){ _G.foundation.value=found; _TRUSS=truss; var r={legs:gAnchorLegs(), total:gAnchors(), unit:ANCHOR_UNIT}; _TRUSS=0; _G.foundation.value='concrete'; return r; }
// Storage under another manufacturer (CA): the CA lean base price isn't under test here.
function ltBasePrice(){ return 0; }
function storAs(mfr, o){ var was=ACTIVE_MFR; ACTIVE_MFR=mfr; try{ setMain(o); return ltStorage(mkEl(o)); } finally { ACTIVE_MFR=was; } }
`;
type Stor = { valid: boolean; err: string; warn: string; total: number; partitionP: number; endP: number; outerP: number; len: number };
type Unit = { total: number; encAdj: number; err?: string; jTrim?: number };
type Ctx = {
  cciLtSideClosed: (h: number, l: number, vertical: boolean) => number;
  cciLtMaxPanels: (h: number) => number;
  price: (o: Record<string, unknown>) => { back: number; side: number; unit: Unit; stor: Stor; opts: number[]; sensei: string };
  sideAs: (o: Record<string, unknown>, v: string) => { side: number; j: number; err?: string; stor: Stor };
  oc4Leans: (leans: Record<string, unknown>[], mw?: number) => number;
  senseiNote: (o: Record<string, unknown>) => string;
  anchors: (found: string, truss: number) => { legs: number; total: number; unit: number };
  cciCombo12x4: (fu: string, oc: string, w: number, bt: string, l: number) => number | null;
  storAs: (mfr: string, o: Record<string, unknown>) => Stor;
  LT_SIDE_P: Record<string, number>;
};
const ctx = vm.createContext({ Math, console }) as unknown as Ctx;
vm.runInContext(code, ctx as unknown as vm.Context);

/** Round-1 Sensei rows, 9/30/26 (review/sensei-storage/notes-A.md + the sampler output). Lean-to 12' wide. */
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
  it('sections under 20 ft are priced at EVERY lean height 6-16, horizontal and vertical (round 3 short table)', () => {
    // Sensei per-side 5 / 10 / 15 ft, horizontal (H15/16 derived from Sensei's vertical reads)
    const T: Record<number, [number, number, number]> = {
      6: [65, 117.5, 172.5], 7: [80, 147.5, 217.5], 8: [85, 160, 235], 9: [90, 172.5, 252.5], 10: [105, 202.5, 297.5],
      11: [117.5, 225, 332.5], 12: [127.5, 235, 342.5], 13: [140, 262.5, 385], 14: [157.5, 295, 432.5], 15: [167.5, 317.5, 467.5], 16: [180, 342.5, 505] };
    for (const h of Object.keys(T).map(Number)) expect([5, 10, 15].map((l) => S(h, l))).toEqual(T[h]);
    // Vertical: short sections take the 20-ft VERT_SIDE column (Sensei, all live)
    expect([5, 10, 15, 20, 25, 30, 35, 40].map((l) => S(10, l, true))).toEqual([285, 382.5, 477.5, 565, 665, 782.5, 882.5, 1052.5]);
    expect([5, 10, 15, 20, 40].map((l) => S(14, l, true))).toEqual([397.5, 535, 672.5, 790, 1495]);
    expect([5, 10, 15, 20, 40].map((l) => S(15, l, true))).toEqual([407.5, 557.5, 707.5, 790, 1495]);
    expect([5, 10, 15, 20, 40].map((l) => S(16, l, true))).toEqual([480, 642.5, 805, 905, 1722.5]);
    for (let h = 6; h <= 16; h++) for (const l of [4, 5, 8, 10, 12, 15]) for (const v of [false, true]) expect(Number.isFinite(S(h, l, v))).toBe(true);
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
  it('no double charge: side already Closed → storage = the closed end only (Sensei once re-picked), no warning', () => {
    const s = ctx.price({ w: 12, l: 40, h: 10, back: 'closed', side: 'closed', stor: 'back', slen: 20 }).stor;
    expect([s.partitionP, s.endP, s.outerP, s.total]).toEqual([717.5, 0, 0, 717.5]);
    expect(s.warn).toBe('');
  });
  it('storage under 20 ft is priced at every height and with vertical panels (was "not priced" before round 3)', () => {
    const a = ctx.price({ w: 12, l: 40, h: 8, back: 'closed', stor: 'back', slen: 12, oc: 4 }).stor;
    expect(a.valid).toBe(true);
    expect(a.err).toBe('');
    expect(a.total).toBe(835);
    const v = ctx.price({ w: 12, l: 40, h: 10, back: 'closed', stor: 'back', slen: 12, oc: 4, vert: true }).stor;
    expect(v.valid).toBe(true);
    expect(v.total).toBe(1375);
    expect(ctx.price({ w: 12, l: 40, h: 8, back: 'closed', stor: 'back', slen: 20, oc: 4 }).stor.total).toBe(930);
  });
  it('a 12 ft lean-to at H8 with the side closed is priced ($235), no error', () => {
    const p = ctx.price({ w: 12, l: 12, h: 8, side: 'closed', back: 'open' });
    expect(p.unit.err).toBeUndefined();
    expect(p.side).toBe(235);
    expect(ctx.price({ w: 12, l: 12, h: 10, side: 'closed', back: 'open' }).unit.err).toBeUndefined();
  });
});

// ── Round 3 (notes-round3.md) ────────────────────────────────────────────────
let r3Checks = 0;
const eq = (got: number, want: number) => { r3Checks++; expect(got).toBe(want); };

describe('round 3 · Job 2: storage under 20 ft at every lean height (24 main, 12x40 lean)', () => {
  // [Back Closed, Side Closed full, {storage len: Sensei storage $}]
  const J2: Record<number, [number, number, Record<number, number>]> = {
    6: [485, 430, { 5: 550, 10: 602.5, 15: 657.5, 35: 835 }], 7: [537.5, 537.5, { 5: 617.5, 10: 685, 15: 755 }],
    8: [600, 645, { 5: 685, 10: 760, 15: 835 }], 9: [600, 645, { 5: 690, 10: 772.5, 15: 852.5, 20: 930 }],
    10: [717.5, 752.5, { 5: 822.5, 10: 920, 15: 1015 }], 11: [895, 860, { 5: 1012.5, 10: 1120, 15: 1227.5 }],
    12: [895, 860, { 5: 1022.5, 10: 1130, 15: 1237.5 }], 13: [1007.5, 967.5, { 5: 1147.5, 10: 1270, 15: 1392.5, 20: 1502.5 }],
    14: [1202.5, 1075, { 5: 1360, 10: 1497.5, 15: 1635, 20: 1752.5 }],
  };
  it.each(Object.keys(J2).map((h) => [Number(h)] as const))('H%i horizontal, 5\' OC', (h) => {
    const [b, sd, st] = J2[h];
    const p = ctx.price({ w: 12, l: 40, h });
    eq(p.back, b); eq(p.side, sd);
    for (const s of Object.keys(st).map(Number)) {
      const q = ctx.price({ w: 12, l: 40, h, stor: 'back', slen: s }).stor;
      expect(q.err).toBe(''); eq(q.total, st[s]);
    }
  });
  it('4\' OC rounds the storage length up to the next 5 ft (H12, H8)', () => {
    for (const [s, v] of [[4, 1022.5], [8, 1130], [12, 1237.5], [16, 1335], [20, 1335]]) eq(ctx.price({ w: 12, l: 40, h: 12, stor: 'back', slen: s, oc: 4 }).stor.total, v);
    for (const [s, v] of [[4, 685], [8, 760], [12, 835], [16, 930]]) eq(ctx.price({ w: 12, l: 40, h: 8, stor: 'back', slen: s, oc: 4 }).stor.total, v);
  });
  it('vertical (Sensei forces it on the 18\' main): H14 / H15 / H16, storage 5-20', () => {
    const V: Record<number, [number, number, number[]]> = {
      14: [1382.5, 1495, [1780, 1917.5, 2055, 2172.5]], 15: [1382.5, 1495, [1790, 1940, 2090, 2172.5]], 16: [1480, 1722.5, [1960, 2122.5, 2285, 2385]] };
    for (const h of [14, 15, 16]) {
      const [b, sd, st] = V[h];
      const p = ctx.price({ w: 12, l: 40, h, vert: true });
      eq(p.back, b); eq(p.side, sd);
      [5, 10, 15, 20].forEach((s, i) => eq(ctx.price({ w: 12, l: 40, h, stor: 'back', slen: s, vert: true }).stor.total, st[i]));
    }
  });
});

describe('round 3 · Job 3 confirmations (24x40x14 main, 12x40x10 lean unless noted)', () => {
  it('a) lean width: storage 20 − Back Closed = $385 at every width 6-24; Back + storage exact at W7-12', () => {
    const WB: Record<number, number> = { 6: 358.75, 7: 490, 8: 490, 9: 490, 10: 565, 11: 642.5, 12: 717.5, 13: 980, 14: 980, 15: 980, 16: 1290, 17: 1490, 18: 1490, 19: 1710, 20: 1710, 21: 1930, 22: 1930, 23: 2370, 24: 2370 };
    for (const w of Object.keys(WB).map(Number)) {
      const p = ctx.price({ w, l: 40, h: 10, stor: 'back', slen: 20 });
      eq(p.stor.outerP, 385); // the side part does not depend on the lean width
      if (w >= 7 && w <= 12) { eq(p.back, WB[w]); eq(p.stor.total, WB[w] + 385); }
      // item 7: W6 / W13-24 end price differs, W7 / W8 base differs → rep note, price unchanged
      if (w >= 9 && w <= 12) expect(p.sensei).toBe(''); else expect(p.sensei).toMatch(/wide lean-to/);
    }
  });
  it('b) vertical siding: Back $897.50, Side $1,052.50, storage 5-35', () => {
    const p = ctx.price({ w: 12, l: 40, h: 10, vert: true });
    eq(p.back, 897.5); eq(p.side, 1052.5);
    [[5, 1182.5], [10, 1280], [15, 1375], [20, 1462.5], [25, 1562.5], [30, 1680], [35, 1780]].forEach(([s, v]) =>
      eq(ctx.price({ w: 12, l: 40, h: 10, stor: 'back', slen: s, vert: true }).stor.total, v));
  });
  it('b) horizontal storage 25 / 30 / 35', () => {
    [[25, 1172.5], [30, 1260], [35, 1330]].forEach(([s, v]) => eq(ctx.price({ w: 12, l: 40, h: 10, stor: 'back', slen: s }).stor.total, v));
  });
  it('c) Back Open + storage 20 = Sensei\'s locked Back $717.50 + storage $1,102.50', () => {
    const p = ctx.price({ w: 12, l: 40, h: 10, back: 'open', stor: 'back', slen: 20 });
    eq(Math.round((p.unit.encAdj + p.stor.total) * 100) / 100, 717.5 + 1102.5);
  });
  it('d) Front Closed + storage 20 = $717.50 + $717.50 + $1,102.50', () => {
    const p = ctx.price({ w: 12, l: 40, h: 10, front: 'closed', stor: 'back', slen: 20 });
    eq(Math.round((p.unit.encAdj + p.stor.total) * 100) / 100, 717.5 + 717.5 + 1102.5);
  });
  it('e) Side Closed + storage: storage = the end only ($717.50) at 5 / 15 / 20 / 35, side $752.50', () => {
    for (const s of [5, 15, 20, 35]) {
      const p = ctx.price({ w: 12, l: 40, h: 10, side: 'closed', stor: 'back', slen: s });
      eq(p.stor.total, 717.5); expect(p.stor.warn).toBe('');
    }
    eq(ctx.price({ w: 12, l: 40, h: 10 }).side, 752.5);
    const s60 = ctx.price({ w: 12, l: 60, h: 10, side: 'closed', stor: 'back', slen: 20 });
    eq(s60.side, 1085); eq(s60.stor.total, 717.5);
  });

  // f) partial sides: [side $, J trim $] per Sensei, the program's side + J must match both.
  const PART = (tag: string, h: number, l: number, slen: number, v: string, side: number, j: number, storTotal?: number) =>
    it(`f) ${tag}: ${v} → $${side} + J trim $${j}`, () => {
      const o = slen ? { w: 12, l, h, stor: 'back', slen } : { w: 12, l, h, back: 'open' };
      const r = ctx.sideAs(o, v);
      expect(r.err).toBeUndefined();
      eq(r.j, j); eq(r.side, Math.round((side + j) * 100) / 100);
      if (storTotal != null) { eq(r.stor.total, storTotal); expect(r.stor.warn).toBe(''); }
    });
  // f1: 40' lean, H10, storage 20 (run 20) — storage stays $1,102.50 with any partial
  for (const [v, s] of [['q1', 96.25], ['q2', 192.5], ['q3', 288.75], ['1panel', 110], ['2panel', 220], ['3panel', 330]] as const) PART('f1 L40 H10 storage 20', 10, 40, 20, v, s, 60, 1102.5);
  PART('f1 L40 H10 storage 5 (run 35)', 10, 40, 5, 'q3', 459.38, 95, 822.5);
  // f2: 40' lean, H10, no storage
  for (const [v, s] of [['q1', 188.13], ['q2', 376.25], ['q3', 564.38], ['1panel', 220], ['2panel', 440], ['3panel', 660]] as const) PART('f2 L40 H10', 10, 40, 0, v, s, 110);
  // f3: 20' lean, H10, no storage
  for (const [v, s] of [['q1', 96.25], ['q2', 192.5], ['q3', 288.75], ['1panel', 110], ['2panel', 220], ['3panel', 330]] as const) PART('f3 L20 H10', 10, 20, 0, v, s, 60);
  // f4: 20' lean, H10, storage 5 / 10 / 15 → always the full 20' run
  for (const [sl, st] of [[5, 822.5], [10, 920], [15, 1015]] as const) { PART('f4 L20 H10 storage ' + sl, 10, 20, sl, 'q2', 192.5, 60, st); PART('f4 L20 H10 storage ' + sl, 10, 20, sl, '1panel', 110, 60, st); }
  for (const [v, s] of [['q1', 96.25], ['q3', 288.75], ['2panel', 220], ['3panel', 330]] as const) PART('f4 L20 H10 storage 10', 10, 20, 10, v, s, 60, 920);
  // f5: 40' lean, H10 — run = max(20, 40 − storage)
  for (const [sl, half, pan, j, st] of [[5, 306.25, 175, 95, 822.5], [10, 271.25, 155, 85, 920], [15, 227.5, 130, 70, 1015], [20, 192.5, 110, 60, 1102.5],
    [25, 192.5, 110, 60, 1172.5], [30, 192.5, 110, 60, 1260], [35, 192.5, 110, 60, 1330]] as const) {
    PART('f5 L40 H10 storage ' + sl, 10, 40, sl, 'q2', half, j, st); PART('f5 L40 H10 storage ' + sl, 10, 40, sl, '1panel', pan, j, st);
  }
  // f6 / f7: 40' lean at H12 (panels do not depend on height)
  for (const [v, s] of [['q1', 110], ['q2', 220], ['q3', 330], ['1panel', 110], ['2panel', 220], ['3panel', 330]] as const) PART('f6 L40 H12 storage 20', 12, 40, 20, v, s, 60, 1335);
  for (const [v, s] of [['q1', 215], ['q2', 430], ['1panel', 220], ['2panel', 440], ['3panel', 660]] as const) PART('f7 L40 H12', 12, 40, 0, v, s, 110);
  // f8 / f9: 60' lean, H10 (24x60 main)
  for (const [sl, half, pan, j, st] of [[20, 376.25, 220, 110, 1102.5], [30, 271.25, 155, 85, 1260], [40, 192.5, 110, 60, 1470], [45, 192.5, 110, 60, 1557.5], [55, 192.5, 110, 60, 1715]] as const) {
    PART('f8 L60 H10 storage ' + sl, 10, 60, sl, 'q2', half, j, st); PART('f8 L60 H10 storage ' + sl, 10, 60, sl, '1panel', pan, j, st);
  }
  for (const [v, s] of [['q1', 271.25], ['q2', 542.5], ['1panel', 310], ['2panel', 620], ['3panel', 930]] as const) PART('f9 L60 H10', 10, 60, 0, v, s, 170);
  // Job 2 incidental: H7, storage 15 (run 25), 3/4 Closed
  PART('J2 H7 L40 storage 15 (run 25)', 7, 40, 15, 'q3', 243.75, 70, 755);

  it('Open and Closed sides carry no J trim', () => {
    expect(ctx.sideAs({ w: 12, l: 40, h: 10, back: 'open' }, 'closed').j).toBe(0);
    expect(ctx.sideAs({ w: 12, l: 40, h: 10, back: 'open' }, 'open').j).toBe(0);
  });
  it('panels offered: floor((H−1)/3) — 1 at H6, 2 at H7-9, 3 at H10-12, 4 at H13-15, 5 at H16; others flagged, never priced', () => {
    expect([6, 7, 9, 10, 12, 13, 15, 16].map((h) => ctx.cciLtMaxPanels(h))).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
    const ok4 = ctx.sideAs({ w: 12, l: 40, h: 13, back: 'open' }, '4panel');
    expect(ok4.err).toBeUndefined(); expect(ok4.side).toBe(4 * 220 + 110);
    const ok5 = ctx.sideAs({ w: 12, l: 40, h: 16, back: 'open' }, '5panel');
    expect(ok5.err).toBeUndefined(); expect(ok5.side).toBe(5 * 220 + 110);
    const bad = ctx.sideAs({ w: 12, l: 40, h: 12, back: 'open' }, '4panel');
    expect(bad.err).toMatch(/isn't offered/); expect(bad.side).toBe(0);
    expect(ctx.sideAs({ w: 12, l: 40, h: 8, back: 'open' }, '3panel').err).toMatch(/isn't offered/);
  });
  it('g) 4\' OC on the lean: 12x40 → $400, 12x20 → $300, 6x40 → $400 (lean width makes no difference)', () => {
    eq(ctx.oc4Leans([{ w: 12, l: 40, h: 10 }]), 400);
    eq(ctx.oc4Leans([{ w: 12, l: 20, h: 10 }]), 300);
    eq(ctx.oc4Leans([{ w: 6, l: 40, h: 10 }]), 400);
    expect(ctx.oc4Leans([{ w: 12, l: 40, h: 10, type: 'freestanding' }])).toBe(0);
    expect(ctx.oc4Leans([{ w: 12, l: 40, h: 10 }, { w: 10, l: 60, h: 8 }])).toBe(400 + 2 * 350); // 60' = 30 + 30 connected units
  });
  it('h) owner case: storage side part on a Triple Wide 30 main is the Standard one; Standard 24 4\' OC exact', () => {
    const tw = ctx.price({ w: 10, l: 40, h: 12, stor: 'back', slen: 12, mw: 30, oc: 4 });
    eq(tw.stor.outerP, 1110 - 767.5);
    eq(ctx.price({ w: 10, l: 40, h: 12, stor: 'back', slen: 36, mw: 30, oc: 4 }).stor.outerP, 1627.5 - 767.5);
    expect(tw.sensei).toMatch(/Triple Wide/); // item 7: Sensei's end on a TW main is $767.50 vs our $700 — rep note, price unchanged
    const st = ctx.price({ w: 10, l: 40, h: 12, stor: 'back', slen: 12, mw: 24, oc: 4 });
    eq(st.back, 700); eq(st.stor.total, 1042.5); expect(st.sensei).toBe('');
    eq(ctx.price({ w: 10, l: 40, h: 12, stor: 'back', slen: 36, mw: 24, oc: 4 }).stor.total, 1560);
  });
});

describe('round 3 · Job 4 (Triple Wide 26 main, 12x40x10 lean): side parts exact, end = item 7', () => {
  it('side full $752.50, storage 20 side part $385, storage 36 side part $752.50', () => {
    const p = ctx.price({ w: 12, l: 40, h: 10, stor: 'back', slen: 20, mw: 26, oc: 4 });
    eq(p.side, 752.5); eq(p.stor.outerP, 1240 - 855);
    eq(ctx.price({ w: 12, l: 40, h: 10, stor: 'back', slen: 36, mw: 26, oc: 4 }).stor.outerP, 1607.5 - 855);
    expect(p.sensei).toMatch(/26' \(Triple Wide\) main/);
  });
});

describe('round 3 · Job 1: mobile home anchors (Sensei "Mobile Home Anchor 30\\"" $70, one per leg)', () => {
  it('32 legs (16 frames) on ground = 32 × $70 = $2,240; concrete = $0', () => {
    const g = ctx.anchors('ground', 16);
    eq(g.unit, 70); eq(g.legs, 32); eq(g.total, 2240);
    expect(ctx.anchors('concrete', 16).total).toBe(0);
  });
});

describe('item-7 rep note and the 12GA + 4\' OC combo', () => {
  it('note only on CCI attached lean widths 6-8 / 13-24 or 26-30 mains — never on W9-12 Standard', () => {
    for (const w of [9, 10, 11, 12]) expect(ctx.price({ w, l: 40, h: 10 }).sensei).toBe('');
    for (const w of [6, 7, 8, 14, 16, 20]) expect(ctx.price({ w, l: 40, h: 10 }).sensei).not.toBe('');
    for (const mw of [26, 28, 30]) expect(ctx.price({ w: 12, l: 40, h: 10, mw }).sensei).not.toBe('');
    expect(ctx.senseiNote({ w: 14, l: 40, h: 10, type: 'freestanding' })).toBe('');
  });
  it('12GA + 4\' OC combined row still applies on ≤24\' mains (lean 4\' OC left out there)', () => {
    expect(ctx.cciCombo12x4('12', '4oc', 24, 'standard', 40)).toBe(840);
    expect(ctx.cciCombo12x4('14', '4oc', 24, 'standard', 40)).toBeNull();
  });
  it('round-3 checks counted', () => {
    expect(r3Checks).toBe(330);
  });
});

describe('storage + partial side caution: CA / free-standing keep it, CCI has none (Sensei prices the CCI partial on the open run)', () => {
  const CAUTION = 'Side wall is set to a partial option — its partial price stays and the storage outer wall is added in full. Verify.';
  it.each(['q1', 'q2', 'q3', '1panel', '2panel', '3panel'])('CA side %s + storage → caution; flat partial stays, outer wall added in full', (side) => {
    const s = ctx.storAs('CA', { w: 12, l: 40, h: 10, back: 'closed', side, stor: 'back', slen: 12 });
    expect(s.valid).toBe(true);
    expect(s.warn).toBe(CAUTION);
    expect(s.outerP).toBe(ctx.LT_SIDE_P.closed);
  });
  it('CA side Open or Closed + storage → no caution', () => {
    expect(ctx.storAs('CA', { w: 12, l: 40, h: 10, back: 'closed', side: 'open', stor: 'back', slen: 12 }).warn).toBe('');
    expect(ctx.storAs('CA', { w: 12, l: 40, h: 10, back: 'closed', side: 'closed', stor: 'back', slen: 12 }).warn).toBe('');
  });
  it('CCI attached side 1/2 Closed + storage → no caution', () => {
    const s = ctx.storAs('CCI', { w: 12, l: 40, h: 10, back: 'closed', side: 'q2', stor: 'back', slen: 10 });
    expect(s.valid).toBe(true);
    expect(s.warn).toBe('');
  });
});
