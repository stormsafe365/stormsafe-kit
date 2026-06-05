import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure, subtractSpans } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { Opening } from '@/types/building';

/**
 * Does any member of `kind` on the wall fixed at perpendicular coord `perp`
 * cross the world point (axis value `p`) at height `y`? `axis` is the wall's
 * run direction ('x' = gable wall, 'z' = eave wall); the perpendicular coord is
 * pinned so a member on the OPPOSITE (uncut) wall doesn't count as a match.
 */
function memberCrosses(
  members: ReturnType<typeof deriveStructure>['members'],
  kind: string,
  axis: 'x' | 'z',
  p: number,
  y: number,
  perp: number,
): boolean {
  const ai = axis === 'x' ? 0 : 2; // run axis index
  const pi = axis === 'x' ? 2 : 0; // perpendicular axis index
  return members.some((m) => {
    if (m.kind !== kind) return false;
    if (Math.abs(m.start[1] - y) > 0.05 || Math.abs(m.end[1] - y) > 0.05) return false;
    if (Math.abs(m.start[pi] - perp) > 0.05 || Math.abs(m.end[pi] - perp) > 0.05) return false;
    const lo = Math.min(m.start[ai], m.end[ai]);
    const hi = Math.max(m.start[ai], m.end[ai]);
    return p > lo + 0.02 && p < hi - 0.02;
  });
}

function opening(o: Partial<Opening> & Pick<Opening, 'type' | 'side' | 'offset' | 'width' | 'height'>): Opening {
  return {
    id: `${o.side}-${o.offset}`,
    sillHeight: 0,
    customerSupplied: false,
    ...o,
  } as Opening;
}

describe('subtractSpans (cut a segment around gaps)', () => {
  it('no gaps → the whole segment survives', () => {
    expect(subtractSpans(-10, 10, [])).toEqual([[-10, 10]]);
  });

  it('one centered gap → two pieces, total length = span minus gap', () => {
    const segs = subtractSpans(0, 20, [[8, 12]]);
    expect(segs).toEqual([
      [0, 8],
      [12, 20],
    ]);
  });

  it('gap at the edge → single remaining piece', () => {
    expect(subtractSpans(0, 20, [[0, 5]])).toEqual([[5, 20]]);
  });

  it('gap fully covering the segment → nothing survives', () => {
    expect(subtractSpans(2, 8, [[0, 10]])).toEqual([]);
  });

  it('ignores a gap entirely outside the segment', () => {
    expect(subtractSpans(0, 10, [[20, 25]])).toEqual([[0, 10]]);
  });

  it('drops slivers shorter than 0.05 ft', () => {
    const segs = subtractSpans(0, 10, [[0.01, 9.99]]);
    expect(segs).toEqual([]); // both leftover pieces are < 0.05
  });
});

describe('frame members are cut around openings', () => {
  it('a floor roll-up door on the front gable cuts the girts AND base rail there', () => {
    const door = opening({ type: 'rollUpDoor', side: 'front', offset: 15, width: 10, height: 10 });
    const s = deriveStructure(
      resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', width: 30, length: 40, legHeight: 12, openings: [door] }),
    );
    const halfW = s.width / 2;
    const halfL = s.length / 2;
    // door center X on the front wall = -halfW + offset
    const cx = -halfW + 15;
    // No girt and no base rail on the FRONT wall (z = -halfL) should pass
    // through the door's centerline.
    expect(memberCrosses(s.members, 'baseRail', 'x', cx, 0, -halfL)).toBe(false);
    // a girt exists somewhere mid-height; none should cross the door span
    const girtYs = s.members.filter((m) => m.kind === 'girt' && Math.abs(m.start[2] - -halfL) < 0.01).map((m) => m.start[1]);
    for (const y of girtYs) expect(memberCrosses(s.members, 'girt', 'x', cx, y, -halfL)).toBe(false);
  });

  it('a window (raised sill) leaves the base rail intact but cuts the girt it crosses', () => {
    const win = opening({ type: 'window', side: 'left', offset: 10, width: 3, height: 3, sillHeight: 4 });
    const s = deriveStructure(
      resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', width: 30, length: 40, legHeight: 12, openings: [win] }),
    );
    const halfW = s.width / 2;
    const halfL = s.length / 2;
    const cz = -halfL + 10; // left eave: center Z = -halfL + offset
    // base rail at y=0 is BELOW the window sill (4ft) → must remain unbroken on
    // the left eave (x = -halfW)
    expect(memberCrosses(s.members, 'baseRail', 'z', cz, 0, -halfW)).toBe(true);
    // a girt at a height within [4, 7] must be cut; find one and verify
    const inWindow = s.members.filter(
      (m) => m.kind === 'girt' && Math.abs(m.start[0] - -halfW) < 0.01 && m.start[1] >= 4 && m.start[1] <= 7,
    );
    // if a girt row lands inside the window band, it must not cross the window
    for (const m of inWindow) expect(memberCrosses(s.members, 'girt', 'z', cz, m.start[1], -halfW)).toBe(false);
  });

  it('an opening away from a girt leaves other girt spans intact', () => {
    const door = opening({ type: 'rollUpDoor', side: 'front', offset: 8, width: 8, height: 8 });
    const s = deriveStructure(
      resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', width: 40, length: 40, legHeight: 12, openings: [door] }),
    );
    const halfW = s.width / 2;
    const halfL = s.length / 2;
    // far side of the wall, well clear of the door → a girt should still run there
    const farX = halfW - 4;
    const girtYs = s.members.filter((m) => m.kind === 'girt' && Math.abs(m.start[2] - -halfL) < 0.01).map((m) => m.start[1]);
    expect(girtYs.length).toBeGreaterThan(0);
    expect(memberCrosses(s.members, 'girt', 'x', farX, girtYs[0], -halfL)).toBe(true);
  });
});

/** Does any column (leg) or knee brace on the given eave span height `y` at Z≈`z`? */
function eaveFrameSpansHeight(
  members: ReturnType<typeof deriveStructure>['members'],
  halfW: number,
  side: 'left' | 'right',
  z: number,
  y: number,
): boolean {
  const wallX = side === 'left' ? -halfW : halfW;
  return members.some((m) => {
    if (m.kind !== 'leg' && m.kind !== 'brace') return false;
    if (Math.abs(m.start[2] - z) > 0.1 || Math.abs(m.end[2] - z) > 0.1) return false;
    if (Math.abs(m.start[0] - wallX) > 0.1 && Math.abs(m.end[0] - wallX) > 0.1) return false;
    const ylo = Math.min(m.start[1], m.end[1]);
    const yhi = Math.max(m.start[1], m.end[1]);
    return y > ylo + 0.05 && y < yhi - 0.05;
  });
}

describe('columns + knee braces are cut out of an eave opening (walk-through)', () => {
  const base = { ...DEFAULT_CONFIG, buildingType: 'garage' as const, width: 30, length: 50, legHeight: 14, openings: [] };

  it('a wide tall door over a bent removes the column/brace inside it, keeps the rest', () => {
    // First find an INTERIOR bent Z (not an end bent).
    const bare = deriveStructure(resolveBuilding(base));
    const halfL = bare.length / 2;
    const interior = bare.framePositionsZ.filter((z) => Math.abs(Math.abs(z) - halfL) > 0.5);
    expect(interior.length).toBeGreaterThan(0);
    const bentZ = interior[0];
    const offset = bentZ + halfL; // eave offset measured from front = -halfL
    const halfW = bare.width / 2;

    // Sanity: bare frame DOES span that bent at mid-height on the left eave.
    expect(eaveFrameSpansHeight(bare.members, halfW, 'left', bentZ, 7)).toBe(true);

    // Now a 16'×13' opening centered on that bent.
    const door = opening({ type: 'rollUpDoor', side: 'left', offset, width: 16, height: 13 });
    const s = deriveStructure(resolveBuilding({ ...base, openings: [door] }));

    // No column/brace inside the doorway (mid-height) on the LEFT eave at the bent.
    expect(eaveFrameSpansHeight(s.members, halfW, 'left', bentZ, 7)).toBe(false);
    // The RIGHT eave (no opening) still has its frame at that bent.
    expect(eaveFrameSpansHeight(s.members, halfW, 'right', bentZ, 7)).toBe(true);
    // Above the 13' opening, a stub of framing remains (header zone ~13.5').
    expect(eaveFrameSpansHeight(s.members, halfW, 'left', bentZ, 13.5)).toBe(true);
  });

  it('leaves an eave bent untouched when no opening reaches it', () => {
    const door = opening({ type: 'walkDoor', side: 'left', offset: 4, width: 3, height: 6.7 });
    const s = deriveStructure(resolveBuilding({ ...base, openings: [door] }));
    const halfL = s.length / 2;
    const halfW = s.width / 2;
    // a far bent the small door doesn't reach keeps its column at mid-height
    const farBent = s.framePositionsZ.find((z) => Math.abs(z - (-halfL + 4)) > 8);
    expect(farBent).toBeDefined();
    expect(eaveFrameSpansHeight(s.members, halfW, 'left', farBent!, 7)).toBe(true);
  });
});
