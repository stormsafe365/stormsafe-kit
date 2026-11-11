import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/11/26 (Michael Bescript asked "does this include insulation in the lean-to?"): with lean-tos on the quote, the
 * insulation row on the quote PDF / contract / text quote says what is insulated - the main building, plus each fully enclosed
 * eave lean-to's outer wall the CCI rule counts (cciInsulEncLeanAdj, math unchanged); never a lean-to's roof or end walls.
 * No lean-tos: the label exactly as before. Wording only.
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
type Lt = { side: string; w: number; l: number; low: number; pitch?: string; closed?: boolean; type?: string };
type Ctx = {
  ACTIVE_MFR: string; __f: Record<string, string>; __lts: Lt[];
  insulRowLabel: () => string; insulScope: () => string; cciInsulEncLeanAdj: (h: number, L: number, s?: string[]) => number;
};
const ctx = vm.createContext({}) as unknown as Ctx;
vm.runInContext(
  grabFn('cciInsulEncLeanAdj') + grabFn('insulScope') + grabFn('insulRowLabel') +
  "var ACTIVE_MFR='CCI', __f={}, __lts=[], window={};" +
  "function G(id){ return __f[id]!=null?{value:__f[id]}:null; }" +
  "function getLTWalls(el){ var c=!!el.__lt.closed; return {sideClosed:c, frontClosed:c, backClosed:c}; }" +
  "function wrap(lt){ var q={'.lt-type':lt.type||'attached','.lts':lt.side,'.ltw':String(lt.w),'.ltl2':String(lt.l),'.lth':String(lt.low),'.ltp':lt.pitch||'2:12','.ltst':'std'};" +
  "  return { __lt:lt, querySelector:function(c){ return q[c]!=null?{value:q[c]}:null; } }; }" +
  "var document={ querySelectorAll:function(s){ return s==='.lte'?__lts.map(wrap):[]; } };",
  ctx as unknown as vm.Context,
);
const FULL = 'Fully Insulated \u2014 Roof & Walls';
const ROOF = 'Insulation \u2014 Roof Only';
function set(mfr: string, insul: string, lts: Lt[], btype = 'standard') {
  ctx.ACTIVE_MFR = mfr;
  ctx.__f = { 'insul-sel': insul, btype, bh: '16', bl: '70', bw: '30' };
  ctx.__lts = lts;
}
// Michael Bescript 11/9/26 (SS-2026-64277): CCI 30x70x16, Left 14x70 open (12' low leg), Right 14x70 fully enclosed (10' low leg).
const michael: Lt[] = [{ side: 'Left Eave', w: 14, l: 70, low: 12 }, { side: 'Right Eave', w: 14, l: 70, low: 10, closed: true }];

describe('insulation row says what is insulated', () => {
  it('no lean-tos: the label exactly as before (both choices)', () => {
    set('CCI', 'roof-walls', []);
    expect(ctx.insulRowLabel()).toBe(FULL);
    set('CCI', 'roof', []);
    expect(ctx.insulRowLabel()).toBe(ROOF);
  });
  it("Michael's quote: the building + the Right lean-to's outer wall, not the lean-to roof or ends", () => {
    set('CCI', 'roof-walls', michael);
    expect(ctx.insulRowLabel()).toBe(FULL + ' (building + Right lean-to outer wall; not lean-to roof or ends)');
  });
  it('open lean-tos only (or CA, GCH, roof only): main building only, lean-tos not insulated', () => {
    set('CCI', 'roof-walls', [{ side: 'Left Eave', w: 12, l: 70, low: 12 }]);
    expect(ctx.insulRowLabel()).toBe(FULL + ' (main building only; lean-tos not insulated)');
    set('CA', 'roof-walls', michael);
    expect(ctx.insulRowLabel()).toBe(FULL + ' (main building only; lean-tos not insulated)');
    set('CCI', 'roof-walls', michael, 'gch');
    expect(ctx.insulRowLabel()).toBe(FULL + ' (main building only; lean-tos not insulated)');
    set('CCI', 'roof', michael);
    expect(ctx.insulRowLabel()).toBe(ROOF + ' (main building; lean-tos not insulated)');
  });
  it('both sides enclosed; a gable lean-to enclosed adds nothing; no insulation = no scope', () => {
    set('CCI', 'roof-walls', [{ side: 'Left Eave', w: 12, l: 70, low: 10, closed: true }, { side: 'Right Eave', w: 12, l: 70, low: 10, closed: true }]);
    expect(ctx.insulScope()).toBe('building + Left & Right lean-to outer walls; not lean-to roof or ends');
    set('CCI', 'roof-walls', [{ side: 'Front Gable', w: 12, l: 30, low: 10, closed: true }]);
    expect(ctx.insulScope()).toBe('main building only; lean-tos not insulated');
    set('CCI', 'none', michael);
    expect(ctx.insulScope()).toBe('');
  });
  it('the insulation math is unchanged by the new sides list', () => {
    set('CCI', 'roof-walls', michael);
    const sides: string[] = [];
    expect(ctx.cciInsulEncLeanAdj(16, 70, sides)).toBe(ctx.cciInsulEncLeanAdj(16, 70));
    expect(ctx.cciInsulEncLeanAdj(16, 70)).toBe(-140); // 70 x (10 + 4 - 16): the $8,340 -> $8,130 of 11/9/26
    expect(sides).toEqual(['Right Eave']);
  });
  it('wiring: quote PDF + contract rows and the text quote use it', () => {
    expect(html.split('row(insulRowLabel(),null,null,insulPr);').length - 1).toBe(2);
    expect(html).toContain("if(insText!=='None'){ var _isc=insulScope(); if(_isc) insText+=' ('+_isc+')'; }");
    expect(html).not.toContain("'Fully Insulated \u2014 Roof & Walls':'Insulation \u2014 Roof Only'),null,null,insulPr)");
  });
});
