import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Main-building storage partition position (owner 10/1/26) — the pricing
 * program's OWN functions (public/quote-builder.html, extracted into a node vm):
 * End Storage depth = frame lines only (trusses at k·S from the FRONT, like
 * getTrussPositions), Left/Right width = whole feet 4..W−4, defaults, the
 * keep / snap rule — and the price (gAddEndWall) never moves with any of it.
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

let code = '';
for (const v of ['EC', 'LR_L', 'LR_STORAGE', 'LR_VERT_ADD', 'AEW_DEFAULT_FT', '_aewMoved']) code += grabVar(v);
for (const f of ['eBkt', 'ecLookup', 'lrStorageLookup', 'getTrussInfo', 'aewDepthOptions', 'aewWidthOptions', 'aewNearest', 'aewDefaultDepth',
  'aewPopulate', 'aewUnset', 'aewClearUnset', 'aewSpec', 'aewSig', 'aewLabel', 'aewEaveConflicts', 'gAddEndWall']) code += grabFn(f);
code += `
var ACTIVE_MFR='CCI';
var INPUT_MODE=false;
// Eave openings for aewEaveConflicts (the program's collectElevItems shape).
var _elev={front:[],back:[],right:[],left:[],partition:[]};
function collectElevItems(){ return _elev; }
function setElev(e){ _elev=Object.assign({front:[],back:[],right:[],left:[],partition:[]}, e); }
function conflicts(){ return aewEaveConflicts(aewSpec()); }
function setInput(on){ INPUT_MODE=!!on; return state(); }
function markUnset(on){ if(on) _G['add-end-wall'].dataset.aewUnset='1'; else aewClearUnset(); return state(); }
function setMode(v){ _G['add-end-wall'].value=v; return state(); }
function Option(text, value){ this.text=text; this.value=value; }
// Minimal <select>: value only sticks to an existing option (like the DOM).
function mkSel(opts){
  var s={options:[], _v:'', add:function(o){ this.options.push(o); }};
  Object.defineProperty(s,'innerHTML',{set:function(){ this.options=[]; this._v=''; }});
  Object.defineProperty(s,'value',{get:function(){ return this._v; }, set:function(v){
    v=String(v); this._v=this.options.some(function(o){ return o.value===v; })?v:''; }});
  (opts||[]).forEach(function(v){ s.add(new Option(v,v)); });
  return s;
}
function mkVal(v){ return {value:v}; }
var _G={};
function G(id){ return _G[id]||null; }
function setup(o){
  _G={btype:mkVal(o.btype!=null?o.btype:'standard'), bw:mkVal(String(o.w)), bl:mkVal(String(o.l)), bh:mkVal(String(o.h||12)),
      'oc-spacing':mkVal(o.oc===4?'4oc':'5oc'), ws:mkVal(o.vert?'Vertical':'Horizontal'),
      'add-end-wall':mkVal(o.aew||'yes'), 'aew-end':mkSel(['back','front']),
      'aew-depth':mkSel([]), 'aew-width':mkSel([])};
  _G['add-end-wall'].dataset={};
  _G['aew-end'].value=o.end||'back';
  ACTIVE_MFR=o.mfr||'CCI';
  INPUT_MODE=false;
}
function opts(sel){ return sel.options.map(function(o){ return Number(o.value); }); }
function state(){ return {depth:_G['aew-depth'].value, width:_G['aew-width'].value, moved:_aewMoved,
  depthOpts:opts(_G['aew-depth']), widthOpts:opts(_G['aew-width']), spec:aewSpec(), label:aewLabel(), price:gAddEndWall(), sig:aewSig()}; }
function populate(o, wantD, wantW){ setup(o); aewPopulate(wantD, wantW); return state(); }
function setSize(o){ _G.bw.value=String(o.w); _G.bl.value=String(o.l); if(o.oc) _G['oc-spacing'].value=o.oc===4?'4oc':'5oc'; aewPopulate(); return state(); }
function pick(id, v){ _G[id].value=String(v); if(id==='aew-end') aewPopulate(); return state(); }
`;

type Spec = { on: boolean; kind: string; end: string; depthFt: number; widthFt: number; priced: boolean; unset: boolean };
type State = { depth: string; width: string; moved: string; depthOpts: number[]; widthOpts: number[]; spec: Spec; label: string; price: number; sig: string };
type Elev = { x: number; w: number; type: string };
type Setup = { w: number; l: number; h?: number; oc?: 4 | 5; btype?: string; aew?: string; end?: string; mfr?: string; vert?: boolean };
type Ctx = {
  aewDepthOptions: (L: number, S: number, end: string) => number[];
  aewWidthOptions: (W: number) => number[];
  aewDefaultDepth: (o: number[]) => number | null;
  aewNearest: (o: number[], want: number) => number | null;
  ecLookup: (w: number, h: number) => number;
  lrStorageLookup: (l: number, h: number) => number;
  populate: (o: Setup, wantD?: string, wantW?: string) => State;
  setSize: (o: { w: number; l: number; oc?: 4 | 5 }) => State;
  pick: (id: string, v: string | number) => State;
  setElev: (e: { right?: Elev[]; left?: Elev[] }) => void;
  conflicts: () => string[];
  setInput: (on: boolean) => State;
  markUnset: (on: boolean) => State;
  setMode: (v: string) => State;
};
const ctx = vm.createContext({ Math, console, String, Number, Object }) as unknown as Ctx;
vm.runInContext(code, ctx as unknown as vm.Context);
const range = (a: number, b: number, s: number) => Array.from({ length: Math.floor((b - a) / s) + 1 }, (_, i) => a + i * s);

describe('End Storage depth = frame lines (trusses at k·S from the front)', () => {
  it('L a multiple of S: every bay from one bay to L − one bay, either end', () => {
    expect(ctx.aewDepthOptions(40, 4, 'back')).toEqual(range(4, 36, 4));
    expect(ctx.aewDepthOptions(40, 4, 'front')).toEqual(range(4, 36, 4));
    expect(ctx.aewDepthOptions(40, 5, 'back')).toEqual(range(5, 35, 5));
  });
  it('short last bay at the back: back-end depths are L − k·S, front-end depths k·S', () => {
    // 42' at 4' OC: trusses 4..40 from the front (2' last bay at the back)
    expect(ctx.aewDepthOptions(42, 4, 'back')).toEqual(range(6, 38, 4));
    expect(ctx.aewDepthOptions(42, 4, 'front')).toEqual(range(4, 36, 4));
  });
  it('nothing to offer without a size', () => {
    expect(ctx.aewDepthOptions(0, 4, 'back')).toEqual([]);
    expect(ctx.aewDepthOptions(40, 0, 'back')).toEqual([]);
  });
  it("default 10' or the nearest line (a tie takes the larger); a building too short for 10' gets the middle line", () => {
    expect(ctx.aewDefaultDepth(range(5, 35, 5))).toBe(10);
    expect(ctx.aewDefaultDepth(range(4, 36, 4))).toBe(12);
    expect(ctx.aewDefaultDepth(range(6, 38, 4))).toBe(10);
    expect(ctx.aewDefaultDepth([4, 8])).toBe(8);
    expect(ctx.aewDefaultDepth([5])).toBe(5);
    expect(ctx.aewDefaultDepth([])).toBe(null);
  });
});

describe("Left / Right storage width: whole feet 4' .. W − 4'", () => {
  it('options + default', () => {
    expect(ctx.aewWidthOptions(30)).toEqual(range(4, 26, 1));
    expect(ctx.aewWidthOptions(12)).toEqual([4, 5, 6, 7, 8]);
    expect(ctx.aewWidthOptions(7)).toEqual([]);
    const s = ctx.populate({ w: 12, l: 30, aew: 'left' });
    expect(s.width).toBe('8'); // 10 clamped to W − 4
  });
});

describe('aewPopulate: defaults, keep a valid pick, snap an invalid one (with a rep note)', () => {
  it("30x40 (4' OC wide build): back end 12' by default, width 10'", () => {
    const s = ctx.populate({ w: 30, l: 40 });
    expect(s.depthOpts).toEqual(range(4, 36, 4));
    expect(s.depth).toBe('12');
    expect(s.width).toBe('10');
    expect(s.spec).toEqual({ on: true, kind: 'end', end: 'back', depthFt: 12, widthFt: 10, priced: true, unset: false });
    expect(s.moved).toBe('');
  });
  it("24x40 at 5' OC: 10' at the back", () => {
    expect(ctx.populate({ w: 24, l: 40 }).depth).toBe('10');
  });
  it('a pick that stays valid is kept when the length changes; an invalid one snaps to the nearest line', () => {
    ctx.populate({ w: 30, l: 40 });
    let s = ctx.pick('aew-depth', 20);
    expect(s.depth).toBe('20');
    s = ctx.setSize({ w: 30, l: 48 });
    expect(s.depth).toBe('20'); // 48 - 20 = 28 is a truss line
    expect(s.moved).toBe('');
    s = ctx.setSize({ w: 30, l: 42 }); // back depths are now 6, 10, 14, 18, 22 …
    expect(s.depth).toBe('22'); // 18 / 22 tie → the larger
    expect(s.moved).toContain('Depth moved from 20′ to 22′');
    s = ctx.setSize({ w: 30, l: 42 }); // the next pass clears the note
    expect(s.moved).toBe('');
  });
  it('switching the end rebuilds the list for that end', () => {
    ctx.populate({ w: 30, l: 42 });
    const s = ctx.pick('aew-end', 'front');
    expect(s.depthOpts).toEqual(range(4, 36, 4));
    expect(s.spec.end).toBe('front');
  });
  it('a restore re-applies the saved picks exactly (no rep note)', () => {
    const s = ctx.populate({ w: 30, l: 40, end: 'front' }, '28', '7');
    expect(s.depth).toBe('28');
    expect(s.width).toBe('7');
    expect(s.moved).toBe('');
  });
});

describe('labels name the position; GCH is untouched', () => {
  it('End / Left / Right labels', () => {
    expect(ctx.populate({ w: 30, l: 40 }).label).toBe('End Storage — Interior Partition Wall (12′ deep at back end)');
    expect(ctx.populate({ w: 30, l: 40, end: 'front' }, '20').label).toBe('End Storage — Interior Partition Wall (20′ deep at front end)');
    expect(ctx.populate({ w: 30, l: 40, aew: 'left' }, undefined, '12').label).toBe('Left Storage — Lengthwise Partition Wall (12′ wide)');
    expect(ctx.populate({ w: 30, l: 40, aew: 'right' }).label).toBe('Right Storage — Lengthwise Partition Wall (10′ wide)');
  });
  it('GCH: no storage partition from these rows (its divider is the enclosed split) and no charge here', () => {
    const s = ctx.populate({ w: 24, l: 40, btype: 'gch' });
    expect(s.spec.on).toBe(false);
    expect(s.price).toBe(0);
  });
  it('None: off', () => {
    expect(ctx.populate({ w: 24, l: 40, aew: 'no' }).spec.on).toBe(false);
  });
});

describe('the price never moves with the storage position (no invented prices)', () => {
  it('End Storage = ecLookup(w, h) at every depth, both ends (Sensei CCI 30w×16h = $2,930)', () => {
    const base = ctx.populate({ w: 30, l: 40, h: 16 });
    expect(base.price).toBe(ctx.ecLookup(30, 16));
    expect(base.price).toBe(2930);
    for (const end of ['back', 'front']) {
      ctx.populate({ w: 30, l: 40, h: 16, end });
      for (const d of range(4, 36, 4)) expect(ctx.pick('aew-depth', d).price).toBe(2930);
    }
  });
  it('Left / Right (CCI) = lrStorageLookup(l, h) at every width', () => {
    for (const aew of ['left', 'right']) {
      ctx.populate({ w: 30, l: 40, h: 12, aew });
      const want = ctx.lrStorageLookup(40, 12);
      expect(want).toBe(3770);
      for (const x of range(4, 26, 1)) expect(ctx.pick('aew-width', x).price).toBe(want);
    }
  });
  it('CA Left / Right stays $0 (unverified chart) whatever the width', () => {
    ctx.populate({ w: 30, l: 40, h: 12, aew: 'left', mfr: 'CA' });
    for (const x of [4, 10, 26]) expect(ctx.pick('aew-width', x).price).toBe(0);
  });
});

describe('rep note names only the field this storage type uses (verifier r1)', () => {
  it("Left Storage + OC change: the hidden depth snaps silently (no 'Depth moved')", () => {
    ctx.populate({ w: 24, l: 40, aew: 'left' }); // depth 10 at 5' OC, width 10
    const s = ctx.setSize({ w: 24, l: 40, oc: 4 }); // depth 10 is no longer a line
    expect(s.depth).toBe('12');
    expect(s.width).toBe('10');
    expect(s.moved).toBe('');
  });
  it('End Storage + width change: the depth move is named, the hidden width snap is not', () => {
    ctx.populate({ w: 30, l: 40 });
    ctx.pick('aew-depth', 28);
    const s = ctx.setSize({ w: 12, l: 40 }); // 5' OC now; width 10 -> 8 (hidden)
    expect(s.depth).toBe('30');
    expect(s.width).toBe('8');
    expect(s.moved).toContain('Depth moved from 28′ to 30′');
    expect(s.moved).not.toContain('Width');
  });
  it('Left Storage + width change: the width move is named', () => {
    ctx.populate({ w: 30, l: 40, aew: 'right' }, undefined, '26');
    const s = ctx.setSize({ w: 24, l: 40 });
    expect(s.width).toBe('20');
    expect(s.moved).toBe('Width moved from 26′ to 20′ (fits this width).');
  });
});

describe('only a wall the quote charges is drawn (CA Left/Right = no chart, $0)', () => {
  it('CA Left: not drawn, no position on the label; Input mode (priced by hand) draws it', () => {
    let s = ctx.populate({ w: 30, l: 40, h: 12, aew: 'left', mfr: 'CA' });
    expect(s.price).toBe(0);
    expect(s.spec.on).toBe(false);
    expect(s.spec.priced).toBe(false);
    expect(s.label).toBe('Left Storage — Lengthwise Partition Wall');
    s = ctx.setInput(true);
    expect(s.spec.on).toBe(true);
    expect(s.price).toBe(0); // Input mode never changes the chart price
  });
  it('CA End Storage is charged (closed-end chart) and drawn', () => {
    const s = ctx.populate({ w: 30, l: 40, h: 12, mfr: 'CA' });
    expect(s.price).toBeGreaterThan(0);
    expect(s.spec.on).toBe(true);
  });
  it('no building type yet (after RESET): nothing drawn', () => {
    const s = ctx.populate({ w: 30, l: 40, btype: '' });
    expect(s.spec.on).toBe(false);
    expect(s.label).toBe('End Storage — Interior Partition Wall');
  });
});

describe('old quotes (no saved position): drawn at the default, no position on the paperwork', () => {
  it('unset -> label without position, signature without position; any pick clears it', () => {
    ctx.populate({ w: 30, l: 40 });
    let s = ctx.markUnset(true);
    expect(s.spec.on).toBe(true); // the 3D still draws the default
    expect(s.spec.unset).toBe(true);
    expect(s.label).toBe('End Storage — Interior Partition Wall');
    expect(s.sig).toBe('yes|');
    s = ctx.markUnset(false);
    expect(s.label).toBe('End Storage — Interior Partition Wall (12′ deep at back end)');
    expect(s.sig).toBe('yes|back:12');
  });
  it('the signature follows end / depth / width / type', () => {
    ctx.populate({ w: 30, l: 40 });
    expect(ctx.pick('aew-depth', 20).sig).toBe('yes|back:20');
    expect(ctx.pick('aew-end', 'front').sig).toMatch(/^yes\|front:/);
    expect(ctx.setMode('left').sig).toBe('left|10');
    expect(ctx.setMode('no').sig).toBe('no|');
  });
});

describe('End Storage wall through an eave opening -> rep warning (no price effect)', () => {
  it('Right Eave x from the front, Left Eave x from the back', () => {
    ctx.populate({ w: 30, l: 40 }); // back end 12' -> wall 28' from the front
    ctx.setElev({ right: [{ x: 23, w: 10, type: 'rollup' }] }); // 23-33 from the front
    expect(ctx.conflicts()).toEqual(['the Right Eave roll-up door (23′–33′ from the front)']);
    ctx.setElev({ left: [{ x: 7, w: 10, type: 'rollup' }] }); // 40-7-10 = 23 .. 33 from the front
    expect(ctx.conflicts()).toEqual(['the Left Eave roll-up door (23′–33′ from the front)']);
    ctx.setElev({ right: [{ x: 28, w: 3, type: 'wtd' }, { x: 18, w: 10, type: 'rollup' }] }); // touching jambs: fine
    expect(ctx.conflicts()).toEqual([]);
    ctx.setElev({ left: [{ x: 10.75, w: 2.5, type: 'win' }] }); // 26.75-29.25 from the front
    expect(ctx.conflicts()).toEqual(['the Left Eave window (26.8′–29.3′ from the front)']);
  });
  it('front-end storage measures from the front; Left/Right storage is not checked here', () => {
    ctx.populate({ w: 30, l: 40, end: 'front' }, '12');
    ctx.setElev({ right: [{ x: 10, w: 10, type: 'fo' }] });
    expect(ctx.conflicts()).toEqual(['the Right Eave framed opening (10′–20′ from the front)']);
    ctx.populate({ w: 30, l: 40, aew: 'left' });
    expect(ctx.conflicts()).toEqual([]);
    ctx.setElev({});
  });
});
