import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { LeanTo, LeanToOpening } from '@/types/building';

/**
 * Does any column (leg) / knee brace sit on the lean-to OUTER wall plane
 * (constant X = `outerX`) at run position Z≈`z`, spanning height `y`? This is the
 * lean-to analogue of eaveFrameSpansHeight — used to prove a lean-to frame-out
 * cuts the posts behind it so you see straight through.
 */
function outerFrameSpansHeight(
  members: ReturnType<typeof deriveStructure>['members'],
  outerX: number,
  z: number,
  y: number,
): boolean {
  return members.some((m) => {
    if (m.kind !== 'leg' && m.kind !== 'brace') return false;
    if (Math.abs(m.start[2] - z) > 0.1 || Math.abs(m.end[2] - z) > 0.1) return false;
    if (Math.abs(m.start[0] - outerX) > 0.1 && Math.abs(m.end[0] - outerX) > 0.1) return false;
    const ylo = Math.min(m.start[1], m.end[1]);
    const yhi = Math.max(m.start[1], m.end[1]);
    return y > ylo + 0.05 && y < yhi - 0.05;
  });
}

function leanTo(openings: LeanToOpening[]): LeanTo {
  return {
    id: 'lt1',
    type: 'attached',
    attachedSide: 'Left Eave',
    widthFt: 12,
    lengthFt: 40,
    lowLegHeightFt: 10,
    roofPitch: '2:12',
    enclosure: 'enclosed',
    openings,
  };
}

describe('lean-to frame-out cuts the posts behind it (see-through)', () => {
  // 30×40×12 garage + a Left Eave lean-to (outer wall at x = +halfW + 12).
  const base = { ...DEFAULT_CONFIG, buildingType: 'garage' as const, width: 30, length: 40, legHeight: 12 };
  const halfW = 15;
  const outerX = halfW + 12; // = 27 — Left Eave is +X
  // spanStart = -halfL = -20; an outer frame-out centered at offset 20 → world Z = 0.
  const frameOut: LeanToOpening = {
    id: 'lt1:fo',
    type: 'frameOut',
    wall: 'outer',
    widthFt: 10,
    heightFt: 8,
    sillFt: 0,
    offsetFt: 20,
  };

  it('a bare lean-to has its outer post standing at the opening center', () => {
    const s = deriveStructure(resolveBuilding({ ...base, leanTos: [leanTo([])] }));
    // Outer post at z=0 spans mid-height (5') on the bare frame.
    expect(outerFrameSpansHeight(s.members, outerX, 0, 5)).toBe(true);
  });

  it('an outer frame-out removes the outer post inside it, keeps a header stub above', () => {
    const s = deriveStructure(resolveBuilding({ ...base, leanTos: [leanTo([frameOut])] }));
    // No post/brace inside the 8' opening at the center bent (mid-height).
    expect(outerFrameSpansHeight(s.members, outerX, 0, 4)).toBe(false);
    // A far bent the opening doesn't reach still has its post at mid-height.
    expect(outerFrameSpansHeight(s.members, outerX, -16, 5)).toBe(true);
    // Below the opening sill is 0, so nothing remains low; above 8' a stub of
    // the 10' post survives.
    expect(outerFrameSpansHeight(s.members, outerX, 0, 9)).toBe(true);
  });

  it('exposes post offsets (from spanStart) for the drag guides, incl. a post at the opening center', () => {
    const s = deriveStructure(resolveBuilding({ ...base, leanTos: [leanTo([frameOut])] }));
    const lt = s.leanTos[0];
    expect(lt.trussOffsets.length).toBeGreaterThan(2);
    // Corner posts at both ends of the 40' run.
    expect(lt.trussOffsets[0]).toBeCloseTo(0, 3);
    expect(lt.trussOffsets[lt.trussOffsets.length - 1]).toBeCloseTo(40, 3);
    // The frame-out centered at offset 20 lands on a post → collision guide fires.
    expect(lt.trussOffsets.some((p) => Math.abs(p - 20) < 0.01)).toBe(true);
  });

  it('a raised-sill opening keeps the post stub below the sill', () => {
    const high: LeanToOpening = { ...frameOut, sillFt: 3, heightFt: 4 }; // band [3,7]
    const s = deriveStructure(resolveBuilding({ ...base, leanTos: [leanTo([high])] }));
    // Inside the band → cut.
    expect(outerFrameSpansHeight(s.members, outerX, 0, 5)).toBe(false);
    // Below the 3' sill → post stub remains.
    expect(outerFrameSpansHeight(s.members, outerX, 0, 1.5)).toBe(true);
    // Above the 7' head → post stub remains.
    expect(outerFrameSpansHeight(s.members, outerX, 0, 8.5)).toBe(true);
  });
});
