import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * 10-14b, CCI 10/14/26 (order SS-2026-93350, Jose Tejada, CCI 30x40x20, Palm Beach, 12 gauge, 4' OC — CCI marked
 * "12-Gauge Framing Upgrade" $840 -> $1,440): "When pricing ladder legs on a triple wide, you must use the 12 gauge
 * price from the commercial brochure, as we will be using commercial legs."
 *  - ladder legs on a triple wide = CCI 25'-30' wide at 17'+, where gLeg prices the legs from the commercial SIDE
 *    HEIGHT chart (CCI 8/14/26: ">16 ft legs price ladder legs from the commercial brochure");
 *  - the 12-gauge line there = Price Book 2 p6 OPTIONS "12 Gauge" (20' $840 · 24' $960 · 28' $1,080 · 32' $1,200 ·
 *    36' $1,320 · 40' $1,440 · 44' $1,560 · 48' $1,680 · 52' $1,800), length rounded UP to the 4' column, per
 *    connected unit past 52' (cciCom12GA). Everything else keeps cci12GA (the triple-wide series) unchanged.
 * Runs the program's own functions (public/quote-builder.html) in a node vm. (The TS port / PriceCheck caps 12'-30' wide
 * at 16' tall - rules.ts applyBuildingRules - so it has no ladder-leg triple wide to price.)
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
function grabArr(name: string): string {
  const m = new RegExp('\\nvar ' + name + '\\s*=\\s*(\\[[^\\]]*\\])').exec(html);
  if (!m) throw new Error('no array ' + name);
  return 'var ' + name + '=' + m[1] + ';\n';
}

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: {} };
vm.createContext(ctx);
vm.runInContext(
  ['cciLadder12', 'cciTripleWide12GA', 'cciCom12GA', 'cci12GA', 'cciWideOn', 'cciWideUnits', 'cciWideUnitSum', 'cciUnits', 'gLeg']
    .map(grabFn)
    .join('') +
    grabArr('CCI_COM_12GA') + grabArr('CCI_GA12_L') + grabArr('CCI_GA12_V') + grabArr('EXT_L') + grabArr('LENGTHS') +
    grabVar('EXT_SH') +
    // HU grids = a marker (-1 per unit): a negative leg price = the 12'-30' standard (non-commercial) legs path
    'var HU_N=new Proxy({},{get:function(){ return [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]; }}); var HU_M=HU_N; var HU=HU_N;\n' +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    'function MFR(){ return { shExtThresh: 52, shIndexByLength: true }; }\n',
  ctx,
);
const run = (js: string) => vm.runInContext(js, ctx);
const BOOK_COLS = [20, 24, 28, 32, 36, 40, 44, 48, 52];
const BOOK_12GA = [840, 960, 1080, 1200, 1320, 1440, 1560, 1680, 1800]; // Price Book 2 p6 OPTIONS "12 Gauge"
const bookAt = (l: number) => BOOK_12GA[BOOK_COLS.findIndex((c) => c >= l)];

describe('CCI triple wide on ladder legs: 12 gauge = the commercial brochure row (CCI 10/14/26)', () => {
  it('the Tejada order: CCI 30x40x20 12 gauge = $1,440 (was $890 on the triple-wide series)', () => {
    expect(run(`cciTripleWide12GA(30,20,40,'standard')`)).toBe(1440);
    expect(run(`cci12GA(40)`)).toBe(890);
  });
  it('20\'-52\': the book row, length rounded UP to its 4\' column, every 25\'-30\' width and every ladder height', () => {
    for (const w of [25, 26, 27, 28, 29, 30]) for (const h of [17, 18, 20, 22, 24]) for (let l = 20; l <= 52; l++)
      for (const bt of ['standard', 'carport', 'gch'])
        expect(run(`cciTripleWide12GA(${w},${h},${l},'${bt}')`), `${w}x${l}x${h} ${bt}`).toBe(bookAt(l));
  });
  it('past 52\': per connected unit (cciCom12GA, handbook p6 combinations)', () => {
    for (let l = 53; l <= 160; l++) expect(run(`cciTripleWide12GA(30,18,${l},'standard')`), `${l}`).toBe(run(`cciCom12GA(${l})`));
    expect(run(`cciTripleWide12GA(30,20,60,'standard')`)).toBe(1080 + 1200); // 60 = 28 + 32
  });
  it('not ladder legs -> the triple-wide series exactly as before (16\' and under, 24\' and narrower, wide span, free-standing, CA)', () => {
    for (const w of [25, 26, 28, 30]) for (const h of [6, 7, 8, 10, 12, 14, 15, 16]) for (let l = 20; l <= 120; l += 1)
      expect(run(`cciTripleWide12GA(${w},${h},${l},'standard')`), `${w}x${l}x${h}`).toBe(run(`cci12GA(${l})`));
    expect(run(`cciLadder12(24,20,'standard')`)).toBe(false);
    expect(run(`cciLadder12(31,20,'standard')`)).toBe(false);
    expect(run(`cciLadder12(30,20,'widespan')`)).toBe(false);
    expect(run(`cciLadder12(30,20,'fslean')`)).toBe(false);
    expect(run(`ACTIVE_MFR='CA'; var r=cciLadder12(30,20,'standard'); ACTIVE_MFR='CCI'; r`)).toBe(false);
  });
  it('the gate IS gLeg\'s commercial (ladder) legs: 25\'-30\' x 6\'-24\' x 20\'-100\'', () => {
    for (const w of [25, 26, 27, 28, 29, 30]) for (const h of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24])
      for (const l of [20, 21, 30, 40, 41, 50, 52, 60, 85, 100]) {
        const legs = run(`__f={btype:'standard',bw:'${w}',bh:'${h}',bl:'${l}'}; gLeg()`) as number;
        const commercial = legs > 0; // the standard path reads the -1 marker grid (negative); 6' = no leg charge (0)
        expect(run(`cciLadder12(${w},${h},'standard')`), `${w}x${l}x${h} legs ${legs}`).toBe(commercial);
      }
  });
});

describe('program wiring', () => {
  it('rc() prices the CCI 25\'-30\' 12-gauge line through cciTripleWide12GA', () => {
    expect(html.includes('framingUpgrade=cciTripleWide12GA(w,h,l,bt3);')).toBe(true);
    expect(html.includes('framingUpgrade=cci12GA(l);')).toBe(false);
    expect(html.includes("if(w>=32 || (ACTIVE_MFR==='CCI' && h>=17)){")).toBe(true); // gLeg's commercial legs gate
  });
  it('documents name the line "12-Gauge Framing (commercial ladder legs)" only when the commercial row priced it', () => {
    expect(html.includes("if(framingUpgrade>0 && fuVal==='12' && _cbR==null && cciLadder12(w,h,bt3)) window._qTotals.ladder12=true;")).toBe(true);
    const lbl = "(window._cb12x4?\"12-Gauge Framing w/ 4' Centers (up to 170 MPH)\":(T.ladder12?'12-Gauge Framing (commercial ladder legs)':'12-Gauge Framing Upgrade'))";
    expect(html.split(lbl).length - 1).toBe(2); // the quote PDF and the contract
  });
  it('the on-screen breakdown row (read by NEWTOOL\'s Sales Quote) follows: engine pass by the flag, Input mode keeps the old name', () => {
    expect(html.includes("  _pfrLabel(!!(window._qTotals||{}).ladder12);")).toBe(true);
    expect(html.includes("setT('pfr',framing); setT('ppch',pitch); _pfrLabel(false);")).toBe(true);
    const k = { textContent: '12GA Framing Upgrade' };
    const c: Record<string, unknown> = { G: () => ({ parentNode: { querySelector: () => k } }) };
    vm.createContext(c);
    vm.runInContext(grabFn('_pfrLabel'), c);
    vm.runInContext('_pfrLabel(true)', c);
    expect(k.textContent).toBe('12-Gauge Framing (commercial ladder legs)');
    vm.runInContext('_pfrLabel(false)', c);
    expect(k.textContent).toBe('12GA Framing Upgrade');
    expect(html.includes('<td class="pk">12GA Framing Upgrade</td><td class="pv" id="pfr">')).toBe(true); // the page's own name
  });
});

