// V2 Doors & windows sheet (design-v2, 10/20/26): wall lines, size presets (only sizes the page offers),
// Left / Center / Right -> the typed position, and the fit (the page's own no-overlap rule).
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN, type WebDesign, type WebOpening } from '../src/model/design';
import { ROLLUP_HEIGHTS, ROLLUP_WIDTHS, WALK_DOOR_H_FT, WALK_DOOR_W_FT, WINDOWS } from '../src/model/catalog';
import { fitMainPos, mainSpotOk } from '../src/model/positions';
import { CORNER_CLEAR, rollupFits } from '../src/model/rules';
import {
  choiceToWantPos,
  defaultPreset,
  placeOnWall,
  posToChoice,
  refOnViewerLeft,
  rollupOptions,
  sizePresets,
  viewerX,
  wallCountLine,
  wallEnds,
  wallInfo,
  windowStyleFor,
} from '../src/model/sheet';

const bare = (o: Partial<WebDesign> = {}): WebDesign => ({
  ...cloneDesign(DEFAULT_DESIGN),
  type: 'garage',
  width: 30,
  length: 40,
  height: 14,
  walls: { ...DEFAULT_DESIGN.walls, front: 'closed', back: 'closed', left: 'closed', right: 'closed' },
  openings: [],
  ...o,
});
const door = (id: string, wall: WebOpening['wall'], pos: number, w = 10, h = 10): WebOpening => ({ id, kind: 'rollup', wall, w, h, sill: 0, pos, color: 'white' });

describe('wall cards', () => {
  it('say the real size and what the wall is', () => {
    const d = bare();
    expect(wallInfo(d, 'front')).toMatchObject({ name: 'Front end', sizeLine: '30′ end', shape: 'gable', lengthFt: 30 });
    expect(wallInfo(d, 'back').sizeLine).toBe('30′ end');
    expect(wallInfo(d, 'left')).toMatchObject({ name: 'Left side', sizeLine: '40′ long side', shape: 'side', lengthFt: 40 });
    expect(wallInfo(d, 'right').sizeLine).toBe('40′ long side');
    expect(wallInfo(d, 'partition').sizeLine).toBe('30′ divider');
  });
  it('count what is on the wall', () => {
    expect(wallCountLine([{ kind: 'rollup' }, { kind: 'rollup' }, { kind: 'window' }])).toBe('2 garage doors, 1 window');
    expect(wallCountLine([{ kind: 'walk' }])).toBe('1 walk-in door');
    expect(wallCountLine([])).toBe('');
  });
});

describe('size presets: only sizes the page already offers', () => {
  it('garage doors: catalog pairs that fit the wall, 10′ × 10′ tagged Popular and picked first', () => {
    const d = bare();
    const p = sizePresets(d, 'rollup', 'front', 1);
    expect(p.length).toBeGreaterThan(0);
    for (const x of p) {
      expect(ROLLUP_WIDTHS).toContain(x.w as never);
      expect(ROLLUP_HEIGHTS).toContain(x.h as never);
      expect(rollupFits(d, 'front', x.w, x.h, 1)).toBe(true);
      expect(rollupOptions(d, 'front', 1)).toContainEqual([x.w, x.h]);
    }
    const pop = p.filter((x) => x.tag === 'Popular');
    expect(pop).toHaveLength(1);
    expect(pop[0]).toMatchObject({ w: 10, h: 10, label: '10′ × 10′' });
    expect(defaultPreset('rollup', p)).toBe(pop[0]);
  });
  it('garage doors on a short wall: no 10′ × 10′, so no Popular; the start is the old 10′ × 8′', () => {
    const d = bare({ height: 9 }); // end wall: doors up to 9′ tall
    const p = sizePresets(d, 'rollup', 'front', 1);
    expect(p.some((x) => x.h > 9)).toBe(false);
    expect(p.some((x) => x.tag === 'Popular')).toBe(false);
    expect(defaultPreset('rollup', p)).toMatchObject({ w: 10, h: 8 });
  });
  it('side walls keep the program rule (door ≤ wall height − 2′)', () => {
    const d = bare({ height: 10 });
    for (const x of sizePresets(d, 'rollup', 'left', 1)) expect(x.h).toBeLessThanOrEqual(8);
  });
  it('2+ garage doors on an end wall: ≤ wall height − 1′ (the count is part of the rule)', () => {
    const d = bare({ height: 10 });
    expect(sizePresets(d, 'rollup', 'front', 1).some((x) => x.w === 10 && x.h === 10)).toBe(true);
    expect(sizePresets(d, 'rollup', 'front', 2).some((x) => x.h > 9)).toBe(false);
  });
  it('a width that cannot sit next to what is there is not offered', () => {
    const d = bare({ width: 24 });
    const p = sizePresets(d, 'rollup', 'front', 2, (w) => w <= 9);
    expect(p.every((x) => x.w <= 9)).toBe(true);
  });
  it('walk-in door: the one 3′ × 6′8″ door (no 3′ × 7′ is invented)', () => {
    const p = sizePresets(bare(), 'walk', 'left', 0);
    expect(p).toEqual([{ key: 'walk', w: WALK_DOOR_W_FT, h: WALK_DOOR_H_FT, label: '3′ × 6′8″', tag: 'Standard' }]);
    expect(p.some((x) => x.w === 3 && x.h === 7)).toBe(false);
  });
  it('windows: the catalog 30″ × 30″ and 30″ × 36″ (no 3′ × 3′ is invented)', () => {
    const p = sizePresets(bare(), 'window', 'left', 0);
    expect(p.map((x) => x.label)).toEqual(['30″ × 30″', '30″ × 36″']);
    for (const x of p) expect(WINDOWS.some((t) => t.wIn === Math.round(x.w * 12) && t.hIn === Math.round(x.h * 12))).toBe(true);
    expect(p[0].tag).toBe('Standard');
  });
  it('opening: the 4′ × 7′ start size the page always used (lower walls: wall − 1′)', () => {
    expect(sizePresets(bare(), 'frame', 'left', 0)[0]).toMatchObject({ w: 4, h: 7 });
    expect(sizePresets(bare({ height: 7 }), 'frame', 'left', 0)[0]).toMatchObject({ w: 4, h: 6 });
  });
  it('a window keeps its look when its size changes', () => {
    expect(windowStyleFor('std', 36)).toBe('w3036');
    expect(windowStyleFor('w3036', 30)).toBe('std');
    expect(windowStyleFor('b3030', 36)).toBe('b3036');
    expect(windowStyleFor('hi', 36)).toBe('hi3036');
    expect(windowStyleFor('hi3036', 30)).toBe('hi');
  });
});

describe('Left / Center / Right', () => {
  it('front end 30′, a 10′ door: center = 10′ in, left = 1′ from the front-left corner, right = 1′ from the other', () => {
    const d = bare();
    expect(choiceToWantPos(d, 'front', 10, 'center')).toBe(10);
    expect(choiceToWantPos(d, 'front', 10, 'left')).toBe(CORNER_CLEAR);
    expect(choiceToWantPos(d, 'front', 10, 'right')).toBe(30 - 10 - CORNER_CLEAR);
  });
  it('seen from outside: the left side wall has its front end on the viewer’s RIGHT, every other wall its reference end on the left', () => {
    expect(refOnViewerLeft('front')).toBe(true);
    expect(refOnViewerLeft('back')).toBe(true);
    expect(refOnViewerLeft('right')).toBe(true);
    expect(refOnViewerLeft('partition')).toBe(true);
    expect(refOnViewerLeft('left')).toBe(false);
    expect(wallEnds('left')).toEqual(['back', 'front']);
    expect(wallEnds('right')).toEqual(['front', 'back']);
    const d = bare();
    // left side 40′: "Left" (viewer) = near the back end = far from the front-end reference
    expect(choiceToWantPos(d, 'left', 3, 'left')).toBe(40 - 3 - CORNER_CLEAR);
    expect(choiceToWantPos(d, 'left', 3, 'right')).toBe(CORNER_CLEAR);
    expect(choiceToWantPos(d, 'right', 3, 'left')).toBe(CORNER_CLEAR);
    // the 2-D picture puts each where the buttons say
    expect(viewerX(d, 'left', CORNER_CLEAR, 3)).toBe(40 - 3 - CORNER_CLEAR);
    expect(viewerX(d, 'front', 10, 10)).toBe(10);
  });
  it('an empty wall: each choice lands exactly where asked, legal, and reads back as the same choice', () => {
    const d = bare();
    for (const wall of ['front', 'back', 'left', 'right'] as const)
      for (const c of ['left', 'center', 'right'] as const) {
        const p = placeOnWall(d, wall, 10, c, null)!;
        expect(p.moved).toBe(false);
        expect(mainSpotOk(d, { id: 'n', wall, pos: p.pos, w: 10 })).toBe(true);
        expect(posToChoice(d, wall, 10, p.pos)).toBe(c);
      }
  });
  it('the spot asked for is taken: the nearest free spot (the same fit as dragging), never an overlap', () => {
    const d = bare({ openings: [door('o1', 'front', 10)] }); // a 10′ door in the middle of the 30′ front
    const p = placeOnWall(d, 'front', 8, 'center', null)!;
    expect(p.moved).toBe(true);
    expect(p.pos).toBe(fitMainPos(d, 'front', 8, choiceToWantPos(d, 'front', 8, 'center'), null));
    expect(mainSpotOk({ ...d, openings: [...d.openings, door('n', 'front', p.pos, 8, 8)] }, { id: 'n', wall: 'front', pos: p.pos, w: 8 })).toBe(true);
  });
  it('no room left: refused (null), as the page refuses a drag or a card change', () => {
    const d = bare({ width: 24, openings: [door('o1', 'front', 1, 10, 8), door('o2', 'front', 13, 10, 8)] });
    expect(placeOnWall(d, 'front', 10, 'center', null)).toBe(null);
    expect(placeOnWall(d, 'front', 10, 'left', null)).toBe(null);
    expect(placeOnWall(d, 'front', 10, 5, null)).toBe(null);
  });
  it('an exact position (Advanced) is fitted the same way', () => {
    const d = bare();
    expect(placeOnWall(d, 'front', 10, 4.5, null)).toEqual({ pos: 4.5, moved: false });
    const clamped = placeOnWall(d, 'front', 10, 25, null)!; // past the far corner: pulled back to 1′ clear
    expect(clamped.moved).toBe(true);
    expect(clamped.pos).toBeLessThanOrEqual(30 - 10 - CORNER_CLEAR + 1e-9);
  });
  it('editing a part: it does not collide with itself', () => {
    const d = bare({ openings: [door('o1', 'front', 10)] });
    expect(placeOnWall(d, 'front', 10, 'center', 'o1')).toEqual({ pos: 10, moved: false });
  });
  it('Garage + Carport side: Left / Center / Right stay on the garage part of the wall', () => {
    const d = bare({ type: 'combo', length: 40, enclosedLength: 20 });
    for (const c of ['left', 'center', 'right'] as const) {
      const p = placeOnWall(d, 'right', 10, c, null)!;
      expect(p).not.toBe(null);
      expect(p.pos).toBeGreaterThanOrEqual(20); // the front 20′ is the open carport
      expect(mainSpotOk(d, { id: 'n', wall: 'right', pos: p.pos, w: 10 })).toBe(true);
    }
  });
});
