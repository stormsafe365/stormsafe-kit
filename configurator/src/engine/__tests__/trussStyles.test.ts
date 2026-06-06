import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';

const build = (over: Partial<typeof DEFAULT_CONFIG>) =>
  deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', openings: [], ...over }));

const legCount = (s: ReturnType<typeof deriveStructure>) => s.members.filter((m) => m.kind === 'leg').length;

/**
 * Leg/truss style auto-derives from size (mirrors the program's badges):
 *   single (default) · double trusses (W>31 or H 14/15) · ladder legs (H>=16).
 * Legs per bent: single = 2 (one post per side); each doubling of trusses ×2;
 * ladder makes each post a 2-post ladder (×2 again).
 */
describe('truss/leg styles by size', () => {
  it('SINGLE: small build → 2 legs per bent (one post each side)', () => {
    const s = build({ width: 24, length: 30, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 2);
  });

  it('DOUBLE: width > 31 → paired trusses, 4 legs per bent, offset in Z', () => {
    const s = build({ width: 40, length: 40, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 4);
    // each frame position should have legs offset both sides of it (±0.6)
    const z0 = s.framePositionsZ[1];
    const leftLegZs = s.members
      .filter((m) => m.kind === 'leg' && Math.abs(m.start[0] - -s.width / 2) < 0.01 && Math.abs(m.start[2] - z0) < 1)
      .map((m) => m.start[2]);
    expect(leftLegZs.some((z) => z < z0 - 0.2)).toBe(true);
    expect(leftLegZs.some((z) => z > z0 + 0.2)).toBe(true);
  });

  it('DOUBLE: height 14 → double posts (even on a narrow build)', () => {
    const s = build({ width: 24, length: 30, legHeight: 14 });
    expect(legCount(s)).toBe(s.frameCount * 4);
  });

  it('LADDER: height >= 16 → each post becomes a 2-post ladder (4 legs/bent) with rungs', () => {
    const s = build({ width: 24, length: 30, legHeight: 18 });
    expect(legCount(s)).toBe(s.frameCount * 4); // 2 sides × 2 ladder posts
    // ladder rungs are horizontal braces spanning the small Z gap at one X
    const halfW = s.width / 2;
    const rungs = s.members.filter(
      (m) =>
        m.kind === 'brace' &&
        Math.abs(m.start[1] - m.end[1]) < 0.01 && // horizontal
        Math.abs(m.start[0] - -halfW) < 0.01 &&
        Math.abs(m.end[0] - -halfW) < 0.01 && // both ends at the eave X
        Math.abs(m.start[2] - m.end[2]) > 0.1, // spans the ladder gap in Z
    );
    expect(rungs.length).toBeGreaterThan(0);
  });

  it('DOUBLE + LADDER: tall AND wide → ladder legs take precedence (4 legs/bent)', () => {
    const s = build({ width: 40, length: 40, legHeight: 18 });
    expect(legCount(s)).toBe(s.frameCount * 4); // ladder (2 posts/side); not stacked with double-post
  });

  it('the frame stays within the building width (never wider than the roof)', () => {
    const s = build({ width: 40, length: 40, legHeight: 12 });
    const halfW = s.width / 2;
    for (const m of s.members) {
      expect(Math.abs(m.start[0])).toBeLessThanOrEqual(halfW + 0.01);
      expect(Math.abs(m.end[0])).toBeLessThanOrEqual(halfW + 0.01);
    }
  });

  it('double trusses also double the eave base rails', () => {
    const single = build({ width: 24, length: 30, legHeight: 12 });
    const dbl = build({ width: 40, length: 40, legHeight: 12 });
    const eaveRails = (s: ReturnType<typeof deriveStructure>) =>
      s.members.filter((m) => m.kind === 'baseRail' && m.start[0] === m.end[0]); // eave rails span Z at fixed X
    expect(eaveRails(dbl).length).toBeGreaterThan(eaveRails(single).length);
  });
});
