// V2 round 2: "How many" stops at how many really fit (the page's own fit rules: 1′ from each corner,
// 1′ between openings - OPENING_CORNER_CLEAR_FT / OPENING_GAP_FT - and the garage-door height rule).
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN, type WebDesign, type WebLeanTo, type WebOpening } from '../src/model/design';
import { maxQty, spreadPositions } from '../src/model/addMany';
import { maxLeanToQty, spreadLeanTo } from '../src/model/leanToMany';
import { leanToSpotOk, mainSpotOk } from '../src/model/positions';
import { CORNER_CLEAR, GAP } from '../src/model/rules';
import { MAX_LEANTO_OPENINGS } from '../src/model/normalize';

const bare = (o: Partial<WebDesign> = {}): WebDesign => ({
  ...cloneDesign(DEFAULT_DESIGN),
  type: 'garage',
  width: 30,
  length: 40,
  height: 14,
  walls: { ...DEFAULT_DESIGN.walls, front: 'closed', back: 'closed', left: 'closed', right: 'closed' },
  openings: [],
  leanTos: [],
  ...o,
});
const lean = (o: Partial<WebLeanTo> = {}): WebLeanTo => ({
  id: 'lt1',
  side: 'Left Eave',
  width: 12,
  length: 40,
  start: 0,
  lowLeg: 8,
  pitch: '2:12',
  enclosure: 'enclosed',
  walls: { front: 'closed', back: 'closed', side: 'closed' },
  openings: [],
  ...o,
});
/** n openings w wide fit on a wall `len` long when 1′ + n·w + (n−1)·1′ + 1′ ≤ len. */
const byRule = (len: number, w: number) => Math.floor((len - 2 * CORNER_CLEAR + GAP) / (w + GAP));

describe('the numbers the page uses', () => {
  it('1′ from each corner, 1′ between openings', () => {
    expect(CORNER_CLEAR).toBe(1);
    expect(GAP).toBe(1);
  });
});

describe('main walls: max that fit', () => {
  it.each([
    ['front', 'rollup', 10, 10, 2], // 30′ end: 1 + 10 + 1 + 10 + 1 = 23; a 3rd needs 34′
    ['front', 'rollup', 8, 7, 3], // 1 + 3·8 + 2 + 1 = 28 ≤ 30
    ['left', 'rollup', 10, 10, 3], // 40′ side, doors ≤ 12′ tall
    ['left', 'walk', 3, 80 / 12, 9], // 40′: 1 + 9·3 + 8 + 1 = 37; 10 would be 41
    ['left', 'window', 2.5, 2.5, 11], // 40′: 1 + 11·2.5 + 10 + 1 = 39.5
    ['front', 'frame', 4, 7, 5], // 30′: 1 + 5·4 + 4 + 1 = 26; 6 would be 31
  ] as const)('%s wall, %s %s′ wide: %i', (wall, kind, w, h, n) => {
    const d = bare();
    expect(maxQty(d, wall, kind, w, h)).toBe(n);
    // and that is exactly the corner / gap arithmetic
    expect(Math.min(n, 12)).toBe(Math.min(byRule(wall === 'left' ? 40 : 30, w), 12));
    // the n spots are all legal
    const spots = spreadPositions(d, wall, w, n)!;
    const after = { ...d, openings: spots.map((pos, i) => ({ id: `n${i}`, kind, wall, w, h, sill: 0, pos }) as WebOpening) };
    for (const o of after.openings) expect(mainSpotOk(after, o)).toBe(true);
  });
  it('the garage-door height rule also caps the count (2+ on an end wall: ≤ wall height − 1′)', () => {
    expect(maxQty(bare({ height: 10 }), 'front', 'rollup', 8, 10)).toBe(1);
    expect(maxQty(bare({ height: 10 }), 'front', 'rollup', 8, 9)).toBe(3);
  });
  it('what is already there counts', () => {
    const d = bare({ openings: [{ id: 'o1', kind: 'rollup', wall: 'front', w: 12, h: 10, sill: 0, pos: 1, color: 'white' }] });
    expect(maxQty(d, 'front', 'walk', 3, 80 / 12)).toBe(4); // 30 − 1 − 12 − 1 = 16′ left: 4 doors (3 + 1 each) + the corner
  });
  it('never more than 12 in one add', () => {
    expect(maxQty(bare({ length: 120 }), 'left', 'window', 2.5, 2.5)).toBe(12);
  });
});

describe('lean-to walls: max that fit', () => {
  it.each([
    ['outer', 3, 9], // 40′ outer wall, walk-in doors
    ['front', 3, 2], // 12′ end: 1 + 3 + 1 + 3 + 1 = 9; 3 would be 13
    ['front', 2.5, 3], // 12′ end, windows: 1 + 3·2.5 + 2 + 1 = 11.5
    ['front', 4, 2], // 12′ end, 4′ openings: 1 + 4 + 1 + 4 + 1 = 11
  ] as const)('%s wall, %s′ wide: %i', (wall, w, n) => {
    const d = bare();
    const lt = lean();
    expect(maxLeanToQty(d, lt, wall, w)).toBe(n);
    const spots = spreadLeanTo(d, lt, wall, w, n)!;
    const after = { ...lt, openings: spots.map((pos, i) => ({ id: `n${i}`, kind: 'frame', wall, w, h: 6, sill: 0, pos }) as WebLeanTo['openings'][number]) };
    for (const o of after.openings) expect(leanToSpotOk(d, after, o)).toBe(true);
    expect(spreadLeanTo(d, lt, wall, w, n + 1)).toBe(null);
  });
  it('the per-lean-to limit (12) caps it', () => {
    const d = bare({ length: 100 });
    expect(maxLeanToQty(d, lean({ length: 100 }), 'outer', 2.5)).toBe(MAX_LEANTO_OPENINGS);
  });
  it('an empty wall: equal gaps at both ends and between', () => {
    const spots = spreadLeanTo(bare(), lean(), 'front', 2.5, 3)!;
    const gaps = [spots[0], spots[1] - spots[0] - 2.5, spots[2] - spots[1] - 2.5, 12 - spots[2] - 2.5];
    for (const g of gaps) expect(Math.abs(g - 1.125)).toBeLessThan(0.07);
  });
});
