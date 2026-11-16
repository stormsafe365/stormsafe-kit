import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/16/26: "CA pricing is NOT up to date on the StormSafe quoting tool.. engineered plans are under priced, and i dont
 * know that anything else is correct". CA (Carports Anywhere) is priced from the Master Price Book Dealer Edition, Revised
 * 7/16/26 - the book's building rows are ROOF lengths (frame + 1'), its option columns are frame lengths rounded UP, its
 * 32'-60' side height / sides charts are by LENGTH, its 4E vertical siding price is BOTH sides, and its 5A / 5B fees are
 * $350 / $450 liaison and $500 / $600 / $900 plans. (The full 3,220-size sweep against the book ran in the release gate.)
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function grabFn(name: string): string {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  let d = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(i, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const make = (src: string, ret: string, env: Record<string, unknown> = {}) => new Function(...Object.keys(env), src + '\nreturn ' + ret + ';')(...Object.values(env));

describe('CA price book 7/16/26: rows and columns', () => {
  const caRoofTier = make(grabFn('caRoofTier'), 'caRoofTier') as (t: number[], l: number) => number;
  const caColUp = make(grabFn('caColUp'), 'caColUp') as (c: number[], l: number) => number;
  const STD = [21, 26, 31, 36, 41, 46, 51], WS = [21, 25, 29, 33, 37, 41, 45, 49, 53];
  it('a frame takes the first ROOF row at or above frame + 1', () => {
    expect([20, 21, 25, 26, 35, 36, 40, 41, 45, 50].map((l) => caRoofTier(STD, l))).toEqual([21, 26, 26, 31, 36, 41, 41, 46, 46, 51]);
    expect([20, 21, 24, 25, 28, 29, 52].map((l) => caRoofTier(WS, l))).toEqual([21, 25, 25, 29, 29, 33, 53]);
  });
  it('option columns are frame lengths rounded UP', () => {
    const C = [20, 25, 30, 35, 40];
    expect([20, 21, 24, 25, 26, 36, 40].map((l) => C[caColUp(C, l)])).toEqual([20, 25, 25, 25, 30, 40, 40]);
  });
  it('the 12-30 combinations compare the combined ROOF length (frame + 1) for CA', () => {
    expect(html).toContain("if(keys[ck] >= (ACTIVE_MFR==='CA'?l+1:l)){ targetKey = keys[ck]; break; }");
    expect(html).toContain("if((ACTIVE_MFR==='CA'?l<=50:l<=51)&&!isWS){");
  });
});

describe('CA price book 7/16/26: walls, siding, 32-60 charts', () => {
  it('side walls read the building\'s own height row; vertical siding is the both-sides price', () => {
    expect(html).toContain("var _scRow=(ACTIVE_MFR==='CA')?(SC[Math.max(6,Math.min(16,h))]||SC[16]):(SC[hk]||SC[16]);");
    expect(html).toContain('vertSideCombined: true, // was false');
  });
  it('32-60: side height and sides by LENGTH (8\' = no charge), past 52\' per section', () => {
    expect(html).toContain("if(ACTIVE_MFR==='CA' && w>=32 && w<=60){");
    expect(html).toContain('      if(h<=8) return 0;');
    expect(html).toContain("if(ACTIVE_MFR==='CA' && w2>=32 && w2<=60){");
    const caWideUnits = make(grabFn('caWideUnits'), 'caWideUnits', { MANUFACTURERS: { CA: { wideSpanCombinations: { 56: [29, 29], 60: [33, 29], 108: [53, 29, 29] } } } }) as (l: number) => number[] | null;
    expect(caWideUnits(52)).toBeNull();
    expect(caWideUnits(56)).toEqual([28, 28]);
    expect(caWideUnits(57)).toEqual([32, 28]);
    expect(caWideUnits(105)).toEqual([52, 28, 28]);
  });
  it('wainscot = book 4H 20\'-40\' $300-$500', () => {
    expect(html).toContain('return { cols:[20,25,30,35,40], vals:[300,350,400,450,500] };');
  });
});

describe('CA price book 7/16/26: fees, doors, freight', () => {
  it('engineered plans (5B) and liaison (5A)', () => {
    expect(html).toContain('if(isCom) return 900;');
    expect(html).toContain('return w > 40 ? 600 : 500;');
    expect(html).toContain("amt:350, lbl:'Building Only'");
    expect(html).toContain("amt:450, lbl:'Building & Pad'");
    expect(html).not.toContain('$400/500/750');
  });
  it('as-built plans on every CA order 30\' wide and over', () => {
    const G = (id: string) => ({ value: id === 'bw' ? globalThis.__w : '' });
    const f = make(grabFn('_caAsBuiltReq'), '_caAsBuiltReq', { G, ACTIVE_MFR: 'CA', INPUT_MODE: false }) as () => boolean;
    (globalThis as any).__w = '28'; expect(f()).toBe(false);
    (globalThis as any).__w = '29'; expect(f()).toBe(true);
    (globalThis as any).__w = '30'; expect(f()).toBe(true);
  });
  it('brush seal = (W + 2H) ft for CA, width for CCI', () => {
    const w = { _seal: 9.85 };
    expect(make(grabFn('rudSealUnit'), 'rudSealUnit', { ACTIVE_MFR: 'CA', window: w })('10x10')).toBe(296);
    expect(make(grabFn('rudSealUnit'), 'rudSealUnit', { ACTIVE_MFR: 'CCI', window: { _seal: 12 } })('12x12')).toBe(144);
  });
  it('the M3100 certified windlock line (book 1C)', () => {
    expect(html).toContain("windlock: {label:'Roll-Up Doors — Certified Heavy-Duty (Hoist Incl.)', hoist:'incl', prices:{\"8x8\":1425,");
    expect(html).toContain('"20x14":3600}}');
  });
  it('freight: over 43\' wide / over 100\' long / custom pitch, min $1,750 or 3% - no manufacturer name on the line', () => {
    const G = (id: string) => ({ value: ({ bw: globalThis.__w, bl: globalThis.__l, 'pitch-sel': globalThis.__p } as any)[id] });
    const f = make(grabFn('caFreightOn'), 'caFreightOn', { G, ACTIVE_MFR: 'CA', INPUT_MODE: false }) as () => boolean;
    const set = (w: string, l: string, p: string) => { Object.assign(globalThis as any, { __w: w, __l: l, __p: p }); return f(); };
    expect([set('42', '100', 'standard'), set('44', '40', 'standard'), set('24', '101', 'standard'), set('24', '30', '4:12')]).toEqual([false, true, true, true]);
    expect(html).toContain("Math.max(CA_FREIGHT_MIN, Math.round((sub-connFeeTotal)*3)/100)");
    expect(html).not.toContain('CA min.');
  });
});

declare global { var __w: string; var __l: string; var __p: string; }
