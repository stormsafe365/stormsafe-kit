import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner case 10/12/26 (Robert Frick, CCI carport 16x40x16, both sides closed): since 845415c (8/26/26) rc() mirrors a
 * carport's sp-left / sp-right into the wall rows wle / wre, so gWalls prices a closed side ("Each Side Closed") — and
 * gSidePanels priced the same closed side a second time ("Side Panels - Left: Closed, Right: Closed"). A closed carport
 * side is now priced once (gWalls); gSidePanels keeps the partial panels. Runs the program's own functions in a vm.
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
const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: {} };
vm.createContext(ctx);
vm.runInContext(
  ['gSidePanels', 'sidePanelLength', 'sideClosurePrice', 'cciUnits', 'cciPanelTiers'].map(grabFn).join('') +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    // a closed side = the both-sides chart halved (16 tall, 40 long: 2,365 / 2); the panel prices are Price Book 2 p2 "Panels 3'"
    'function scLookup(h, l, w){ return 1183; }\n' +
    'var SP = { full: {21:110, 26:130, 31:155, 36:175}, halfTrim: {21:220, 26:260, 31:310, 36:350}, tiers: [21,26,31,36] };\n' +
    'function MFR(){ return { sidePanels: SP, panelTier: function(l){ for (var i=0;i<SP.tiers.length;i++){ if (SP.tiers[i]>=l) return SP.tiers[i]; } return 36; } }; }\n',
  ctx,
);
const sp = (mfr: string, f: Record<string, string>) => vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; gSidePanels()`, ctx) as number;
const carport = (l: string, r: string) => ({ btype: 'carport', bw: '16', bl: '40', bh: '16', 'sp-left': l, 'sp-right': r });

describe('a closed carport side is charged once (gWalls "Each Side Closed"), not again as a side panel', () => {
  it('Robert Frick: CCI carport 16x40x16, both sides closed -> no side-panel charge', () => {
    expect(sp('CCI', carport('closed', 'closed'))).toBe(0);
  });
  it('CA carport, both sides closed -> no side-panel charge either (same code path)', () => {
    expect(sp('CA', carport('closed', 'closed'))).toBe(0);
  });
  it('partial panels still price: one side closed, the other 2 panels (40 long = one 36 panel row x 2)', () => {
    expect(sp('CCI', carport('closed', '2panel'))).toBe(2 * 175);
    expect(sp('CCI', carport('1panel', 'open'))).toBe(175);
  });
  it('the wall rows mirror the carport sides (the gWalls side of the fix): rc() still maps closed -> Closed', () => {
    expect(html).toContain("var mv=(sv==='closed')?'Closed':(sv==='open')?'Open':sv;");
  });
});
