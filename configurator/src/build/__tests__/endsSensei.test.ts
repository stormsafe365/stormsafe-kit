import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, halfEndOpening, HALF_END } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, WallOverrides } from '@/types/building';

/**
 * 11-20b - Sensei's end options (owner 11/20/26: "there's a few options were missing from the gable end after looking at
 * Sensei ... we're missing 'half end' too which gives it a nice finished look"). Sensei (CCI), read 11/20/26:
 *   30x40x14 H: Closed 2,800 | 3/4 2,100 | 1/2 1,400 | 1/4 700 | Half End 1,400 | Extended Gable 600 | Gable 300
 *   24x40x10 H: Closed 1,435 | Half End 717.50 | Gable 225 | Extended Gable 450
 *   24x40x10 V: Closed 1,795 | Half End 897.50 | 1/2 897.50 | 1/4 448.75 | 3/4 1,346.25 | Gable 275 | Extended Gable 550
 * The real program reproduces these in the headless checks (scratchpad ends1120b); here: the rules, the wiring, the 3D frame.
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
const ctx: Record<string, unknown> = { __f: {}, __gable: 0, ACTIVE_MFR: 'CCI' };
vm.createContext(ctx);
vm.runInContext(
  ['endFrac', 'extGableCost'].map(grabFn).join('') +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    'function gableOnlyCost(){ return __gable; }\n' +
    'var SP={ CCI:{ tiers:[21,26,31,36], full:{21:110,26:130,31:155,36:175} }, CA:{ tiers:[21,26,31,36,41], full:{21:110,26:130,31:155,36:175,41:220} } };\n' +
    'function MFR(){ var sp=SP[ACTIVE_MFR]; return { sidePanels:sp, panelTier:function(l){ for(var i=0;i<sp.tiers.length;i++){ if(sp.tiers[i]>=l) return sp.tiers[i]; } return sp.tiers[sp.tiers.length-1]; } }; }\n',
  ctx,
);
const run = (js: string, f: Record<string, string> = {}, gable = 0, mfr = 'CCI') => {
  ctx.__gable = gable;
  return vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; ${js}`, ctx) as unknown;
};

describe('fractions: 1/4, 1/2, 3/4 and Half End', () => {
  it('Half End and 1/2 Closed are half the closed end (Sensei 30x14: both $1,400 of $2,800)', () => {
    expect(run("endFrac('Half End')")).toBe(0.5);
    expect(run("endFrac('1/2 Closed')")).toBe(0.5);
    expect(run("endFrac('1/4 Closed')")).toBe(0.25);
    expect(run("endFrac('3/4 Closed')")).toBe(0.75);
    for (const v of ['Closed', 'Open', 'Gable Only', 'Extended Gable', 'Half Closed']) expect(run(`endFrac(${JSON.stringify(v)})`)).toBe(0);
  });
});

describe('Extended Gable', () => {
  it('CCI 12\'-30\' = twice the gable, its vertical gable add included (Sensei: 24 H $450, 24 V $550, 26-30 H $600)', () => {
    expect(run('extGableCost()', { bw: '24' }, 225)).toBe(450);
    expect(run('extGableCost()', { bw: '24' }, 275)).toBe(550);
    expect(run('extGableCost()', { bw: '26' }, 300)).toBe(600);
    expect(run('extGableCost()', { bw: '30' }, 300)).toBe(600);
    expect(run('extGableCost()', { bw: '13' }, 225)).toBe(450); // odd widths round up like every end
  });
  it("CCI 32'+ = 2 x the gable too (Sensei 11/20/26 36x56x14 commercial $1,200; 11-20c - the handbook's 3 x gable + panel read $1,975)", () => {
    expect(run('extGableCost()', { bw: '36' }, 600)).toBe(1200);
    expect(run('extGableCost()', { bw: '40' }, 600)).toBe(1200);
    expect(run('extGableCost()', { bw: '60' }, 900)).toBe(1800);
    expect(run('extGableCost()', { bw: '70' }, 1050)).toBe(2100); // 62'-100' gable $1,050-$1,500 - not sampled
  });
  it('CA (book 4H): gable + the panel that covers the end + frame 75 / 100 / 200 / 400 - not confirmed', () => {
    expect(run('extGableCost()', { bw: '24' }, 225, 'CA')).toBe(225 + 130 + 75);
    expect(run('extGableCost()', { bw: '30' }, 300, 'CA')).toBe(300 + 155 + 100);
    expect(run('extGableCost()', { bw: '' }, 300, 'CA')).toBe(0);
  });
});

describe('wired into the program', () => {
  it("both end selects: Sensei's order, Half Closed (6' Panel) kept last for saved quotes", () => {
    const sel = (id: string) => {
      const a = html.indexOf(`<select id="${id}"`);
      return html.slice(a, html.indexOf('</select>', a)).match(/value="([^"]+)"/g)!.map((v) => v.slice(7, -1));
    };
    const want = ['Closed', 'Open', 'Half End', 'Gable Only', 'Extended Gable', '1/4 Closed', '1/2 Closed', '3/4 Closed', 'Half Closed'];
    expect(sel('wfg')).toEqual(want);
    expect(sel('wbg')).toEqual(want);
  });
  it('priced in gWalls; vertical: the fraction for partial ends (CCI too - 11-20a charged $0), CCI Half Closed 50%, cents kept', () => {
    expect(html).toContain("  else if(fgv==='Extended Gable') t += extGableCost(); // 11-20b");
    expect(html).toContain("  [fgv,bgv].forEach(function(v){ var f=endFrac(v)||((v==='Half Closed'&&!_gvC)?0.5:0); if(f) t+=Math.round(vertEndUpcharge(w)*f*100)/100; });");
    expect(html).toContain('  return Math.round(t*100)/100; // cents kept: partial ends (11-20b)');
    expect(html).toContain("  if(fgv==='Closed'||((fgv==='Gable Only'||fgv==='Extended Gable')&&_gvC)) t+=vertEndUpcharge(w);");
  });
  it('drawn: 1/2 = half the wall, Extended Gable = one 3\' panel, Half End = the 1\' frame', () => {
    expect(html).toContain("var origIsHalfEnd=(wallOpen==='Half End');");
    expect(html).toContain('function _drawHalfEnd(x, w_px){');
    expect(html).toContain("((wallOpen==='Extended Gable')?Math.min(3,wallH_ft):6)");
  });
});

describe('3D: Half End = the closed end with its middle open (a 1\' frame)', () => {
  const cfg = (wallOverrides?: WallOverrides): BuildingConfig => ({
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 24,
    length: 40,
    legHeight: 10,
    manufacturer: 'CCI',
    ...(wallOverrides ? { wallOverrides } : {}),
  });
  const model = (ov?: WallOverrides) => deriveStructure(resolveBuilding(cfg(ov)));
  it('the opening is the width less a 1\' strip each side, the height less a 1\' header', () => {
    expect(HALF_END).toEqual({ stripFt: 1, headerFt: 1 });
    expect(halfEndOpening(24, 10)).toEqual({ w: 22, h: 9 });
    expect(halfEndOpening(1.5, 0.5)).toEqual({ w: 0, h: 0 });
  });
  it('a Half End front carries that mode; its sheeted area is the frame (closed end minus the opening)', () => {
    const closed = model({ front: 'closed', back: 'closed', leftOpen: false, rightOpen: false });
    const half = model({ front: 'halfEnd', back: 'closed', leftOpen: false, rightOpen: false });
    expect(half.enclosure.front).toBe('halfEnd');
    expect(Math.round((closed.areas.walls - half.areas.walls) * 100) / 100).toBe(22 * 9);
  });
});
