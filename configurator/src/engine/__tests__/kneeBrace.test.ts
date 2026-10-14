import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure, type Member } from '../geometry';
import { kneeBraceFt } from '../kneeBrace';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { BuildingConfig } from '@/types/building';
import { kneeBraceDetail, kneeBraceTitle } from '@/three/dimLabels';

/**
 * Knee braces by manufacturer (owner 10/14/26) — drawing only.
 * CCI Dealer Handbook p.30 "Corner/Leg Braces and Peak Braces"; CA sheet CA-2.
 */
type S = ReturnType<typeof deriveStructure>;
const build = (over: Partial<BuildingConfig>): S =>
  deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, openings: [], ...over } as BuildingConfig));
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;
const knees = (s: S) => s.members.filter((m) => m.kind === 'brace' && !near(m.start[1], m.end[1]) && !near(m.start[0], m.end[0]));
const kneesAtZ = (s: S, z: number) => knees(s).filter((m) => near(m.start[2], z) && near(m.end[2], z));
const len = (m: Member) => Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1], m.end[2] - m.start[2]);

describe('kneeBraceFt — the manufacturer rule', () => {
  it('CCI up to 7ft tall: 12-20 wide = 2ft, 22-24 = 4ft, 26+ = 4ft', () => {
    for (const w of [12, 18, 20]) expect(kneeBraceFt('CCI', w, 7)).toBe(2);
    for (const w of [22, 24, 26, 30, 40, 60]) expect(kneeBraceFt('CCI', w, 7)).toBe(4);
  });
  it('CCI over 7ft (certified 8ft+): 4ft at every width', () => {
    for (const w of [12, 20, 24, 30, 50]) for (const h of [8, 10, 12, 16]) expect(kneeBraceFt('CCI', w, h)).toBe(4);
  });
  it('CA: min 24in on posts up to 7ft, 48in over 7ft (unset follows CA)', () => {
    expect(kneeBraceFt('CA', 24, 7)).toBe(2);
    expect(kneeBraceFt('CA', 24, 7.5)).toBe(4);
    expect(kneeBraceFt('CA', 24, 12)).toBe(4);
    expect(kneeBraceFt(undefined, 12, 6)).toBe(2);
  });
});

describe('drawn braces', () => {
  it('the member IS the rule length, at 45°, from the leg up onto the rafter', () => {
    for (const [mfr, w, h] of [['CCI', 12, 6], ['CCI', 20, 7], ['CCI', 24, 12], ['CA', 24, 7], ['CA', 24, 12]] as const) {
      const s = build({ manufacturer: mfr, width: w, legHeight: h, buildingType: 'carport' } as Partial<BuildingConfig>);
      const rule = kneeBraceFt(mfr, w, h);
      const k = knees(s);
      expect(k.length).toBe(s.frameCount * 2);
      for (const m of k) {
        expect(len(m)).toBeCloseTo(rule, 6);
        expect(Math.abs(m.end[0] - m.start[0])).toBeCloseTo(Math.abs(m.end[1] - m.start[1]), 6); // 45°
        expect(Math.abs(m.start[0])).toBeCloseTo(w / 2, 6); // foot on the leg
        const rise = (s.peakHeight - h) / (w / 2);
        expect(m.end[1]).toBeCloseTo(h + (w / 2 - Math.abs(m.end[0])) * rise, 6); // tip on the rafter
      }
    }
  });
  it('none on an END frame whose end is sheeted; an open end keeps them', () => {
    const g = build({ buildingType: 'garage', length: 30 });
    expect(kneesAtZ(g, -15).length).toBe(0);
    expect(kneesAtZ(g, 15).length).toBe(0);
    expect(kneesAtZ(g, g.framePositionsZ[1]).length).toBe(2);
    const c = build({ buildingType: 'carport', length: 30 });
    expect(kneesAtZ(c, -15).length).toBe(2);
    const gable = build({ buildingType: 'carport', length: 30, wallOverrides: { leftOpen: false, rightOpen: false, front: 'gableOnly', back: 'halfClosed' } });
    expect(kneesAtZ(gable, -15).length).toBe(0);
    expect(kneesAtZ(gable, 15).length).toBe(0);
  });
  it('ladder legs keep no knee brace (and no dimension)', () => {
    const s = build({ manufacturer: 'CA', width: 52, legHeight: 12, buildingType: 'carport' } as Partial<BuildingConfig>);
    expect(knees(s).filter((m) => Math.abs(m.end[0] - m.start[0]) > 0.6).length).toBe(0);
    expect(s.kneeBrace).toBeUndefined();
  });
  it('a truss chord in the way still stops the brace on it (never longer than the rule)', () => {
    const s = build({ manufacturer: 'CA', width: 34, legHeight: 12, buildingType: 'carport' } as Partial<BuildingConfig>);
    for (const m of knees(s).filter((m) => Math.abs(m.end[0] - m.start[0]) > 0.5)) expect(len(m)).toBeLessThanOrEqual(4 + 1e-6);
  });
  it('single slope: tall side braced on its own height, tip on the sloped rafter', () => {
    const s = build({ manufacturer: 'CCI', width: 20, legHeight: 12, monoDropFt: 2, buildingType: 'carport' } as Partial<BuildingConfig>);
    for (const m of knees(s)) expect(len(m)).toBeCloseTo(4, 6);
  });
});

describe('Spacing overlay knee-brace dimension (structure.kneeBrace + labels)', () => {
  it('CCI 24 wide x 12ft, 3:12 — "Knee brace 4\' @ 45°" / drop, reach, clear height', () => {
    const s = build({ manufacturer: 'CCI', width: 24, legHeight: 12, roofPitch: 3, buildingType: 'carport' } as Partial<BuildingConfig>);
    const kb = s.kneeBrace!.right;
    expect(kb.lengthFt).toBeCloseTo(4, 6);
    expect(kb.reachFt).toBeCloseTo(4 / Math.SQRT2, 6);
    expect(kb.dropFt).toBeCloseTo((4 / Math.SQRT2) * (1 - 3 / 12), 6);
    expect(kb.footY).toBeCloseTo(12 - kb.dropFt, 6);
    expect(kneeBraceTitle(kb)).toBe("Knee brace 4' @ 45°");
    expect(kneeBraceDetail(kb)).toBe('2\'1½" down · 2\'10" in · 9\'10½" clear at wall');
    expect(s.kneeBrace!.left.footY).toBeCloseTo(kb.footY, 6);
  });
  it('CA 24 wide x 7ft — the 2ft brace', () => {
    const s = build({ manufacturer: 'CA', width: 24, legHeight: 7, roofPitch: 3, buildingType: 'carport' } as Partial<BuildingConfig>);
    expect(kneeBraceTitle(s.kneeBrace!.right)).toBe("Knee brace 2' @ 45°");
  });
});
