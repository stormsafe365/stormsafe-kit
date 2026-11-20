import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, endBandFor } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, WallOverrides } from '@/types/building';

/**
 * 11-20a - "1/4 Closed" / "3/4 Closed" main-building ends (owner 11/20/26: "our program wont let us do gable end sheeted
 * 1/4 closed"). Priced as that fraction of the CLOSED end, cents kept: CCI's Sensei (owner's screenshot 11/20/26), 30' wide
 * x 12' tall: Back Closed $2,315, Front 1/4 Closed $578.75 (25%), Left 1 Panel (3') $220. CA's 1/4 / 3/4 use the same rule
 * (not confirmed). CCI vertical = $0 on a partial end (Sensei); CA vertical = the same fraction (not confirmed). Drawn as the
 * half-closed band at 1/4 or 3/4 of the wall height (the classic Half Closed keeps its 6' panel).
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
const ctx: Record<string, unknown> = { __f: {}, __ec: 0, __ecArgs: [] };
vm.createContext(ctx);
vm.runInContext(
  ['endFrac', 'partialEndCost'].map(grabFn).join('') +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    'function ecLookup(w,h){ __ecArgs.push([w,h]); return __ec; }\n',
  ctx,
);
const run = (js: string, f: Record<string, string> = {}, ec = 0) => {
  ctx.__ec = ec; ctx.__ecArgs = [];
  return vm.runInContext(`__f=${JSON.stringify(f)}; ${js}`, ctx) as unknown;
};

describe('1/4 and 3/4 Closed ends: the fraction of the closed end', () => {
  it("CCI's Sensei: 30' x 12' end closed $2,315 -> 1/4 Closed $578.75", () => {
    expect(run("partialEndCost('1/4 Closed')", { bw: '30', bh: '12' }, 2315)).toBe(578.75);
    expect(run("partialEndCost('3/4 Closed')", { bw: '30', bh: '12' }, 2315)).toBe(1736.25);
  });
  it('the closed end is read at the building width (odd widths round UP) and leg height', () => {
    run("partialEndCost('1/4 Closed')", { bw: '23', bh: '9' }, 1000);
    expect(ctx.__ecArgs).toEqual([[24, 9]]);
  });
  it('every other end choice is not a fraction ($0 here; Closed / Gable Only / Half Closed keep their own prices)', () => {
    for (const v of ['Closed', 'Open', 'Gable Only', 'Half Closed', '']) {
      expect(run(`endFrac(${JSON.stringify(v)})`)).toBe(0);
      expect(run(`partialEndCost(${JSON.stringify(v)})`, { bw: '30', bh: '12' }, 2315)).toBe(0);
    }
    expect(run("partialEndCost('1/4 Closed')", { bw: '', bh: '12' }, 2315)).toBe(0); // no width yet
  });
});

describe('wired into the program', () => {
  it('both end selects offer 1/4 and 3/4 Closed', () => {
    expect(html.split('<option value="1/4 Closed">1/4 Closed (top &frac14; + gable)</option>').length - 1).toBe(2);
    expect(html.split('<option value="3/4 Closed">3/4 Closed (top &frac34; + gable)</option>').length - 1).toBe(2);
  });
  it('priced in gWalls; CA vertical = the same fraction of its vertical end add, CCI $0', () => {
    expect(html).toContain("  else if(endFrac(fgv)) t += partialEndCost(fgv); // 1/4 / 3/4 Closed (11-20a)");
    expect(html).toContain("  else if(endFrac(bgv)) t += partialEndCost(bgv); // 1/4 / 3/4 Closed (11-20a)");
    expect(html).toContain("  if(_gvC){ if(endFrac(fgv)) t+=Math.round(vertEndUpcharge(w)*endFrac(fgv)*100)/100;");
  });
  it('named on the quote PDF and the contract ("Front End 1/4 Closed", "Each End 3/4 Closed")', () => {
    expect(html).toContain("    if(fq && bq) rows+=row('Each End '+pq[1]+' Closed ('+wallStyle+')', 2, pp, Math.round(pp*200)/100);");
    expect(html).toContain("    else if(fq) row('Front End '+pq[1]+' Closed ('+wallStyle+')', 1, pp, pp);");
  });
  it('the elevation drawings hang the band at 1/4 / 3/4 of the wall (Half Closed keeps 6\')', () => {
    expect(html).toContain("var _hcBandFt=(wallOpen==='1/4 Closed')?wallH_ft*0.25:((wallOpen==='3/4 Closed')?wallH_ft*0.75:6);");
    expect(html).toContain('var panelDropPx=Math.min(_hcBandFt*sc, wallH*0.9);');
  });
});

describe('3D: the band of a partially closed end', () => {
  const cfg = (wallOverrides?: WallOverrides): BuildingConfig => ({
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 30,
    length: 40,
    legHeight: 12,
    manufacturer: 'CA',
    ...(wallOverrides ? { wallOverrides } : {}),
  });
  const enc = (ov?: WallOverrides) => deriveStructure(resolveBuilding(cfg(ov))).enclosure;
  it('1/4 Closed front = a 3\' band on a 12\' wall, 3/4 Closed back = 9\'', () => {
    const e = enc({ front: 'halfClosed', back: 'halfClosed', leftOpen: false, rightOpen: false, frontBandFt: 3, backBandFt: 9 });
    expect(e.front).toBe('halfClosed');
    expect(endBandFor(e, 'front', 12)).toBe(3);
    expect(endBandFor(e, 'back', 12)).toBe(9);
  });
  it("Half Closed (no band sent) keeps the classic 6' panel; other enclosures carry no band at all", () => {
    const e = enc({ front: 'halfClosed', back: 'closed', leftOpen: false, rightOpen: false });
    expect(e.endBandFt).toBeUndefined();
    expect(endBandFor(e, 'front', 12)).toBe(6);
    expect(endBandFor(e, 'front', 5)).toBe(5); // never taller than the wall
    expect(enc().endBandFt).toBeUndefined();
  });
});
