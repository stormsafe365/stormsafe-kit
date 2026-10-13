import { describe, expect, it } from 'vitest';
import { designToConfig, closureFeet } from '../src/model/toConfig';
import { cloneDesign, DEFAULT_DESIGN, type WebDesign, type WebWall } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';
import { fitMainPos, freeMainPos, offset3DToPos, posToOffset3D } from '../src/model/positions';
import { activeWraps, framingGauge, impactRequired, trussSpacingFt, wrapStatus } from '../src/model/rules';
import { PRICING } from '@/config/pricing';
import * as stub from '../stubs/pricing';

const ctx = { county: null };
const base = () => normalizeDesign(DEFAULT_DESIGN, false);

describe('designToConfig — customer design → the shared 3D config', () => {
  it('names left / right from the front: the customer left side is the 3D +X ("right") wall', () => {
    const d = base();
    d.walls.left = 'open';
    d.walls.right = '2panel';
    const c = designToConfig(d, ctx);
    expect(c.wallOverrides).toMatchObject({ rightOpen: true, leftOpen: false, leftBandFt: 6, rightBandFt: undefined });
    const walk = c.openings.find((o) => o.type === 'walkDoor');
    expect(walk).toBeUndefined(); // the walk door sat on the (now open) left side
    const d2 = base();
    expect(designToConfig(d2, ctx).openings.find((o) => o.type === 'walkDoor')?.side).toBe('right');
  });

  it('carport side panels hang from the eave on the swapped sides', () => {
    const d = cloneDesign(DEFAULT_DESIGN);
    d.type = 'carport';
    d.walls = { front: 'gableOnly', back: 'open', left: 'q2', right: '1panel' };
    d.openings = [];
    const c = designToConfig(normalizeDesign(d, false), ctx);
    expect(c.buildingType).toBe('carport');
    expect(c.eavePanelFt).toEqual({ left: 3, right: 5 });
    expect(c.wallOverrides).toMatchObject({ front: 'gableOnly', back: 'open' });
  });

  it('garage + carport is the 3D utility build with the carport in front', () => {
    const d = cloneDesign(DEFAULT_DESIGN);
    d.type = 'combo';
    d.enclosedLength = 18;
    d.walls = { front: 'gableOnly', back: 'closed', left: 'open', right: 'open' };
    d.openings = [{ id: 'p', kind: 'rollup', wall: 'partition', w: 10, h: 8, sill: 0, pos: 7, color: 'white' }];
    const c = designToConfig(normalizeDesign(d, false), ctx);
    expect(c).toMatchObject({ buildingType: 'utility', openEnd: 'front', enclosedLengthFt: 18, openEndGableSheeting: true });
    expect(c.openings[0].side).toBe('partition');
  });

  it('maps every position onto the 3D wall and back exactly (program near-edge numbers)', () => {
    const d = base();
    const walls: WebWall[] = ['front', 'back', 'left', 'right'];
    for (const wall of walls) for (const pos of [1, 3.5, 7, 11.25]) {
      const off = posToOffset3D(d, wall, pos, 3);
      expect(offset3DToPos(d, wall, off, 3)).toBeCloseTo(pos, 6);
    }
    // Left side 6' from the front gable, 3' door: centerline 7.5' from the front in the 3D.
    expect(posToOffset3D(d, 'left', 6, 3)).toBeCloseTo(7.5, 9);
    expect(posToOffset3D(d, 'right', 6, 3)).toBeCloseTo(7.5, 9);
    // Front end 3' from the left eave corner (3D +X): 10' door center 8' from +X = 16' from −X.
    expect(posToOffset3D(d, 'front', 3, 10)).toBeCloseTo(16, 9);
    // Back end measures from the right eave corner (3D −X); the 3D back wall runs from +X, so it mirrors too.
    expect(posToOffset3D(d, 'back', 3, 10)).toBeCloseTo(16, 9);
  });

  it('keeps openings 1′ from corners and from each other (wallFit), and finds free spots', () => {
    const d = base();
    const empty = cloneDesign(d);
    empty.openings = [];
    expect(fitMainPos(empty, 'front', 10, 0, null)).toBe(1); // pulled off the corner
    expect(fitMainPos(d, 'front', 4, 8, null)).toBe(2); // the 10' door sits at 7–17: nearest spot 1' clear of it
    expect(fitMainPos(d, 'front', 10, 8, null)).toBeNull(); // no room for a second 10' door on a 24' end
    const full = cloneDesign(d);
    full.openings = [{ id: 'a', kind: 'rollup', wall: 'front', w: 16, h: 8, sill: 0, pos: 4, color: 'white' }];
    expect(freeMainPos(full, 'front', 9)).toBeNull(); // 24' wall: no room for a 9' door beside a 16' door
  });

  it('a garage + carport side door stays on the garage part', () => {
    const d = cloneDesign(DEFAULT_DESIGN);
    d.type = 'combo';
    d.length = 30;
    d.enclosedLength = 20;
    d.openings = [];
    const n = normalizeDesign(d, false);
    expect(fitMainPos(n, 'left', 3, 0, null)).toBe(11); // carport is the first 10': 1' past the divider post
  });

  it('lean-tos: gable Starts At, wrap corners, openings centered from the left end', () => {
    const d = cloneDesign(DEFAULT_DESIGN);
    d.width = 30;
    d.length = 40;
    d.height = 12;
    d.leanTos = [
      { id: 'e', side: 'Left Eave', width: 12, length: 40, start: 0, lowLeg: 9, pitch: '2:12', enclosure: 'enclosed', walls: { front: 'open', back: 'open', side: 'open' }, openings: [{ id: 'lo1', kind: 'rollup', wall: 'outer', w: 8, h: 7, sill: 0, pos: 20, color: 'white' }] },
      { id: 'g', side: 'Front Gable', width: 12, length: 20, start: 4, lowLeg: 9, pitch: '2:12', enclosure: 'open', walls: { front: 'open', back: 'open', side: 'open' }, openings: [] },
    ];
    d.wraps = ['FL'];
    const n = normalizeDesign(d, false);
    expect(wrapStatus(n).FL).toMatchObject({ offered: true, ok: false });
    expect(activeWraps(n)).toEqual([]);
    let c = designToConfig(n, ctx);
    expect(c.leanTos[1].offsetFt).toBe(30 - 20 - 4); // front gable: from the left eave corner, mirrored onto −X
    expect(c.leanTos[0].wrapCorners).toBeUndefined();
    expect(c.leanTos[0].openings?.[0]).toMatchObject({ wall: 'outer', offsetFt: 24, widthFt: 8 });
    n.leanTos[1].start = 0;
    n.leanTos[1].length = 30;
    expect(activeWraps(n)).toEqual(['FL']);
    c = designToConfig(n, ctx);
    expect(c.leanTos[0].wrapCorners).toEqual(['FL']);
    expect(c.leanTos[1].wrapCorners).toEqual(['FL']);
    n.leanTos[1].pitch = '3:12';
    expect(wrapStatus(n).FL.why).toContain('same roof pitch');
  });

  it('rep-only parts come from the rules, never from the customer', () => {
    const d = base();
    expect(designToConfig(d, { county: 'Palm Beach' })).toMatchObject({ trussSpacingFt: 4, framingGauge: '12-gauge', manufacturer: 'CCI' });
    expect(designToConfig(d, { county: 'Orange' })).toMatchObject({ trussSpacingFt: 5, framingGauge: '14-gauge' });
    const wide: WebDesign = { ...d, width: 30 };
    expect(trussSpacingFt(wide, 'Lee')).toBe(4);
    expect(framingGauge(wide, 'Lee')).toBe('12-gauge');
    expect(framingGauge(wide, 'Orange')).toBe('14-gauge');
  });

  it('impact: the URL decides, else the county lock (Okaloosa / Okeechobee over 720 sq ft)', () => {
    const d = base();
    expect(impactRequired({ zip: null, county: 'Palm Beach', impactParam: false }, d)).toBe(false);
    expect(impactRequired({ zip: null, county: null, impactParam: true }, d)).toBe(true);
    expect(impactRequired({ zip: null, county: 'Palm Beach', impactParam: null }, d)).toBe(true);
    expect(impactRequired({ zip: null, county: 'Orange', impactParam: null }, d)).toBe(false);
    expect(impactRequired({ zip: null, county: 'Okaloosa', impactParam: null }, { width: 30, length: 30 })).toBe(true);
    expect(impactRequired({ zip: null, county: 'Okeechobee', impactParam: null }, { width: 24, length: 30 })).toBe(false); // 720 sq ft: not over
    expect(impactRequired({ zip: null, county: 'Okaloosa', impactParam: null }, { width: 20, length: 30 })).toBe(false);
  });

  it('impact walk doors swing out in the 3D; black parts carry the black hex', () => {
    const c = designToConfig(normalizeDesign(DEFAULT_DESIGN, true), ctx);
    expect(c.openings.find((o) => o.type === 'walkDoor')).toMatchObject({ impact: true, doorStyle: 'std' });
    const d = cloneDesign(DEFAULT_DESIGN);
    d.openings[1].style = '6panel_blk';
    d.openings[2].style = 'b3030';
    const c2 = designToConfig(normalizeDesign(d, false), ctx);
    expect(c2.openings.find((o) => o.type === 'walkDoor')).toMatchObject({ doorStyle: '6panel', color: '#1f1f1f', impact: false });
    expect(c2.openings.find((o) => o.type === 'window')?.color).toBe('#1f1f1f');
  });

  it('closure bands match the program (panels 3′ each, quarters of the wall)', () => {
    expect(closureFeet('open', 10)).toBe(0);
    expect(closureFeet('closed', 10)).toBe(10);
    expect(closureFeet('2panel', 10)).toBe(6);
    expect(closureFeet('3panel', 8)).toBe(8);
    expect(closureFeet('q3', 12)).toBe(9);
  });

  it('the web pricing stub has the estimator’s shape with every number zero', () => {
    const shape = (o: unknown): unknown => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : typeof o);
    expect(shape(stub.PRICING)).toEqual(shape(PRICING));
    const nums = JSON.stringify(stub.PRICING).match(/-?\d+(\.\d+)?(?=[,}])/g) ?? [];
    expect(nums.every((n) => Number(n) === 0)).toBe(true);
    expect(stub.PRICE_DISCLAIMER).toBe('');
  });
});
