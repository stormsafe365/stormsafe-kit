import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LT_PARTITION_CORNER_CLEAR_FT,
  LT_PARTITION_EPS_FT,
  LT_PARTITION_GAP_FT,
  OPENING_CORNER_CLEAR_FT,
  OPENING_EPS_FT,
  OPENING_GAP_FT,
} from '@/config/constants';
import { clampWallCenter, wallSpotOk } from '../wallFit';

/**
 * NO-OVERLAP RULE (owner 10/2/26: "Components & framed openings cant overlap so
 * our program shouldn't even allow them to overlap"). The pricing program owns
 * one per-wall occupancy model (quote-builder.html ovlModel); these tests run
 * its PURE core, lifted out of the HTML, on every kind of wall the program
 * lays out — main gable / eave / partition (End Storage, GCH), lean-to outer /
 * end / storage partition — plus the 3D drag clamp (engine/wallFit.ts) that
 * must agree with it.
 */

const HTML = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

/** Source of `function name(...){...}` from the program (brace-matched, string-aware). */
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

const ovlConst = HTML.match(/var OVL_CLR=[^;]+;/);
const partConst = HTML.match(/var LT_PART_CLR=[^;]+;/);
type Span = { x: number; w: number };
type Issue = { k: 'corner' | 'pair'; a: number; b: number | null; gap: number; end?: number };
type Item = { w: number; x: number; fixed: boolean; g: number | string };
const P = new Function(
  `${ovlConst ? ovlConst[0] : ''}
   ${partConst ? partConst[0] : ''}
   ${programFn('ovlClear')}
   ${programFn('ovlIssues')}
   ${programFn('ovlFree')}
   ${programFn('ovlPack')}
   ${programFn('ovlLayoutWall')}
   return { ovlClear: ovlClear, ovlIssues: ovlIssues, ovlFree: ovlFree, ovlPack: ovlPack, ovlLayoutWall: ovlLayoutWall,
            C: { CLR: OVL_CLR, GAP: OVL_GAP, EPS: OVL_EPS }, PART: { CLR: LT_PART_CLR, GAP: LT_PART_GAP, EPS: LT_PART_EPS } };`,
)() as {
  ovlClear: (a: Span, b: Span) => number;
  ovlIssues: (len: number, sp: Span[]) => Issue[];
  ovlFree: (len: number, fixed: Span[]) => Array<[number, number]>;
  ovlPack: (iv: Array<[number, number]>, ws: number[]) => number[] | null;
  ovlLayoutWall: (len: number, items: Item[]) => { xs: number[]; moved: boolean[]; re: boolean; fit: boolean };
  C: { CLR: number; GAP: number; EPS: number };
  PART: { CLR: number; GAP: number; EPS: number };
};

/** The program's own Auto spot (getPosItems): one entry's equal spacing across the wall. */
const auto = (len: number, w: number, n: number) => Array.from({ length: n }, (_, i) => ((len - n * w) / (n + 1)) * (i + 1) + w * i);
/** runTrussChecks' lean-to Auto layout (gap = max(1, ...)). */
const ltAuto = (len: number, w: number, n: number) => {
  const gap = Math.max(1, (len - w * n) / (n + 1));
  const xs: number[] = [];
  for (let i = 0, x = gap; i < n; i++, x += w + gap) xs.push(x);
  return xs;
};
/** Items of one Auto entry (group g). */
const autoEntry = (g: number, len: number, w: number, n: number, xs = auto(len, w, n)): Item[] => xs.map((x) => ({ w, x, fixed: false, g }));
const typed = (g: number, w: number, x: number): Item => ({ w, x, fixed: true, g });
const spans = (items: Item[], xs: number[]) => items.map((it, i) => ({ x: xs[i], w: it.w }));
const r2 = (n: number) => Math.round(n * 1000) / 1000;

describe('rule numbers — the program\'s existing ones, nothing new', () => {
  it('OVL_* = the Storage Partition rules (LT_PART_*) = the 3D constants', () => {
    expect(P.C).toEqual(P.PART);
    expect(P.C).toEqual({ CLR: OPENING_CORNER_CLEAR_FT, GAP: OPENING_GAP_FT, EPS: OPENING_EPS_FT });
    expect(P.C).toEqual({ CLR: LT_PARTITION_CORNER_CLEAR_FT, GAP: LT_PARTITION_GAP_FT, EPS: LT_PARTITION_EPS_FT });
    expect(P.C).toEqual({ CLR: 1, GAP: 1, EPS: 0.01 });
  });
});

describe('ovlIssues — overlap, 1\' between openings, 1\' corners', () => {
  it('flags an overlap, a touch and a sub-1\' gap; a 1\' gap is fine', () => {
    // FO 2-14, door 10-13 (inside it), door 14.5-17.5, window 17.5-20, door 21-24
    const iss = P.ovlIssues(40, [{ x: 2, w: 12 }, { x: 10, w: 3 }, { x: 14.5, w: 3 }, { x: 17.5, w: 2.5 }, { x: 21, w: 3 }]);
    const pairs = iss.filter((i) => i.k === 'pair').map((i) => [i.a, i.b, r2(i.gap)]);
    expect(pairs).toEqual([
      [0, 1, -4], // the walk door inside the 12' FO
      [0, 2, 0.5], // only 6"
      [2, 3, 0], // touching
    ]); // 3-4 exactly 1' apart: fine
    expect(iss.filter((i) => i.k === 'corner')).toEqual([]);
  });
  it('corners: closer than 1\' to either end, or past it', () => {
    const iss = P.ovlIssues(30, [{ x: 0.5, w: 3 }, { x: 26.5, w: 3 }, { x: 28, w: 3 }, { x: 1, w: 3 }]);
    const c = iss.filter((i) => i.k === 'corner').map((i) => [i.a, i.end, r2(i.gap)]);
    expect(c).toEqual([[0, 0, 0.5], [1, 1, 0.5], [2, 1, -1]]);
  });
  it('an opening inside another (window in a framed opening) clashes, whatever the heights', () => {
    expect(P.ovlIssues(40, [{ x: 14, w: 12 }, { x: 18.75, w: 2.5 }]).some((i) => i.k === 'pair' && i.gap < 0)).toBe(true);
  });
});

describe('ovlFree / ovlPack — the free stretches and the equal spacing', () => {
  it('free stretches keep 1\' from corners and from every kept opening', () => {
    expect(P.ovlFree(40, [])).toEqual([[1, 39]]);
    expect(P.ovlFree(40, [{ x: 14, w: 12 }])).toEqual([[1, 13], [27, 39]]);
    expect(P.ovlFree(40, [{ x: 0.5, w: 12 }])).toEqual([[13.5, 39]]);
    expect(P.ovlFree(1.5, [])).toEqual([]); // no room at all
  });
  it('one stretch [1, len-1] = the program Auto equal spacing exactly', () => {
    for (const [len, w, n] of [[40, 12, 3], [30, 3, 2], [24, 2.5, 4], [50, 10, 1], [12, 3, 2]] as const) {
      const xs = P.ovlPack([[1, len - 1]], Array(n).fill(w))!;
      xs.forEach((x, i) => expect(x).toBeCloseTo(auto(len, w, n)[i], 9));
    }
  });
  it('null when they cannot fit with 1\' between', () => {
    expect(P.ovlPack([[1, 39]], [12, 12, 12, 3])).toBeNull();
    expect(P.ovlPack([[1, 13], [27, 39]], [12, 12])).toEqual([1, 27]);
  });
  it('splits across stretches for the widest smallest gap', () => {
    // 3' door: the 26' stretch, not the 3' one
    const xs = P.ovlPack([[1, 4], [10, 36]], [3])!;
    expect(xs[0]).toBeGreaterThan(10);
  });
});

describe('ovlLayoutWall — main walls (getPosItems spots)', () => {
  it('a wall with no clash comes back untouched — same spots, same price', () => {
    const its = [...autoEntry(1, 40, 12, 3)]; // 1-13, 14-26, 27-39: exactly 1' apart
    const r = P.ovlLayoutWall(40, its);
    expect(r.re).toBe(false);
    expect(r.xs).toEqual(its.map((i) => i.x)); // bit-identical
    const its2 = [typed(1, 12, 2), typed(2, 12, 26), ...autoEntry(3, 40, 3, 1)]; // door centred between two typed FOs
    const r2_ = P.ovlLayoutWall(40, its2);
    expect(r2_.re).toBe(false);
    expect(r2_.xs).toEqual(its2.map((i) => i.x));
  });
  it('owner case: three separate 12\' framed openings on Auto (all centred) — spread along the wall in the order added', () => {
    const its = [...autoEntry(1, 40, 12, 1), ...autoEntry(2, 40, 12, 1), ...autoEntry(3, 40, 12, 1)];
    expect(its.map((i) => i.x)).toEqual([14, 14, 14]); // the old program: all on top of each other
    const r = P.ovlLayoutWall(40, its);
    expect(r.fit).toBe(true);
    expect(r.xs.map(r2)).toEqual([1, 14, 27]); // = one entry of qty 3
    expect(P.ovlIssues(40, spans(its, r.xs))).toEqual([]);
  });
  it('owner case + walk door + window on a 40\' eave: cannot fit (41.5\' of openings + 6\' spacing) — left as Auto put them, flagged', () => {
    const its = [...autoEntry(1, 40, 12, 1), ...autoEntry(2, 40, 12, 1), ...autoEntry(3, 40, 12, 1), ...autoEntry(4, 40, 3, 1), ...autoEntry(5, 40, 2.5, 1)];
    const r = P.ovlLayoutWall(40, its);
    expect(r.fit).toBe(false);
    expect(r.xs).toEqual(its.map((i) => i.x));
    expect(P.ovlIssues(40, spans(its, r.xs)).length).toBeGreaterThan(0);
  });
  it('the same five on a 60\' eave: all placed, none closer than 1\'', () => {
    const its = [...autoEntry(1, 60, 12, 1), ...autoEntry(2, 60, 12, 1), ...autoEntry(3, 60, 12, 1), ...autoEntry(4, 60, 3, 1), ...autoEntry(5, 60, 2.5, 1)];
    const r = P.ovlLayoutWall(60, its);
    expect(r.fit).toBe(true);
    expect(P.ovlIssues(60, spans(its, r.xs))).toEqual([]);
    // in the order added, evenly spaced (equal gaps, corners included)
    const gaps = its.map((_, i) => (i ? r.xs[i] - (r.xs[i - 1] + its[i - 1].w) : r.xs[0]));
    gaps.forEach((g) => expect(g).toBeCloseTo(gaps[0], 9));
  });
  it('two separate Auto entries that clash are spread exactly like one entry of qty 2', () => {
    const its = [...autoEntry(1, 40, 12, 1), ...autoEntry(2, 40, 12, 1)];
    const r = P.ovlLayoutWall(40, its);
    r.xs.forEach((x, i) => expect(x).toBeCloseTo(auto(40, 12, 2)[i], 9));
  });
  it('typed (pinned) spots never move; Auto ones go around them', () => {
    const its = [typed(1, 12, 2), ...autoEntry(2, 40, 12, 1), ...autoEntry(3, 40, 3, 1)];
    // Auto FO centred at 14-26 clears the typed 2-14 FO by 0' -> must move; the door centred inside it too
    const r = P.ovlLayoutWall(40, its);
    expect(r.fit).toBe(true);
    expect(r.xs[0]).toBe(2);
    expect(r.moved[0]).toBe(false);
    expect(P.ovlIssues(40, spans(its, r.xs))).toEqual([]);
  });
  it('typed spots that clash are left alone (flagged), even when Auto ones fit', () => {
    const its = [typed(1, 12, 5), typed(2, 12, 10), ...autoEntry(3, 40, 3, 1)];
    const r = P.ovlLayoutWall(40, its);
    expect(r.xs.slice(0, 2)).toEqual([5, 10]);
    const iss = P.ovlIssues(40, spans(its, r.xs));
    expect(iss.some((i) => i.k === 'pair' && i.a === 0 && i.b === 1)).toBe(true); // still flagged
    expect(iss.some((i) => i.a === 2 || i.b === 2)).toBe(false); // the Auto door found a clear spot
  });
  it('a reopened quote\'s saved Auto spots (kept = fixed) are never moved', () => {
    const its = autoEntry(1, 40, 12, 1).map((i) => ({ ...i, fixed: true })).concat(autoEntry(2, 40, 12, 1).map((i) => ({ ...i, fixed: true })));
    const r = P.ovlLayoutWall(40, its);
    expect(r.xs).toEqual([14, 14]);
    expect(r.re).toBe(false);
  });
  it('re-spreads every Auto opening when the newest cannot fit beside the older ones', () => {
    // older door centred (18.5-21.5) leaves 17.5' / 17.5' each side; two new 12' FOs fit only if the door moves
    const its = [...autoEntry(1, 40, 3, 1), ...autoEntry(2, 40, 12, 1), ...autoEntry(3, 40, 12, 1)];
    const r = P.ovlLayoutWall(40, its);
    expect(r.fit).toBe(true);
    expect(P.ovlIssues(40, spans(its, r.xs))).toEqual([]);
  });
  it('one entry crammed past its wall (qty 3 × 12\' on a 30\' eave): no room — untouched and flagged', () => {
    const its = autoEntry(1, 30, 12, 3);
    const r = P.ovlLayoutWall(30, its);
    expect(r.fit).toBe(false);
    expect(r.xs).toEqual(auto(30, 12, 3));
    expect(P.ovlIssues(30, spans(its, r.xs)).some((i) => i.k === 'corner' && i.gap < 0)).toBe(true);
  });
  it('gable: three 10\' frame-outs as one Auto entry touch with no corner room on 30\' (0 gaps) — flagged; 2 fit', () => {
    const r3 = P.ovlLayoutWall(30, autoEntry(1, 30, 10, 3));
    expect(r3.fit).toBe(false);
    const r2w = P.ovlLayoutWall(30, autoEntry(1, 30, 10, 2));
    expect(r2w.re).toBe(false);
    expect(P.ovlIssues(30, spans(autoEntry(1, 30, 10, 2), r2w.xs))).toEqual([]);
  });
  it('End Storage / GCH partition (W long): roll-up + framed openings share it like any wall', () => {
    const its = [...autoEntry(1, 24, 10, 1), ...autoEntry(2, 24, 10, 1)]; // both centred 7-17
    const r = P.ovlLayoutWall(24, its);
    expect(r.fit).toBe(true);
    expect(P.ovlIssues(24, spans(its, r.xs))).toEqual([]);
    const its3 = [...autoEntry(1, 24, 10, 1), ...autoEntry(2, 24, 10, 1), ...autoEntry(3, 24, 10, 1)];
    expect(P.ovlLayoutWall(24, its3).fit).toBe(false); // 30' + 4' > 24'
  });
});

describe('ovlLayoutWall — lean-to walls (runTrussChecks spots)', () => {
  it('outer wall 40\': 12\' FO qty 3 Auto fits exactly — untouched (1, 14, 27)', () => {
    const its = autoEntry(1, 40, 12, 3, ltAuto(40, 12, 3));
    const r = P.ovlLayoutWall(40, its);
    expect(r.re).toBe(false);
    expect(r.xs.map(r2)).toEqual([1, 14, 27]);
  });
  it('outer wall: walk door + window on "Left side" inside FO #1 (the owner\'s screenshot) — no room on 40\', placed on 50\'', () => {
    const left = (len: number) => [Math.max(1, len * 0.04)]; // runTrussChecks "Left side", qty 1
    const mk = (len: number) => [
      ...autoEntry(1, len, 12, 3, ltAuto(len, 12, 3)),
      ...autoEntry(2, len, 3, 1, left(len)),
      ...autoEntry(3, len, 2.5, 1, left(len)),
    ];
    expect(P.ovlLayoutWall(40, mk(40)).fit).toBe(false);
    const its = mk(50);
    const r = P.ovlLayoutWall(50, its);
    expect(r.fit).toBe(true);
    expect(P.ovlIssues(50, spans(its, r.xs))).toEqual([]);
  });
  it('end wall 12\' wide: two 6\' frame-outs can never both fit (12 + 3 > 12)', () => {
    const its = [...autoEntry(1, 12, 6, 1, ltAuto(12, 6, 1)), ...autoEntry(2, 12, 6, 1, ltAuto(12, 6, 1))];
    expect(P.ovlLayoutWall(12, its).fit).toBe(false);
    // a 6' frame-out + a walk door: 6 + 3 + 3' spacing = 12 — fits, but only once
    // the older frame-out leaves its centred spot (re-spread): 1-7 and 8-11
    const one = [...autoEntry(1, 12, 6, 1, ltAuto(12, 6, 1)), ...autoEntry(2, 12, 3, 1, ltAuto(12, 3, 1))];
    const r = P.ovlLayoutWall(12, one);
    expect(r.fit).toBe(true);
    expect(r.xs.map(r2)).toEqual([1, 8]);
  });
  it('storage partition (lean-to width): two 4\' frame-outs + walk door on 12\' -> 11\' + 4\' > 12 no; two 4\' fit', () => {
    const two = [...autoEntry(1, 12, 4, 1), ...autoEntry(2, 12, 4, 1)];
    const r = P.ovlLayoutWall(12, two);
    expect(r.fit).toBe(true);
    expect(P.ovlIssues(12, spans(two, r.xs))).toEqual([]);
    expect(P.ovlLayoutWall(12, [...two, ...autoEntry(3, 12, 3, 1)]).fit).toBe(false);
  });
});

describe('qty — a count fits iff the openings + 1\' at each corner and between fit', () => {
  it('matches the closed form on an empty wall', () => {
    for (const len of [12, 20, 24, 30, 40, 50]) {
      for (const w of [2.5, 3, 6, 10, 12]) {
        for (let n = 1; n <= 6; n++) {
          const fits = n * w + (n + 1) <= len + 0.01;
          const its = autoEntry(1, len, w, n);
          const r = P.ovlLayoutWall(len, its);
          expect(r.fit && P.ovlIssues(len, spans(its, r.xs)).length === 0).toBe(fits);
        }
      }
    }
  });
});

describe('3D drag clamp (engine/wallFit.ts) agrees with the program rule', () => {
  const sib = (x: number, w: number) => ({ offset: x + w / 2, width: w });
  it('wallSpotOk = no ovlIssues for that opening', () => {
    const sibs = [sib(14, 12)];
    for (let x = -2; x <= 40; x += 0.25) {
      const ok = wallSpotOk(x + 1.5, 3, 40, sibs);
      const iss = P.ovlIssues(40, [{ x: 14, w: 12 }, { x, w: 3 }]);
      expect(ok).toBe(iss.length === 0);
    }
  });
  it('a drag onto another opening stops at the nearest spot 1\' clear of it, on a whole inch', () => {
    const c = clampWallCenter(20, 3, 40, [sib(14, 12)], 30); // pointer over the FO
    const x = c - 1.5;
    expect(Math.abs(x * 12 - Math.round(x * 12))).toBeLessThan(1e-9);
    expect(P.ovlIssues(40, [{ x: 14, w: 12 }, { x, w: 3 }])).toEqual([]);
    expect(x === 27 || x === 10).toBe(true);
  });
  it('keeps 1\' from the corners', () => {
    expect(clampWallCenter(0, 3, 40, [], 20) - 1.5).toBe(1);
    expect(clampWallCenter(40, 3, 40, [], 20) + 1.5).toBe(39);
  });
  it('no valid spot anywhere -> stays where it is', () => {
    expect(clampWallCenter(10, 12, 13, [], 6.5)).toBe(6.5);
    expect(clampWallCenter(10, 12, 40, [sib(1, 12), sib(14, 12), sib(27, 12)], 33)).toBe(33);
  });
});
