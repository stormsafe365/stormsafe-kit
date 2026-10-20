import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure } from '../geometry';
import { resolveBuilding } from '../ruleEngine';
import type { BuildingConfig, WallOverrides } from '@/types/building';

/**
 * A GCH's (utility) ends follow the program's Front / Back Gable rows (owner
 * 10/19/26: "you can still open that wall if you want ... or have gable only
 * sheeting or half sheeting"). The quote prices each end by that choice; the
 * drawing used to keep the enclosed bay's end closed whatever was picked.
 */

const cfg = (over: Partial<BuildingConfig> = {}, wallOverrides?: WallOverrides): BuildingConfig => ({
  ...DEFAULT_CONFIG,
  buildingType: 'utility',
  width: 24,
  length: 40,
  legHeight: 10,
  enclosedLengthFt: 20,
  openEnd: 'front',
  manufacturer: 'CCI',
  ...over,
  ...(wallOverrides ? { wallOverrides } : {}),
});
const enclosure = (over: Partial<BuildingConfig> = {}, wallOverrides?: WallOverrides) =>
  deriveStructure(resolveBuilding(cfg(over, wallOverrides))).enclosure;

describe('GCH ends follow the Front / Back Gable rows', () => {
  it('no choice: the open bay per the gable rule, the enclosed bay closed (as before)', () => {
    const e = enclosure();
    expect(e.type).toBe('utility');
    expect(e.front).toBe('open');
    expect(e.back).toBe('closed');
    expect(enclosure({ openEndGableSheeting: true }).front).toBe('gableOnly');
    expect(e.partitionZ).toBe(0); // 40' long, 20' enclosed at the back: the divider sits mid-length
  });

  it('the enclosed bay\'s end (back) can be open, gable-only or half-closed', () => {
    for (const back of ['open', 'gableOnly', 'halfClosed', 'closed'] as const) {
      const e = enclosure({}, { leftOpen: false, rightOpen: false, back });
      expect(e.back).toBe(back);
      expect(e.front).toBe('open'); // the open bay is untouched
      expect(e.partitionZ).toBe(0); // the divider stays
      expect(e.sideZ).toEqual({ start: 0, end: 20 });
    }
  });

  it('the open bay\'s end (front) can be closed or half-closed, and a row choice wins over the gable rule', () => {
    expect(enclosure({ openEndGableSheeting: true }, { leftOpen: false, rightOpen: false, front: 'closed' }).front).toBe('closed');
    expect(enclosure({}, { leftOpen: false, rightOpen: false, front: 'halfClosed' }).front).toBe('halfClosed');
    expect(enclosure({ openEndGableSheeting: true }, { leftOpen: false, rightOpen: false, front: 'open' }).front).toBe('open');
  });

  it('with the open bay at the back the rows map the same way', () => {
    const e = enclosure({ openEnd: 'back' }, { leftOpen: false, rightOpen: false, front: 'gableOnly', back: 'halfClosed' });
    expect(e.front).toBe('gableOnly'); // the enclosed bay's end
    expect(e.back).toBe('halfClosed'); // the open bay's end
    expect(e.sideZ).toEqual({ start: -20, end: 0 });
  });

  it('a GCH never takes eave-side opens or bands from the rows (its sides are the Side Panels controls)', () => {
    const e = enclosure({}, { leftOpen: true, rightOpen: true, leftBandFt: 3, rightBandFt: 3, back: 'open' });
    expect(e.sideOpen).toEqual({ left: false, right: false });
    expect(e.sideBandFt).toEqual({ left: 0, right: 0 });
  });
});
