import { describe, expect, it } from 'vitest';
import { stripsAround, type LocalRect } from '../Siding';

/** Total area of a set of rects. */
const area = (rs: LocalRect[]) => rs.reduce((a, r) => a + r.w * r.h, 0);

/** Do two centered rects overlap (with a small tolerance)? */
function overlaps(a: LocalRect, b: LocalRect): boolean {
  const dx = Math.abs(a.u - b.u);
  const dy = Math.abs(a.v - b.v);
  return dx < (a.w + b.w) / 2 - 0.02 && dy < (a.h + b.h) / 2 - 0.02;
}

describe('stripsAround (wall cut into strips around openings)', () => {
  it('no holes → one full panel', () => {
    const s = stripsAround(40, 12, []);
    expect(s.length).toBe(1);
    expect(area(s)).toBeCloseTo(40 * 12, 3);
  });

  it('one centered floor opening → strips cover wall MINUS the hole, and none overlap it', () => {
    const hole: LocalRect = { u: 0, v: -12 / 2 + 8 / 2, w: 10, h: 8 }; // 10×8 on the floor, centered
    const strips = stripsAround(40, 12, [hole]);
    // total strip area = wall area - hole area
    expect(area(strips)).toBeCloseTo(40 * 12 - 10 * 8, 1);
    // no strip overlaps the hole (it's a real gap)
    for (const st of strips) expect(overlaps(st, hole)).toBe(false);
    // left + right full-height columns + a strip above the hole (no below: it's on the floor)
    expect(strips.length).toBeGreaterThanOrEqual(3);
  });

  it('two openings → wall area minus both holes, none overlapping either', () => {
    const a: LocalRect = { u: -10, v: -2, w: 6, h: 7 };
    const b: LocalRect = { u: 12, v: -2, w: 4, h: 7 };
    const strips = stripsAround(40, 12, [a, b]);
    expect(area(strips)).toBeCloseTo(40 * 12 - 6 * 7 - 4 * 7, 1);
    for (const st of strips) {
      expect(overlaps(st, a)).toBe(false);
      expect(overlaps(st, b)).toBe(false);
    }
  });

  it('ignores a hole entirely outside the wall (e.g. opening on the open carport bay)', () => {
    const outside: LocalRect = { u: 60, v: 0, w: 10, h: 8 }; // way past the wall's right edge
    const strips = stripsAround(40, 12, [outside]);
    expect(strips.length).toBe(1);
    expect(area(strips)).toBeCloseTo(40 * 12, 3);
  });
});
