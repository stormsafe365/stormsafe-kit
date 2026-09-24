import { describe, expect, it } from 'vitest';
import { rendersLeanToFixture } from '../leanToFixtures';
import type { LeanToOpening } from '@/types/building';

// Lean-to walls take a narrower set than the main building (no 'garageDoor' —
// a garage-door frame-out is a frameOut with garage-door pricing).
type LTType = LeanToOpening['type'];

const op = (type: LTType, wall: LeanToOpening['wall']) => ({ type, wall });
const walls = (side: string, front = 'open', back = 'open') => ({ side, front, back });

describe('lean-to fixture visibility', () => {
  // THE REGRESSION. A frame-out is bare framing and the opening cut removes the
  // outer post inside it regardless of wall closure — so hiding the frame on an
  // open wall leaves an empty bay with a missing post. Do not re-gate this on
  // sheeting. See leanToFixtures.ts.
  it('renders a frame-out on an OPEN outer side wall', () => {
    expect(rendersLeanToFixture(op('frameOut', 'outer'), walls('open'))).toBe(true);
  });

  it('renders a frame-out on an open gable end too (same rule, both ends)', () => {
    expect(rendersLeanToFixture(op('frameOut', 'front'), walls('open', 'open'))).toBe(true);
    expect(rendersLeanToFixture(op('frameOut', 'back'), walls('open', 'open', 'halfEnd'))).toBe(true);
  });

  it('still hides sheeting-dependent fixtures on a fully open wall', () => {
    for (const t of ['rollUpDoor', 'walkDoor', 'window'] as LTType[]) {
      expect(rendersLeanToFixture(op(t, 'outer'), walls('open'))).toBe(false);
    }
  });

  it('renders every fixture type on a closed outer wall', () => {
    for (const t of ['rollUpDoor', 'walkDoor', 'window', 'frameOut'] as LTType[]) {
      expect(rendersLeanToFixture(op(t, 'outer'), walls('closed'))).toBe(true);
    }
  });

  it('renders doors on PARTIAL outer closures — the band cuts around them', () => {
    for (const side of ['q1', 'q2', 'q3', '1panel', '2panel', '3panel']) {
      expect(rendersLeanToFixture(op('rollUpDoor', 'outer'), walls(side))).toBe(true);
    }
  });

  it('gable-end doors need a fully closed end', () => {
    expect(rendersLeanToFixture(op('walkDoor', 'front'), walls('open', 'closed'))).toBe(true);
    expect(rendersLeanToFixture(op('walkDoor', 'front'), walls('open', 'halfEnd'))).toBe(false);
    expect(rendersLeanToFixture(op('walkDoor', 'back'), walls('open', 'closed', 'open'))).toBe(false);
  });
});
