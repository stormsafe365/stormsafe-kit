import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI "Fully Insulated - Roof & Walls" next to a FULLY ENCLOSED eave lean-to (CCI 11/9/26, order SS-2026-69096, Michael
 * Bescript 30x70x16, 3:12: Left 14x70 lean-to 12' low leg OPEN, Right 14x70 lean-to 10' low leg FULLY ENCLOSED, 2:12).
 * CCI: roof 2,240 + walls 2,100 + ends 1,080 = 5,420 sq ft x $1.50 = $8,130 (the program had 2,240 walls = $8,340).
 * Walls 2,100 = left building wall 16' x 70 (open lean-to: nothing changes) + the enclosed lean-to's outer wall at its 10' low
 * leg + the building wall above its roof (16' - 12'4" high side = 3'8", rounded UP to 4'). Owner 11/9/26: "Match CCI exactly"
 * (the lean-to's roof and ends are not added). Run through the program's OWN functions.
 */

const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

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
const pitchChart = /var INSUL_END_ADD_PITCH\s*=\s*(\{[\s\S]*?\});/.exec(html)![1];

let code = grabFn('gInsul') + grabFn('insulEndAdd') + grabFn('cciInsulEncLeanAdj') + grabFn('getLTWalls');
code += 'var INSUL_END_ADD_PITCH=' + pitchChart + ';\n';
code += `
var ACTIVE_MFR='CCI', INSUL_RATE=1.50, LT_END_P={}, LT_SIDE_P={}, window={};
var _G={}, _LTS=[];
function G(id){ return (id in _G)?{value:_G[id]}:null; }
var document={querySelectorAll:function(s){ return s==='.lte'?_LTS:[]; }};
function mkEl(o){
  var f={'.lt-type':o.type||'attached','.lts':o.side,'.ltw':o.w,'.ltl2':o.l,'.ltst':o.cont?'cont':'step','.lth':o.low,'.lth-cont':o.low,
         '.ltp':o.pitch||'2:12','.lt-wm':o.wm||'open','.lt-wall-front':o.front||'open','.lt-wall-back':o.back||'open','.lt-wall-side':o.wside||'open'};
  return {querySelector:function(s){ return (s in f)?{value:String(f[s])}:null; }};
}
function insul(main, leans){
  _G={'insul-sel':main.sel||'roof-walls', bw:String(main.w), bl:String(main.l), bh:String(main.h), btype:main.bt||'standard', 'pitch-sel':main.pitch||'standard', 'gch-enc':String(main.enc||0)};
  _LTS=(leans||[]).map(mkEl);
  return gInsul();
}
function insulOld(main, leans){ window._insEncOff=true; try{ return insul(main, leans); } finally { window._insEncOff=false; } }
`;
type Lean = Record<string, unknown>;
type Ctx = { insul: (m: Record<string, unknown>, l?: Lean[]) => number; insulOld: (m: Record<string, unknown>, l?: Lean[]) => number; ACTIVE_MFR: string };
const ctx = vm.createContext({ Math, console, parseInt, parseFloat, String }) as unknown as Ctx;
vm.runInContext(code, ctx as unknown as vm.Context);

const MAIN = { w: 30, l: 70, h: 16 };
const LEFT_OPEN: Lean = { side: 'Left Eave', w: 14, l: 70, low: 12 };
const RIGHT_ENC: Lean = { side: 'Right Eave', w: 14, l: 70, low: 10, wm: 'enclosed' };

describe("CCI's insulation on order SS-2026-69096 (11/9/26), to the dollar", () => {
  it('Michael Bescript: $8,130 (roof 2,240 + walls 2,100 + ends 1,080 sq ft); before 11/9 $8,340', () => {
    expect(ctx.insul(MAIN, [LEFT_OPEN, RIGHT_ENC])).toBe(8130);
    expect(ctx.insulOld(MAIN, [LEFT_OPEN, RIGHT_ENC])).toBe(8340);
  });
  it('an open lean-to adds nothing; so does one that is not fully enclosed', () => {
    expect(ctx.insul(MAIN, [LEFT_OPEN])).toBe(8340);
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, wm: 'custom', wside: 'closed', front: 'closed', back: 'open' }])).toBe(8340);
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, wm: 'custom', wside: 'q2', front: 'closed', back: 'closed' }])).toBe(8340);
    expect(ctx.insul(MAIN, [])).toBe(8340);
  });
  it('custom Closed / Closed / Closed = enclosed', () => {
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, wm: 'custom', wside: 'closed', front: 'closed', back: 'closed' }])).toBe(8130);
  });
});

describe('the rule', () => {
  it('the strip above the lean-to roof rounds UP to the foot; a continuous lean-to has none', () => {
    // 12' low leg, 14' wide, 2:12 -> high side 14'4" -> strip 1'8" -> 2': wall 12 + 2 = 14 (2' less than 16 over 70')
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, low: 12 }])).toBe(8340 - 2 * 70 * 1.5);
    // continuous: low leg = 16 - 14 x 2/12 = 13.67, meets the eave: wall 13.67 (2.33' less over 70')
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, cont: true, low: 13.67 }])).toBe(3360 + Math.round((2240 - 70 * (16 - 13.67)) * 1.5) + 1620);
  });
  it('a shorter lean-to only replaces the wall it covers; two enclosed lean-tos on one side never cover more than the building', () => {
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, l: 30 }])).toBe(8340 - 30 * 2 * 1.5);
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, l: 50 }, { ...RIGHT_ENC, l: 50 }])).toBe(8340 - 70 * 2 * 1.5);
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, l: 90 }])).toBe(8130);
  });
  it('both sides enclosed: both replaced', () => {
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC }, { ...RIGHT_ENC, side: 'Left Eave' }])).toBe(8340 - 2 * 140 * 1.5);
  });
  it('gable lean-tos, free-standing, Roof Only, GCH and CA: unchanged', () => {
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, side: 'Front Gable' }])).toBe(8340);
    expect(ctx.insul(MAIN, [{ ...RIGHT_ENC, type: 'freestanding' }])).toBe(8340);
    expect(ctx.insul({ ...MAIN, sel: 'roof' }, [RIGHT_ENC])).toBe(3360);
    expect(ctx.insul({ ...MAIN, bt: 'gch', enc: 70 }, [RIGHT_ENC])).toBe(8340);
    ctx.ACTIVE_MFR = 'CA';
    try { expect(ctx.insul(MAIN, [RIGHT_ENC])).toBe(8340); } finally { ctx.ACTIVE_MFR = 'CCI'; }
  });
});

describe('program wiring', () => {
  it('the on-screen note uses the same number; saves carry insulLean; older saves name it on reopen', () => {
    expect(html).toContain("var wallCost2=insulSel2.value==='roof-walls'?Math.round((insulDisplayL*ih*2+_encAdj2)*INSUL_RATE)");
    expect(html).toContain(' wideLean:1, insulLean:1,');
    expect(html).toContain("label:'Insulation (as originally quoted)', amt:inD, rules:['insul-enc-lean']");
    expect(html).toContain("'insul-enc-lean': { commit:'11-09d'");
  });
});
