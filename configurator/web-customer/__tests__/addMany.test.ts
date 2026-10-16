// Quantity when adding doors / windows (owner 10/16/26: Josh tried two 10×10s on the front end).
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN, type WebDesign } from '../src/model/design';
import { maxQty, spreadPositions } from '../src/model/addMany';
import { mainSpotOk } from '../src/model/positions';

const bare = (o: Partial<WebDesign> = {}): WebDesign => ({ ...cloneDesign(DEFAULT_DESIGN), openings: [], ...o });

describe('add several at once', () => {
  it('two 10′ doors on a 24′ front end: spread evenly, both legal', () => {
    const d = bare({ width: 24, height: 11 });
    const spots = spreadPositions(d, 'front', 10, 2)!;
    expect(spots).toHaveLength(2);
    const doors = spots.map((pos, i) => ({ id: `n${i}`, kind: 'rollup' as const, wall: 'front' as const, w: 10, h: 10, sill: 0, pos }));
    const after = { ...d, openings: doors };
    for (const o of doors) expect(mainSpotOk(after, o)).toBe(true);
    expect(maxQty(d, 'front', 'rollup', 10, 10)).toBe(2); // a third 10′ door does not fit on 24′
  });
  it('the program rule: 2+ roll-ups on an end wall are at most 1′ shorter than the walls', () => {
    const d = bare({ width: 24, height: 10 });
    expect(maxQty(d, 'front', 'rollup', 10, 10)).toBe(1); // two 10×10s need 11′ walls
    expect(maxQty(d, 'front', 'rollup', 10, 9)).toBe(2);
  });
  it('a door already in the middle leaves no room for another 10′ door', () => {
    const d = cloneDesign(DEFAULT_DESIGN); // the starting design has a 10×8 roll-up on the front end
    d.height = 11;
    expect(maxQty(d, 'front', 'rollup', 10, 8)).toBe(0);
    expect(maxQty(d, 'front', 'rollup', 6, 8)).toBe(0); // 7′ each side minus 1′ clearances = 5′
  });
  it('windows along a 30′ side: as many as keep 1′ apart', () => {
    const d = bare({ length: 30 });
    const n = maxQty(d, 'left', 'window', 2.5, 2.5);
    expect(n).toBeGreaterThanOrEqual(8);
    const spots = spreadPositions(d, 'left', 2.5, n)!;
    expect(spots).toHaveLength(n);
    expect(spreadPositions(d, 'left', 2.5, n + 1)).toBe(null);
  });
});
