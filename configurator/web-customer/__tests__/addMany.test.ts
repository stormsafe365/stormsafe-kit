// Quantity when adding doors / windows (owner 10/16/26: Josh tried two 10×10s on the front end).
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN, type WebDesign, type WebOpening } from '../src/model/design';
import { maxQty, spreadPositions, whyNoMore } from '../src/model/addMany';
import { mainSpotOk } from '../src/model/positions';

const bare = (o: Partial<WebDesign> = {}): WebDesign => ({ ...cloneDesign(DEFAULT_DESIGN), openings: [], ...o });
const door = (id: string, wall: WebOpening['wall'], pos: number, w = 10, h = 10): WebOpening => ({ id, kind: 'rollup', wall, w, h, sill: 0, pos, color: 'white' });

describe('add several at once', () => {
  it('two 10′ doors on a 24′ front end: equal gaps, both legal', () => {
    const d = bare({ width: 24, height: 11 });
    const spots = spreadPositions(d, 'front', 10, 2)!;
    expect(spots).toHaveLength(2);
    // (24 − 20) / 3 = 1′4″ at each end and between (to the 1/8″)
    const gaps = [spots[0], spots[1] - (spots[0] + 10), 24 - (spots[1] + 10)];
    for (const g of gaps) expect(Math.abs(g - 4 / 3)).toBeLessThan(0.07);
    const after = { ...d, openings: spots.map((pos, i) => door(`n${i}`, 'front', pos)) };
    for (const o of after.openings) expect(mainSpotOk(after, o)).toBe(true);
    expect(maxQty(d, 'front', 'rollup', 10, 10)).toBe(2); // a third 10′ door does not fit on 24′
  });
  it('the program rule: 2+ roll-ups on an end wall are at most 1′ shorter than the walls', () => {
    const d = bare({ width: 24, height: 10 });
    expect(maxQty(d, 'front', 'rollup', 10, 10)).toBe(1); // two 10×10s need 11′ walls
    expect(maxQty(d, 'front', 'rollup', 10, 9)).toBe(2);
    expect(whyNoMore(d, 'front', 'rollup', 10, 10, 2)).toMatch(/up to 9′ tall/);
    expect(whyNoMore(d, 'front', 'rollup', 10, 9, 3)).toBe(null); // the 3rd is just space
  });
  it('a door already there is never shrunk by adding another: that count is not offered, and the reason is given', () => {
    const d = bare({ width: 30, height: 10, openings: [door('o1', 'front', 1, 10, 10)] });
    expect(maxQty(d, 'front', 'rollup', 8, 8)).toBe(0); // the 10′ tall door would have to become 9′
    expect(whyNoMore(d, 'front', 'rollup', 8, 8, 1)).toMatch(/already on this wall/);
    d.openings[0].h = 9;
    expect(maxQty(d, 'front', 'rollup', 8, 8)).toBe(2);
  });
  it('a door already in the middle leaves no room for another 10′ door', () => {
    const d = cloneDesign(DEFAULT_DESIGN); // the starting design has a 10×8 roll-up on the front end
    d.height = 11;
    expect(maxQty(d, 'front', 'rollup', 10, 8)).toBe(0);
  });
  it('windows along a 30′ side: as many as keep 1′ apart', () => {
    const d = bare({ length: 30 });
    const n = maxQty(d, 'left', 'window', 2.5, 2.5);
    expect(n).toBeGreaterThanOrEqual(8);
    expect(spreadPositions(d, 'left', 2.5, n)).toHaveLength(n);
    expect(spreadPositions(d, 'left', 2.5, n + 1)).toBe(null);
  });
  it('never past the 40 doors / windows a design can hold', () => {
    const d = bare({ length: 200 });
    d.openings = Array.from({ length: 39 }, (_, i) => ({ id: `w${i}`, kind: 'window' as const, wall: 'left' as const, w: 2.5, h: 2.5, sill: 50 / 12, pos: 1 + i * 4, style: 'std' }));
    expect(maxQty(d, 'right', 'window', 2.5, 2.5)).toBe(1);
    expect(whyNoMore(d, 'right', 'window', 2.5, 2.5, 2)).toMatch(/up to 40/);
  });
  it('Garage + Carport side: spread over the garage part, clear of the divider post', () => {
    const d = bare({ type: 'combo', width: 24, length: 40, enclosedLength: 24, height: 10, walls: { front: 'open', back: 'closed', left: 'open', right: 'open' } });
    const spots = spreadPositions(d, 'left', 3, 2);
    expect(spots).not.toBe(null);
    // the carport bay is the front 16′: every spot starts at least 1′ past it
    for (const p of spots!) expect(p).toBeGreaterThanOrEqual(17 - 1e-6);
  });
});
