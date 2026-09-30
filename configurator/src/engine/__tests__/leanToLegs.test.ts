import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';

const eaveLeanTo = (openings: unknown[]) =>
  deriveStructure(
    resolveBuilding({
      ...DEFAULT_CONFIG,
      buildingType: 'garage',
      width: 30,
      length: 50,
      legHeight: 12,
      openings,
      leanTos: [
        {
          id: 'lt1',
          type: 'attached',
          attachedSide: 'Left Eave',
          widthFt: 12,
          lengthFt: 50,
          lowLegHeightFt: 9,
          roofPitch: '2:12',
          openings: [],
        },
      ],
    } as never),
  );

const outerLegs = (s: ReturnType<typeof deriveStructure>) => {
  const halfW = s.width / 2;
  return s.members.filter(
    (m) =>
      m.kind === 'leg' &&
      Math.abs(m.start[0] - (halfW + 12)) < 0.1 &&
      Math.abs(m.end[0] - (halfW + 12)) < 0.1,
  );
};

// The program's 'Left Eave' lean-to attaches to the 3D's +X wall, which the 3D
// calls side 'right' (BuildHost SIDE_MAP swaps Left Eave -> 'right').
const SAME_SIDE = 'right';

// Three big frame-outs on the main wall the lean-to attaches to. Offsets run
// from the building front (z = -L/2), so they cover z in [-22,-12], [-5,5] and
// [12,22] on a 50' building.
const sameSideFrameOuts = [
  { id: 'fo1', type: 'frameOut', side: SAME_SIDE, offset: 8, width: 10, height: 10, sillHeight: 0, customerSupplied: true },
  { id: 'fo2', type: 'frameOut', side: SAME_SIDE, offset: 25, width: 10, height: 10, sillHeight: 0, customerSupplied: true },
  { id: 'fo3', type: 'frameOut', side: SAME_SIDE, offset: 42, width: 10, height: 10, sillHeight: 0, customerSupplied: true },
];

describe('lean-to legs', () => {
  it('eave lean-to emits outer posts', () => {
    const s = eaveLeanTo([]);
    expect(s.leanTos.length).toBe(1);
    expect(outerLegs(s).length).toBeGreaterThan(0);
  });

  it("a 'Left Eave' lean-to stands on the +X side (3D side 'right')", () => {
    const s = eaveLeanTo([]);
    expect(s.leanTos[0].outer.x).toBeCloseTo(s.width / 2 + 12, 3);
  });

  // Regression: "the legs on the lean-to are not showing" — the eave-opening
  // clip band (widened for deep double/ladder columns) had no OUTER bound, so
  // framed openings on the main wall erased the lean-to posts standing 12'
  // beyond it. Openings clip the wall's own columns, never the lean-to's.
  // The openings MUST be on the same side as the lean-to (+X = 'right'), or
  // the test passes whether or not the bound exists.
  it('main-wall framed openings on the SAME side do NOT erase lean-to outer posts', () => {
    const bare = eaveLeanTo([]);
    const withOpenings = eaveLeanTo(sameSideFrameOuts);
    expect(outerLegs(withOpenings).length).toBe(outerLegs(bare).length);
  });

  // Proves the test above really covers the same-side case: the openings DO
  // cut the main building's own +X columns, and several lean-to outer posts
  // stand inside the openings' Z bands (an unbounded clip band would erase them).
  it('sanity: the same openings cut the +X main columns and overlap the lean-to posts in Z', () => {
    const s = eaveLeanTo(sameSideFrameOuts);
    const halfW = s.width / 2;
    const halfL = s.length / 2;
    const cutMainCols = s.members.filter(
      (m) =>
        m.kind === 'leg' &&
        Math.abs(m.start[0] - halfW) < 0.1 &&
        Math.abs(m.end[0] - halfW) < 0.1 &&
        Math.min(m.start[1], m.end[1]) >= 10 - 0.01, // starts at the top of a 10' frame-out
    );
    expect(cutMainCols.length).toBeGreaterThan(0);

    const bands = sameSideFrameOuts.map((o) => [-halfL + o.offset - o.width / 2, -halfL + o.offset + o.width / 2]);
    const postsInBands = outerLegs(s).filter((m) => bands.some(([lo, hi]) => m.start[2] >= lo && m.start[2] <= hi));
    expect(postsInBands.length).toBeGreaterThan(0);
  });
});
