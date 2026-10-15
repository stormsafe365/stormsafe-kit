import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * WRAP-AROUND LEAN-TOS (owner 10/12/26) — the pricing program's OWN functions
 * (public/quote-builder.html, extracted into a node vm) against Sensei's CCI
 * quotes read live on 10/12/26 (scratchpad sensei-wrap-1012/result.json):
 * CCI Standard Garages 24'W x 40'L x 12'H, Vertical roof, 150 MPH (5' OC),
 * lean-tos 12' wide, 10' low leg, 2:12, open unless noted.
 *
 *   B  Left 12x40                          size $2,897.50  height $342.50
 *   C  B + Front 12x24 (not wrapped)       front $1,797.50 height $197.50
 *   D  C wrapped Front Left                Left @52' $3,945 + $442.50 · Front @36' $2,897.50 + $342.50 · corner $300
 *   E  Left + Front + Right, FL + FR       Left/Right @52' $3,945 + $442.50 · Front @48' $3,595 + $395 · 2 x $300
 *   Full Building (adds Back 12x24)        Left/Right @64' $4,645 + $540 · Front/Back @48' $3,595 + $395 · 4 x $300
 *   enclosed wrapped Left (horizontal)     ends $1,435 (unchanged) · side wall @64' $1,155 (unwrapped $752.50)
 *
 * The rule: a wrapped lean-to is priced as a normal lean-to at its WRAPPED
 * LENGTH (own length + the width of each lean-to it meets at a wrapped
 * corner) for size, height and side wall; rounds up to 5', connected units
 * past 40' (handbook p6). The normal per-lean-to connection fees are NOT
 * changed by a wrap; each wrapped corner adds $300.
 * 10/14/26 (owner: "match Sensei / the CCI book"): connection fees on 12'-30'
 * mains = Price Book 2 p2/p4 side rule ($200 at 40'), gable end twice that
 * ($250 at 24'), Triple Wide side + $200 ($450 at 50') / end $700 + $25 per 5'
 * ($750 at 30'); Triple Wide (26'-30') main: lean-to size = the half-of-2W price
 * + a per-unit premium of half of (Boxed-Eave 30' - Vertical 24') at the unit's
 * tier ($300 per 25' unit), height = half of the 26'-30' chart; lean-to lengths
 * round UP to the next 5' column. Every line of B-F now matches Sensei to the cent.
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

const cciBlock = html.slice(html.indexOf('\n  CCI: {'));
const vertEnd = /vertEnd:\s*(\{[^}]*\})/.exec(cciBlock)![1];
const huN = /huN:\s*(\{[\s\S]*?\]\})/.exec(cciBlock)![1];
const huM = /huM:\s*(\{[\s\S]*?\]\})/.exec(cciBlock)![1];
const combos = /standardCombinations:\s*(\{[\s\S]*?\})/.exec(cciBlock)![1];

let code = '';
for (const v of ['WIDTHS', 'LENGTHS', 'PV', 'PR', 'PB', 'SC', 'EC', 'VERT_SIDE', 'LT_END_P', 'LT_SIDE_P', 'STD_TIERS', 'CCI_LT_CERT_RATE', 'CCI_LT_SIDE_SHORT',
  'CCI_LT_PANEL', 'CCI_LT_SIDE_FRAC', 'LTS_CONN', 'LT_WRAP_KEYS', 'LT_WRAP_NAME', 'LT_WRAP_FEE_LBL', 'LT_WRAP_FEE', 'LT_WRAP_SIDES', 'LT_SIDE_SHORT']) code += grabVar(v);
code += 'for(var _bpi=0;_bpi<10;_bpi++){ PV[26][_bpi]=PV[25][_bpi]; PV[46][_bpi]=PV[45][_bpi]; }\n'; // the program's 26'/46' row patch
for (const f of ['eBkt', 'ecLookup', 'vertEndUpcharge', 'cciLtSideSecs', 'cciLtSideClosed', 'cciLtShortSideMsg', 'ltPanelsHorizontal', 'nearestStd',
  'cciLtSidePanels', 'cciLtMaxPanels', 'cciLtRunSum', 'cciLtSidePartial', 'cciUnits', 'ltBasePrice', 'getLTWalls', 'ltWallsAs', 'ltStorOn', 'ltStorLenOptions', 'ltUnit',
  '_ltsInterp', 'connFeeFor', 'gConnectionFees', 'ltWrapReq', 'ltWrapSetReq', '_ltWrapRd', '_ltWrapReach', 'ltWraps', 'ltWrapOf', 'ltWrapFeeRows',
  'ltWrapFeeTotal', '_ltWrapTxt', '_ltWrapTip', 'ltOverall', 'ltWrapPrintIssue', '_ltWrapLostTxt', 'ltWrapTyping', 'ltWrapGuard', 'ltLenGuard', 'ltWrapRemove',
  'ltWrapClick', 'ltWrapUI']) code += grabFn(f);
code += grabVar('LT_WRAP_SNAP');
code += 'var VERT_END=' + vertEnd + ', HU_N=' + huN + ', HU_M=' + huM + ', HU={}, _CC=' + combos + ';\n';
code += `
var ACTIVE_MFR='CCI', window={};
var _G={bw:{value:'24'},bl:{value:'40'},bh:{value:'12'},btype:{value:'standard'},ws:{value:'Horizontal'},rs:{value:'Vertical'},'oc-spacing':{value:'5oc'},'lt-wraps':{value:''}};
function G(id){ return _G[id]||null; }
function MFR(){ return {standardCombinations:_CC}; }
function getTrussOC(){ return 5; }
var _LTS=[];
var document={querySelectorAll:function(s){ return s==='.lte'?_LTS:[]; }};
// Fields are persistent objects (a guard can put a value back); remove() takes the entry off the form.
function mkEl(o){
  var f={'.lts':o.side,'.ltw':o.w||12,'.ltl2':o.l,'.ltoff':o.off||0,'.lt-type':o.type||'attached','.lth':o.h||10,'.ltp':(o.p||2)+':12',
         '.lt-wm':o.wm||'open','.lt-wall-front':'open','.lt-wall-back':'open','.lt-wall-side':'open','.lt-stor':'none'};
  var F={}; Object.keys(f).forEach(function(k){ F[k]={value:String(f[k])}; });
  var el={querySelector:function(s){ return F[s]||null; }, _o:o, _f:F, remove:function(){ _LTS=_LTS.filter(function(x){ return x!==el; }); }};
  Object.keys(F).forEach(function(k){ F[k].closest=function(){ return el; }; });
  el.closest=function(){ return el; };
  return el;
}
// UI stubs: rc() ends with ltWrapUI() like the program's; the wrap box elements are plain objects.
var _toasts=[]; function toast(m){ _toasts.push(m); }
function rc(){ ltWrapUI(); }
function ltTypeChange(){} function updateLTNote(){}
function fC(n){ return '$'+n; }
['lt-wrap-box','lt-wrap-add','lt-wrap-row','lt-wrap-chips','lt-wrap-note'].forEach(function(id){ _G[id]={style:{},innerHTML:''}; });
function setup(o){
  _G.bw.value=String(o.mw||24); _G.bl.value=String(o.ml||40); _G.bh.value=String(o.mh||12);
  _G.ws.value=o.vert?'Vertical':'Horizontal'; _G['lt-wraps'].value=o.wraps||'';
  ACTIVE_MFR=o.mfr||'CCI';
  _LTS=o.leans.map(mkEl);
  return _LTS;
}
function run(o){
  var els=setup(o), wr=ltWraps();
  var rows=els.map(function(el){ var u=ltUnit(el); var w=ltWrapOf(el,wr);
    return {side:el._o.side, bp:u.bp, h:u.heightAdj, enc:u.encAdj, total:u.total, wrapLen:w.len, unitWrap:u.wrapLen||0,
            conn:connFeeFor(el._o.side, el._o.l), txt:_ltWrapTxt(el), tip:_ltWrapTip(el,w)}; });
  return {rows:rows, active:wr.active, why:wr.why, fees:ltWrapFeeRows(wr), feeTotal:ltWrapFeeTotal(), conn:gConnectionFees(),
          overall:ltOverall(), block:ltWrapPrintIssue()};
}
`;
const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, parseInt, parseFloat, isNaN });
vm.runInContext(code, ctx);
type Row = { side: string; bp: number; h: number; enc: number; total: number; wrapLen: number; unitWrap: number; conn: number; txt: string; tip: string };
type Res = { rows: Row[]; active: string[]; why: Record<string, string>; fees: { k: string; label: string; fee: number }[]; feeTotal: number; conn: number; overall: { w: number; l: number; W: number; L: number }; block: string };
const run = (o: Record<string, unknown>): Res => JSON.parse(JSON.stringify(vm.runInContext('run(' + JSON.stringify(o) + ')', ctx)));
const row = (r: Res, side: string) => r.rows.find((x) => x.side === side)!;

const LEFT = { side: 'Left Eave', l: 40 };
const RIGHT = { side: 'Right Eave', l: 40 };
const FRONT = { side: 'Front Gable', l: 24 };
const BACK = { side: 'Back Gable', l: 24 };

describe('wrap-around lean-tos — Sensei CCI parity (24x40x12, 12-wide lean-tos, 10\' low leg)', () => {
  it('B / C: not wrapped — size, height and the side connection fee match Sensei; the gable fee is the pre-10-14 rule (10-14d)', () => {
    const c = run({ leans: [LEFT, FRONT] });
    expect(row(c, 'Left Eave')).toMatchObject({ bp: 2897.5, h: 342.5, wrapLen: 0, txt: '' });
    expect(row(c, 'Front Gable')).toMatchObject({ bp: 1797.5, h: 197.5, wrapLen: 0 });
    // Sensei: Side Connection Fees $200 (book $100 + 4 x $25) = the program. End Connection Fees: Sensei $250; the program
    // keeps its pre-10-14 gable rule $700 + $25 per 5' past 21' = $725 (10-14 "A2" reverted, owner 10/14/26 - CCI question)
    expect(row(c, 'Left Eave').conn).toBe(200);
    expect(row(c, 'Front Gable').conn).toBe(725);
    expect(c.feeTotal).toBe(0);
    expect(c.conn).toBe(925);
  });

  it('D: Front Left wrap — Left @52\' and Front @36\', + $300 corner (to the cent)', () => {
    const d = run({ leans: [LEFT, FRONT], wraps: 'FL' });
    expect(d.active).toEqual(['FL']);
    expect(row(d, 'Left Eave')).toMatchObject({ wrapLen: 52, unitWrap: 52, bp: 3945, h: 442.5 });
    expect(row(d, 'Front Gable')).toMatchObject({ wrapLen: 36, unitWrap: 36, bp: 2897.5, h: 342.5 });
    expect(d.fees).toEqual([{ k: 'FL', label: 'Left Front Connection Fee (wrap-around corner)', fee: 300 }]);
    expect(d.conn).toBe(925 + 300); // normal fees unchanged by the wrap + one corner
    // D − C lean-to lines = Sensei's $2,692.50 minus nothing (fees aside): 1,047.50 + 100 + 1,100 + 145 + 300
    const c = run({ leans: [LEFT, FRONT] });
    const lines = (r: Res) => r.rows.reduce((s, x) => s + x.bp + x.h, 0) + r.feeTotal;
    expect(lines(d) - lines(c)).toBeCloseTo(2692.5, 2);
    expect(row(d, 'Left Eave').txt).toBe(", wrapped length 52'");
    expect(row(d, 'Left Eave').tip).toContain('includes the Front and Left lean-to');
    expect(d.overall).toEqual({ w: 36, l: 52, W: 24, L: 40 });
    expect(d.block).toBe('');
  });

  it('E: Front Left + Front Right — Front @48\' (24+12+12), Left/Right @52\', 2 x $300', () => {
    const e = run({ leans: [LEFT, FRONT, RIGHT], wraps: 'FL,FR' });
    expect(e.active).toEqual(['FL', 'FR']);
    expect(row(e, 'Left Eave')).toMatchObject({ wrapLen: 52, bp: 3945, h: 442.5 });
    expect(row(e, 'Right Eave')).toMatchObject({ wrapLen: 52, bp: 3945, h: 442.5 });
    expect(row(e, 'Front Gable')).toMatchObject({ wrapLen: 48, bp: 3595, h: 395 });
    expect(e.feeTotal).toBe(600);
    expect(e.fees.map((f) => f.label)).toEqual(['Left Front Connection Fee (wrap-around corner)', 'Right Front Connection Fee (wrap-around corner)']);
  });

  it('Full Building — Left/Right @64\', Front/Back @48\', 4 x $300', () => {
    const f = run({ leans: [LEFT, RIGHT, FRONT, BACK], wraps: 'FL,FR,BL,BR' });
    expect(f.active).toEqual(['FL', 'FR', 'BL', 'BR']);
    for (const s of ['Left Eave', 'Right Eave']) expect(row(f, s)).toMatchObject({ wrapLen: 64, bp: 4645, h: 540 });
    for (const s of ['Front Gable', 'Back Gable']) expect(row(f, s)).toMatchObject({ wrapLen: 48, bp: 3595, h: 395 });
    expect(f.feeTotal).toBe(1200);
    expect(f.overall).toEqual({ w: 48, l: 64, W: 24, L: 40 });
  });

  it('enclosed wrapped Left (horizontal walls): ends unchanged $1,435, side wall at the wrapped length $1,155', () => {
    const open = run({ leans: [LEFT, FRONT, RIGHT, BACK], wraps: 'FL,FR,BL,BR' });
    const enc = run({ leans: [{ ...LEFT, wm: 'enclosed' }, FRONT, RIGHT, BACK], wraps: 'FL,FR,BL,BR' });
    expect(row(enc, 'Left Eave').enc).toBeCloseTo(1435 + 1155, 2);
    const unwrapped = run({ leans: [{ ...LEFT, wm: 'enclosed' }] });
    expect(row(unwrapped, 'Left Eave').enc).toBeCloseTo(1435 + 752.5, 2);
    expect(row(open, 'Left Eave').enc).toBe(0);
  });

  it('F (Triple Wide 30x50x14, 12-wide x 12\' lean-tos, Left + Front wrapped): wrapped lengths 62\' / 42\' — the half-of-2W method (10-14 "A3" reverted, 10-14d)', () => {
    const f = run({ mw: 30, ml: 50, mh: 14, leans: [{ side: 'Left Eave', l: 50, h: 12 }, { side: 'Front Gable', l: 30, h: 12 }], wraps: 'FL' });
    expect(f.active).toEqual(['FL']);
    expect(row(f, 'Left Eave').wrapLen).toBe(62);
    expect(row(f, 'Front Gable').wrapLen).toBe(42);
    // 62 → 35+30 units, 42 → 25+20 (Dealer Handbook p6): half of the 24' Vertical chart (Price Book 2 p1 24x35 $4,995 +
    // 24x30 $4,295; 24x25 $3,595 + 24x20 $2,895), heights half of the 24' 12' row (p2: 35' $840 + 30' $710; 25' $575 + 20'
    // $430). Sensei's Triple Wide premium ($5,445 / $1,217.50, $3,795 / $917.50) was reverted until CCI confirms (owner 10/14/26).
    expect([row(f, 'Left Eave').bp, row(f, 'Left Eave').h]).toEqual([4645, 775]);
    expect([row(f, 'Front Gable').bp, row(f, 'Front Gable').h]).toEqual([3245, 502.5]);
    expect(f.feeTotal).toBe(300);
    // side = Price Book 2 p4 $100 + 6 x $25 (Sensei $450 incl. a +$200 = reverted A2); end = the pre-10-14 rule $700 + 2 x $25 (= Sensei)
    expect([row(f, 'Left Eave').conn, row(f, 'Front Gable').conn]).toEqual([250, 750]);
  });
});

describe('wrap-around lean-tos — rules', () => {
  it('a corner needs both lean-tos, running to that corner, same width / height / pitch', () => {
    expect(run({ leans: [LEFT], wraps: 'FL' }).why.FL).toMatch(/needs a Left lean-to and a Front lean-to/);
    expect(run({ leans: [LEFT, { ...FRONT, w: 10 }], wraps: 'FL' }).why.FL).toMatch(/same width and height/);
    expect(run({ leans: [LEFT, { ...FRONT, h: 9 }], wraps: 'FL' }).why.FL).toMatch(/same width and height/);
    expect(run({ leans: [LEFT, { ...FRONT, p: 3 }], wraps: 'FL' }).why.FL).toMatch(/same roof pitch/);
    // a 30' left lean-to starting at the front reaches the FRONT corner only
    const part = run({ leans: [{ ...LEFT, l: 30 }, FRONT, BACK], wraps: 'FL,BL' });
    expect(part.active).toEqual(['FL']);
    expect(part.why.BL).toMatch(/run to the back corner/);
    // front gable from the LEFT eave corner: 20' at 0 reaches FL, not FR
    const fr = run({ leans: [LEFT, RIGHT, { ...FRONT, l: 20 }], wraps: 'FL,FR' });
    expect(fr.active).toEqual(['FL']);
    // back gable runs from the RIGHT eave corner: 20' at 0 reaches BR, not BL
    const bk = run({ leans: [LEFT, RIGHT, { ...BACK, l: 20 }], wraps: 'BL,BR' });
    expect(bk.active).toEqual(['BR']);
    // a gable lean-to longer than the building is wide never wraps
    expect(run({ leans: [LEFT, { ...FRONT, l: 30 }], wraps: 'FL' }).why.FL).toMatch(/longer than the building is wide/);
  });

  it('a requested corner that does not hold is not priced and blocks the documents', () => {
    const r = run({ leans: [LEFT, { ...FRONT, w: 10 }], wraps: 'FL' });
    expect(r.active).toEqual([]);
    expect(row(r, 'Left Eave')).toMatchObject({ wrapLen: 0, bp: 2897.5 });
    expect(r.feeTotal).toBe(0);
    expect(r.block).toMatch(/^Wrap-around Front Left: lean-tos that wrap a corner must be the same width and height/);
  });

  it('CA: wraps stay off ("CCI only until CA confirms pricing") — CA lean-to prices untouched', () => {
    const ca = run({ mfr: 'CA', leans: [LEFT, FRONT], wraps: 'FL' });
    expect(ca.active).toEqual([]);
    expect(ca.why.FL).toBe('Wrap-arounds: CCI only until CA confirms pricing');
    expect(row(ca, 'Left Eave').wrapLen).toBe(0);
    const caNone = run({ mfr: 'CA', leans: [LEFT, FRONT] });
    expect(row(ca, 'Left Eave').total).toBe(row(caNone, 'Left Eave').total);
  });

  it('no wrap requested: every lean-to prices exactly as before (no wrap keys on the unit)', () => {
    const r = run({ leans: [LEFT, FRONT, RIGHT, BACK] });
    expect(r.active).toEqual([]);
    expect(r.rows.every((x) => x.wrapLen === 0 && x.unitWrap === 0)).toBe(true);
    expect(r.feeTotal).toBe(0);
    expect(r.block).toBe('');
  });
});

// ── Drawings: the spacing page's plan corner squares and the "wrap length" bar (dimPlanSVG / dimElevSVG) ──
let dcode = '';
for (const v of ['DIM_K', 'DIM_C', '_dimSvgN', 'LT_WRAP_KEYS']) dcode += grabVar(v);
for (const f of ['dimQ', '_dim8', '_dimFtIn', '_dimIn', '_dimT', '_dimPeakTxt', 'dimElevSVG', 'dimPlanSVG', '_dimWrapCorners', '_dimWrapW']) dcode += grabFn(f);
dcode += 'this.dimElevSVG=dimElevSVG; this.dimPlanSVG=dimPlanSVG; this._dimWrapCorners=_dimWrapCorners; this._dimWrapW=_dimWrapW;';
const dctx: any = { console };
vm.createContext(dctx);
vm.runInContext(dcode, dctx);
const L1 = { n: 1, side: 'Left Eave', eave: true, k: 'left', w: 12, low: 10, pitch: 2, conn: 12, len: 40, ll: 40, start: 0, walls: { sideClosed: false, frontClosed: false, backClosed: false, mode: 'open' }, stor: null, wrap: { len: 52, own: 40, meets: [{ k: 'FL', side: 'Front Gable', w: 12 }] } };
const F2 = { n: 2, side: 'Front Gable', eave: false, k: 'front', w: 12, low: 10, pitch: 2, conn: 12, len: 24, ll: 24, start: 0, walls: { sideClosed: false, frontClosed: false, backClosed: false, mode: 'open' }, stor: null, wrap: { len: 36, own: 24, meets: [{ k: 'FL', side: 'Left Eave', w: 12 }] } };

describe('wrap-around lean-tos — spacing page drawings', () => {
  it('the plan draws the corner square (w × w past the main corner) with its hip line', () => {
    expect(JSON.parse(JSON.stringify(dctx._dimWrapCorners([L1, F2])))).toEqual([{ k: 'FL', w: 12 }]);
    expect(dctx._dimWrapCorners([{ ...L1, wrap: { len: 0, own: 0, meets: [] } }]).length).toBe(0);
    const it = { front: [], back: [], left: [], right: [] };
    const plan = dctx.dimPlanSVG('front', it, [L1, F2], 24, 40, null, {});
    const plain = dctx.dimPlanSVG('front', it, [{ ...L1, wrap: { len: 0, own: 0, meets: [] } }, { ...F2, wrap: { len: 0, own: 0, meets: [] } }], 24, 40, null, {});
    expect((plan.match(/<rect /g) || []).length - (plain.match(/<rect /g) || []).length).toBe(1);
    expect(plan).toContain('stroke-dasharray="1.5 2"');
  });
  it('the elevation under a wrapped lean-to adds "LTn wrap length 36′ (24′ + 12′ corner)" from the corner to the far end', () => {
    expect(dctx._dimWrapW(F2, 'FL')).toBe(12);
    expect(dctx._dimWrapW(F2, 'FR')).toBe(0);
    const svg = dctx.dimElevSVG(24, 12, 15, true, [], false, null, null, { pitch: 3, ends: ['LEFT EAVE', 'RIGHT EAVE'],
      sideLeans: [{ l: L1, onLeft: true, closed: false }], foot: [{ l: F2, x0: 0, wA: 12, wB: 0 }] });
    expect(svg).toMatch(/LT2 wrap length 36['′] \(24['′] \+ 12['′] corner\)/);
    const plain = dctx.dimElevSVG(24, 12, 15, true, [], false, null, null, { pitch: 3, ends: ['LEFT EAVE', 'RIGHT EAVE'],
      sideLeans: [{ l: L1, onLeft: true, closed: false }], foot: [{ l: F2, x0: 0 }] });
    expect(plain).not.toMatch(/wrap length/);
    const vh = (s: string) => Number(/viewBox="0 0 \d+ (\d+)"/.exec(s)![1]);
    expect(vh(svg) - vh(plain)).toBe(26); // one more row under the drawing
  });
});

// ── Verify fixes (10/12/26) ──────────────────────────────────────────────
const ev = (s: string) => JSON.parse(JSON.stringify(vm.runInContext('(function(){ ' + s + ' })()', ctx)) ?? null);
const elOf = (side: string) => 'var _e=_LTS.filter(function(x){ return x._o.side===' + JSON.stringify(side) + '; })[0];';

describe('wrap-around lean-tos — the undo-on-break ALERT (verify 10/12/26)', () => {
  it('one change that breaks two corners names the rule once and each lean-to once (E: Front 12 → 10 wide)', () => {
    const r = ev(`setup({leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24},{side:'Right Eave',l:40}], wraps:'FL,FR'}); window._ltWrapMsg=''; ltWrapUI();
      ${elOf('Front Gable')} _e._f['.ltw'].value='10'; var undone=ltWrapGuard(_e._f['.ltw']);
      return {undone:undone, msg:window._ltWrapMsg, w:_e._f['.ltw'].value, active:ltWraps().active};`);
    expect(r.undone).toBe(true);
    expect(r.w).toBe('12');
    expect(r.active).toEqual(['FL', 'FR']);
    expect(r.msg).toMatch(/^ALERT — Front Left and Front Right wrap: lean-tos that wrap a corner must be the same width and height \(now /);
    expect(r.msg.split('must be the same width and height').length - 1).toBe(1);
    for (const p of ['Left 12′ wide × 10′ low leg', 'Front 10′ wide × 10′ low leg', 'Right 12′ wide × 10′ low leg']) expect(r.msg.split(p).length - 1).toBe(1);
  });

  it('typed Length (input events, then change): the change that breaks the wrap is undone with the ALERT', () => {
    const r = ev(`setup({leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24}], wraps:'FL'}); window._ltWrapMsg=''; ltWrapUI();
      ${elOf('Left Eave')} var f=_e._f['.ltl2'];
      f.value='4'; ltWrapTyping(f); rc(); f.value='45'; ltWrapTyping(f); rc();
      var mid=ltWraps().active.slice(); ltLenGuard(f);
      return {mid:mid, len:f.value, msg:window._ltWrapMsg, active:ltWraps().active, pre:!!_e._ltWrapPre};`);
    expect(r.mid).toEqual([]); // while typing, 45' does not wrap (longer than the 40' wall)
    expect(r.len).toBe('40');
    expect(r.msg).toMatch(/^ALERT — Front Left wrap: the Left lean-to \(45′\) is longer than the building \(40′ long\)/);
    expect(r.active).toEqual(['FL']);
    expect(r.pre).toBe(false);
  });

  it('typed Starts At: the same', () => {
    const r = ev(`setup({leans:[{side:'Left Eave',l:30},{side:'Front Gable',l:24}], wraps:'FL'}); window._ltWrapMsg=''; ltWrapUI();
      ${elOf('Left Eave')} var f=_e._f['.ltoff']; f.value='5'; ltWrapTyping(f); rc(); ltLenGuard(f);
      return {off:f.value, msg:window._ltWrapMsg, active:ltWraps().active};`);
    expect(r.off).toBe('0');
    expect(r.msg).toMatch(/^ALERT — Front Left wrap: the Left lean-to has to run to the front corner/);
    expect(r.active).toEqual(['FL']);
  });

  it('a typed change that keeps the wrap is not undone; an unwrapped lean-to is never undone', () => {
    const keep = ev(`setup({leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24}], wraps:'FL'}); window._ltWrapMsg=''; ltWrapUI();
      ${elOf('Front Gable')} var f=_e._f['.ltl2']; f.value='2'; ltWrapTyping(f); rc(); f.value='20'; ltWrapTyping(f); rc(); ltLenGuard(f);
      return {len:f.value, msg:window._ltWrapMsg, active:ltWraps().active};`);
    expect(keep).toEqual({ len: '20', msg: '', active: ['FL'] }); // a front gable 20' from the LEFT corner still reaches FL
    const none = ev(`setup({leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24}]}); window._ltWrapMsg=''; ltWrapUI();
      ${elOf('Left Eave')} var f=_e._f['.ltl2']; f.value='45'; ltWrapTyping(f); rc(); ltLenGuard(f); return {len:f.value, msg:window._ltWrapMsg};`);
    expect(none).toEqual({ len: '45', msg: '' });
  });
});

describe('wrap-around lean-tos — no length cap outside the wrap rules (verify 10/12/26)', () => {
  for (const mfr of ['CCI', 'CA']) {
    it(`${mfr}: a front lean-to typed longer than the building is wide keeps its length and its price`, () => {
      const r = ev(`setup({mfr:${JSON.stringify(mfr)}, leans:[{side:'Front Gable',l:30}]}); _toasts.length=0; ltWrapUI();
        ${elOf('Front Gable')} var f=_e._f['.ltl2']; var before=ltUnit(_e).total; ltLenGuard(f); return {len:f.value, toasts:_toasts.length, same:ltUnit(_e).total===before};`);
      expect(r).toEqual({ len: '30', toasts: 0, same: true });
    });
  }
});

describe('wrap-around lean-tos — clearing a request (verify 10/12/26)', () => {
  it('CA (switched from CCI): a requested corner turns OFF from its chip and from Full Building, never ON', () => {
    const r = ev(`setup({mfr:'CA', leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24},{side:'Right Eave',l:40}], wraps:'FL,FR'}); _toasts.length=0;
      ltWrapClick('FL'); var a=ltWrapReq().join(','); ltWrapClick('FL'); var b=ltWrapReq().join(','); var t=_toasts.slice();
      ltWrapClick('FULL'); var c=ltWrapReq().join(','); return {a:a, b:b, c:c, toasts:t, block:ltWrapPrintIssue()};`);
    expect(r.a).toBe('FR');
    expect(r.b).toBe('FR'); // turning ON is refused
    expect(r.toasts).toEqual(['Wrap-arounds: CCI only until CA confirms pricing.']);
    expect(r.c).toBe('');
    expect(r.block).toBe('');
  });

  it('removing a lean-to drops every requested corner on its side that no lean-to is left to make (CA, a broken CCI wrap)', () => {
    const ca = ev(`setup({mfr:'CA', leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24}], wraps:'FL'});
      ${elOf('Left Eave')} ltWrapRemove({closest:function(){ return _e; }}); var a=ltWrapReq().join(',');
      var e2=_LTS[0]; ltWrapRemove({closest:function(){ return e2; }}); return {a:a, n:_LTS.length, block:ltWrapPrintIssue()};`);
    expect(ca).toEqual({ a: '', n: 0, block: '' });
    const broken = ev(`setup({leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24,w:10},{side:'Right Eave',l:40}], wraps:'FL'});
      var b0=ltWrapPrintIssue()!==''; ${elOf('Front Gable')} ltWrapRemove({closest:function(){ return _e; }}); return {b0:b0, req:ltWrapReq().join(','), block:ltWrapPrintIssue()};`);
    expect(broken).toEqual({ b0: true, req: '', block: '' });
    const other = ev(`setup({leans:[{side:'Left Eave',l:40},{side:'Front Gable',l:24},{side:'Right Eave',l:40}], wraps:'FL'});
      ${elOf('Right Eave')} ltWrapRemove({closest:function(){ return _e; }}); return {req:ltWrapReq().join(','), active:ltWraps().active};`);
    expect(other).toEqual({ req: 'FL', active: ['FL'] }); // an unrelated lean-to: the wrap stays
  });
});

describe('wrap-around lean-tos — pinned assumptions and pre-existing differences (not changed; owner / CCI decisions)', () => {
  it('32′+ wide: the $5.50/ft lean-to certification adder is charged at the WRAPPED length (Sensei unsampled there)', () => {
    const r = ev(`var o={mw:40, ml:60, mh:14, leans:[{side:'Left Eave',l:60,h:12},{side:'Front Gable',l:40,h:12}], wraps:'FL'};
      _G.btype.value='widespan'; var lt=function(){ setup(o); return ltUnit(_LTS[0]).bp; };
      var a=lt(); var keep=CCI_LT_CERT_RATE; CCI_LT_CERT_RATE=0; var b=lt(); CCI_LT_CERT_RATE=keep; _G.btype.value='standard';
      return {cert:Math.round((a-b)*100)/100, wl:ltWrapOf(_LTS[0]).len};`);
    expect(r).toEqual({ cert: 5.5 * 72, wl: 72 });
  });

  it('typed 26′ / 36′ / 41′ lean-tos round UP to the next 5′ column like Sensei and the book (10/14/26); a WRAPPED 36′ prices at 40′', () => {
    const one = (l: number) => row(run({ leans: [{ side: 'Left Eave', l }] }), 'Left Eave');
    expect([one(26).bp, one(26).h]).toEqual([2147.5, 245]); // = 30' (Sensei 26-30: $2,147.50 / $245)
    expect([one(36).bp, one(36).h]).toEqual([2897.5, 342.5]); // = 40' (Sensei 36-40: $2,897.50 / $342.50)
    expect([one(40).bp, one(40).h]).toEqual([2897.5, 342.5]);
    expect(one(41).bp).toBe(3245); // 41' → 45' = 20' + 25' units (handbook p6): (2,895 + 3,595) / 2
    const d = run({ leans: [LEFT, FRONT], wraps: 'FL' });
    expect([row(d, 'Front Gable').bp, row(d, 'Front Gable').h]).toEqual([2897.5, 342.5]); // wrapped 24 + 12 = 36 → 40
  });

  it('connection fees (10-14d): 12′–30′ mains eave = book ($100 at 21′ + $25 / 5′, Price Book 2 p2/p4); gable = the pre-10-14 rule $700 + $25 / 5′ (10-14 "A2" reverted, owner 10/14/26); 32′+ keep the $300 floor', () => {
    const exp: Record<number, number> = { 10: 100, 12: 100, 15: 100, 20: 100, 21: 100, 25: 125, 26: 125, 30: 150, 35: 175, 36: 175, 40: 200, 50: 250, 60: 300 };
    for (const l of Object.keys(exp).map(Number)) expect(ev(`setup({leans:[]}); return connFeeFor('Right Eave', ${l});`)).toBe(exp[l]);
    for (const l of Object.keys(exp).map(Number)) expect(ev(`setup({mw:30, leans:[]}); return connFeeFor('Right Eave', ${l});`)).toBe(exp[l]); // no Triple Wide + $200
    expect(ev(`setup({leans:[]}); return connFeeFor('Front Gable', 24);`)).toBe(725);
    expect(ev(`setup({leans:[]}); return connFeeFor('Front Gable', 12);`)).toBe(700);
    expect(ev(`setup({mw:30, leans:[]}); return connFeeFor('Front Gable', 30);`)).toBe(750);
    expect(ev(`setup({mw:30, ml:50, leans:[]}); return connFeeFor('Left Eave', 50);`)).toBe(250);
    expect(ev(`setup({mw:40, leans:[]}); return connFeeFor('Left Eave', 40);`)).toBe(300);
    expect(ev(`setup({mfr:'CA', leans:[]}); return connFeeFor('Left Eave', 40);`)).toBe(200);
    expect(ev(`setup({mfr:'CA', leans:[]}); return connFeeFor('Front Gable', 24);`)).toBe(725);
  });

  it('Triple Wide 30x50x14 (F): lean-to lines = half of the 2W building (Price Book 2 p1/p2 24\' charts); Sensei\'s Triple Wide lines are a CCI question (10-14 "A3" reverted, 10-14d)', () => {
    const o = { mw: 30, ml: 50, mh: 14, leans: [{ side: 'Left Eave', l: 50, h: 12 }, { side: 'Front Gable', l: 30, h: 12 }] };
    const sep = run(o), wr = run({ ...o, wraps: 'FL' });
    // 12x50 = (24x25 $3,595 x 2)/2, 12' height (25' $575 x 2)/2; 12x30 = 24x30 $4,295 / 2, height $710 / 2 (Sensei: 4,195 / 995 / 2,497.50 / 570)
    expect([row(sep, 'Left Eave').bp, row(sep, 'Left Eave').h, row(sep, 'Front Gable').bp, row(sep, 'Front Gable').h]).toEqual([3595, 575, 2147.5, 355]);
    expect([row(wr, 'Left Eave').bp, row(wr, 'Left Eave').h, row(wr, 'Front Gable').bp, row(wr, 'Front Gable').h]).toEqual([4645, 775, 3245, 502.5]);
    const lines = (r: Res) => r.rows.reduce((s, x) => s + x.bp + x.h, 0) + r.feeTotal;
    expect(lines(wr) - lines(sep)).toBeCloseTo(2795, 2); // the wrap: longer units + one $300 corner
  });

  it('no Triple Wide premium (10-14 "A3" reverted, owner 10/14/26): a lean-to prices the same on a 24′ and a 26′–30′ main; a wider lean-to never prices lower', () => {
    const bpOn = (mw: number, w: number) => row(run({ mw, ml: 50, mh: 14, leans: [{ side: 'Left Eave', w, l: 50, h: 12 }] }), 'Left Eave').bp;
    const hOn = (mw: number, w: number) => row(run({ mw, ml: 50, mh: 14, leans: [{ side: 'Left Eave', w, l: 50, h: 12 }] }), 'Left Eave').h;
    expect(bpOn(30, 12)).toBe(3595);
    for (const [mw, w] of [[30, 12], [30, 10], [30, 14], [26, 12], [28, 14], [26, 8]]) { expect(bpOn(mw, w)).toBe(bpOn(24, w)); expect(hOn(mw, w)).toBe(hOn(24, w)); }
    expect(bpOn(30, 14)).toBeGreaterThan(bpOn(30, 12));
    expect(bpOn(30, 12)).toBeGreaterThan(bpOn(30, 10));
    expect(bpOn(32, 12)).not.toBe(bpOn(24, 12)); // 32'+ mains keep their own (certified) rule
  });
});
