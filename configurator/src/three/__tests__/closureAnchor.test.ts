import { describe, expect, it } from 'vitest';
import { eaveDownBand } from '../Siding';
import { sideWallPolys } from '../LeanToSiding';

/**
 * Sidewall closures must sheet from the EAVE downward (never the ground up), and
 * the geometry must EXACTLY reflect the selected option:
 *   1 Panel (3') / 2 (6') / 3 (9')  → that many feet down from the eave
 *   1/4, 1/2, 3/4 Closed            → 25 / 50 / 75 % of wall height, from the top
 *   Closed                          → full wall
 * A panel taller than the wall clamps to full height (no overshoot past the eave).
 */
describe('eaveDownBand — main building (carport / GCH open extension)', () => {
  it('1 Panel (3 ft) on a 12 ft wall → top 3 ft sheeted, bottom 9 ft open', () => {
    const b = eaveDownBand(12, 3);
    expect(b.top).toBe(12); // always anchored at the eave
    expect(b.bottom).toBe(9); // open below this line
    expect(b.height).toBe(3);
    expect(b.centerY).toBe(10.5);
  });

  it('1/2 Closed (6 ft) on a 12 ft wall → exact top half', () => {
    const b = eaveDownBand(12, 6);
    expect(b.top).toBe(12);
    expect(b.bottom).toBe(6);
    expect(b.height).toBe(6);
  });

  it('3/4 Closed (9 ft) on a 12 ft wall → top 75%', () => {
    expect(eaveDownBand(12, 9).bottom).toBe(3);
  });

  it('Closed → full wall, eave to ground', () => {
    const b = eaveDownBand(12, 12);
    expect(b.bottom).toBe(0);
    expect(b.height).toBe(12);
  });

  it('panel taller than the wall clamps to full height — never overshoots the eave', () => {
    const b = eaveDownBand(9, 10.5); // "3 1/2 Panels" on a 9 ft wall
    expect(b.height).toBe(9);
    expect(b.bottom).toBe(0);
    expect(b.top).toBe(9);
  });

  it('Open (0) → no band', () => {
    expect(eaveDownBand(12, 0).height).toBe(0);
  });

  it('the band is ALWAYS anchored at the eave for every closure value', () => {
    for (const bh of [1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12]) {
      expect(eaveDownBand(12, bh).top).toBe(12);
    }
  });
});

describe('sideWallPolys — lean-to sidewall hangs from the eave (low-leg top)', () => {
  const geo = { wall: { axis: 'z' as const, plane: 5, a: 0, b: 20 } };
  const yRange = (side: string, lh: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const polys = sideWallPolys(geo as any, side, lh);
    const ys = polys.flatMap((p) => p.corners.map((c) => c[1]));
    return { min: Math.min(...ys), max: Math.max(...ys) };
  };

  it('q2 (1/2 Closed) on a 10 ft wall → top half [5, 10]', () => {
    expect(yRange('q2', 10)).toEqual({ min: 5, max: 10 });
  });

  it('1panel on a 10 ft wall → top 3 ft [7, 10] (NOT a length-shortened strip)', () => {
    expect(yRange('1panel', 10)).toEqual({ min: 7, max: 10 });
  });

  it('q1 / q3 → top 25% / 75%', () => {
    expect(yRange('q1', 10)).toEqual({ min: 7.5, max: 10 });
    expect(yRange('q3', 10)).toEqual({ min: 2.5, max: 10 });
  });

  it('closed → full wall [0, lh]', () => {
    expect(yRange('closed', 10)).toEqual({ min: 0, max: 10 });
  });

  it('panel taller than the wall clamps to full height', () => {
    expect(yRange('3panel', 2)).toEqual({ min: 0, max: 2 });
  });

  it('every partial closure stays anchored at the eave (top === lh)', () => {
    for (const side of ['q1', 'q2', 'q3', '1panel', '2panel', '3panel', 'closed']) {
      expect(yRange(side, 10).max).toBe(10);
    }
  });
});
