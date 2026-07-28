import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';

const build = (over: Partial<typeof DEFAULT_CONFIG>) =>
  deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', openings: [], ...over }));

const legCount = (s: ReturnType<typeof deriveStructure>) => s.members.filter((m) => m.kind === 'leg').length;

// Ladder rungs: short HORIZONTAL braces spanning the column depth INBOARD
// (along X) near the left eave — the ladder lives in the truss plane, not
// flat along the wall.
const ladderRungs = (s: ReturnType<typeof deriveStructure>) => {
  const halfW = s.width / 2;
  return s.members.filter(
    (m) =>
      m.kind === 'brace' &&
      Math.abs(m.start[1] - m.end[1]) < 0.01 && // horizontal
      Math.abs(m.start[2] - m.end[2]) < 0.01 && // in one bent plane (same Z)
      Math.abs(m.start[0] - m.end[0]) > 0.5 && // spans the column depth in X
      Math.min(Math.abs(m.start[0]), Math.abs(m.end[0])) > halfW - 2.5, // at the eave column
  );
};

describe('truss/leg styles — single, double (W>31 / H 14-15), ladder (H>=16)', () => {
  it('small build → 2 legs per bent (one post each side)', () => {
    const s = build({ width: 24, length: 30, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 2);
  });

  it('wide build (W>31) → DOUBLE legs: 4 posts per bent', () => {
    const s = build({ width: 40, length: 40, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 4);
  });

  it('height 14 → DOUBLE legs: 4 posts per bent', () => {
    const s = build({ width: 24, length: 30, legHeight: 14 });
    expect(legCount(s)).toBe(s.frameCount * 4);
  });

  it('tall build (H>=16) → LADDER legs: 4 chords per bent + rungs', () => {
    const s = build({ width: 24, length: 30, legHeight: 18 });
    expect(legCount(s)).toBe(s.frameCount * 4);
    expect(ladderRungs(s).length).toBeGreaterThan(0);
  });

  it('tall AND wide → ladder wins: 4 chords per bent + rungs', () => {
    const s = build({ width: 40, length: 40, legHeight: 18 });
    expect(legCount(s)).toBe(s.frameCount * 4);
    expect(ladderRungs(s).length).toBeGreaterThan(0);
  });

  it('inner chords stay INBOARD — the frame never grows wider than the roof', () => {
    for (const legHeight of [12, 14, 18]) {
      const s = build({ width: 40, length: 40, legHeight });
      const halfW = s.width / 2;
      for (const m of s.members) {
        expect(Math.abs(m.start[0])).toBeLessThanOrEqual(halfW + 0.01);
        expect(Math.abs(m.end[0])).toBeLessThanOrEqual(halfW + 0.01);
      }
    }
  });

  it('ladder rungs run inboard, not along the wall (regression: flat-ladder bug)', () => {
    const s = build({ width: 24, length: 30, legHeight: 18 });
    const halfW = s.width / 2;
    const wallPlaneRungs = s.members.filter(
      (m) =>
        m.kind === 'brace' &&
        Math.abs(m.start[1] - m.end[1]) < 0.01 &&
        Math.abs(m.start[2] - m.end[2]) > 0.1 && // runs along the wall (Z)
        Math.abs(Math.abs(m.start[0]) - halfW) < 0.01 &&
        Math.abs(Math.abs(m.end[0]) - halfW) < 0.01,
    );
    expect(wallPlaneRungs.length).toBe(0);
  });

  it('double legs double the eave base rails (inner rail under the inner post)', () => {
    const s = build({ width: 40, length: 40, legHeight: 12 });
    const halfW = s.width / 2;
    const eaveRails = s.members.filter((m) => m.kind === 'baseRail' && m.start[0] === m.end[0]);
    const onWall = eaveRails.filter((m) => Math.abs(Math.abs(m.start[0]) - halfW) < 0.01);
    const inset = eaveRails.filter((m) => Math.abs(Math.abs(m.start[0]) - halfW) >= 0.01);
    expect(onWall.length).toBeGreaterThan(0);
    expect(inset.length).toBeGreaterThan(0);
  });

  it('single-leg builds keep single eave base rails', () => {
    const s = build({ width: 24, length: 30, legHeight: 12 });
    const halfW = s.width / 2;
    const eaveRails = s.members.filter((m) => m.kind === 'baseRail' && m.start[0] === m.end[0]);
    expect(eaveRails.length).toBeGreaterThan(0);
    for (const m of eaveRails) expect(Math.abs(Math.abs(m.start[0]) - halfW)).toBeLessThan(0.01);
  });
});
