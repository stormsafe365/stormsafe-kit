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

describe('lean-to legs', () => {
  it('eave lean-to emits outer posts', () => {
    const s = eaveLeanTo([]);
    expect(s.leanTos.length).toBe(1);
    expect(outerLegs(s).length).toBeGreaterThan(0);
  });

  // Regression: "the legs on the lean-to are not showing" — the eave-opening
  // clip band (widened for deep double/ladder columns) had no OUTER bound, so
  // framed openings on the main wall erased the lean-to posts standing 12'
  // beyond it. Openings clip the wall's own columns, never the lean-to's.
  it('main-wall framed openings do NOT erase lean-to outer posts', () => {
    const bare = eaveLeanTo([]);
    const withOpenings = eaveLeanTo([
      // Left side (= +X, same side the lean-to attaches) — 3 big frame-outs
      { id: 'fo1', type: 'frameOut', side: 'left', offset: 8, width: 10, height: 10, sillHeight: 0, customerSupplied: true },
      { id: 'fo2', type: 'frameOut', side: 'left', offset: 25, width: 10, height: 10, sillHeight: 0, customerSupplied: true },
      { id: 'fo3', type: 'frameOut', side: 'left', offset: 42, width: 10, height: 10, sillHeight: 0, customerSupplied: true },
    ]);
    expect(outerLegs(withOpenings).length).toBe(outerLegs(bare).length);
  });
});
