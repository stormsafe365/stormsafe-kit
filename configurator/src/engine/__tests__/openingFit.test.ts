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
  OPENING_VERT_GAP_FT,
} from '@/config/constants';
import { spreadAutoOverlaps } from '../autoSpread';
import { clampWallCenter, openingIdsUnder, pressBelongsToSmaller, vertConflict, wallSpotOk } from '../wallFit';

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
type Span = { x: number; w: number; y?: number; h?: number };
type Issue = { k: 'corner' | 'pair'; a: number; b: number | null; gap: number; end?: number; vg?: number };
type Item = { w: number; x: number; fixed: boolean; g: number | string; y?: number; h?: number };
const P = new Function(
  `${ovlConst ? ovlConst[0] : ''}
   ${partConst ? partConst[0] : ''}
   ${programFn('ovlClear')}
   ${programFn('ovlVClear')}
   ${programFn('ovlVHit')}
   ${programFn('ovlIssues')}
   ${programFn('ovlFree')}
   ${programFn('ovlPack')}
   ${programFn('ovlLayoutWall')}
   return { ovlVClear: ovlVClear, V: OVL_VGAP, ovlClear: ovlClear, ovlIssues: ovlIssues, ovlFree: ovlFree, ovlPack: ovlPack, ovlLayoutWall: ovlLayoutWall,
            C: { CLR: OVL_CLR, GAP: OVL_GAP, EPS: OVL_EPS }, PART: { CLR: LT_PART_CLR, GAP: LT_PART_GAP, EPS: LT_PART_EPS } };`,
)() as {
  ovlClear: (a: Span, b: Span) => number;
  ovlVClear: (a: Span, b: Span) => number;
  V: number;
  ovlIssues: (len: number, sp: Span[]) => Issue[];
  ovlFree: (len: number, fixed: Span[], bars?: number[] | null, mv?: Array<{ y?: number; h?: number }>) => Array<[number, number]>;
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

describe('owner 10/5/26 — window added to an eave that already has a framed opening', () => {
  // "i added a window to the eave side & it went on top of a framed opening thats already been added to that eave side"
  it('typed 14 ft framed opening (17-31) on a 40 ft eave + new Auto window: the window lands clear of it, the FO never moves', () => {
    const its = [typed(1, 14, 17), ...autoEntry(2, 40, 2.5, 1)];
    expect(its[1].x).toBe(18.75); // the old program: centred, inside the FO (17-31)
    expect(P.ovlIssues(40, spans(its, its.map((i) => i.x))).some((i) => i.k === 'pair' && i.gap < 0)).toBe(true);
    const r = P.ovlLayoutWall(40, its);
    expect(r.fit).toBe(true);
    expect(r.xs[0]).toBe(17);
    expect(r.moved[0]).toBe(false);
    expect(r.moved[1]).toBe(true);
    expect(P.ovlIssues(40, spans(its, r.xs))).toEqual([]);
    expect(r.xs[1]).toBeCloseTo(1 + (15 - 2.5) / 2, 9); // centred in the wider free stretch 1-16
  });
  it('Auto framed opening (centred) + new Auto window: both clear, nothing on top of anything', () => {
    const its = [...autoEntry(1, 40, 14, 1), ...autoEntry(2, 40, 2.5, 1)];
    const r = P.ovlLayoutWall(40, its);
    expect(r.fit).toBe(true);
    expect(P.ovlIssues(40, spans(its, r.xs))).toEqual([]);
  });
  it('no room beside it (16 ft FO typed on a 20 ft eave): the window cannot fit — the add is refused', () => {
    const its = [typed(1, 16, 2), ...autoEntry(2, 20, 2.5, 1)];
    const r = P.ovlLayoutWall(20, its);
    expect(r.fit).toBe(false);
  });
});

describe('3D picking — a press on overlapping openings goes to the smaller one', () => {
  const fo = { offset: 31, width: 14, sill: 0, height: 10 }; // FO 24-38
  const win = { offset: 32, width: 2.5, sill: 4, height: 2.5 }; // window inside it
  it('the framed opening lets a press on the window pass on; the window keeps it', () => {
    expect(pressBelongsToSmaller(fo, 32, 5, [win])).toBe(true);
    expect(pressBelongsToSmaller(win, 32, 5, [fo])).toBe(false);
  });
  it('a press on the framed opening away from the window stays with the framed opening', () => {
    expect(pressBelongsToSmaller(fo, 26, 5, [win])).toBe(false);
    expect(pressBelongsToSmaller(fo, 32, 8, [win])).toBe(false);
  });
  it('openings that do not overlap are unaffected', () => {
    expect(pressBelongsToSmaller(win, 10, 5, [fo])).toBe(false);
    expect(pressBelongsToSmaller(fo, 31, 5, [])).toBe(false);
  });
});

describe('3D picking — only an opening the press actually went through can take it', () => {
  it('openingIdsUnder walks each hit up to its opening root', () => {
    const root = (id: string) => ({ userData: { ssOpeningId: id }, parent: null });
    const child = (p: { userData: Record<string, unknown>; parent: unknown }) => ({ userData: {}, parent: p as never });
    const fo = root('fo'), win = root('win');
    const ids = openingIdsUnder([{ object: child(child(fo)) }, { object: child(win) }, { object: { userData: {}, parent: null } }]);
    expect([...ids].sort()).toEqual(['fo', 'win']);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Owner 10/20/26: "the overlap rule is so the program doesnt add a component right
// on top of another component (i dont mean above it i mean literally on it) ...
// if there is room to put something above or below something then we should be
// able to ... 2' of space would be needed between them, at least."
// Two openings clash only when they overlap BOTH sideways (1') AND up-and-down (2').
describe('vertical room — stacked openings (owner 10/20/26)', () => {
  const SILL = 50 / 12; // a standard window sill
  const win = (x: number, y = SILL, h = 2.5, w = 2.5): Span => ({ x, w, y, h });
  const hasPair = (len: number, sp: Span[]) => P.ovlIssues(len, sp).some((i) => i.k === 'pair');
  const g96 = (a: number) => Math.round(a * 96) / 96;

  it('the vertical gap is ONE named constant, 2 ft, equal in the 3D', () => {
    expect(P.V).toBe(2);
    expect(OPENING_VERT_GAP_FT).toBe(2);
    expect(HTML.match(/OVL_VGAP/g)!.length).toBeGreaterThan(8);
    expect(HTML).not.toMatch(/OVL_VGAP\s*=\s*[^2]/);
  });

  it('ovlVClear: sill-to-top distance, negative when they overlap, -Infinity when a height is unknown', () => {
    expect(P.ovlVClear({ x: 0, w: 1, y: 0, h: 8 }, { x: 0, w: 1, y: 10, h: 2 })).toBe(2);
    expect(P.ovlVClear({ x: 0, w: 1, y: 10, h: 2 }, { x: 0, w: 1, y: 0, h: 8 })).toBe(2);
    expect(P.ovlVClear(win(0), win(0))).toBeLessThan(0);
    expect(P.ovlVClear({ x: 0, w: 1 }, win(0))).toBe(-Infinity);
    expect(P.ovlVClear({ x: 0, w: 1, y: 0, h: 0 }, win(0))).toBe(-Infinity);
  });

  it('a window straight BELOW another with room between is accepted; on top of it is blocked', () => {
    const upper = win(10, 10.5); // 10.5 - 13
    expect(hasPair(40, [upper, win(10)])).toBe(false); // lower window 4'2" - 6'8": 3'10" of wall between
    expect(hasPair(40, [upper, win(10, 10.5)])).toBe(true); // literally on it
    expect(hasPair(40, [upper, win(10, 9)])).toBe(true); // overlaps vertically
    expect(hasPair(40, [upper, win(11.2, 11)])).toBe(true); // partly on it
  });

  it('exact boundary: 2 ft between top and bottom is allowed; 1.99 and one 1/96 ft less are blocked', () => {
    const lower = win(10); // top = 4.1667 + 2.5 = 6.6667
    const top = SILL + 2.5;
    expect(hasPair(40, [lower, win(10, top + 2)])).toBe(false);
    expect(hasPair(40, [lower, win(10, top + 1.99)])).toBe(true);
    expect(hasPair(40, [lower, win(10, top + 2 - 1 / 96)])).toBe(true);
    expect(hasPair(40, [lower, win(10, top + 1.9)])).toBe(true);
    expect(hasPair(40, [lower, win(10, top + 1.5)])).toBe(true);
    expect(hasPair(40, [lower, win(10, top + 3)])).toBe(false);
    // the issue carries the vertical gap so the message can say how much room is missing
    const is = P.ovlIssues(40, [lower, win(10, top + 1.5)]).find((i) => i.k === 'pair')!;
    expect(is.vg).toBeCloseTo(1.5, 9);
    expect(P.ovlIssues(40, [lower, win(10, 10.5)]).find((i) => i.k === 'pair')).toBeUndefined(); // 3 ft 10 in apart: no issue at all
  });

  it('sideways stays 1 ft: with vertical overlap, 1 ft apart is fine, a hair under is blocked', () => {
    const a = { x: 10, w: 3, y: 0, h: 6.67 };
    expect(hasPair(40, [a, { x: 14, w: 3, y: 0, h: 6.67 }])).toBe(false);
    expect(hasPair(40, [a, { x: 14 - 1 / 96, w: 3, y: 0, h: 6.67 }])).toBe(true);
    expect(hasPair(40, [a, { x: 13.5, w: 3, y: 0, h: 6.67 }])).toBe(true);
    expect(hasPair(40, [a, win(13.5)])).toBe(true); // a window beside a door still needs the 1 ft
    expect(hasPair(40, [a, win(14)])).toBe(false);
  });

  it('a roll-up door beside a window: unchanged (they share height); a window high above the door is fine', () => {
    const roll = { x: 10, w: 10, y: 0, h: 8 };
    expect(hasPair(40, [roll, win(20.5)])).toBe(true);
    expect(hasPair(40, [roll, win(21)])).toBe(false);
    expect(hasPair(40, [roll, win(12)])).toBe(true); // inside the door's width
    expect(hasPair(40, [roll, win(12, 10)])).toBe(false); // 14 ft gable: window 10 - 12.5, 2 ft over the 8 ft door
    expect(hasPair(40, [roll, win(12, 9.5)])).toBe(true);
  });

  it('corners are still 1 ft for a stacked opening', () => {
    const iss = P.ovlIssues(30, [win(0.5, 10.5), win(10)]);
    expect(iss.some((i) => i.k === 'corner' && i.a === 0)).toBe(true);
    expect(iss.some((i) => i.k === 'pair')).toBe(false);
  });

  it('no sill / height known -> the old horizontal-only rule (nothing slips through)', () => {
    expect(hasPair(40, [{ x: 10, w: 3 }, { x: 10, w: 3 }])).toBe(true);
    expect(hasPair(40, [{ x: 10, w: 3 }, win(10, 20)])).toBe(true);
  });

  it('Auto spots: an Auto window right under two high typed windows (2 ft+ clear) is NOT moved', () => {
    const high = [{ w: 2.5, x: 10, fixed: true, g: 1, y: 10.5, h: 2.5 }, { w: 2.5, x: 14, fixed: true, g: 1, y: 10.5, h: 2.5 }];
    const newAuto = { w: 2.5, x: 10.5, fixed: false, g: 2, y: SILL, h: 2.5 };
    const r = P.ovlLayoutWall(40, [...high, newAuto]);
    expect(r.moved[2]).toBe(false);
    expect(r.xs[2]).toBe(10.5);
    expect(r.re).toBe(false);
    // the same wall read the OLD way (no heights) moves it off the windows
    const old = P.ovlLayoutWall(40, [...high, newAuto].map((i) => ({ ...i, y: undefined, h: undefined })));
    expect(old.moved[2]).toBe(true);
  });

  it('Auto spots: 1.83 ft under the high windows is a clash again — it is re-spread and the result is clean', () => {
    const high = [{ w: 2.5, x: 10, fixed: true, g: 1, y: 8.5, h: 2.5 }, { w: 2.5, x: 14, fixed: true, g: 1, y: 8.5, h: 2.5 }]; // gap to 6.6667 = 1.83
    const newAuto = { w: 2.5, x: 10.5, fixed: false, g: 2, y: SILL, h: 2.5 };
    const its = [...high, newAuto];
    const r = P.ovlLayoutWall(40, its);
    expect(r.moved[2]).toBe(true);
    expect(r.fit).toBe(true);
    expect(hasPair(40, its.map((it, i) => ({ x: r.xs[i], w: it.w, y: it.y, h: it.h })))).toBe(false);
  });

  it('Auto re-spread packs around the fixed openings it shares height with, ignores the ones it is stacked clear of', () => {
    const door = { w: 10, x: 15, fixed: true, g: 1, y: 0, h: 8 };
    const highWin = { w: 6, x: 30, fixed: true, g: 2, y: 11, h: 2 }; // 3 ft over the door top, away from it
    const autoWin = { w: 2.5, x: 17, fixed: false, g: 3, y: SILL, h: 2.5 }; // in the door's span -> clashes with the door only
    const its = [door, highWin, autoWin];
    const r = P.ovlLayoutWall(40, its);
    expect(r.moved[2]).toBe(true);
    expect(hasPair(40, its.map((it, i) => ({ x: r.xs[i], w: it.w, y: it.y, h: it.h })))).toBe(false);
    // 30-36 is 4.17..6.67 + 4.3 ft below the high window: the stretch over there stays free for it
    expect(P.ovlFree(40, [door, highWin], null, [{ y: SILL, h: 2.5 }])).toEqual([[1, 14], [26, 39]]);
    expect(P.ovlFree(40, [door, highWin])).toEqual([[1, 14], [26, 29], [37, 39]]); // old call: every kept span cuts
    expect(P.ovlFree(40, [{ x: 2, w: 3, y: 11, h: 2 }], null, [{ y: 2, h: 2 }])).toEqual([[1, 39]]); // far below it: not cut
    expect(P.ovlFree(40, [{ x: 2, w: 3, y: 11, h: 2 }], null, [{ y: 9, h: 2 }])).toEqual([[6, 39]]); // touching: cut
  });

  it('fuzz: wallSpotOk (3D) with the vertical extent = no ovlIssues (program); without it = the old rule', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    let blocked = 0;
    let stackedOk = 0;
    for (let n = 0; n < 4000; n++) {
      const len = 20 + Math.floor(rnd() * 30);
      const mk = () => {
        const w = g96(1 + rnd() * 6);
        return { x: g96(1 + rnd() * (len - 2 - w)), w, y: g96(rnd() * 12), h: g96(1 + rnd() * 7) };
      };
      const a = mk();
      const b = mk();
      const prog = P.ovlIssues(len, [a, b]).length === 0;
      const sib = { offset: a.x + a.w / 2, width: a.w, sill: a.y, height: a.h };
      expect(wallSpotOk(b.x + b.w / 2, b.w, len, [sib], { sill: b.y, height: b.h })).toBe(prog);
      const old = P.ovlIssues(len, [{ x: a.x, w: a.w }, { x: b.x, w: b.w }]).length === 0;
      expect(wallSpotOk(b.x + b.w / 2, b.w, len, [{ offset: a.x + a.w / 2, width: a.w }])).toBe(old);
      if (!prog) blocked++;
      if (prog && !old) stackedOk++;
    }
    expect(blocked).toBeGreaterThan(100);
    expect(stackedOk).toBeGreaterThan(100); // cases the old rule refused and the new one allows
  });
});

describe('3D (wallFit / autoSpread) — stacked openings', () => {
  const sib = (x: number, w: number, sill?: number, height?: number) => ({ offset: x + w / 2, width: w, sill, height });
  it('vertConflict: boundary at exactly 2 ft', () => {
    const self = { sill: 8.6667, height: 2.5 };
    expect(vertConflict(self, { sill: 4.1667, height: 2.5 })).toBe(false); // 8.6667 - 6.6667 = 2
    expect(vertConflict(self, { sill: 4.1771, height: 2.5 })).toBe(true); // 1/96 ft closer
    expect(vertConflict(undefined, { sill: 4, height: 2 })).toBe(true);
    expect(vertConflict(self, {})).toBe(true);
  });
  it('wallSpotOk: a window placed under another is accepted at 2 ft, refused at 1.99 and 1.9', () => {
    const above = sib(10, 2.5, 10.5, 2.5); // 10.5 - 13
    const below = (sill: number) => ({ sill, height: 2.5 });
    expect(wallSpotOk(11.25, 2.5, 40, [above], below(6))).toBe(true); // top 8.5: 2 ft under
    expect(wallSpotOk(11.25, 2.5, 40, [above], below(6.1))).toBe(false); // 1.9 ft
    expect(wallSpotOk(11.25, 2.5, 40, [above], below(6.01))).toBe(false); // 1.99 ft
    expect(wallSpotOk(11.25, 2.5, 40, [above])).toBe(false); // no heights: the old rule
  });
  it('a drag onto a spot under another opening is NOT pushed sideways (clampWallCenter)', () => {
    const above = sib(10, 2.5, 10.5, 2.5);
    const self = { sill: 4.1667, height: 2.5 };
    expect(clampWallCenter(11.25, 2.5, 40, [above], 30, self)).toBeCloseTo(11.25, 6);
    expect(Math.abs(clampWallCenter(11.25, 2.5, 40, [above], 30) - 11.25)).toBeGreaterThan(0.5); // old callers: moved out
    const near = { sill: 6.1, height: 2.5 }; // 1.9 ft under: pushed out sideways as before
    const c3 = clampWallCenter(11.25, 2.5, 40, [above], 30, near);
    expect(Math.abs(c3 - 11.25)).toBeGreaterThan(0.5);
    expect(wallSpotOk(c3, 2.5, 40, [above], near)).toBe(true);
  });
  it('view-only Auto spread (autoSpread): a stacked Auto window is left where the program put it', () => {
    const items = [
      { offset: 11.25, width: 2.5, group: 'a', movable: false, sill: 10.5, height: 2.5 },
      { offset: 11.25, width: 2.5, group: 'b', movable: true, sill: 50 / 12, height: 2.5 },
    ];
    expect(spreadAutoOverlaps(items, 40)).toEqual([11.25, 11.25]);
    const clash = [items[0], { ...items[1], sill: 7, height: 2.5 }]; // 1 ft under: a clash -> moved
    expect(spreadAutoOverlaps(clash, 40)[1]).not.toBe(11.25);
    const noH = items.map(({ sill: _s, height: _h, ...r }) => r); // old callers: the old rule
    expect(spreadAutoOverlaps(noH, 40)[1]).not.toBe(11.25);
  });
});

describe('owner 10/20/26 — a custom frame-out with a blank size keeps its layout footprint but is never refused / flagged for room', () => {
  const F = new Function(
    `${programFn('foSillFt')}
     ${programFn('foCustomFeet')}
     ${HTML.slice(HTML.indexOf('function ovlFoDims('), HTML.indexOf('// One main-building entry (.re/.we/.ne/.ace)'))} // (a regex with a quote in it defeats programFn)
     return { ovlFoDims: ovlFoDims, foCustomFeet: foCustomFeet };`,
  )() as {
    ovlFoDims: (el: unknown, comp: string) => { w: number; h: number; yo: number; nf: boolean } | null;
    foCustomFeet: (el: unknown) => { w: number; h: number };
  };
  const entry = (v: Record<string, string>) => ({ querySelector: (s: string) => (s.startsWith('.') && v[s.slice(1)] !== undefined ? { value: v[s.slice(1)] } : null) });
  const WIN = 'Framed Opening — Window (Custom Size)';
  const DOOR = 'Framed Opening — Custom Frame Out (Custom Size)';
  it('blank width or height: the 10x8 default footprint stays for the layout (as ever) but nf says it is never refused / flagged', () => {
    for (const [cw, ch] of [['', ''], ['4', ''], ['', '5']]) {
      const d = F.ovlFoDims(entry({ 'fo-cw': cw, 'fo-ch': ch, 'fo-unit': 'ft', 'fo-sill': '4.17' }), WIN)!;
      expect(d.nf).toBe(true);
      expect({ w: d.w, h: d.h }).toEqual(F.foCustomFeet(entry({ 'fo-cw': cw, 'fo-ch': ch, 'fo-unit': 'ft' })));
    }
    expect(F.foCustomFeet(entry({ 'fo-cw': '', 'fo-ch': '', 'fo-unit': 'ft' }))).toEqual({ w: 10, h: 8 });
  });
  it('entered size + entered sill are used as typed (inches too); window-type frames sit raised', () => {
    expect(F.ovlFoDims(entry({ 'fo-cw': '3', 'fo-ch': '3', 'fo-unit': 'ft', 'fo-sill': '6' }), WIN)).toEqual({ w: 3, h: 3, yo: 6, nf: false });
    expect(F.ovlFoDims(entry({ 'fo-cw': '36', 'fo-ch': '36', 'fo-unit': 'in', 'fo-sill': '4.17' }), WIN)).toEqual({ w: 3, h: 3, yo: 4.17, nf: false });
    expect(F.ovlFoDims(entry({ 'fo-cw': '10', 'fo-ch': '8', 'fo-unit': 'ft', 'fo-sill': '6' }), DOOR)).toEqual({ w: 10, h: 8, yo: 0, nf: false });
  });
  it('under two high windows with >= 2 ft clear it is accepted; closer is blocked', () => {
    const d = F.ovlFoDims(entry({ 'fo-cw': '3', 'fo-ch': '3', 'fo-unit': 'ft', 'fo-sill': '4.17' }), WIN)!;
    const hi = [{ x: 5, w: 2.5, y: 10.5, h: 2.5 }, { x: 15, w: 2.5, y: 10.5, h: 2.5 }];
    expect(P.ovlIssues(24, [...hi, { x: 5, w: d.w, y: d.yo, h: d.h }])).toEqual([]); // top 7.17, 3.33 ft clear
    expect(P.ovlIssues(24, [...hi, { x: 5, w: 3, y: 4.5, h: 3 }]).length).toBe(0); // top 7.5: exactly 3 ft
    expect(P.ovlIssues(24, [...hi, { x: 5, w: 3, y: 5.6, h: 3 }]).some((i) => i.k === 'pair')).toBe(true); // 1.9 ft
  });
});
