import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { spreadAutoOverlaps, type SpreadItem } from '../autoSpread';

/**
 * VIEW-ONLY de-overlap of auto-placed openings (combined copy 10/2: a roll-up
 * and a walk door added to one wall without typed positions were drawn one
 * inside the other, both at the wall's centre).
 */
const A = { row: 'A' };
const B = { row: 'B' };
const C = { row: 'C' };
const it_ = (offset: number, width: number, group: unknown, movable = true): SpreadItem => ({ offset, width, group, movable });
const edges = (offs: number[], items: SpreadItem[]) => offs.map((c, i) => [c - items[i].width / 2, c + items[i].width / 2]);
const minGap = (offs: number[], items: SpreadItem[]) => {
  const e = edges(offs, items).sort((a, b) => a[0] - b[0]);
  let g = Infinity;
  for (let i = 1; i < e.length; i++) g = Math.min(g, e[i][0] - e[i - 1][1]);
  return g;
};

describe('spreadAutoOverlaps', () => {
  it('owner case: 6x6 roll-up + walk door, both auto on a 24 ft back gable — the later row moves next to the first, 1 ft clear', () => {
    const items = [it_(12, 6, A), it_(12, 3, B)];
    const offs = spreadAutoOverlaps(items, 24);
    expect(offs[0]).toBe(12); // the first row stays where the program put it
    expect(Math.abs(offs[1] - 12)).toBeCloseTo(5.5, 6); // nearest free spot: 1 ft off the roll-up
    expect(minGap(offs, items)).toBeGreaterThanOrEqual(1 - 1e-9);
    for (const [l, r] of edges(offs, items)) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(24);
    }
  });

  it('26 ft storage wall: 10x10 roll-up + walk door both at 13 → walk door beside the roll-up', () => {
    const items = [it_(13, 10, A), it_(13, 3, B)];
    const offs = spreadAutoOverlaps(items, 26);
    expect(offs[0]).toBe(13);
    expect([5.5, 20.5]).toContain(offs[1]);
    expect(minGap(offs, items)).toBeCloseTo(1, 6);
  });

  it('nothing moves when nothing overlaps (or when nothing is movable)', () => {
    const items = [it_(5, 3, A), it_(15, 6, B)];
    expect(spreadAutoOverlaps(items, 24)).toEqual([5, 15]);
    const fixed = [it_(12, 6, A, false), it_(12, 3, B, false)];
    expect(spreadAutoOverlaps(fixed, 24)).toEqual([12, 12]);
    expect(spreadAutoOverlaps([it_(12, 3, A)], 24)).toEqual([12]);
  });

  it('a typed / priced (fixed) item never moves — the auto one goes around it, even when listed first', () => {
    const items = [it_(12, 10, A, true), it_(12, 3, B, false)];
    const offs = spreadAutoOverlaps(items, 40);
    expect(offs[1]).toBe(12);
    expect(offs[0]).not.toBe(12);
    expect(minGap(offs, items)).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it("one row's own items are never pushed apart (the program spaces them); another row still avoids them", () => {
    // row A: 2 windows the program spaced 0.5 ft apart; row B: a walk door on top of the first one
    const items = [it_(10, 2.5, A), it_(13, 2.5, A), it_(10, 3, B)];
    const offs = spreadAutoOverlaps(items, 40);
    expect(offs[0]).toBe(10);
    expect(offs[1]).toBe(13);
    const door = [offs[2] - 1.5, offs[2] + 1.5];
    for (const c of [offs[0], offs[1]]) expect(door[1] <= c - 1.25 - 1 + 1e-9 || door[0] >= c + 1.25 + 1 - 1e-9).toBe(true);
  });

  it('three rows on one wall: each later one finds its own free spot', () => {
    const items = [it_(15, 10, A), it_(15, 3, B), it_(15, 3, C)];
    const offs = spreadAutoOverlaps(items, 30);
    expect(minGap(offs, items)).toBeGreaterThanOrEqual(1 - 1e-9);
    for (const [l, r] of edges(offs, items)) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(30);
    }
  });

  it('no room anywhere: the item stays where the program put it', () => {
    const items = [it_(6, 10, A), it_(6, 3, B)];
    expect(spreadAutoOverlaps(items, 12)).toEqual([6, 6]);
  });

  it('uses the wall ends when the 1 ft end margin does not fit', () => {
    // 12 ft wall, 8 ft roll-up at 6 (2..10): a 1 ft door fits only hard against an end (0..1 / 11..12)
    const items = [it_(6, 8, A), it_(6, 1, B)];
    const offs = spreadAutoOverlaps(items, 12);
    expect([0.5, 11.5]).toContain(offs[1]);
  });
});

describe('BuildHost wiring (source check)', () => {
  const src = readFileSync(fileURLToPath(new URL('../../build/BuildHost.tsx', import.meta.url)), 'utf8');
  it('readOpenings spreads auto-placed items, keeping eave walk doors / windows / framed openings (side-frame priced) fixed', () => {
    expect(src).toMatch(/spreadAutoPlaced\(out, faceOf, autoOf\);\s*return out;/);
    expect(src).toMatch(/movable: !!autoOf\.get\(d\) && !\(eave && \(d\.type === 'walkDoor' \|\| d\.type === 'window' \|\| d\.type === 'frameOut'\)\)/);
    // the program is only read: no position is written back by the spread
    const fn = src.slice(src.indexOf('function spreadAutoPlaced'), src.indexOf('function readOpenings'));
    expect(fn).not.toMatch(/\.value\s*=|rc\(\)|dispatchEvent/);
  });
});
