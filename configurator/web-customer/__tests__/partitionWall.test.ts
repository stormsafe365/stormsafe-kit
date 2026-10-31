/**
 * Add-ons (owner 10/31/26: "where are the partition walls ???? ... lean-tos should be add-ons with then the option to add a
 * lean-to or partition wall like on the customize page"): the partition wall = the program's End Storage. Same field names as
 * the website's builder, so the CRM reads it the way it already reads website designs (designShape.storageOf).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneDesign, wallLabel, type WebDesign, type WebOpening } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';
import {
  builtSpacingFt,
  openingWalls,
  storageCrossings,
  storageDefaultDepth,
  storageDepthOptions,
  storageNearest,
} from '../src/model/rules';
import { buildSpec } from '../src/model/spec';
import { designToConfig } from '../src/model/toConfig';
import { reviewRows } from '../src/panels/ReviewList';
import { SAMPLE_DESIGN } from './sample';

const ctx = { zip: null, county: null, impactParam: null };
const specCtx = { zip: null, county: null, impact: false };
const base = (o: Partial<WebDesign> = {}): WebDesign => {
  const d = cloneDesign(SAMPLE_DESIGN);
  d.type = 'garage';
  d.width = 24;
  d.length = 40;
  d.height = 12;
  d.walls = { front: 'closed', back: 'closed', left: 'closed', right: 'closed' };
  d.openings = [];
  d.leanTos = [];
  return { ...d, ...o };
};
const walk = (id: string, wall: WebOpening['wall'], pos: number): WebOpening => ({ id, kind: 'walk', wall, w: 3, h: 80 / 12, sill: 0, pos, style: 'std' });

// the program's own functions (public/quote-builder.html), run as they are
const PROGRAM = readFileSync(path.resolve(__dirname, '../../public/quote-builder.html'), 'utf8');
const grab = (name: string) => {
  const i = PROGRAM.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in the program`);
  let depth = 0;
  for (let j = PROGRAM.indexOf('{', i); j < PROGRAM.length; j++) {
    if (PROGRAM[j] === '{') depth++;
    else if (PROGRAM[j] === '}' && --depth === 0) return PROGRAM.slice(i, j + 1);
  }
  throw new Error(`${name} has no end`);
};
const prog = new Function(
  `var AEW_DEFAULT_FT=10;\n${grab('aewDepthOptions')}\n${grab('aewNearest')}\n${grab('aewDefaultDepth')}\nreturn { aewDepthOptions, aewNearest, aewDefaultDepth };`,
)() as {
  aewDepthOptions: (L: number, S: number, end: string) => number[];
  aewNearest: (o: number[], w: number) => number | null;
  aewDefaultDepth: (o: number[]) => number | null;
};

describe('partition wall: the program’s depth list', () => {
  it('same depths, default and nearest pick as the program for every length, spacing and end', () => {
    let n = 0;
    for (let L = 6; L <= 120; L++)
      for (const S of [4, 5])
        for (const end of ['front', 'back'] as const) {
          const mine = storageDepthOptions(L, S, end);
          expect(mine).toEqual(prog.aewDepthOptions(L, S, end));
          expect(storageDefaultDepth(mine)).toBe(prog.aewDefaultDepth(mine));
          for (const want of [1, 7.5, 10, 12, 13, 22.5, 40]) expect(storageNearest(mine, want)).toBe(prog.aewNearest(mine, want));
          n++;
        }
    expect(n).toBe(460);
  });
  it('a tie goes to the deeper line (32′ long, 4′ apart: 8′ and 12′ are both 2′ from 10′)', () => {
    const opts = storageDepthOptions(32, 4, 'back');
    expect(opts).toEqual([4, 8, 12, 16, 20, 24, 28]);
    expect(storageDefaultDepth(opts)).toBe(12);
  });
});

describe('partition wall: the page rules', () => {
  it('a design from before (no storage) has none: back end, 10′', () => {
    const d = base() as Partial<WebDesign>;
    delete d.storage;
    expect(normalizeDesign(d as WebDesign, false).storage).toEqual({ on: false, end: 'back', depth: 10 });
  });
  it('added: snaps to a frame line of the spacing the building is drawn with', () => {
    const d = base({ storage: { on: true, end: 'back', depth: 11 } });
    expect(normalizeDesign(d, false).storage).toEqual({ on: true, end: 'back', depth: 10 }); // 5′ apart
    expect(normalizeDesign(d, false, 'Palm Beach').storage).toEqual({ on: true, end: 'back', depth: 12 }); // 4′ apart there
    const oc4 = base({ storage: { on: true, end: 'front', depth: 11 } });
    oc4.upgrades = { ...oc4.upgrades, oc4: true };
    expect(builtSpacingFt(oc4, null)).toBe(4);
    expect(normalizeDesign(oc4, false).storage).toEqual({ on: true, end: 'front', depth: 12 });
    // wider than 24′ is 4′ apart anyway
    expect(normalizeDesign(base({ width: 30, storage: { on: true, end: 'back', depth: 10 } }), false).storage.depth).toBe(12);
  });
  it('junk is cleaned up', () => {
    const d = base({ storage: { on: 'yes', end: 'middle', depth: 'deep' } as unknown as WebDesign['storage'] });
    expect(normalizeDesign(d, false).storage).toEqual({ on: false, end: 'back', depth: 10 });
  });
  it('not on a Garage + Carport (its divider is the split), and not on a building too short for a bay each side', () => {
    expect(normalizeDesign(base({ type: 'combo', storage: { on: true, end: 'back', depth: 10 } }), false).storage.on).toBe(false);
    expect(storageDepthOptions(8, 5, 'back')).toEqual([]);
  });
  it('a carport gets one too (as on the website, and the program prices it)', () => {
    const d = base({ type: 'carport', width: 20, storage: { on: true, end: 'back', depth: 10 } });
    expect(normalizeDesign(d, false).storage.on).toBe(true);
  });
  it('doors on it: kept while it is there, taken off with it; windows are not offered on it', () => {
    const on = base({ storage: { on: true, end: 'back', depth: 10 }, openings: [walk('o1', 'partition', 4)] });
    const n = normalizeDesign(on, false);
    expect(n.openings.map((o) => o.wall)).toEqual(['partition']);
    expect(openingWalls(n)).toContain('partition');
    const off = normalizeDesign({ ...on, storage: { on: false, end: 'back', depth: 10 } }, false);
    expect(off.openings).toEqual([]);
    expect(openingWalls(off)).not.toContain('partition');
  });
  it('its name: Partition wall (a Garage + Carport’s stays its divider)', () => {
    expect(wallLabel(base(), 'partition')).toBe('Partition wall');
    expect(wallLabel(base({ type: 'combo' }), 'partition')).toBe('Garage/carport divider wall');
  });
});

describe('partition wall: a side door or window in its way (the program’s aewEaveConflicts)', () => {
  it('flags a side part the wall runs through, measured from the front on both sides', () => {
    // back end, 10′ deep on a 40′ building: the wall stands 30′ from the front
    const d = base({ openings: [walk('a', 'left', 28.5), walk('b', 'right', 29), walk('c', 'right', 31), walk('d', 'front', 29)] });
    const s = { end: 'back' as const, depth: 10 };
    expect(storageCrossings(d, s).map((o) => o.id)).toEqual(['a', 'b']);
    // the front end, 10′ deep: 10′ from the front
    expect(storageCrossings(d, { end: 'front', depth: 10 })).toEqual([]);
  });
  it('a part that only touches the wall line is fine', () => {
    const d = base({ openings: [walk('a', 'left', 27), walk('b', 'left', 30)] });
    expect(storageCrossings(d, { end: 'back', depth: 10 })).toEqual([]);
  });
});

describe('partition wall: the 3D, the spec and the review', () => {
  it('the 3D draws the program’s End Storage', () => {
    const back = normalizeDesign(base({ storage: { on: true, end: 'back', depth: 10 } }), false);
    expect(designToConfig(back, ctx).walls.storage).toEqual({ mode: 'endBack', lengthFt: 10 });
    const front = normalizeDesign(base({ storage: { on: true, end: 'front', depth: 15 } }), false);
    expect(designToConfig(front, ctx).walls.storage).toEqual({ mode: 'end', lengthFt: 15 });
    expect(designToConfig(normalizeDesign(base(), false), ctx).walls.storage).toEqual({ mode: 'none', lengthFt: 0 });
  });
  it('the spec and the review say where it is; nothing is added without one', () => {
    const d = normalizeDesign(base({ storage: { on: true, end: 'back', depth: 10 }, openings: [walk('o1', 'partition', 4)] }), false);
    const spec = buildSpec(d, specCtx);
    expect(spec).toContain('Partition wall: 10\' in from the back end, making a room 24\' W × 10\' deep (main room 30\')');
    expect(spec).toContain('Walk-in door');
    expect(spec).toMatch(/Partition wall, 4' from the left eave corner/);
    expect(reviewRows(d).find((r) => r.key === 'leantos')).toEqual({ key: 'leantos', label: 'Add-ons', lines: ['Partition wall: room 10′ deep at the back end'] });
    const plain = normalizeDesign(base(), false);
    expect(buildSpec(plain, specCtx)).not.toContain('Partition wall');
    expect(reviewRows(plain).find((r) => r.key === 'leantos')?.lines).toEqual(['None']);
  });
  it('the saved design carries it under the same names as the website (the CRM reads storage.on / end / depth)', () => {
    const d = normalizeDesign(base({ storage: { on: true, end: 'front', depth: 10 } }), false);
    expect(JSON.parse(JSON.stringify(d)).storage).toEqual({ on: true, end: 'front', depth: 10 });
  });
});
