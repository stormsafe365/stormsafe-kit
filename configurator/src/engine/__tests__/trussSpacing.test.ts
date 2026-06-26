import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';

const resolve = (over: Partial<typeof DEFAULT_CONFIG>) =>
  resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', openings: [], ...over });

const build = (over: Partial<typeof DEFAULT_CONFIG>) => deriveStructure(resolve(over));

/**
 * The pricing program is the source of truth for truss spacing. When it forwards
 * config.trussSpacingFt the 3D MUST mirror it exactly — otherwise the trusses
 * (and the program's collision warnings keyed off them) disagree with what the
 * customer sees. Regression guard for the "3D showed 4' OC while the quote used
 * 5' OC" bug on a 24×30 @150mph build.
 */
describe('truss spacing — program override is authoritative', () => {
  it('24×30 @150mph WITHOUT override falls back to the load engine (4ft OC)', () => {
    const r = resolve({ width: 24, length: 30, windSpeedMph: 150 });
    expect(r.legSpacing).toBe(4);
    expect(r.frameCount).toBe(Math.ceil(30 / 4) + 1); // 9
  });

  it('24×30 @150mph WITH 5ft program override uses 5ft OC and floor()+1 count', () => {
    const r = resolve({ width: 24, length: 30, windSpeedMph: 150, trussSpacingFt: 5 });
    expect(r.legSpacing).toBe(5);
    expect(r.frameCount).toBe(Math.floor(30 / 5) + 1); // 7 — matches the program
  });

  it('frame positions are evenly spaced at the overridden 5ft OC', () => {
    const s = build({ width: 24, length: 30, windSpeedMph: 150, trussSpacingFt: 5 });
    expect(s.frameCount).toBe(7);
    expect(s.framePositionsZ).toHaveLength(7);
    // 7 frames across 30ft → 5ft gaps, endpoints at ±15.
    const sorted = [...s.framePositionsZ].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(5, 5);
    }
  });

  it('a 4ft program override (OC upgrade) still wins over a low-wind default', () => {
    const r = resolve({ width: 24, length: 40, windSpeedMph: 130, trussSpacingFt: 4 });
    expect(r.legSpacing).toBe(4);
    expect(r.frameCount).toBe(Math.floor(40 / 4) + 1); // 11
  });
});
