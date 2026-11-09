import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI 14' lean-tos (CCI 11/9/26). CCI hand-corrected order SS-2026-69096 (Michael Bescript): a 30x70x16 12-gauge
 * in Palm Beach (170 MPH, 4' centers) with two 14x70 lean-tos at 2:12 - Left, 12' low leg, open; Right, 10' low leg, fully
 * enclosed, vertical walls. CCI's numbers (each lean-to): size $7,190, 12 gauge $1,440, leg height $840 (12') / $590 (10'),
 * walls 1,765 + 2,500 (side + two ends); the building's own 12-Gauge line $1,540. A 13'-15' (the 14' option) CCI lean-to now
 * prices as its own carport unit at the CCI column (14' = 18'): full size / ends / 12 gauge row, the 12'-24' leg-height
 * chart halved. 12' and under, and 16'+ (owner 11/9/26: "Keep as today" until CCI prices one), stay exactly as before.
 * Run through the program's OWN functions.
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
for (const v of ['WIDTHS', 'LENGTHS', 'PV', 'SC', 'EC', 'VERT_SIDE', 'LT_END_P', 'LT_SIDE_P', 'STD_TIERS', 'CCI_LT_CERT_RATE', 'CCI_LT_SIDE_SHORT',
  'CCI_LT_PANEL', 'CCI_LT_SIDE_FRAC']) code += grabVar(v);
for (const f of ['eBkt', 'ecLookup', 'vertEndUpcharge', 'cciLtSideSecs', 'cciLtSideClosed', 'cciLtShortSideMsg', 'ltPanelsHorizontal', 'nearestStd',
  'cciLtSidePanels', 'cciLtMaxPanels', 'cciLtRunSum', 'cciLtSidePartial', 'cciUnits', 'cciUnitSum', 'cciOC4Leans', 'cciColUp', 'ltSenseiDiffers',
  'getLTWalls', 'ltWallsAs', 'ltStorOn', 'ltStorLenOptions', 'getTrussOC', 'ltStorage', 'ltUnit',
  'cciWideLean', 'cciLeanCol', 'cciLean4C', 'cciLeanGa4', 'cci12GALeanOf', 'cci12GALeans', 'cciWideLtDrift']) code += grabFn(f);
code += 'var VERT_END=' + vertEnd + ';\nvar _CCI_COMBOS=' + cciCombos + ';\n';
// Leg-height rows straight from Price Book 2 (061422): p2 = the 12'-24' chart (HU_N), p4 = the 26'-30' chart (HU_M), at the
// program's LENGTHS columns [21,25,26,29,31,33,36,37,41,...] (20' 25' 25' 30' 30' 30' 35' 35' 40'). The program's own CCI
// tables must carry the same rows (checked below).
code += `
var ACTIVE_MFR='CCI', PR={}, PB={}, HU={}, window={};
for(var _bpi=0;_bpi<10;_bpi++){ PV[26][_bpi]=PV[25][_bpi]; PV[46][_bpi]=PV[45][_bpi]; } // the program's own 26'/46' row correction (line after var PV)
function ltBasePrice(){ return 0; } // free-standing / CA path - not under test
var HU_N={10:[290,395,395,395,490,490,590,590,685],12:[430,575,575,575,710,710,840,840,970]};
var HU_M={10:[430,530,530,530,625,625,720,720,815],12:[840,995,995,995,1140,1140,1295,1295,1440]};
var _G={bw:{value:'30'},btype:{value:'standard'},ws:{value:'Vertical'},rs:{value:'Vertical'},'oc-spacing':{value:'4oc'},foundation:{value:'concrete'}};
function G(id){ return _G[id]||null; }
function MFR(){ return {standardCombinations:_CCI_COMBOS}; }
var _LTS=[];
var document={querySelectorAll:function(s){ return s==='.lte'?_LTS:[]; }};
function getTrussInfo(){ return {count:0}; }
function mkEl(o){
  var f={'.ltw':o.w,'.ltl2':o.l,'.lt-type':o.type||'attached','.ltst':'step','.lth':o.h,'.lth-cont':o.h,
         '.lt-wm':'custom','.lt-wall-front':o.front||'open','.lt-wall-back':o.back||'open','.lt-wall-side':o.side||'open',
         '.lt-stor':o.stor||'none','.lt-stor-len':o.slen==null?'':String(o.slen)};
  return {querySelector:function(s){ return (s in f)?{value:String(f[s])}:null; }};
}
function setMain(o){
  _G.bw.value=String(o.mw||30); _G['oc-spacing'].value=o.oc===5?'5oc':'4oc';
  _G.ws.value=o.horiz?'Horizontal':'Vertical'; _G.btype.value=o.btype||'standard';
}
function lean(o){ setMain(o); var el=mkEl(o); _LTS=[el]; var u=ltUnit(el); return {bp:u.bp, h:u.heightAdj, enc:u.encAdj, total:u.total, ga:cci12GALeanOf(el), ga4:cciLeanGa4(el), note:ltSenseiDiffers(el)}; }
function old(o){ window._ltWideOff=true; try{ return lean(o); } finally { window._ltWideOff=false; } }
function leans(list, o){ setMain(o||{}); _LTS=list.map(mkEl); return {ga:cci12GALeans(), oc4:cciOC4Leans(), oc4narrow:cciOC4Leans(true), drift:cciWideLtDrift(true), driftNoGa:cciWideLtDrift(false)}; }
`;
type L = { bp: number; h: number; enc: number; total: number; ga: number; ga4: boolean; note: string };
type Ctx = {
  lean: (o: Record<string, unknown>) => L;
  old: (o: Record<string, unknown>) => L;
  leans: (list: Record<string, unknown>[], o?: Record<string, unknown>) => { ga: number; oc4: number; oc4narrow: number; drift: number; driftNoGa: number };
};
const ctx = vm.createContext({ Math, console }) as unknown as Ctx;
vm.runInContext(code, ctx as unknown as vm.Context);

const LEFT = { w: 14, l: 70, h: 12 };                                                       // open
const RIGHT = { w: 14, l: 70, h: 10, front: 'closed', back: 'closed', side: 'closed' };      // fully enclosed, vertical

describe("CCI's corrections on order SS-2026-69096 (11/9/26), to the dollar", () => {
  it('Left 14x70, 12\' low leg, open: size $7,190, leg height $840, 12 gauge $1,440', () => {
    const u = ctx.lean(LEFT);
    expect(u.bp).toBe(7190);
    expect(u.h).toBe(840);
    expect(u.enc).toBe(0);
    expect(u.ga).toBe(1440);
    expect(u.ga4).toBe(true);
  });
  it('Right 14x70, 10\' low leg, fully enclosed: size $7,190, leg height $590, walls $1,765 + $2,500, 12 gauge $1,440', () => {
    const u = ctx.lean(RIGHT);
    expect(u.bp).toBe(7190);
    expect(u.h).toBe(590);
    expect(u.enc).toBe(1765 + 2500);
    expect(u.ga).toBe(1440);
    const side = ctx.lean({ ...RIGHT, front: 'open', back: 'open' }).enc;
    expect(side).toBe(1765);                       // = the program's side before 11/9 (CCI ticked it)
    expect((u.enc - side) / 2).toBe(980 + 270);    // each end = the 18' end at 10' tall + the 18' vertical end
  });
  it('both lean-tos: 12 gauge $2,880 (the building\'s own 12-Gauge line keeps only its $1,540)', () => {
    expect(ctx.leans([LEFT, RIGHT]).ga).toBe(2880);
  });
  it('lean-to total change on this job = +$2,875 (size +$1,790, 12 gauge +$1,680, leg height -$585, ends -$10)', () => {
    const now = ctx.lean(LEFT).total + ctx.lean(RIGHT).total + ctx.leans([LEFT, RIGHT]).ga;
    const before = ctx.old(LEFT).total + ctx.old(RIGHT).total + 600 + 600;
    expect(ctx.old(LEFT).bp).toBe(6295);
    expect(ctx.old(LEFT).h).toBe(1295);
    expect(ctx.old(RIGHT).h).toBe(720);
    expect(ctx.old(RIGHT).enc).toBe(4275);
    expect(ctx.old(LEFT).ga).toBe(600);
    expect(now - before).toBe(2875);
    // the price lock names exactly that for a quote saved before 11/9 (old - new, with and without the 12 gauge part)
    expect(ctx.leans([LEFT, RIGHT]).drift).toBe(-2875);
    expect(ctx.leans([LEFT, RIGHT]).driftNoGa).toBe(-2875 + 1680);
  });
});

describe('the rule: 13\'-15\' lean-tos (the 14\' option) only', () => {
  it('12\' and under: exactly as before (half of a 2W building, 5\' 12-gauge row) — also at 4\' centers on a 30\' main', () => {
    for (const w of [8, 10, 12]) {
      for (const l of [20, 40, 50, 70]) {
        for (const h of [10, 12]) {
          const o = { w, l, h, front: 'closed', side: 'closed' };
          expect(ctx.lean(o)).toEqual(ctx.old(o));
        }
      }
    }
    expect(ctx.lean({ w: 12, l: 50, h: 12 }).bp).toBe(3595);   // Peter Mawn 10/28 (CCI's bill)
    expect(ctx.lean({ w: 12, l: 50, h: 12 }).h).toBe(575);
    expect(ctx.lean({ w: 12, l: 50, h: 12 }).ga).toBe(480);
  });
  it('14\' prices at the 18\' column; full size, full ends', () => {
    expect(ctx.lean({ w: 14, l: 40, h: 10 }).bp).toBe(4095);          // 18x40 (Price Book 2 p1)
    expect(ctx.lean({ w: 13, l: 40, h: 10 }).bp).toBe(4095);
    expect(ctx.lean({ w: 15, l: 40, h: 10 }).bp).toBe(4095);
  });
  it('16\' and 20\': exactly as before (owner 11/9/26 "Keep as today" until CCI prices one), rep note kept', () => {
    for (const w of [16, 20]) {
      for (const l of [20, 40, 70]) {
        for (const h of [10, 12]) {
          for (const mw of [24, 30]) {
            const o = { w, l, h, mw, front: 'closed', back: 'gable', side: 'closed' };
            expect(ctx.lean(o)).toEqual(ctx.old(o));
            expect(ctx.lean(o).note).toMatch(/wide lean-to/);
          }
        }
      }
    }
    expect(ctx.leans([{ w: 16, l: 40, h: 10 }, { w: 20, l: 70, h: 12 }]).drift).toBe(0);
  });
  it('12 gauge over 12\': the 170 MPH 4\' centers row at 4\' centers (4\' OC option, 26\'+ or wide-span main), else the 5\' row', () => {
    expect(ctx.lean({ w: 14, l: 40, h: 10, mw: 24, oc: 5 }).ga).toBe(330);
    expect(ctx.lean({ w: 14, l: 40, h: 10, mw: 24, oc: 4 }).ga).toBe(840);
    expect(ctx.lean({ w: 14, l: 40, h: 10, mw: 30, oc: 5 }).ga).toBe(840);
    expect(ctx.lean({ w: 14, l: 40, h: 10, mw: 40, oc: 5, btype: 'widespan' }).ga).toBe(840);
    expect(ctx.lean({ w: 12, l: 40, h: 10, mw: 30, oc: 4 }).ga).toBe(330);
    expect(ctx.lean({ w: 14, l: 40, h: 10, type: 'freestanding' }).ga).toBe(0);
  });
  it('partial ends follow the full end; Gable Only = the full $225 gable', () => {
    const closed = ctx.lean({ w: 14, l: 40, h: 10, horiz: true, back: 'closed' }).enc;
    expect(closed).toBe(980);
    expect(ctx.lean({ w: 14, l: 40, h: 10, horiz: true, back: 'q2' }).enc).toBe(490);
    expect(ctx.lean({ w: 14, l: 40, h: 10, horiz: true, back: 'gable' }).enc).toBe(225);
    expect(ctx.lean({ w: 12, l: 40, h: 10, horiz: true, back: 'gable' }).enc).toBe(112.5);
  });
  it('the 12GA + 4\' OC rep note counts lean-tos of 12\' and under only', () => {
    const r = ctx.leans([{ w: 12, l: 40, h: 10 }, { w: 14, l: 40, h: 10 }], { mw: 24, oc: 4 });
    expect(r.oc4).toBe(800);
    expect(r.oc4narrow).toBe(400);
  });
  it('rep note "verify with CCI": not on 13\'-15\' (CCI checked a 14\'), still on 16\'+ and 6\'-8\'', () => {
    for (const w of [13, 14, 15]) expect(ctx.lean({ w, l: 40, h: 10 }).note).toBe('');
    for (const w of [16, 20]) expect(ctx.lean({ w, l: 40, h: 10 }).note).toMatch(/wide lean-to/);
    expect(ctx.lean({ w: 12, l: 40, h: 10, mw: 30 }).note).toMatch(/Triple Wide/);
    expect(ctx.lean({ w: 14, l: 40, h: 10, mw: 30 }).note).toBe('');
  });
});

describe('program wiring', () => {
  it("the program's CCI leg-height tables carry the Price Book 2 rows used above", () => {
    expect(html).toContain('12:[430,575,575,575,710,710,840,840,970');
    expect(html).toContain('10:[290,395,395,395,490,490,590,590,685');
    expect(html).toContain('12:[840,995,995,995,1140,1140,1295,1295,1440');
    expect(html).toContain('10:[430,530,530,530,625,625,720,720,815');
  });
  it('documents: the building\'s 12-Gauge row without the lean-tos; a 12-gauge row under each lean-to', () => {
    expect(html.split("  var framingUpgP=T.framingUpgrade-(+T.ga12Lean||0);").length - 1).toBe(2);
    expect(html.split("var _lg12=(+T.ga12Lean>0&&!ltIsFree)?cci12GALeanOf(el):0; if(_lg12) ").length - 1).toBe(2);
  });
  it('price lock: new saves carry wideLean; older ones name the lean-to change on reopen', () => {
    expect(html).toContain(' lean12ga:1, frtSep:1, wideLean:1,');
    expect(html).toContain("if(mfr==='CCI' && !_ov3.wideLean && bt!=='fslean' && typeof root.cciWideLtDrift==='function'){");
    expect(html).toContain("'wide-lean-1109': { commit:'11-09c'");
  });
});
