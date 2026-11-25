import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig } from '@/types/building';
import { gchEaveEnclosed, gchGapLabel } from '../gchSpacing';

/**
 * GCH eave Spacing (owner 11/25/26, a 24x32x9 GCH with 8' enclosed): "its only showing me the spacing from the window to the
 * back gable end but not from the window to the front of the enclosed portion" / "its also not showing how much is enclosed".
 * Eave offsets run from the building FRONT; the enclosed bay sits against the closed end.
 */
const cfg = (over: Partial<BuildingConfig> = {}): BuildingConfig => ({
  ...DEFAULT_CONFIG, buildingType: 'utility', width: 24, length: 32, legHeight: 9, enclosedLengthFt: 8, openEnd: 'front', manufacturer: 'CCI', ...over,
});
const st = (over: Partial<BuildingConfig> = {}) => deriveStructure(resolveBuilding(cfg(over)));

describe('GCH eave: the enclosed bay', () => {
  it('8\' enclosed at the back of a 32\' building = 24\' to 32\' on both eaves', () => {
    expect(gchEaveEnclosed('right', st())).toEqual({ a: 24, b: 32 });
    expect(gchEaveEnclosed('left', st())).toEqual({ a: 24, b: 32 });
  });
  it('open bay at the back: the enclosed bay is 0\' to 8\'', () => {
    expect(gchEaveEnclosed('right', st({ openEnd: 'back' }))).toEqual({ a: 0, b: 8 });
  });
  it('not on the gable ends, the partition, a garage, or a GCH enclosed full length', () => {
    expect(gchEaveEnclosed('front', st())).toBeNull();
    expect(gchEaveEnclosed('back', st())).toBeNull();
    expect(gchEaveEnclosed('partition', st())).toBeNull();
    expect(gchEaveEnclosed('right', st({ buildingType: 'garage' }))).toBeNull();
    expect(gchEaveEnclosed('right', st({ enclosedLengthFt: 32 }))).toBeNull();
  });
});

describe('GCH eave: the chain labels', () => {
  const enc = { a: 24, b: 32 };
  it('the owner\'s window (30" wide, 2\'9" from the back): 24\' open | 2\'9" | [window] | 2\'9"', () => {
    expect(gchGapLabel(0, 24, enc)).toBe("24' open");
    expect(gchGapLabel(24, 26.75, enc)).toBe('2\'9"');
    expect(gchGapLabel(29.25, 32, enc)).toBe('2\'9"');
  });
  it('no openings: the bay itself reads "8\' enclosed"', () => {
    expect(gchGapLabel(24, 32, enc)).toBe("8' enclosed");
  });
});
