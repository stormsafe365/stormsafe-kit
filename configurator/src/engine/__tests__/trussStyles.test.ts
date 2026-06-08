import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';

const build = (over: Partial<typeof DEFAULT_CONFIG>) =>
  deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', openings: [], ...over }));

const legCount = (s: ReturnType<typeof deriveStructure>) => s.members.filter((m) => m.kind === 'leg').length;

const ladderRungs = (s: ReturnType<typeof deriveStructure>) => {
  const halfW = s.width / 2;
  return s.members.filter(
    (m) =>
      m.kind === 'brace' &&
      Math.abs(m.start[1] - m.end[1]) < 0.01 && // horizontal
      Math.abs(m.start[0] - -halfW) < 0.01 &&
      Math.abs(m.end[0] - -halfW) < 0.01 && // both ends at the eave X
      Math.abs(m.start[2] - m.end[2]) > 0.1, // spans the ladder gap in Z
  );
};

/**
 * TEMP — truss styling (double posts / ladder legs) is disabled in geometry.ts
 * via SINGLE_TRUSS_ONLY, so every bent renders as a single post per side at any
 * size. When that flag is flipped back to false, restore the size-based
 * expectations: DOUBLE (W>31 or H 14/15) → 4 legs/bent, LADDER (H>=16) → 4
 * legs/bent + rungs, and double trusses double the eave base rails.
 */
describe('truss/leg styles — single-post only (SINGLE_TRUSS_ONLY)', () => {
  it('small build → 2 legs per bent (one post each side)', () => {
    const s = build({ width: 24, length: 30, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 2);
  });

  it('wide build (W>31) still renders single posts → 2 legs per bent', () => {
    const s = build({ width: 40, length: 40, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 2);
  });

  it('height 14 still renders single posts → 2 legs per bent', () => {
    const s = build({ width: 24, length: 30, legHeight: 14 });
    expect(legCount(s)).toBe(s.frameCount * 2);
  });

  it('tall build (H>=16) renders single posts with NO ladder rungs', () => {
    const s = build({ width: 24, length: 30, legHeight: 18 });
    expect(legCount(s)).toBe(s.frameCount * 2);
    expect(ladderRungs(s).length).toBe(0);
  });

  it('tall AND wide → still single posts, no rungs', () => {
    const s = build({ width: 40, length: 40, legHeight: 18 });
    expect(legCount(s)).toBe(s.frameCount * 2);
    expect(ladderRungs(s).length).toBe(0);
  });

  it('the frame stays within the building width (never wider than the roof)', () => {
    const s = build({ width: 40, length: 40, legHeight: 12 });
    const halfW = s.width / 2;
    for (const m of s.members) {
      expect(Math.abs(m.start[0])).toBeLessThanOrEqual(halfW + 0.01);
      expect(Math.abs(m.end[0])).toBeLessThanOrEqual(halfW + 0.01);
    }
  });

  it('a wide build keeps single (un-doubled) eave base rails', () => {
    // single base rail per eave run: all eave rails sit exactly on the wall
    // plane (|x| == halfW), none inset inboard.
    const s = build({ width: 40, length: 40, legHeight: 12 });
    const halfW = s.width / 2;
    const eaveRails = s.members.filter((m) => m.kind === 'baseRail' && m.start[0] === m.end[0]);
    expect(eaveRails.length).toBeGreaterThan(0);
    for (const m of eaveRails) expect(Math.abs(Math.abs(m.start[0]) - halfW)).toBeLessThan(0.01);
  });
});
