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

// Current rule (geometry.ts deriveStructure, same as the program's badges):
// By manufacturer (owner 9/29/26): CCI = LADDER on every wide span (W >= 32);
// CA (sheet AD-1) = DOUBLE 32-51, LADDER 52+. Narrower buildings: DOUBLE when
// H >= 15 (owner 9/28/26: 14' is single); else SINGLE. Unset mfr = CA rule.
describe('truss/leg styles — single, double, ladder by manufacturer', () => {
  it('small build → 2 legs per bent (one post each side)', () => {
    const s = build({ width: 24, length: 30, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 2);
  });

  it('CA wide span 40w → DOUBLE legs (CA sheet AD-1: 31-51 double post)', () => {
    const s = build({ width: 40, length: 40, legHeight: 12, manufacturer: 'CA' });
    expect(legCount(s)).toBe(s.frameCount * 4);
    expect(ladderRungs(s).length).toBe(0);
  });

  it('CCI wide span 40w → LADDER legs: chords + rungs (CCI chart)', () => {
    const s = build({ width: 40, length: 40, legHeight: 12, manufacturer: 'CCI' });
    expect(legCount(s)).toBe(s.frameCount * 4);
    expect(ladderRungs(s).length).toBeGreaterThan(0);
  });

  it('32 ft wide: CCI → LADDER, CA → DOUBLE', () => {
    expect(ladderRungs(build({ width: 32, length: 40, legHeight: 12, manufacturer: 'CCI' })).length).toBeGreaterThan(0);
    const ca = build({ width: 32, length: 40, legHeight: 12, manufacturer: 'CA' });
    expect(ladderRungs(ca).length).toBe(0);
    expect(legCount(ca)).toBe(ca.frameCount * 4);
  });

  it('30 ft wide at 12 ft → still SINGLE legs (not a wide span)', () => {
    const s = build({ width: 30, length: 40, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 2);
    expect(ladderRungs(s).length).toBe(0);
  });

  it('height 14 → still SINGLE legs (owner 9/28: double starts at 15)', () => {
    const s = build({ width: 24, length: 30, legHeight: 14 });
    expect(legCount(s)).toBe(s.frameCount * 2);
  });

  it('height 15 → DOUBLE legs: 4 posts per bent', () => {
    const s = build({ width: 24, length: 30, legHeight: 15 });
    expect(legCount(s)).toBe(s.frameCount * 4);
  });

  it('height 16 → standard DOUBLE legs, NOT ladder: 4 posts per bent, no rungs', () => {
    const s = build({ width: 30, length: 50, legHeight: 16 });
    expect(legCount(s)).toBe(s.frameCount * 4);
    expect(ladderRungs(s).length).toBe(0);
  });

  it('tall NARROW build (18h, 24w) → DOUBLE legs, not ladder (Sensei renders double)', () => {
    const s = build({ width: 24, length: 30, legHeight: 18 });
    expect(legCount(s)).toBe(s.frameCount * 4);
    expect(ladderRungs(s).length).toBe(0);
  });

  it('52ft+ wide → LADDER legs at any height (book footnote): chords + rungs', () => {
    const s = build({ width: 56, length: 60, legHeight: 12 });
    expect(legCount(s)).toBe(s.frameCount * 4);
    expect(ladderRungs(s).length).toBeGreaterThan(0);
  });

  it('40w x 18h: CCI → LADDER legs', () => {
    const s = build({ width: 40, length: 40, legHeight: 18, manufacturer: 'CCI' });
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

  // 24w x 18h is a DOUBLE-leg build (no rungs at all), so this only checks
  // that nothing lies flat along the wall. The 56w test below is a real ladder.
  it('tall double-leg build (24w x 18h): nothing lies flat along the wall (regression: flat-ladder bug)', () => {
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

  it('real ladder build (56w x 12h): rungs exist, run inboard, and none lie flat along the wall', () => {
    const s = build({ width: 56, length: 60, legHeight: 12 });
    const halfW = s.width / 2;
    expect(ladderRungs(s).length).toBeGreaterThan(0);
    const wallPlaneRungs = s.members.filter(
      (m) =>
        m.kind === 'brace' &&
        Math.abs(m.start[1] - m.end[1]) < 0.01 &&
        Math.abs(m.start[2] - m.end[2]) > 0.1 &&
        Math.abs(Math.abs(m.start[0]) - halfW) < 0.01 &&
        Math.abs(Math.abs(m.end[0]) - halfW) < 0.01,
    );
    expect(wallPlaneRungs.length).toBe(0);
  });

  it('double legs double the eave base rails (inner rail under the inner post)', () => {
    const s = build({ width: 24, length: 40, legHeight: 16 });
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

// Regression: "trusses showing inside the opening again" — the eave-opening
// clip only removed members with a foot ON the wall plane (±0.1'), so the
// double/ladder INNER posts (0.4'–2' inboard) stood visible through framed
// openings. The clip band now covers the deep-column inset.
describe('eave framed openings cut double/ladder columns too', () => {
  const clippedInside = (s: ReturnType<typeof deriveStructure>, sideSign: 1 | -1, zlo: number, zhi: number, ylo: number, yhi: number) => {
    const halfW = s.width / 2;
    return s.members.filter((m) => {
      if (m.kind !== 'leg' && m.kind !== 'brace') return false;
      if (Math.abs(m.start[2] - m.end[2]) > 0.01) return false; // in one bent plane
      const x = Math.max(Math.abs(m.start[0]), Math.abs(m.end[0]));
      if (x < halfW - 2.5) return false; // wall + inset band only
      if (Math.sign(m.start[0] || m.end[0]) !== sideSign) return false;
      const z = m.start[2];
      if (z < zlo + 0.01 || z > zhi - 0.01) return false;
      const y0 = Math.min(m.start[1], m.end[1]);
      const y1 = Math.max(m.start[1], m.end[1]);
      return y1 > ylo + 0.05 && y0 < yhi - 0.05; // intersects the opening band
    });
  };

  it('wide-span ladder build (40w x 14h): a 20ft frame-out clears wall AND inner chord + rungs', () => {
    const s = build({
      width: 40, length: 96, legHeight: 14, manufacturer: 'CCI',
      openings: [{ id: 'fo1', type: 'frameOut', side: 'right', offset: 30, width: 20, height: 12, sillHeight: 0, customerSupplied: true } as never],
    });
    const halfL = s.length / 2;
    const cz = -halfL + 30;
    expect(clippedInside(s, 1, cz - 10, cz + 10, 0, 12).length).toBe(0);
  });

  // 24w x 18h is DOUBLE legs under the current rule (ladder needs W >= 52).
  it('tall double-leg build (24w x 18h): an 8ft frame-out clears both posts', () => {
    const s = build({
      width: 24, length: 40, legHeight: 18,
      openings: [{ id: 'fo2', type: 'frameOut', side: 'left', offset: 20, width: 8, height: 10, sillHeight: 0, customerSupplied: true } as never],
    });
    const halfL = s.length / 2;
    const cz = -halfL + 20;
    expect(clippedInside(s, -1, cz - 4, cz + 4, 0, 10).length).toBe(0);
  });

  it('real ladder build (56w x 12h): a 10ft eave frame-out clears both chords and the rungs', () => {
    const s = build({
      width: 56, length: 60, legHeight: 12,
      openings: [{ id: 'fo4', type: 'frameOut', side: 'left', offset: 20, width: 10, height: 10, sillHeight: 0, customerSupplied: true } as never],
    });
    const halfL = s.length / 2;
    const cz = -halfL + 20;
    expect(ladderRungs(s).length).toBeGreaterThan(0); // it really is a ladder build
    expect(clippedInside(s, -1, cz - 5, cz + 5, 0, 10).length).toBe(0);
  });

  it('legs outside the opening span are untouched', () => {
    const withO = build({
      width: 40, length: 96, legHeight: 14,
      openings: [{ id: 'fo3', type: 'frameOut', side: 'right', offset: 30, width: 20, height: 12, sillHeight: 0, customerSupplied: true } as never],
    });
    const bare = build({ width: 40, length: 96, legHeight: 14 });
    const farLegs = (s: ReturnType<typeof deriveStructure>) =>
      s.members.filter((m) => m.kind === 'leg' && m.start[2] > 0).length; // opening is in the -Z half
    expect(farLegs(withO)).toBe(farLegs(bare));
  });
});
