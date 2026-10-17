// The guided start (owner 10/17/26): every starting size is one the builder accepts exactly as listed,
// for every kind of building a card can lead to, and nothing is added to the design.
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';
import { applyPreset, PURPOSES, SIDE_CHOICES } from '../src/model/guide';
import { heightOptions, isWideSpan, widthOptions } from '../src/model/rules';

describe('guided starting sizes', () => {
  it('the owner list is all there (width x length x height)', () => {
    const all = PURPOSES.flatMap((p) => p.sizes).map((s) => `${s.label} ${s.w}x${s.l}x${s.h}`);
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
    ]) expect(all).toContain(want);
  });

  it('every size is kept exactly, for every type its card can lead to', () => {
    for (const p of PURPOSES) {
      const types = p.type ? [p.type] : SIDE_CHOICES.map((c) => c.type);
      for (const type of types) {
        for (const s of p.sizes) {
          if (isWideSpan(s.w) && type !== 'garage') continue; // wide span is a garage only (the card never leads there)
          const d = cloneDesign(DEFAULT_DESIGN);
          applyPreset(d, type, s);
          const n = normalizeDesign(d, false);
          expect([p.key, type, s.label, n.type, n.width, n.length, n.height]).toEqual([p.key, type, s.label, type, s.w, s.l, s.h]);
          expect(widthOptions(type)).toContain(s.w);
          expect(heightOptions(s.w)).toContain(s.h);
          expect(n.openings).toEqual([]);
          expect(n.leanTos).toEqual([]);
          if (type === 'combo') {
            expect(n.enclosedLength).toBeGreaterThanOrEqual(5);
            expect(n.enclosedLength).toBeLessThanOrEqual(n.length - 5);
          }
        }
      }
    }
  });

  it('wide span (40 wide) is only offered as a closed garage', () => {
    const wide = PURPOSES.filter((p) => p.sizes.some((s) => isWideSpan(s.w)));
    expect(wide.map((p) => p.key)).toEqual(['other']);
    expect(wide[0].type).toBe('garage');
  });
});
