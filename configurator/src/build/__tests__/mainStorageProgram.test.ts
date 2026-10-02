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
  'aewPopulate', 'aewSpec', 'aewLabel', 'gAddEndWall']) code += grabFn(f);
code += `
var ACTIVE_MFR='CCI';
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
  _G={btype:mkVal(o.btype||'standard'), bw:mkVal(String(o.w)), bl:mkVal(String(o.l)), bh:mkVal(String(o.h||12)),
      'oc-spacing':mkVal(o.oc===4?'4oc':'5oc'), ws:mkVal(o.vert?'Vertical':'Horizontal'),
      'add-end-wall':mkVal(o.aew||'yes'), 'aew-end':mkSel(['back','front']),
      'aew-depth':mkSel([]), 'aew-width':mkSel([])};
  _G['aew-end'].value=o.end||'back';
  ACTIVE_MFR=o.mfr||'CCI';
}
function opts(sel){ return sel.options.map(function(o){ return Number(o.value); }); }
function state(){ return {depth:_G['aew-depth'].value, width:_G['aew-width'].value, moved:_aewMoved,
  depthOpts:opts(_G['aew-depth']), widthOpts:opts(_G['aew-width']), spec:aewSpec(), label:aewLabel(), price:gAddEndWall()}; }
function populate(o, wantD, wantW){ setup(o); aewPopulate(wantD, wantW); return state(); }
function setSize(o){ _G.bw.value=String(o.w); _G.bl.value=String(o.l); if(o.oc) _G['oc-spacing'].value=o.oc===4?'4oc':'5oc'; aewPopulate(); return state(); }
function pick(id, v){ _G[id].value=String(v); if(id==='aew-end') aewPopulate(); return state(); }
`;

type Spec = { on: boolean; kind: string; end: string; depthFt: number; widthFt: number };
type State = { depth: string; width: string; moved: string; depthOpts: number[]; widthOpts: number[]; spec: Spec; label: string; price: number };
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
    expect(s.spec).toEqual({ on: true, kind: 'end', end: 'back', depthFt: 12, widthFt: 10 });
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
