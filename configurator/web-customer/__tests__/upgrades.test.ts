// Upgrades step (owner 10/16/26 "add-ons/upgrades"): the saved design, the
// rules, the 3D config and the spec.
import { describe, expect, it } from 'vitest';
import { SAMPLE_DESIGN } from './sample';
import { cloneDesign, type WebDesign } from '../src/model/design';
import { normalizeDesign, hasRollupDoor } from '../src/model/normalize';
import { buildSpec, upgradeLines } from '../src/model/spec';
import { designToConfig } from '../src/model/toConfig';
import { checkState } from '../src/model/validate';

const ctx = { zip: null, county: null, impactParam: null };
const specCtx = { zip: null, county: null, impact: false };
const all = (): WebDesign => {
  const d = cloneDesign(SAMPLE_DESIGN);
  d.upgrades = { insulation: 'roofWalls', frame12: true, oc4: true, panels26: true, colorScrews: true, openers: true, angle45: true };
  return d;
};

describe('upgrades: saved design', () => {
  it('a design saved without upgrades (10/13 states) gets none', () => {
    const d = cloneDesign(SAMPLE_DESIGN) as Partial<WebDesign>;
    delete d.upgrades;
    const n = normalizeDesign(d as WebDesign, false);
    expect(n.upgrades).toEqual({ insulation: 'none', frame12: false, oc4: false, panels26: false, colorScrews: false, openers: false, angle45: false });
    const chk = checkState({ schema: 'ss-web-design', v: 1, design: d, ctx: {} });
    expect(chk.ok).toBe(true);
  });
  it('junk values are cleaned; a non-object is refused', () => {
    const d = cloneDesign(SAMPLE_DESIGN) as unknown as Record<string, unknown>;
    d.upgrades = { insulation: 'everything', frame12: 'yes', oc4: 1, panels26: true };
    const n = normalizeDesign(d as unknown as WebDesign, false);
    expect(n.upgrades).toEqual({ insulation: 'none', frame12: false, oc4: false, panels26: true, colorScrews: false, openers: false, angle45: false });
    expect(checkState({ schema: 'ss-web-design', v: 1, design: { ...cloneDesign(SAMPLE_DESIGN), upgrades: 'x' }, ctx: {} }).ok).toBe(false);
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
    const plain = designToConfig(normalizeDesign(cloneDesign(SAMPLE_DESIGN), false), ctx);
    expect(plain.framingGauge).toBe('14-gauge');
    expect(plain.trussSpacingFt).toBe(5);
    expect(plain.sheetingGauge).toBe('29-gauge');
    const up = designToConfig(normalizeDesign(all(), false), ctx);
    expect(up.framingGauge).toBe('12-gauge');
    expect(up.trussSpacingFt).toBe(4);
    expect(up.sheetingGauge).toBe('26-gauge');
  });
  it('the area rules still apply without the upgrade (Palm Beach = 12 GA + 4 ft)', () => {
    const c = designToConfig(normalizeDesign(cloneDesign(SAMPLE_DESIGN), false), { ...ctx, county: 'Palm Beach' });
    expect(c.framingGauge).toBe('12-gauge');
    expect(c.trussSpacingFt).toBe(4);
  });
  it('the spec lists what was asked for, or None; never prices', () => {
    expect(buildSpec(normalizeDesign(cloneDesign(SAMPLE_DESIGN), false), specCtx)).toContain('Upgrades requested: None');
    const s = buildSpec(normalizeDesign(all(), false), specCtx);
    expect(s).toContain('Upgrades requested:\n- Insulation: roof and walls\n- 12-gauge frame\n');
    expect(upgradeLines(normalizeDesign(all(), false))).toHaveLength(7);
    expect(s).not.toMatch(/\$|price|cost|mph|CCI|Carolina|CRM/i);
  });
});

describe('impact area: the customer keeps their own door / window pick', () => {
  const ctxPB = { zip: '33401', county: 'Palm Beach', impactParam: null };
  const ctxNone = { zip: null, county: null, impactParam: null };
  it('impact shows the rated ones; leaving the impact area puts the picks back', async () => {
    const { settle } = await import('../src/store');
    const d = cloneDesign(SAMPLE_DESIGN);
    d.openings = [
      { id: 'o1', kind: 'walk', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 6, style: '6panel_blk' },
      { id: 'o2', kind: 'window', wall: 'left', w: 2.5, h: 3, sill: 50 / 12, pos: 14, style: 'b3036' },
    ];
    const inImpact = settle(d, ctxPB);
    expect(inImpact.impact).toBe(true);
    expect(inImpact.design.openings.map((o) => o.style)).toEqual(['hiwind', 'hi3036']);
    const back = settle(inImpact.design, ctxNone);
    expect(back.impact).toBe(false);
    expect(back.design.openings.map((o) => o.style)).toEqual(['6panel_blk', 'b3036']);
    expect(back.design.openings.every((o) => o.chosen === undefined)).toBe(true);
  });
  it('a size changed while impact was showing sticks', async () => {
    const { settle } = await import('../src/store');
    const d = cloneDesign(SAMPLE_DESIGN);
    d.openings = [{ id: 'o2', kind: 'window', wall: 'left', w: 2.5, h: 2.5, sill: 50 / 12, pos: 14, style: 'b3030' }];
    const a = settle(d, ctxPB).design;
    expect(a.openings[0].style).toBe('hi');
    a.openings[0].style = 'hi3036'; // the customer picks the taller impact window
    const b = settle(a, ctxPB).design;
    expect(b.openings[0].style).toBe('hi3036');
    expect(settle(b, ctxNone).design.openings[0].style).toBe('b3036'); // the black frame is kept
  });
  it('a door / window added inside an impact area goes back to the plain one after', async () => {
    const { settle } = await import('../src/store');
    const d = cloneDesign(SAMPLE_DESIGN);
    // the panels add new parts as 'std'; the impact area shows the rated ones
    d.openings = [
      { id: 'o1', kind: 'walk', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 6, style: 'std' },
      { id: 'o2', kind: 'window', wall: 'left', w: 2.5, h: 2.5, sill: 50 / 12, pos: 14, style: 'std' },
    ];
    const a = settle(d, ctxPB).design;
    expect(a.openings.map((o) => o.style)).toEqual(['hiwind', 'hi']);
    expect(settle(a, ctxNone).design.openings.map((o) => o.style)).toEqual(['std', 'std']);
  });
  it('wide span: 26-gauge panels are standard, not an upgrade', () => {
    const d = all();
    d.width = 40;
    const n = normalizeDesign(d, false);
    expect(n.upgrades.panels26).toBe(true); // kept, in case the width goes back below wide span
    expect(upgradeLines(n)).not.toContain('26-gauge wall panels');
    d.width = 24;
    expect(upgradeLines(normalizeDesign(d, false))).toContain('26-gauge wall panels');
    expect(designToConfig(n, ctx).sheetingGauge).toBe('26-gauge');
  });
});

describe('upgrades: 45-degree angle cut on the roll-up doors', () => {
  it('kept with a roll-up door, cleared without one, false when missing', () => {
    const d = all();
    expect(normalizeDesign(d, false).upgrades.angle45).toBe(true);
    d.openings = d.openings.filter((o) => o.kind !== 'rollup');
    expect(normalizeDesign(d, false).upgrades.angle45).toBe(false);
    const old = cloneDesign(SAMPLE_DESIGN) as unknown as Record<string, unknown>;
    old.upgrades = { insulation: 'none', frame12: false, oc4: false, panels26: false, colorScrews: false, openers: false };
    expect(normalizeDesign(old as unknown as WebDesign, false).upgrades.angle45).toBe(false);
    old.upgrades = { angle45: 'yes' };
    expect(normalizeDesign(old as unknown as WebDesign, false).upgrades.angle45).toBe(false);
  });
  it('is listed in the upgrades and the spec text', () => {
    const n = normalizeDesign(all(), false);
    expect(upgradeLines(n)).toContain('45-degree angle cut on the roll-up doors');
    expect(buildSpec(n, specCtx)).toContain('45-degree angle cut');
    n.upgrades.angle45 = false;
    expect(upgradeLines(n).join(' ')).not.toContain('45-degree');
  });
});
