/**
 * Owner 10/31/26: "trying to move the window it keeps going back next to the other one i just moved it from" - the
 * position box's − / + steps half a foot; a step that lands within 1′ of a neighbour used to snap straight back.
 */
import { describe, expect, it } from 'vitest';
import { cloneDesign, type WebDesign } from '../src/model/design';
import { placeOnWall, stepOnWall } from '../src/model/sheet';
import { SAMPLE_DESIGN } from './sample';

// her right side (30′ long): window A, walk door, window B (being moved), window C 1′ past it
function wall(): WebDesign {
  const d = cloneDesign(SAMPLE_DESIGN);
  Object.assign(d, { type: 'garage', width: 24, length: 30, height: 10, walls: { front: 'closed', back: 'closed', left: 'closed', right: 'closed' }, leanTos: [] });
  d.openings = [
    { id: 'a', kind: 'window', wall: 'right', w: 2.5, h: 2.5, sill: 50 / 12, pos: 3, style: 'std' },
    { id: 'door', kind: 'walk', wall: 'right', w: 3, h: 80 / 12, sill: 0, pos: 9, style: 'std' },
    { id: 'c', kind: 'window', wall: 'right', w: 2.5, h: 2.5, sill: 50 / 12, pos: 18.75, style: 'std' },
  ];
  return d; // window B (2.5′ wide) is the one being moved: not in the list (the sheet's `base`)
}

describe('the position box steps past a neighbour instead of snapping back', () => {
  it('before: a + step beside window C went straight back', () => {
    expect(placeOnWall(wall(), 'right', 2.5, 15.75, null)!.pos).toBe(15.25);
  });
  it('+ from 15.25 jumps past window C to the first free spot', () => {
    const s = stepOnWall(wall(), 'right', 2.5, 15.25, 15.75, null)!;
    expect(s.pos).toBe(22.25); // window C ends at 21.25, + 1′
  });
  it('a free step is just that step', () => {
    expect(stepOnWall(wall(), 'right', 2.5, 15.25, 14.75, null)!.pos).toBe(14.75);
  });
  it('− into the door jumps past it only if there is room; here there is not (window A), so it stays', () => {
    expect(stepOnWall(wall(), 'right', 2.5, 13, 12.5, null)!.pos).toBe(13);
  });
  it('− past the door when there is room on the other side', () => {
    const d = wall();
    d.openings = d.openings.filter((o) => o.id !== 'a');
    expect(stepOnWall(d, 'right', 2.5, 13, 12.5, null)!.pos).toBe(5.5); // the door starts at 9: 9 − 1′ − 2.5′
  });
  it('a typed number in a taken spot that is a move the right way keeps the nearest free spot', () => {
    expect(stepOnWall(wall(), 'right', 2.5, 15.25, 21, null)!.pos).toBe(22.25);
  });
});
