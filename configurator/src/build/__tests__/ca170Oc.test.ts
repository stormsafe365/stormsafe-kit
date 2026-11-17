import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * 11-17a - CA certified up to 170 MPH = 4' OC, 12 gauge NOT required (owner 11/17/26, relaying CA's Christina:
 * "170 MPH Wind Rating: Is 12-gauge framing required, or is 4' on-center spacing sufficient? Does not require 12g,
 * only 4' OC"). CA 24' wide and under in a 170 MPH county (HW) or on a Commercial / Risk Cat 2 property gets CCI's
 * 4' OC lock + override. CA's 4' OC is now charged like CCI's (owner 11/17/26: "whatever CCI charges for 4' OC its
 * probably the same as CA"): 300/325/350/375/400 for 20'-40' (rounded up), per connected unit past 40'.
 * The CA Master Price Book 7/16/26 lists no 4' OC charge; CA was $0 from 8/12/26 to 11-17a.
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
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
}
// The rc() 4' OC block, run on its own: from "var ocUpgrade=0" to the end of its if-block.
function ocBlock(): string {
  const a = html.indexOf('  var ocUpgrade=0, ocLean=0;');
  const b = html.indexOf("  if(ocSpacingVal==='4oc' && w<=24 && bt3!=='widespan' && bt3!=='fslean'){", a);
  if (a < 0 || b < 0) throw new Error('no 4oc block');
  return html.slice(a, matchEnd(b) + 1) + '\n';
}

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CA', __f: {}, __lts: [] };
vm.createContext(ctx);
vm.runInContext(
  ['cciPBRule', 'cci170OcRule', 'cciUnits', 'cciUnitSum', 'cciColUp', 'cciOC4Leans', 'cciWideLean'].map(grabFn).join('') +
    'var HW=["Charlotte","Collier","Duval","Flagler","Indian River","Lake","Lee","Martin","Palm Beach","Pinellas","Sarasota","Seminole","St Lucie","St. Lucie"];\n' +
    'function G(id){ if(!(id in __f)) return null; return { id:id, value:__f[id], textContent:__f[id] }; }\n' +
    'function lt(o){ return { querySelector:function(s){ var k=s.replace(/^\\./,""); return (k in o)?{ value:o[k] }:null; } }; }\n' +
    'var document={ querySelectorAll:function(){ return __lts.map(lt); } };\n' +
    'function ocPrice(w,l,oc,bt){ var ocSpacingVal=oc, bt3=bt||"standard";\n' + ocBlock() + ' return { oc:ocUpgrade, lean:ocLean }; }\n',
  ctx,
);
const run = (js: string, f: Record<string, unknown> = {}, mfr = 'CA', lts: unknown[] = []) => {
  ctx.__lts = lts;
  return vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; ${js}`, ctx) as unknown;
};

describe('CA up to 170 MPH on 24\' and narrower = 4\' OC (CA 11/17/26), 12 gauge never forced', () => {
  const r = (f: Record<string, unknown>, w = 24, bt = 'standard') => run(`cci170OcRule(${w}, '${bt}')`, f, 'CA');
  it('hi-wind county (Palm Beach too - the CCI-only Palm Beach rule does not apply to CA) or Commercial / Risk Cat 2', () => {
    expect(r({ county: 'Palm Beach', pt: 'res' })).toBe('hw');
    expect(r({ county: 'Lee', pt: 'res' }, 12, 'carport')).toBe('hw');
    expect(r({ county: 'St. Lucie', pt: 'res' }, 20)).toBe('hw');
    expect(r({ county: 'Orange', pt: 'com' }, 22)).toBe('com');
    expect(r({ county: 'Polk', pt: 'rc2r' }, 12, 'gch')).toBe('com');
  });
  it('not: a 150 MPH county, 26\'+ wide (4\' OC is standard there), wide span, free-standing lean-to', () => {
    expect(r({ county: 'Orange', pt: 'res' })).toBe('');
    expect(r({ county: 'Palm Beach', pt: 'res' }, 26)).toBe('');
    expect(r({ county: 'Palm Beach', pt: 'res' }, 24, 'widespan')).toBe('');
    expect(r({ county: 'Palm Beach', pt: 'res' }, 12, 'fslean')).toBe('');
  });
  it('CCI keeps its own rules (Palm Beach = its 10/9 rule, not this one); another manufacturer is never locked', () => {
    expect(run("cci170OcRule(24,'standard')", { county: 'Palm Beach', pt: 'res' }, 'CCI')).toBe('');
    expect(run("cci170OcRule(24,'standard')", { county: 'Lee', pt: 'res' }, 'CCI')).toBe('hw');
    expect(run("cci170OcRule(24,'standard')", { county: 'Lee', pt: 'com' }, 'OTHER')).toBe('');
  });
  it('the 12 GA locks stay CCI-only (CA: "Does not require 12g")', () => {
    expect(html).toContain("var _req12Hw=(ACTIVE_MFR==='CCI' && w>24 && typeof HW!=='undefined' && HW.indexOf(G('county').textContent)>=0);");
    expect(html).toContain("function cciPBRule(){ return ACTIVE_MFR==='CCI' && ((G('county')||{}).textContent||'')==='Palm Beach'; }");
    expect(run('cciPBRule()', { county: 'Palm Beach' }, 'CA')).toBe(false);
  });
});

describe("CA 4' OC priced like CCI's (owner 11/17/26)", () => {
  const p = (w: number, l: number, oc = '4oc', mfr = 'CA', bt = 'standard', lts: unknown[] = []) =>
    run(`JSON.stringify(ocPrice(${w},${l},'${oc}','${bt}'))`, {}, mfr, lts);
  it('300 / 325 / 350 / 375 / 400 at 20\'-40\', a length between two columns rounds UP', () => {
    expect(p(24, 20)).toBe('{"oc":300,"lean":0}');
    expect(p(24, 21)).toBe('{"oc":325,"lean":0}');
    expect(p(20, 25)).toBe('{"oc":325,"lean":0}');
    expect(p(12, 30)).toBe('{"oc":350,"lean":0}');
    expect(p(24, 35)).toBe('{"oc":375,"lean":0}');
    expect(p(24, 40)).toBe('{"oc":400,"lean":0}');
  });
  it('past 40\': per connected unit, the same as CCI', () => {
    for (const l of [45, 50, 60, 80, 100]) expect(p(24, l)).toBe(p(24, l, '4oc', 'CCI'));
  });
  it('the same number as CCI at every length 20\'-100\'', () => {
    for (let l = 20; l <= 100; l++) expect(p(24, l)).toBe(p(24, l, '4oc', 'CCI'));
  });
  it('an attached lean-to adds its own 4\' OC column, as CCI (free-standing lean-tos do not)', () => {
    const lts = [{ 'lt-type': 'attached', ltl2: '30', ltw: '10' }, { 'lt-type': 'freestanding', ltl2: '30', ltw: '10' }];
    expect(p(24, 30, '4oc', 'CA', 'standard', lts)).toBe('{"oc":700,"lean":350}');
  });
  it('$0 at 5\' OC, on 26\'+ wide, on a wide span', () => {
    expect(p(24, 30, '5oc')).toBe('{"oc":0,"lean":0}');
    expect(p(26, 30)).toBe('{"oc":0,"lean":0}');
    expect(p(24, 30, '4oc', 'CA', 'widespan')).toBe('{"oc":0,"lean":0}');
  });
});

describe('reopened quotes keep their price and build (price lock)', () => {
  it('a CA save from before 11-17a at 5\' OC is GRANDFATHERED (its own marker ca170Rule), CCI keeps oc170Rule', () => {
    expect(html).toContain("if(opts.lock && !ov.fu14 && c.oc170 && (f['oc-spacing']||'5oc')!=='4oc' && !(c.cci?ov.oc170Rule:ov.ca170Rule)){ root._fu14Ovr=true; gf.fu14=true; }");
    expect(html).toContain('oc170Rule:1, ca170Rule:1, com12Rule:1,');
    expect(html).toContain("var oc170=!!((cci || root.ACTIVE_MFR==='CA') && typeof root.cci170OcRule==='function'");
    expect(html).toContain("      req4oc: (cci && w>0 && w<=24 && ((($('btype')||{}).value)||'')!=='widespan' && co==='Palm Beach') || oc170,");
  });
  it("a CA save from before 11-17a with 4' OC holds its $0 4' OC line (old engines: step 'ca-4oc')", () => {
    expect(html).toContain("var T_CA_OC        = tms('2026-11-17T18:30:00-05:00');");
    expect(html).toContain("[T_COMBO,'combo-12x4'],[T_CA_OC,'ca-4oc']];");
    expect(html).toContain("    if(c.mfr==='CA' && T>=T_CA_OC && c.oc==='4oc' && c.w>0 && c.w<=24 && c.bt!=='widespan' && c.bt!=='fslean'){");
    expect(html).toContain("'ca-4oc':      { commit:'11-17a'");
    expect(html).toContain("'ca-170-4oc':  { commit:'11-17a'");
    expect(html).toContain("((k==='fu14' && _rc.oc170)?(_rc.cci?'cci-170-4oc':'ca-170-4oc'):");
  });
});
