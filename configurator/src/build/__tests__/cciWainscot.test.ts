import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI wainscot = Sensei "Add Wainscot (Full Building)" (Carolina Carports Inc,
 * Florida), sampled 10/5/26: EVERY reading in
 *   3D-Render-Handoff/review/sensei-wainscot/sensei-wainscot-2026-10-05.md        (#1-64)
 *   3D-Render-Handoff/review/sensei-wainscot/sensei-wainscot-2026-10-05-part2.md  (#65-149)
 * (fitted in RULES.md) is run through the pricing program's OWN gWainscot()
 * (public/quote-builder.html, extracted into a node vm) and must match to the
 * dollar — wainscot line only. The CA path must be unchanged, and the CCI
 * Free-Standing Lean-To main (not sampled) keeps the rule it had before 10/5.
 *
 * Sensei → program mapping:
 *   Standard Garages / Triple Wide Garages (12-30) → btype standard
 *   Commercial Buildings (32-100)                 → btype widespan
 *   Utility Carports / Triple Wide Carports + Back Storage → btype gch
 *     (Back Storage depth = gch-enc; Left/Right Wall = gch-left/right; Front Wall = wfg)
 *   Center Building Back / Left / Right Storage   → add-end-wall yes / left / right
 *   Lean-to walls / Add Storage                   → .lte custom walls / lt-stor back
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
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
}
/** A manufacturer's method, e.g. MANUFACTURERS.CA.wainscotBuckets → its function expression. */
function grabMethod(mfr: 'CA' | 'CCI', name: string): string {
  const at = html.indexOf('\n  ' + mfr + ': {');
  if (at < 0) throw new Error('no MANUFACTURERS.' + mfr);
  const k = html.indexOf(name + ': function', at);
  if (k < 0) throw new Error('no ' + mfr + '.' + name);
  const f = html.indexOf('function', k);
  return html.slice(f, matchEnd(f) + 1);
}

const vertEnd = /CCI:\s*\{[\s\S]*?vertEnd:\s*(\{[^}]*\})/.exec(html)![1];
const cciCombos = /CCI:\s*\{[\s\S]*?standardCombinations:\s*(\{[\s\S]*?\})/.exec(html)![1];

let code = '';
for (const v of ['WIDTHS', 'LENGTHS', 'SC', 'EC', 'VERT_SIDE', 'LT_END_P', 'LT_SIDE_P', 'STD_TIERS', 'CCI_LT_CERT_RATE', 'CCI_LT_SIDE_SHORT',
  'CCI_LT_PANEL', 'CCI_LT_SIDE_FRAC', 'ANCHOR_UNIT', 'LR_STORAGE', 'LR_VERT_ADD', 'CCI_WAIN_END']) code += grabVar(v);
for (const f of ['eBkt', 'ecLookup', 'vertEndUpcharge', 'cciLtSideSecs', 'cciLtSideClosed', 'cciLtShortSideMsg', 'ltPanelsHorizontal', 'nearestStd',
  'cciLtSidePanels', 'cciLtMaxPanels', 'cciLtRunSum', 'cciLtSidePartial', 'cciUnits', 'cciUnitSum',
  'getLTWalls', 'ltWallsAs', 'ltStorOn', 'ltStorLenOptions', 'getTrussOC', 'ltStorage', 'ltUnit',
  'lrStorageLookup', 'aewUnset', 'aewSpec', 'gAddEndWall',
  'wainscotPrintOpt', 'cciWainscotPre', 'cciWainEnd', 'cciWainSide', 'cciWainLeanEnd', 'cciWainscot', 'gWainscot']) code += grabFn(f);
code += 'var VERT_END=' + vertEnd + ';\nvar _CCI_COMBOS=' + cciCombos + ';\n';
code += 'var MANUFACTURERS={CA:{wainscotBuckets:' + grabMethod('CA', 'wainscotBuckets') + '},CCI:{wainscotBuckets:' + grabMethod('CCI', 'wainscotBuckets') + ',standardCombinations:_CCI_COMBOS}};\n';
code += `
var ACTIVE_MFR='CCI', INPUT_MODE=false, PV={}, PR={}, PB={}, HU_N={}, HU_M={}, HU={};
function MFR(){ return MANUFACTURERS[ACTIVE_MFR]; }
var _G={}, _LTS=[];
function G(id){ return _G[id]||null; }
var document={querySelectorAll:function(s){ return s==='.lte'?_LTS:[]; }};
function getTrussInfo(){ return {count:0}; }
function ltBasePrice(){ return 0; }
function v(x){ return {value:String(x)}; }
function mkLean(o){
  var f={'.ltw':o.w,'.ltl2':o.l,'.lt-type':o.type||'attached','.ltst':'step','.lth':o.h||10,'.lth-cont':o.h||10,
         '.lt-wm':'custom','.lt-wall-front':o.front||'open','.lt-wall-back':o.back||'open','.lt-wall-side':o.side||'open',
         '.lt-stor':o.stor?'back':'none','.lt-stor-len':o.stor?String(o.stor):''};
  return {querySelector:function(s){ return (s in f)?{value:String(f[s])}:null; }};
}
function setBuild(c){
  ACTIVE_MFR=c.mfr||'CCI';
  var bt=c.bt||'standard', def=(bt==='gch')?'Open':'Closed';
  _G={
    btype:v(bt), bw:v(c.w), bl:v(c.l), bh:v(c.h||10), ws:v(c.horiz?'Horizontal':'Vertical'), wain:v(c.wain===false?'no':'yes'),
    wfg:v(c.front||def), wbg:v(c.back||'Closed'), wle:v(c.left||def), wre:v(c.right||def),
    'add-end-wall':{value:c.aew||(bt==='gch'?'yes':'no'), dataset:{}}, 'aew-end':v('back'), 'aew-depth':v(c.depth||''), 'aew-width':v(c.swidth||''),
    'gch-enc':v(c.enc||''), 'gch-left':v(c.gl||'open'), 'gch-right':v(c.gr||'open'),
    rs:v('Vertical'), 'oc-spacing':v('5oc'), foundation:v('concrete'),
    cwn:{selectedIndex:0, options:[{getAttribute:function(a){ return (a==='data-print'&&c.print)?'1':null; }}]}
  };
  _LTS=(c.leans||[]).map(mkLean);
}
function wain(c){ setBuild(c); return gWainscot(); }
function detail(c){ setBuild(c); return cciWainscot(); }
function stor(c){ setBuild(c); return _LTS.map(function(el){ return ltStorage(el); }); }
`;
type Lean = { w: number; l: number; h?: number; front?: string; back?: string; side?: string; stor?: number; type?: string };
type Case = {
  mfr?: 'CA' | 'CCI'; bt?: string; w: number; l: number; h?: number; horiz?: boolean; wain?: boolean; print?: boolean;
  front?: string; back?: string; left?: string; right?: string; aew?: string; depth?: number; swidth?: number;
  enc?: number; gl?: string; gr?: string; leans?: Lean[];
};
type Ctx = {
  wain: (c: Case) => number;
  detail: (c: Case) => { total: number; sum: number; parts: { k: string; label: string; amt: number }[]; covers: string; warn: string };
  stor: (c: Case) => { valid: boolean; err: string }[];
  cciWainEnd: (w: number) => number;
  cciWainSide: (l: number, w: number) => number;
  cciWainLeanEnd: (w: number) => number;
};
const ctx = vm.createContext({ Math, console, parseInt, parseFloat, isNaN, String, Number, Object }) as unknown as Ctx;
vm.runInContext(code, ctx as unknown as vm.Context);

/** One Sensei reading: # (from the two files), what was built, the wainscot Sensei charged. */
type Reading = { n: number; tag: string; c: Case; sensei: number };
const R: Reading[] = [];
const add = (n: number, tag: string, c: Case, sensei: number) => R.push({ n, tag, c, sensei });

// ── Part 1 (sensei-wainscot-2026-10-05.md) ─────────────────────────────────────
// A1 width sweep, Standard Garages Wx40x10 fully enclosed
([[1, 12, 900], [2, 14, 1000], [3, 16, 1000], [4, 18, 1000], [5, 20, 1100], [6, 22, 1200], [7, 24, 1300]] as const)
  .forEach(([n, w, s]) => add(n, `A1 ${w}x40x10`, { w, l: 40 }, s));
// A2 length sweep, 24xLx10
([[8, 20, 1100], [9, 25, 1150], [10, 30, 1200], [11, 35, 1250], [12, 45, 1450], [13, 50, 1500], [14, 60, 1600], [15, 80, 1800], [16, 100, 2100]] as const)
  .forEach(([n, l, s]) => add(n, `A2 24x${l}x10`, { w: 24, l }, s));
// A3 height sweep, 24x40 — height never changes it
([[17, 6], [18, 8], [19, 12], [20, 14], [21, 16], [22, 17], [23, 20]] as const)
  .forEach(([n, h]) => add(n, `A3 24x40x${h}`, { w: 24, l: 40, h }, 1300));
// B1 Back Storage (End Storage partition), width sweep L40 H10
([[24, 12, 1100], [25, 14, 1250], [26, 16, 1250], [27, 18, 1250], [28, 20, 1400], [29, 22, 1550], [30, 24, 1700]] as const)
  .forEach(([n, w, s]) => add(n, `B1 ${w}x40x10 + Back Storage 35`, { w, l: 40, aew: 'yes', depth: 35 }, s));
// B4 partition depth 20 / 10 / 5
([[31, 20], [32, 10], [33, 5]] as const).forEach(([n, d]) => add(n, `B4 24x40x10 + Back Storage ${d}`, { w: 24, l: 40, aew: 'yes', depth: d }, 1700));
// B2 height sweep with the partition
([[34, 8], [35, 12], [36, 14], [37, 16]] as const).forEach(([n, h]) => add(n, `B2 24x40x${h} + Back Storage 35`, { w: 24, l: 40, h, aew: 'yes', depth: 35 }, 1700));
// B3 length sweep with the partition
add(38, 'B3 24x20x10 + Back Storage 15', { w: 24, l: 20, aew: 'yes', depth: 15 }, 1500);
add(39, 'B3 24x60x10 + Back Storage 15', { w: 24, l: 60, aew: 'yes', depth: 15 }, 2000);
// C lengthwise partition (Left / Right Storage)
add(40, 'C 24x40x10 + Left Storage 12', { w: 24, l: 40, aew: 'left', swidth: 12 }, 1550);
add(41, 'C 24x40x10 + Right Storage 12', { w: 24, l: 40, aew: 'right', swidth: 12 }, 1550);
add(42, 'C 24x40x10 + Right Storage 10', { w: 24, l: 40, aew: 'right', swidth: 10 }, 1550);
add(43, 'C 24x20x10 + Right Storage 10', { w: 24, l: 20, aew: 'right', swidth: 10 }, 1250);
add(44, 'C Triple Wide 30x40x12 + Left Storage 15', { w: 30, l: 40, h: 12, aew: 'left', swidth: 15 }, 1850);
// E Triple Wide Garages 26-30, with and without Back Storage 36
([[45, 30, 12, 'no', 1600], [46, 30, 12, 'yes', 2150], [47, 30, 10, 'no', 1600], [48, 30, 10, 'yes', 2150],
  [49, 28, 12, 'no', 1500], [50, 28, 12, 'yes', 2000], [51, 26, 12, 'no', 1400], [52, 26, 12, 'yes', 1850]] as const)
  .forEach(([n, w, h, aew, s]) => add(n, `E Triple Wide ${w}x40x${h}${aew === 'yes' ? ' + Back Storage 36' : ''}`, { w, l: 40, h, aew, depth: 36 }, s));
// D Triple Wide 30x40x12 + right lean-to 12x40x10 (storage: Sensei locks the lean back Closed, side Open)
const tw = (n: number, tag: string, lean: Lean, s: number) => add(n, 'D 30x40x12 + lean 12x40x10 ' + tag, { w: 30, l: 40, h: 12, leans: [lean] }, s);
tw(53, 'all open', { w: 12, l: 40 }, 1600);
tw(54, 'back Closed', { w: 12, l: 40, back: 'closed' }, 1800);
tw(55, 'back + side Closed', { w: 12, l: 40, back: 'closed', side: 'closed' }, 2050);
([[56, 4, 2150], [57, 12, 2150], [58, 20, 2150], [59, 24, 2175], [60, 36, 2250]] as const)
  .forEach(([n, sl, s]) => tw(n, `storage ${sl}`, { w: 12, l: 40, back: 'closed', stor: sl }, s));
// B5 horizontal walls = $0 (box ticked)
add(61, 'B5 24x40x10 horizontal', { w: 24, l: 40, horiz: true }, 0);
add(62, 'B5 24x40x10 horizontal + Back Storage', { w: 24, l: 40, horiz: true, aew: 'yes', depth: 35 }, 0);
add(63, 'B5 Triple Wide 30x40x10 horizontal + Back Storage', { w: 30, l: 40, horiz: true, aew: 'yes', depth: 36 }, 0);
add(64, 'B5 Triple Wide 30x40x12 horizontal', { w: 30, l: 40, h: 12, horiz: true }, 0);

// ── Part 2 (sensei-wainscot-2026-10-05-part2.md) ───────────────────────────────
// F1 Utility Carports 24x40x10, Back Storage 20 (→ GCH, enclosed 20), back locked Closed
const uc = (n: number, tag: string, c: Partial<Case>, s: number) => add(n, 'F1 Utility 24x40x10 ' + tag, { bt: 'gch', w: 24, l: 40, enc: 20, ...c }, s);
uc(65, 'front / sides Open', {}, 1100);
uc(66, 'left Closed', { gl: 'closed' }, 1200);
uc(67, 'both sides Closed', { gl: 'closed', gr: 'closed' }, 1300);
uc(68, 'left 1 Panel', { gl: '1panel' }, 1100);
uc(69, 'left 2 Panels', { gl: '2panel' }, 1100);
uc(70, 'left 3 Panels (box)', { gl: '3panel' }, 1100);
uc(71, 'left 1/4 Closed (box)', { gl: 'q1' }, 1100);
uc(72, 'left 1/2 Closed', { gl: 'q2' }, 1100);
uc(73, 'left 3/4 Closed', { gl: 'q3' }, 1100);
uc(74, 'front Gable', { front: 'Gable Only' }, 1100);
uc(75, 'front Extended Gable (no such program option; any non-Closed front)', { front: 'Extended Gable' }, 1100);
uc(76, 'front 1/2 Closed', { front: 'Half Closed' }, 1100);
uc(77, 'front Closed', { front: 'Closed' }, 1500);
uc(78, 'storage depth 10', { enc: 10 }, 1100);
uc(79, 'storage depth 25', { enc: 25 }, 1150);
// F2 Triple Wide Carports 30x40x12 + Back Storage 20
const tc = (n: number, tag: string, c: Partial<Case>, s: number) => add(n, 'F2 Triple Wide Carport 30x40x12 ' + tag, { bt: 'gch', w: 30, l: 40, h: 12, enc: 20, ...c }, s);
tc(80, 'sides Open', {}, 1400);
tc(81, 'sides Closed', { gl: 'closed', gr: 'closed' }, 1600);
tc(82, 'left 2 Panels, right 1/2 Closed', { gl: '2panel', gr: 'q2' }, 1400);
tc(83, 'left 2 Panels, right Closed', { gl: '2panel', gr: 'closed' }, 1500);
// G partial walls on a fully enclosed Standard Garage 24x40x10
add(84, 'G 24x40x10 all Closed', { w: 24, l: 40 }, 1300);
add(85, 'G front Gable', { w: 24, l: 40, front: 'Gable Only' }, 900);
add(86, 'G left 2 Panels', { w: 24, l: 40, left: '2panel' }, 1050);
add(87, 'G left 3/4 Closed', { w: 24, l: 40, left: 'q3' }, 1050);
add(88, 'G ends Closed, sides Open', { w: 24, l: 40, left: 'Open', right: 'Open' }, 800);
add(89, 'G sides Closed, ends Open', { w: 24, l: 40, front: 'Open', back: 'Open' }, 500);
// H odd widths Wx40x10
([[90, 23, 1300], [91, 21, 1200], [92, 19, 1100], [93, 17, 1000], [94, 15, 1000], [95, 13, 1000]] as const)
  .forEach(([n, w, s]) => add(n, `H ${w}x40x10`, { w, l: 40 }, s));
// I lengths off the 5' columns and over 100
([[96, 22, 1150], [97, 41, 1450], [98, 42, 1450], [99, 105, 2150], [100, 120, 2300], [101, 121, 2450], [102, 125, 2450], [103, 150, 2700], [104, 200, 3300], [105, 300, 4600]] as const)
  .forEach(([n, l, s]) => add(n, `I 24x${l}x10`, { w: 24, l }, s));
// J1 Commercial 32-60
const cm = (n: number, w: number, l: number, h: number, s: number, c: Partial<Case> = {}, tag = '') => add(n, `J ${w}x${l}x${h}${tag}`, { bt: 'widespan', w, l, h, ...c }, s);
cm(106, 36, 36, 14, 1800);
cm(107, 40, 40, 12, 1950);
cm(108, 40, 40, 12, 2650, { aew: 'yes', depth: 36 }, ' + Back Storage 36');
cm(109, 50, 60, 14, 2500);
cm(110, 50, 60, 14, 3325, { aew: 'yes', depth: 56 }, ' + Back Storage 56');
cm(111, 50, 60, 14, 2925, { aew: 'left', swidth: 25 }, ' + Left Storage 25');
cm(112, 50, 40, 14, 2200);
cm(113, 50, 52, 14, 2350);
cm(114, 50, 56, 14, 2450);
cm(115, 50, 64, 14, 2550);
cm(116, 50, 100, 14, 3000);
cm(117, 50, 108, 14, 3150);
cm(118, 60, 40, 14, 2450);
cm(119, 32, 40, 14, 1750);
cm(120, 33, 40, 14, 1800);
cm(121, 33, 42, 14, 1850);
cm(122, 33, 54, 14, 2050);
// J2 Commercial 62-100
cm(123, 62, 40, 14, 2500);
cm(124, 80, 40, 14, 4750);
cm(125, 100, 40, 14, 5250);
cm(126, 100, 40, 14, 4700, { left: 'Open', right: 'Open' }, ' ends Closed, sides Open');
const backOnly = { front: 'Open', left: 'Open', right: 'Open' };
([[127, 100, 2350], [128, 62, 975], [129, 66, 1025], [130, 70, 1075], [131, 71, 2000], [132, 72, 2000], [133, 74, 2025], [134, 76, 2050], [135, 80, 2100]] as const)
  .forEach(([n, w, s]) => cm(n, w, 40, 14, s, backOnly, ' back only'));
// K lean-to walls: Standard Garage 24x40x10 fully enclosed + LEFT lean, L40 H6
const lk = (n: number, tag: string, lean: Lean, s: number) => add(n, 'K 24x40x10 + lean ' + tag, { w: 24, l: 40, leans: [{ h: 6, ...lean }] }, s);
lk(136, '12x40 all Open (box)', { w: 12, l: 40 }, 1300);
lk(137, '10x40 back Closed', { w: 10, l: 40, back: 'closed' }, 1450);
([[138, 10, 1600], [139, 8, 1550], [140, 6, 1500], [141, 18, 1800], [142, 20, 1900], [143, 16, 1800], [144, 14, 1800]] as const)
  .forEach(([n, lw, s]) => lk(n, `${lw}x40 front + back Closed`, { w: lw, l: 40, front: 'closed', back: 'closed' }, s));
lk(145, '14x40 front Closed, back Gable', { w: 14, l: 40, front: 'closed', back: 'gable' }, 1550);
lk(146, '14x40 front Closed, back Gable, side 1 Panel', { w: 14, l: 40, front: 'closed', back: 'gable', side: '1panel' }, 1550);
lk(147, '14x40 front Closed, back Gable, side Closed', { w: 14, l: 40, front: 'closed', back: 'gable', side: 'closed' }, 1800);
lk(148, '14x27 front Closed, back Gable, side Closed', { w: 14, l: 27, front: 'closed', back: 'gable', side: 'closed' }, 1750);
// L wainscot color Black (not a print panel) = $0 extra
add(149, 'L 24x40x10 wainscot color Black', { w: 24, l: 40 }, 1300);

describe('CCI wainscot = Sensei per closed wall (10/5/26) — every reading, $0 residual', () => {
  it('covers every reading #1-149 exactly once', () => {
    expect(R.map((r) => r.n)).toEqual(Array.from({ length: 149 }, (_, i) => i + 1));
  });

  it.each(R.map((r) => ['#' + r.n + ' ' + r.tag, r] as const))('%s', (_n, r) => {
    expect(ctx.wain(r.c)).toBe(r.sensei);
  });

  it('lean-to storage rows are priced storage rooms (not silently skipped)', () => {
    for (const sl of [4, 12, 20, 24, 36]) {
      const s = ctx.stor({ w: 30, l: 40, h: 12, leans: [{ w: 12, l: 40, back: 'closed', stor: sl }] });
      expect(s[0].err).toBe('');
      expect(s[0].valid).toBe(true);
    }
  });
});

describe('per-wall tables', () => {
  it('E(W): brochure 12-30, p6 slope 32-70, Sensei +$900 step from 72', () => {
    expect([12, 13, 14, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30].map(ctx.cciWainEnd)).toEqual([200, 250, 250, 250, 250, 250, 300, 300, 350, 400, 450, 500, 550]);
    expect([32, 33, 34, 36, 40, 50, 60, 62, 70].map(ctx.cciWainEnd)).toEqual([600, 625, 625, 650, 700, 825, 950, 975, 1075]);
    expect([71, 72, 74, 76, 80, 100].map(ctx.cciWainEnd)).toEqual([2000, 2000, 2025, 2050, 2100, 2350]);
  });
  it('S(L), 12-30 wide: 5·L′ + 50 per connected unit (L′ up to the next 5′, 20′ minimum)', () => {
    expect([4, 12, 20, 22, 25, 30, 35, 40, 41, 45, 50, 60, 80, 100, 105, 120, 121, 150, 200, 300].map((l) => ctx.cciWainSide(l, 24)))
      .toEqual([150, 150, 150, 175, 175, 200, 225, 250, 325, 325, 350, 400, 500, 650, 675, 750, 825, 950, 1250, 1900]);
  });
  it('S(L), over 30 wide: 6.25·L′ + 25 per connected unit of at most 52′ (L′ up to the next 4′)', () => {
    expect([36, 40, 42, 52, 54, 56, 60, 64, 100, 108].map((l) => ctx.cciWainSide(l, 50))).toEqual([250, 275, 300, 350, 400, 400, 425, 450, 675, 750]);
  });
  it('lean end: half of a 2W end under 12 wide, the main table from 12 up', () => {
    expect([6, 8, 10, 12, 14, 16, 18, 20].map(ctx.cciWainLeanEnd)).toEqual([100, 125, 150, 200, 250, 250, 250, 300]);
  });
});

describe('what the wainscot line covers (rep note)', () => {
  it('names the walls, the partition and the lean-to', () => {
    expect(ctx.detail({ w: 24, l: 40, aew: 'yes', depth: 35 }).covers).toBe('4 walls + storage partition');
    expect(ctx.detail({ w: 24, l: 40, front: 'Gable Only', left: 'Open' }).covers).toBe('back + right walls');
    expect(ctx.detail({ w: 24, l: 40, front: 'Open', left: 'Open', right: 'Open' }).covers).toBe('back wall');
    expect(ctx.detail({ w: 30, l: 40, h: 12, leans: [{ w: 12, l: 40, back: 'closed', stor: 36 }] }).covers).toBe('4 walls + lean-to walls + storage');
    expect(ctx.detail({ bt: 'gch', w: 24, l: 40, enc: 20 }).covers).toBe('back + left + right walls + storage partition');
    expect(ctx.detail({ w: 24, l: 40, aew: 'right', swidth: 10 }).covers).toBe('4 walls + lengthwise storage partition');
  });
  it('warns on the unconfirmed 72′+ step and on free-standing lean-tos', () => {
    expect(ctx.detail({ bt: 'widespan', w: 80, l: 40, h: 14 }).warn).toMatch(/72'\+ wide.*\$900.*confirm with CCI/);
    expect(ctx.detail({ bt: 'widespan', w: 70, l: 40, h: 14 }).warn).toBe('');
    expect(ctx.detail({ w: 24, l: 40, leans: [{ w: 12, l: 40, type: 'freestanding', front: 'closed' }] }).warn).toMatch(/Free-standing lean-to/);
  });
});

describe('print panel (+25%) — not in Sensei: today\'s behaviour, the whole wainscot amount ×1.25', () => {
  it('multiplies the total, partition and lean walls included', () => {
    expect(ctx.wain({ w: 24, l: 40, print: true })).toBe(1625);
    expect(ctx.wain({ w: 24, l: 40, aew: 'yes', depth: 35, print: true })).toBe(Math.round(1700 * 1.25));
    expect(ctx.wain({ w: 24, l: 40, leans: [{ w: 14, l: 27, h: 6, front: 'closed', side: 'closed' }], print: true })).toBe(Math.round(1750 * 1.25));
  });
});

describe('unchanged paths', () => {
  // The CA bucket rule exactly as it was (MANUFACTURERS.CA.wainscotBuckets, any height, walls ignored).
  const caRef = (l: number, print: boolean) => { // CA buckets are by length only
    const cols = [20, 24, 28, 32, 36, 40, 44, 48, 52], vals = [300, 350, 400, 450, 500, 550, 600, 650, 700];
    let c = 0;
    for (let i = 0; i < cols.length; i++) { if (cols[i] <= l) c = i; else break; }
    return Math.round(vals[c] * (print ? 1.25 : 1));
  };
  it('CA: the bucket price for every size / height / wall set / print (partitions and lean-tos add nothing)', () => {
    let n = 0;
    for (const w of [12, 18, 24, 30, 32, 40, 60, 70])
      for (const l of [20, 24, 26, 30, 40, 52, 60, 100])
        for (const h of [6, 10, 16, 17, 20])
          for (const walls of [{}, { front: 'Open', left: 'Open' }, { front: 'Open', back: 'Open', left: 'Open', right: 'Open' }])
            for (const print of [false, true]) {
              const c: Case = { mfr: 'CA', bt: w > 30 ? 'widespan' : 'standard', w, l, h, print, aew: 'yes', depth: 10, leans: [{ w: 12, l: 40, back: 'closed', side: 'closed' }], ...walls };
              expect(ctx.wain(c), JSON.stringify(c)).toBe(caRef(l, print));
              n++;
            }
    expect(n).toBe(8 * 8 * 5 * 3 * 2);
    expect(ctx.wain({ mfr: 'CA', w: 24, l: 40, horiz: true })).toBe(0);
    expect(ctx.wain({ mfr: 'CA', w: 24, l: 40, wain: false })).toBe(0);
  });
  it('CA: gWainscot still ends with the byte-identical bucket lines', () => {
    expect(html.replace(/\r\n/g, '\n')).toContain(
      "  var _wb=MFR().wainscotBuckets(w), _wc=0;\n  for(var _wi=0;_wi<_wb.cols.length;_wi++){if(_wb.cols[_wi]<=l)_wc=_wi;else break;}\n  return Math.round(_wb.vals[_wc]*(wainscotPrintOpt()?1.25:1));\n}\nfunction gWalls(){");
  });
  it('CCI Free-Standing Lean-To main (not sampled) keeps the rule it had before 10/5', () => {
    // under 17': the brochure BOTH SIDES bucket for the length, walls ignored
    expect(ctx.wain({ bt: 'fslean', w: 12, l: 20, front: 'Open', back: 'Open', left: 'Open', right: 'Open' })).toBe(300);
    expect(ctx.wain({ bt: 'fslean', w: 20, l: 40, front: 'Open', back: 'Open', left: 'Open', right: 'Open' })).toBe(500);
    // 17'+: the 8/31 chart × the closed share of the perimeter (fslean parks the main wall rows Open → 0)
    expect(ctx.wain({ bt: 'fslean', w: 20, l: 40, h: 17, front: 'Open', back: 'Open', left: 'Open', right: 'Open' })).toBe(0);
  });
  it('the wainscot box off or horizontal walls → $0 for every CCI type', () => {
    for (const bt of ['standard', 'widespan', 'gch', 'fslean']) {
      expect(ctx.wain({ bt, w: bt === 'widespan' ? 40 : 24, l: 40, enc: 20, wain: false })).toBe(0);
      expect(ctx.wain({ bt, w: bt === 'widespan' ? 40 : 24, l: 40, enc: 20, horiz: true })).toBe(0);
    }
  });
});
