import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Owner rule (10/6/26): "components/openings can NEVER overlap". A lean-to's
 * STORAGE PARTITION crosses its outer wall; an Auto opening there used to be
 * centred straight across it (CCI 30x50x12, left-eave 12'x50' lean-to, 24'
 * storage at the back: an 8x8 roll-up at 21'-29' from the front, the partition
 * at 26'). The program's occupancy model (quote-builder.html) now treats the
 * partition line as an obstacle on that wall (`bars`): Auto openings land
 * wholly in one segment, 1' clear of the partition post; a typed spot across
 * it is flagged (bar issue). These tests run the pure core lifted from the HTML.
 */
const HTML = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function programFn(name: string): string {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`program function ${name} not found`);
  let i = HTML.indexOf('{', start);
  let depth = 0;
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === "'" || c === '"') {
      for (i++; i < HTML.length && HTML[i] !== c; i++) if (HTML[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return HTML.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
type Span = { x: number; w: number };
type Issue = { k: 'corner' | 'pair' | 'bar'; a: number; b: number | null; gap: number; at?: number };
type Item = { w: number; x: number; fixed: boolean };
const P = new Function(
  `${(HTML.match(/var OVL_CLR=[^;]+;/) as RegExpMatchArray)[0]}
   ${programFn('ovlClear')}
   ${programFn('ovlIssues')}
   ${programFn('ovlFree')}
   ${programFn('ovlPack')}
   ${programFn('ovlLayoutWall')}
   return { ovlIssues: ovlIssues, ovlFree: ovlFree, ovlLayoutWall: ovlLayoutWall };`,
)() as {
  ovlIssues: (len: number, sp: Span[], bars?: number[]) => Issue[];
  ovlFree: (len: number, fixed: Span[], bars?: number[]) => Array<[number, number]>;
  ovlLayoutWall: (len: number, items: Item[], bars?: number[]) => { xs: number[]; moved: boolean[]; re: boolean; fit: boolean };
};
const straddles = (x: number, w: number, b: number) => x < b && x + w > b;
const clear = (x: number, w: number, b: number) => x + w <= b - 1 + 0.01 || x >= b + 1 - 0.01;

describe('lean-to storage partition on the outer wall', () => {
  it('the owner case: an Auto 8x8 roll-up centred across the partition at 26 ft moves wholly into one segment', () => {
    const lay = P.ovlLayoutWall(50, [{ w: 8, x: 21, fixed: false }], [26]);
    expect(lay.re).toBe(true);
    expect(lay.fit).toBe(true);
    expect(clear(lay.xs[0], 8, 26)).toBe(true);
    expect(lay.xs[0]).toBeGreaterThanOrEqual(1);
    expect(lay.xs[0] + 8).toBeLessThanOrEqual(49);
  });
  it('no partition line = exactly as before (the old two-argument call)', () => {
    expect(P.ovlLayoutWall(50, [{ w: 8, x: 21, fixed: false }]).xs).toEqual([21]);
    expect(P.ovlIssues(50, [{ x: 21, w: 8 }])).toEqual([]);
    expect(P.ovlFree(50, [])).toEqual([[1, 49]]);
  });
  it('an Auto opening already clear of the partition keeps its spot', () => {
    const lay = P.ovlLayoutWall(50, [{ w: 8, x: 21, fixed: false }], [38]);
    expect(lay.re).toBe(false);
    expect(lay.xs).toEqual([21]);
  });
  it('a typed spot across the partition is flagged (never moved)', () => {
    const lay = P.ovlLayoutWall(50, [{ w: 8, x: 22, fixed: true }], [26]);
    expect(lay.xs).toEqual([22]);
    const iss = P.ovlIssues(50, [{ x: 22, w: 8 }], [26]);
    expect(iss.some((i) => i.k === 'bar' && i.at === 26 && i.gap < 0)).toBe(true);
  });
  it('1 ft clear of the partition post, like a corner post', () => {
    expect(P.ovlIssues(50, [{ x: 17, w: 8 }], [26]).filter((i) => i.k === 'bar')).toEqual([]); // 17-25: 1 ft clear
    expect(P.ovlIssues(50, [{ x: 17.5, w: 8 }], [26]).some((i) => i.k === 'bar')).toBe(true); // 6" from the post
    expect(P.ovlFree(50, [], [26])).toEqual([[1, 25], [27, 49]]);
  });
  it('several Auto openings: none straddles, and a spread that was already clear is kept as it was', () => {
    const items = [3, 3, 2.5, 2.5].map((w, i) => ({ w, x: 5 + i * 9, fixed: false }));
    const lay = P.ovlLayoutWall(50, items, [26]);
    lay.xs.forEach((x, i) => expect(clear(x, items[i].w, 26)).toBe(true));
    const noBar = P.ovlLayoutWall(50, items);
    if (noBar.xs.every((x, i) => clear(x, items[i].w, 26))) expect(lay.xs).toEqual(noBar.xs);
  });
  it('gable lean-to (30 ft outer wall, 12 ft front storage): the roll-up leaves the line at 12 ft', () => {
    const lay = P.ovlLayoutWall(30, [{ w: 8, x: 11, fixed: false }], [12]);
    expect(clear(lay.xs[0], 8, 12)).toBe(true);
    expect(straddles(11, 8, 12)).toBe(true);
  });
});
