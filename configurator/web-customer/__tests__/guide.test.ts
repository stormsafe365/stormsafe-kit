// The guided start (owner 10/17/26): every starting size is one the builder accepts exactly as listed,
// for every building style a card leads to; an ag barn is a center building with a lean-to on each
// side (not a garage + carport); nothing but the style's own parts is added to the design.
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';
import { applyStyle, BARNS, joinDrop, raisedDrop, STYLES } from '../src/model/guide';
import { heightOptions, isWideSpan, pitchRise, widthOptions } from '../src/model/rules';

describe('guided starting sizes', () => {
  it('the five styles the owner asked for, in plain words', () => {
    expect(STYLES.map((s) => s.title)).toEqual(['Carport', 'Partially enclosed', 'Garage', 'Utility carport', 'Ag barn']);
  });

  it('the owner list is all there (width x length x height)', () => {
    const all = new Set(STYLES.flatMap((p) => p.sizes).map((s) => `${s.label} ${s.w}x${s.l}x${s.h}`));
    for (const want of [
      '1 car 12x21x9',
      '2 cars 24x26x9',
      '3 cars 30x26x9',
      '2 cars + storage 24x36x10',
      'Garage + workshop 30x41x12',
      'Travel trailer / Class C RV 18x36x12',
      'Class A / fifth wheel 18x46x14',
      'Boat on trailer 18x31x12',
      'Tractor & equipment 24x31x14',
      'Ag / barn 30x51x12',
      'Commercial / clear span 40x53x14',
    ]) expect(all.has(want), want).toBe(true);
  });

  it('every size is kept exactly, for every style', () => {
    for (const st of STYLES) {
      for (const s of st.sizes) {
        const d = cloneDesign(DEFAULT_DESIGN);
        applyStyle(d, st.key, s);
        const n = normalizeDesign(d, false);
        expect([st.key, s.label, n.type, n.width, n.length, n.height]).toEqual([st.key, s.label, st.type, s.w, s.l, s.h]);
        expect(widthOptions(st.type)).toContain(s.w);
        expect(heightOptions(s.w)).toContain(s.h);
        expect(n.openings).toEqual([]);
        expect(n.walls).toEqual(st.walls);
        if (st.type === 'combo') {
          expect(n.enclosedLength).toBeGreaterThanOrEqual(5);
          expect(n.enclosedLength).toBeLessThanOrEqual(n.length - 5);
        }
      }
    }
  });

  it('three barn styles, the way the owner described them (10/17/26)', () => {
    expect(BARNS.map((x) => x.title)).toEqual(['Standard barn', 'Raised center barn', 'Straight roof barn']);
    const ag = STYLES.find((x) => x.key === 'ag')!;
    for (const size of ag.sizes) {
      for (const barn of ['standard', 'raised', 'straight'] as const) {
        const d = cloneDesign(DEFAULT_DESIGN);
        applyStyle(d, 'ag', size, barn);
        const n = normalizeDesign(d, false);
        expect(n.type).toBe('garage');
        expect([n.width, n.length, n.height]).toEqual([size.w, size.l, size.h]);
        expect(n.leanTos.map((l) => l.side)).toEqual(['Left Eave', 'Right Eave']);
        // the rules keep every lean-to as built (nothing is snapped to something else)
        expect(n.leanTos).toEqual(d.leanTos);
        for (const l of n.leanTos) {
          expect(l.length).toBe(size.l);
          const drop = joinDrop(n, l);
          if (barn === 'standard') expect(drop).toBeCloseTo(2, 9);
          if (barn === 'raised') expect(drop).toBeCloseTo(raisedDrop(size.h), 9);
          if (barn === 'straight') {
            expect(drop).toBeCloseTo(0, 9); // meets the eave exactly...
            expect(l.pitch).toBe(pitchRise(n) === 3 ? '3:12' : '2:12'); // ...on the center building's own slope
          }
        }
        // standard: one lean-to closed in, the other open; the other barns: both open
        expect(n.leanTos.map((l) => l.enclosure)).toEqual(barn === 'standard' ? ['enclosed', 'open'] : ['open', 'open']);
      }
    }
  });

  it('raised center barn: the drop follows the wall height (10 or less 1′, 11-14 2′, 15-16 3′, 18-20 4′)', () => {
    for (const [h, drop] of [[6, 1], [8, 1], [10, 1], [11, 2], [12, 2], [14, 2], [15, 3], [16, 3], [17, 3], [18, 4], [20, 4]] as const) expect(raisedDrop(h)).toBe(drop);
    // and the exact join is built at every wall height from 9′ to 20′ (a 3:12 lean-to where 2:12 has no leg that fits)
    for (let h = 9; h <= 20; h++) {
      const d = cloneDesign(DEFAULT_DESIGN);
      applyStyle(d, 'ag', { label: '', w: h > 16 ? 40 : 24, l: 40, h }, 'raised');
      const n = normalizeDesign(d, false);
      expect(n.leanTos).toEqual(d.leanTos);
      for (const l of n.leanTos) expect(joinDrop(n, l), 'height ' + h).toBeCloseTo(raisedDrop(h), 9);
    }
  });

  it('no other style has lean-tos, and picking again replaces the last pick (Back, then another style)', () => {
    const d = cloneDesign(DEFAULT_DESIGN);
    const ag = STYLES.find((s) => s.key === 'ag')!;
    applyStyle(d, 'ag', ag.sizes[0], 'standard');
    expect(d.leanTos).toHaveLength(2);
    const carport = STYLES.find((s) => s.key === 'carport')!;
    applyStyle(d, 'carport', carport.sizes[0]);
    expect(d.leanTos).toEqual([]);
    expect(normalizeDesign(d, false).type).toBe('carport');
    expect(normalizeDesign(d, false).walls).toEqual(carport.walls);
    // partially enclosed -> carport again: the walls come back open
    applyStyle(d, 'partial', carport.sizes[0]);
    expect(normalizeDesign(d, false).walls).toEqual({ front: 'gableOnly', back: 'closed', left: 'closed', right: 'closed' });
    applyStyle(d, 'carport', carport.sizes[0]);
    expect(normalizeDesign(d, false).walls).toEqual(carport.walls);
  });

  it('wide span (40 wide) is only offered as a closed garage', () => {
    const wide = STYLES.filter((p) => p.sizes.some((s) => isWideSpan(s.w)));
    expect(wide.map((p) => p.key)).toEqual(['garage']);
  });

  it('a free-standing lean-to is not offered (the builder has no such building)', () => {
    expect(STYLES.some((s) => /free/i.test(s.title))).toBe(false);
  });
});

function applyStyle2(key: Parameters<typeof applyStyle>[1], s: Parameters<typeof applyStyle>[2]) {
  const d = cloneDesign(DEFAULT_DESIGN);
  applyStyle(d, key, s);
  return d;
}
