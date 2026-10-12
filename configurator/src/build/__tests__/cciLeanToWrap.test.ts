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
 * changed by a wrap; each wrapped corner adds $300. Our existing (non-wrap)
 * connection fees differ from Sensei (side $300 vs $200, gable end $725 vs
 * $250) — reported, deliberately unchanged here, pinned below as they are.
 * F (Triple Wide 30x50x14): Sensei's lean-to size / height there are not the
 * half-of-24' method (known item 7, rep note) — pinned at OUR values.
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
  'ltWrapFeeTotal', '_ltWrapTxt', '_ltWrapTip', 'ltOverall', 'ltWrapPrintIssue']) code += grabFn(f);
code += 'var VERT_END=' + vertEnd + ', HU_N=' + huN + ', HU_M=' + huM + ', HU={}, _CC=' + combos + ';\n';
code += `
var ACTIVE_MFR='CCI', window={};
var _G={bw:{value:'24'},bl:{value:'40'},bh:{value:'12'},btype:{value:'standard'},ws:{value:'Horizontal'},rs:{value:'Vertical'},'oc-spacing':{value:'5oc'},'lt-wraps':{value:''}};
function G(id){ return _G[id]||null; }
function MFR(){ return {standardCombinations:_CC}; }
function getTrussOC(){ return 5; }
var _LTS=[];
var document={querySelectorAll:function(s){ return s==='.lte'?_LTS:[]; }};
function mkEl(o){
  var f={'.lts':o.side,'.ltw':o.w||12,'.ltl2':o.l,'.ltoff':o.off||0,'.lt-type':o.type||'attached','.lth':o.h||10,'.ltp':(o.p||2)+':12',
         '.lt-wm':o.wm||'open','.lt-wall-front':'open','.lt-wall-back':'open','.lt-wall-side':'open','.lt-stor':'none'};
  return {querySelector:function(s){ return (s in f)?{value:String(f[s])}:null; }, _o:o};
}
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
  it('B / C: not wrapped — size and height already match Sensei; connection fees are ours (unchanged)', () => {
    const c = run({ leans: [LEFT, FRONT] });
    expect(row(c, 'Left Eave')).toMatchObject({ bp: 2897.5, h: 342.5, wrapLen: 0, txt: '' });
    expect(row(c, 'Front Gable')).toMatchObject({ bp: 1797.5, h: 197.5, wrapLen: 0 });
    // ours vs Sensei: side $300 vs $200, gable end $725 vs $250 (pre-existing, reported — not changed by this feature)
    expect(row(c, 'Left Eave').conn).toBe(300);
    expect(row(c, 'Front Gable').conn).toBe(725);
    expect(c.feeTotal).toBe(0);
    expect(c.conn).toBe(1025);
  });

  it('D: Front Left wrap — Left @52\' and Front @36\', + $300 corner (to the cent)', () => {
    const d = run({ leans: [LEFT, FRONT], wraps: 'FL' });
    expect(d.active).toEqual(['FL']);
    expect(row(d, 'Left Eave')).toMatchObject({ wrapLen: 52, unitWrap: 52, bp: 3945, h: 442.5 });
    expect(row(d, 'Front Gable')).toMatchObject({ wrapLen: 36, unitWrap: 36, bp: 2897.5, h: 342.5 });
    expect(d.fees).toEqual([{ k: 'FL', label: 'Left Front Connection Fee (wrap-around corner)', fee: 300 }]);
    expect(d.conn).toBe(1025 + 300); // normal fees unchanged by the wrap + one corner
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

  it('F (Triple Wide 30x50x14, 12-wide x 12\' lean-tos, Left + Front wrapped): wrapped lengths 62\' / 42\' — OUR half-of-24\' prices (Sensei item 7 differs)', () => {
    const f = run({ mw: 30, ml: 50, mh: 14, leans: [{ side: 'Left Eave', l: 50, h: 12 }, { side: 'Front Gable', l: 30, h: 12 }], wraps: 'FL' });
    expect(f.active).toEqual(['FL']);
    expect(row(f, 'Left Eave').wrapLen).toBe(62);
    expect(row(f, 'Front Gable').wrapLen).toBe(42);
    // ours: 62 → 35+30 units of the 24' chart, 42 → 25+20 (Sensei: $5,445 / $3,795 sizes, $1,217.50 / $917.50 heights)
    expect(row(f, 'Left Eave').bp).toBe(4645);
    expect(row(f, 'Front Gable').bp).toBe(3245);
    expect(f.feeTotal).toBe(300);
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
