// Owner 10/20/26: openings clash only when they overlap BOTH sideways (1') AND up-and-down (2').
import { describe, expect, it } from 'vitest';
import { OPENING_VERT_GAP_FT } from '../../src/config/constants';
import { cloneDesign, DEFAULT_DESIGN, type WebDesign, type WebOpening } from '../src/model/design';
import { spreadPositions } from '../src/model/addMany';
import { fitMainPos, freeMainPos, mainSpotOk } from '../src/model/positions';
import { SPACING_RULE, VERT_GAP } from '../src/model/rules';

const SILL = 50 / 12;
const bare = (o: Partial<WebDesign> = {}): WebDesign => ({ ...cloneDesign(DEFAULT_DESIGN), openings: [], ...o });
const win = (id: string, pos: number, sill = SILL, wall: WebOpening['wall'] = 'back'): WebOpening => ({ id, kind: 'window', wall, w: 2.5, h: 2.5, sill, pos, style: 'std' });

describe('customer design page — stacked openings use the 2-D rule', () => {
  it('uses the one shared constant (2′)', () => {
    expect(VERT_GAP).toBe(OPENING_VERT_GAP_FT);
    expect(VERT_GAP).toBe(2);
    expect(SPACING_RULE).toMatch(/2′/);
  });

  it('a window straight under two high windows on a 14′ back gable is accepted; on top of one is flagged', () => {
    const d = bare({ width: 30, height: 14 });
    d.openings = [win('hi1', 10, 10.5), win('hi2', 14, 10.5)];
    const under = win('lo', 10, SILL); // top 6′8″, 3′10″ of wall below the high windows
    expect(mainSpotOk({ ...d, openings: [...d.openings, under] }, under)).toBe(true);
    const onTop = win('on', 10, 10.5);
    expect(mainSpotOk({ ...d, openings: [...d.openings, onTop] }, onTop)).toBe(false);
  });

  it('exact vertical boundary: 2′ of wall is fine, 1.99′ and 1.9′ are flagged', () => {
    const d = bare({ width: 30, height: 14 });
    const hi = win('hi', 10, 10.5);
    const at = (sill: number) => {
      const o = win('lo', 10, sill);
      return mainSpotOk({ ...d, openings: [hi, o] }, o);
    };
    expect(at(6)).toBe(true); // 6 + 2.5 = 8.5; 10.5 − 8.5 = 2′
    expect(at(6.01)).toBe(false); // 1.99′
    expect(at(6.1)).toBe(false); // 1.9′
  });

  it('sideways it is still 1′: beside a window at the same height needs the 1′', () => {
    const d = bare({ width: 30, height: 14 });
    const a = win('a', 10);
    const near = win('b', 13.4);
    expect(mainSpotOk({ ...d, openings: [a, near] }, near)).toBe(false);
    const ok = win('c', 13.5);
    expect(mainSpotOk({ ...d, openings: [a, ok] }, ok)).toBe(true);
  });

  it('fitMainPos / freeMainPos: a stacked part keeps its typed spot; without heights it is pushed aside as before', () => {
    const d = bare({ width: 30, height: 14 });
    d.openings = [win('hi', 10, 10.5)];
    expect(fitMainPos(d, 'back', 2.5, 10, null, { sill: SILL, h: 2.5 })).toBe(10);
    expect(fitMainPos(d, 'back', 2.5, 10, null)).not.toBe(10);
    expect(fitMainPos(d, 'back', 2.5, 10, null, { sill: 6.1, h: 2.5 })).not.toBe(10); // 1.9′ under
    expect(freeMainPos(d, 'back', 2.5, { sill: SILL, h: 2.5 })).toBe(13.75); // the middle of the wall is free for it
  });

  it('adding several: they may go under a window; each is checked against the ones before', () => {
    const d = bare({ width: 30, height: 14 });
    d.openings = [win('hi', 13.75, 10.5)];
    const spots = spreadPositions(d, 'back', 2.5, 2, { sill: SILL, h: 2.5 })!;
    expect(spots).toHaveLength(2);
    const after = { ...d, openings: [...d.openings, ...spots.map((p, i) => win(`n${i}`, p))] };
    for (const o of after.openings) expect(mainSpotOk(after, o)).toBe(true);
    // the old call (no heights) keeps every new one clear of the window sideways
    const old = spreadPositions(d, 'back', 2.5, 2)!;
    expect(old.every((p) => p + 2.5 <= 12.75 + 1e-6 || p >= 17.25 - 1e-6)).toBe(true);
  });
});
