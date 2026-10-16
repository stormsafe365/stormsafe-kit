// Upgrades step (owner 10/16/26 "add-ons/upgrades"): the saved design, the
// rules, the 3D config and the spec.
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN, type WebDesign } from '../src/model/design';
import { normalizeDesign, hasRollupDoor } from '../src/model/normalize';
import { buildSpec, upgradeLines } from '../src/model/spec';
import { designToConfig } from '../src/model/toConfig';
import { checkState } from '../src/model/validate';

const ctx = { zip: null, county: null, impactParam: null };
const specCtx = { zip: null, county: null, impact: false };
const all = (): WebDesign => {
  const d = cloneDesign(DEFAULT_DESIGN);
  d.upgrades = { insulation: 'roofWalls', frame12: true, oc4: true, panels26: true, colorScrews: true, openers: true };
  return d;
};

describe('upgrades: saved design', () => {
  it('a design saved without upgrades (10/13 states) gets none', () => {
    const d = cloneDesign(DEFAULT_DESIGN) as Partial<WebDesign>;
    delete d.upgrades;
    const n = normalizeDesign(d as WebDesign, false);
    expect(n.upgrades).toEqual({ insulation: 'none', frame12: false, oc4: false, panels26: false, colorScrews: false, openers: false });
    const chk = checkState({ schema: 'ss-web-design', v: 1, design: d, ctx: {} });
    expect(chk.ok).toBe(true);
  });
  it('junk values are cleaned; a non-object is refused', () => {
    const d = cloneDesign(DEFAULT_DESIGN) as unknown as Record<string, unknown>;
    d.upgrades = { insulation: 'everything', frame12: 'yes', oc4: 1, panels26: true };
    const n = normalizeDesign(d as unknown as WebDesign, false);
    expect(n.upgrades).toEqual({ insulation: 'none', frame12: false, oc4: false, panels26: true, colorScrews: false, openers: false });
    expect(checkState({ schema: 'ss-web-design', v: 1, design: { ...cloneDesign(DEFAULT_DESIGN), upgrades: 'x' }, ctx: {} }).ok).toBe(false);
  });
  it('insulation only with a vertical roof (the program rule)', () => {
    const d = all();
    d.roofStyle = 'Regular';
    expect(normalizeDesign(d, false).upgrades.insulation).toBe('none');
    d.roofStyle = 'Vertical';
    expect(normalizeDesign(d, false).upgrades.insulation).toBe('roofWalls');
  });
  it('openers need a roll-up door', () => {
    const d = all();
    expect(hasRollupDoor(d)).toBe(true);
    expect(normalizeDesign(d, false).upgrades.openers).toBe(true);
    d.openings = d.openings.filter((o) => o.kind !== 'rollup');
    expect(normalizeDesign(d, false).upgrades.openers).toBe(false);
  });
});

describe('upgrades: drawing + spec', () => {
  it('12-gauge, 4 ft spacing and 26-gauge panels show in the 3D config', () => {
    const plain = designToConfig(normalizeDesign(cloneDesign(DEFAULT_DESIGN), false), ctx);
    expect(plain.framingGauge).toBe('14-gauge');
    expect(plain.trussSpacingFt).toBe(5);
    expect(plain.sheetingGauge).toBe('29-gauge');
    const up = designToConfig(normalizeDesign(all(), false), ctx);
    expect(up.framingGauge).toBe('12-gauge');
    expect(up.trussSpacingFt).toBe(4);
    expect(up.sheetingGauge).toBe('26-gauge');
  });
  it('the area rules still apply without the upgrade (Palm Beach = 12 GA + 4 ft)', () => {
    const c = designToConfig(normalizeDesign(cloneDesign(DEFAULT_DESIGN), false), { ...ctx, county: 'Palm Beach' });
    expect(c.framingGauge).toBe('12-gauge');
    expect(c.trussSpacingFt).toBe(4);
  });
  it('the spec lists what was asked for, or None; never prices', () => {
    expect(buildSpec(normalizeDesign(cloneDesign(DEFAULT_DESIGN), false), specCtx)).toContain('Upgrades requested: None');
    const s = buildSpec(normalizeDesign(all(), false), specCtx);
    expect(s).toContain('Upgrades requested:\n- Insulation: roof and walls\n- 12-gauge frame\n');
    expect(upgradeLines(normalizeDesign(all(), false))).toHaveLength(6);
    expect(s).not.toMatch(/\$|price|cost|mph|CCI|Carolina|CRM/i);
  });
});
