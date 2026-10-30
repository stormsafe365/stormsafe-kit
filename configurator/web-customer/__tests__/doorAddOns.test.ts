/**
 * Owner 10/30/26: 6:12 pitch on the page, and a chain hoist / brush seal on each roll-up door ("Included" where the
 * size comes with a hoist).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneDesign, type WebDesign } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';
import { hoistIncluded, pitchRise } from '../src/model/rules';
import { partText } from '../src/model/spec';
import { ROLLUP_HEIGHTS, ROLLUP_WIDTHS } from '../src/model/catalog';
import { addOnText } from '../src/panels/PartEditor';
import { reviewRows } from '../src/panels/ReviewList';
import { SAMPLE_DESIGN } from './sample';

const base = (): WebDesign => {
  const d = cloneDesign(SAMPLE_DESIGN);
  d.type = 'garage';
  d.width = 24;
  d.length = 30;
  d.height = 14;
  d.walls = { front: 'closed', back: 'closed', left: 'closed', right: 'closed' };
  d.openings = [];
  d.leanTos = [];
  return d;
};

describe('6:12 roof pitch', () => {
  it('is kept by the page rules and rises 6 per 12', () => {
    const d = base();
    d.pitch = '6:12';
    const n = normalizeDesign(d, false);
    expect(n.pitch).toBe('6:12');
    expect(pitchRise(n)).toBe(6);
  });
  it('an unknown pitch still falls back to standard', () => {
    const d = base();
    (d as unknown as { pitch: string }).pitch = '7:12';
    expect(normalizeDesign(d, false).pitch).toBe('standard');
  });
});

describe('chain hoist included: the same sizes as the quote program (CCI chart)', () => {
  // the program's own rule, read from the quote program file (cciCertHoistIncluded)
  const qb = readFileSync(path.resolve(__dirname, '../../public/quote-builder.html'), 'utf8');
  const src = qb.match(/function cciCertHoistIncluded\(size\)\{[\s\S]*?\n\}/);
  it('the program rule is found', () => expect(src).not.toBeNull());
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const prog = new Function(`${src![0]}; return cciCertHoistIncluded;`)() as (s: string) => boolean;
  for (const w of ROLLUP_WIDTHS)
    for (const h of ROLLUP_HEIGHTS)
      it(`${w}x${h}`, () => expect(hoistIncluded(w, h)).toBe(prog(`${w}x${h}`)));
});

describe('hoist / seal on a roll-up door', () => {
  it('kept as a plain yes; anything else is dropped', () => {
    const d = base();
    d.openings = [
      { id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 7, color: 'white', hoist: true, seal: true },
      { id: 'o2', kind: 'rollup', wall: 'back', w: 10, h: 10, sill: 0, pos: 7, color: 'white', hoist: 'yes' as unknown as boolean, seal: false },
      { id: 'o3', kind: 'walk', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 5, style: 'std', hoist: true, seal: true },
    ];
    const n = normalizeDesign(d, false);
    expect(n.openings[0].hoist).toBe(true);
    expect(n.openings[0].seal).toBe(true);
    expect('hoist' in n.openings[1]).toBe(false);
    expect('seal' in n.openings[1]).toBe(false);
    expect('hoist' in n.openings[2]).toBe(false);
    expect('seal' in n.openings[2]).toBe(false);
  });
  it('a door with neither is unchanged (older saved designs read the same)', () => {
    const d = base();
    d.openings = [{ id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 7, color: 'white' }];
    expect(normalizeDesign(d, false).openings[0]).toEqual({ id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 7, color: 'white' });
  });
  it('lean-to roll-ups keep them too', () => {
    const d = base();
    d.leanTos = [
      {
        id: 'lt1', side: 'Left Eave', width: 12, length: 30, start: 0, lowLeg: 10, pitch: '2:12', enclosure: 'enclosed',
        walls: { front: 'closed', back: 'closed', side: 'closed' },
        openings: [{ id: 'lo1', kind: 'rollup', wall: 'outer', w: 8, h: 7, sill: 0, pos: 10, color: 'white', hoist: true, seal: true }],
      },
    ];
    const lo = normalizeDesign(d, false).leanTos[0].openings[0];
    expect(lo.hoist).toBe(true);
    expect(lo.seal).toBe(true);
  });
  it('the spec and the lists say it in plain words', () => {
    const a = { id: 'o1', kind: 'rollup' as const, wall: 'front' as const, w: 10, h: 10, sill: 0, pos: 7, color: 'white', hoist: true, seal: true };
    expect(partText(a)).toBe('Roll-up door 10\' W × 10\' H, White, chain hoist, brush seal');
    expect(addOnText(a)).toBe(' · chain hoist · brush seal');
    const big = { ...a, w: 14, h: 12, hoist: undefined, seal: undefined };
    expect(partText(big)).toBe('Roll-up door 14\' W × 12\' H, White, chain hoist included with this size');
    expect(addOnText(big)).toBe(' · chain hoist included');
    const plain = { ...a, hoist: undefined, seal: undefined };
    expect(partText(plain)).toBe('Roll-up door 10\' W × 10\' H, White');
    expect(addOnText(plain)).toBe('');
    const d = base();
    d.openings = [a];
    expect(reviewRows(d).some((r) => r.lines.some((l) => l.includes('Garage door 10′ × 10′ · chain hoist · brush seal')))).toBe(true);
  });
});
