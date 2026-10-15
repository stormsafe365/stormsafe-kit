import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * 10-9b, the Sensei check of 10/12/26 (30 configs): the four pricing gaps where Sensei = the CCI book, fixed per the
 * book (owner decision 10/12/26). Runs the program's own functions in a vm.
 *  - frame-outs: Price Book 2 p2 "Side Openings - Without Garage Door" by width for a blank custom garage-door
 *    frame-out on a CCI 12'-30' eave (Dealer Handbook p17), no separate side frame;
 *  - gable-only ends 12'-24' $225 / 26'-30' $300 + vertical gable add $50 / $85 (PB p2 / p4; HB p14);
 *  - sides closed 12'-30' at 17'+ past 52': the 12W-30W combination on PB p6 (30x85x18 = $11,370), the pair from the chart.
 * (J-trim: carportClosedSides.test.ts.)
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
function grabVar(name: string): string {
  const m = new RegExp('\\nvar ' + name + '\\s*=\\s*\\{').exec(html);
  if (!m) throw new Error('no var ' + name);
  const i = html.indexOf('{', m.index);
  return 'var ' + name + '=' + html.slice(i, matchEnd(i) + 1) + ';\n';
}
// MANUFACTURERS.CCI.acPrices (the catalog the program sells from)
const cciAt = html.indexOf('\n  CCI: {');
const acAt = html.indexOf('acPrices: {', cciAt);
const ccIAc = html.slice(html.indexOf('{', acAt), matchEnd(acAt) + 1);

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: {} };
vm.createContext(ctx);
vm.runInContext(
  ['ltFrameoutPrice', 'cciSideOpenNoDoor', 'acCustomBook', 'acCompUnit', 'acUnitPrice', 'cciWideOn', 'isEaveSide', 'foCustomFeet',
    'gableOnlyCost', 'scLookup', 'scPairLookup', 'cciUnits'].map(grabFn).join('') +
    grabVar('SC') +
    'var EXT_L=[45,50,55,60,65,70,75,80,85,90,95,100]; var EXT_BSC={}; var EXT_BSC_30={};\n' +
    'var AC_PRICES=' + ccIAc + ';\n' +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    'function MFR(){ return { shExtThresh: 52, shIndexByLength: true, gableOnlyPrice: 300 }; }\n' +
    'function cciWideUnitSum(){ throw new Error("32-60 path"); } function cciWideSCBothSides(){ throw new Error("62-100 path"); }\n' +
    // a framed-opening entry: wall, custom width / height, typed price
    'function FO(loc, cw, acp){ var v={ ".fo-loc":loc, ".fo-cw":cw, ".fo-ch":"14", ".fo-unit":"ft", ".acp":acp||"" };' +
    ' return { querySelector: function(s){ return (s in v) ? { value: v[s] } : null; } }; }\n',
  ctx,
);
const run = (js: string, f: Record<string, string>, mfr = 'CCI') => vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; ${js}`, ctx) as number;
const CUSTOM_GD = 'Framed Opening — Custom Garage Door (Custom Size)';
const carport16 = { btype: 'carport', bw: '16', bl: '40', bh: '16', ws: 'Horizontal' };

describe('frame-outs on a CCI 12-30 eave: Price Book 2 p2 "Side Openings - Without Garage Door" (handbook p17)', () => {
  it('the book rows by width, rounding UP; over 20 no CCI price', () => {
    const p = (w: number) => run(`cciSideOpenNoDoor(${w})`, carport16);
    expect([6, 10, 11, 12, 14, 16, 17, 18, 20, 21].map(p)).toEqual([250, 250, 300, 300, 350, 400, 450, 450, 500, 0]);
  });
  it('Robert Frick: a blank custom 17x14 garage-door frame-out on the eave = $450 (was $0); a typed price wins', () => {
    expect(run(`acCompUnit(${JSON.stringify(CUSTOM_GD)}, FO('Left Eave Side','17'))`, carport16)).toBe(450);
    expect(run(`acCompUnit(${JSON.stringify(CUSTOM_GD)}, FO('Right Eave Side','17','600'))`, carport16)).toBe(600);
  });
  it('not on a gable end, not on 32-60 wide, not CA (no book row there: the typed price)', () => {
    expect(run(`acCompUnit(${JSON.stringify(CUSTOM_GD)}, FO('Front Gable End','17'))`, carport16)).toBe(0);
    expect(run(`acCompUnit(${JSON.stringify(CUSTOM_GD)}, FO('Left Eave Side','17'))`, { ...carport16, btype: 'widespan', bw: '40' })).toBe(0);
    expect(run(`acCustomBook(${JSON.stringify(CUSTOM_GD)}, FO('Left Eave Side','17'))`, carport16, 'CA')).toBe(0);
  });
  it('the catalog side opening stays the book price (18 wide $450)', () => {
    expect(run(`acCompUnit("Framed Opening — Side Opening, No Door (18' Wide)", FO('Left Eave Side',''))`, carport16)).toBe(450);
  });
  it('no separate side frame on any CCI eave frame-out (gAC / both documents / the truss check)', () => {
    expect(html).toContain("if(comp.indexOf('Framed Opening')===0 && ACTIVE_MFR!=='CCI'){");
    expect(html).toContain("var _foWideCCI=(typeof ACTIVE_MFR!=='undefined'&&ACTIVE_MFR==='CCI');");
  });
});

describe('gable-only ends: $225 (12-24) / $300 (26-30) + vertical gable add $50 / $85 (Price Book 2 p2 / p4)', () => {
  const b = (bw: string, ws: string, bh = '12') => ({ btype: 'standard', bw, bl: '40', bh, ws });
  it('CCI', () => {
    expect(run('gableOnlyCost()', b('24', 'Horizontal'))).toBe(225); // Sensei config 26: 2 x $225
    expect(run('gableOnlyCost()', b('24', 'Vertical'))).toBe(275);
    expect(run('gableOnlyCost()', b('12', 'Horizontal'))).toBe(225);
    expect(run('gableOnlyCost()', b('26', 'Horizontal'))).toBe(300);
    expect(run('gableOnlyCost()', b('30', 'Vertical'))).toBe(385);
    expect(run('gableOnlyCost()', b('24', 'Vertical', '18'))).toBe(225); // 17'+ priced orientation-blind
  });
  it('CA unchanged; CCI 32-60 = Price Book 2 p6 "Gable End" $600 / $750 / $900 per end (10-14d, audit F16; was $300)', () => {
    expect(run('gableOnlyCost()', b('24', 'Vertical'), 'CA')).toBe(225);
    expect(run('gableOnlyCost()', b('26', 'Horizontal'), 'CA')).toBe(300);
    expect(run('gableOnlyCost()', { ...b('40', 'Vertical'), btype: 'widespan' })).toBe(600);
    expect(run('gableOnlyCost()', { ...b('32', 'Vertical'), btype: 'widespan' })).toBe(600);
    expect(run('gableOnlyCost()', { ...b('42', 'Vertical'), btype: 'widespan' })).toBe(750);
    expect(run('gableOnlyCost()', { ...b('49', 'Vertical'), btype: 'widespan' })).toBe(750); // 49 builds as 50
    expect(run('gableOnlyCost()', { ...b('51', 'Vertical'), btype: 'widespan' })).toBe(900); // 51 builds as 52
    expect(run('gableOnlyCost()', { ...b('60', 'Vertical'), btype: 'widespan' })).toBe(900);
  });
  it('a CCI gable-only end no longer takes the whole vertical END upcharge', () => {
    expect(html).toContain("if(fgv==='Closed'||(fgv==='Gable Only'&&_gvC)) t+=vertEndUpcharge(w);");
  });
});

describe("sides closed, CCI 12'-30' at 17'+: Price Book 2 p6 BOTH SIDES CLOSED, the 12W-30W combination past 52'", () => {
  it('Sensei config 16: 30x85x18 = 31+31+26 roof -> 3,955 + 3,955 + 3,460 = $11,370 (was $10,468)', () => {
    expect(run('scPairLookup(18, 85, 30)', { bw: '30' })).toBe(11370);
    expect(run('scLookup(18, 85, 30)', { bw: '30' })).toBe(5685);
  });
  it('100 long = 35+35+30: the 36/36/32 columns; 120 = 40+40+40', () => {
    expect(run('scPairLookup(20, 100, 30)', { bw: '30' })).toBe(5225 + 5225 + 4645);
    expect(run('scPairLookup(18, 120, 24)', { bw: '24' })).toBe(3 * 4945);
  });
  it("up to 52' the brochure column, the pair straight from the chart (no $1 drift)", () => {
    expect(run('scPairLookup(20, 40, 30)', { bw: '30' })).toBe(5810); // CCI Tejada 30x40x20
    expect(run('scPairLookup(18, 30, 24)', { bw: '24' })).toBe(3955); // was 2 x 1,978
    expect(run('scPairLookup(18, 45, 30)', { bw: '30' })).toBe(5935);
  });
});
