import { describe, expect, it } from 'vitest';
import { buildSpec, overallFootprint } from '../src/model/spec';
import { SAMPLE_DESIGN } from './sample';
import { cloneDesign, type WebDesign } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';

const ctx = { zip: '33401', county: 'Palm Beach', impact: false };

function sample(): WebDesign {
  const d = cloneDesign(SAMPLE_DESIGN);
  d.width = 30;
  d.length = 40;
  d.height = 12;
  d.leanTos = [
    {
      id: 'lt1',
      side: 'Left Eave',
      width: 12,
      length: 40,
      start: 0,
      lowLeg: 9,
      pitch: '2:12',
      enclosure: 'enclosed',
      walls: { front: 'open', back: 'open', side: 'open' },
      openings: [{ id: 'lo1', kind: 'rollup', wall: 'outer', w: 8, h: 7, sill: 0, pos: 20, color: 'black' }],
    },
    {
      id: 'lt2',
      side: 'Front Gable',
      width: 12,
      length: 30,
      start: 0,
      lowLeg: 9,
      pitch: '2:12',
      enclosure: 'open',
      walls: { front: 'open', back: 'open', side: 'open' },
      openings: [],
    },
  ];
  d.wraps = ['FL'];
  return normalizeDesign(d, false);
}

describe('buildSpec — the plain-text design spec', () => {
  it('writes the size W × L × H and the building type', () => {
    const s = buildSpec(normalizeDesign(SAMPLE_DESIGN, false), ctx);
    expect(s).toContain("Building: Garage — 24' W × 30' L × 10' H");
    expect(s).toContain('Roof: Vertical roof, 3:12 pitch (standard)');
  });

  it('gives every door / window its wall, size and position in the program’s words', () => {
    const s = buildSpec(normalizeDesign(SAMPLE_DESIGN, false), ctx);
    expect(s).toContain("1. Roll-up door 10' W × 8' H, White — Front end, 7' from the left eave corner to its near edge");
    expect(s).toContain('2. Walk-in door 36" × 80", Standard, white — Left side, 6\' from the front gable to its near edge');
    expect(s).toContain("3. Window 30\" × 30\", White — Left side, 14' from the front gable to its near edge, sill 4'2\"");
  });

  it('describes the back end and right side from their own program references', () => {
    const d = cloneDesign(SAMPLE_DESIGN);
    d.openings = [
      { id: 'a', kind: 'rollup', wall: 'back', w: 8, h: 8, sill: 0, pos: 4, color: 'white' },
      { id: 'b', kind: 'frame', wall: 'right', w: 4, h: 7, sill: 0, pos: 10, frame: 'door' },
    ];
    const s = buildSpec(normalizeDesign(d, false), ctx);
    expect(s).toContain("Back end, 4' from the right eave corner to its near edge");
    expect(s).toContain("Framed opening (door) 4' W × 7' H, customer-supplied unit — Right side, 10' from the front gable to its near edge");
  });

  it('lists lean-tos with Starts At, walls, wrap-around corners and their parts', () => {
    const s = buildSpec(sample(), ctx);
    expect(s).toContain("1. Left side lean-to 12' W × 40' L, low leg 9', 2:12 pitch, starts 0' from the front end — walls: Fully enclosed");
    expect(s).toContain('Wraps around the front-left corner');
    expect(s).toContain("a. Roll-up door 8' W × 7' H, Black — outer wall, 20' from the left end to its near edge");
    expect(s).toContain("2. Front end lean-to 12' W × 30' L, low leg 9', 2:12 pitch, starts 0' from the front-left corner — walls: Open");
    expect(s).toContain("Overall with lean-tos: 42' W × 52' L");
    expect(overallFootprint(sample())).toEqual({ w: 42, l: 52 });
  });

  it('describes a garage + carport split', () => {
    const d = cloneDesign(SAMPLE_DESIGN);
    d.type = 'combo';
    d.enclosedLength = 20;
    d.walls = { front: 'gableOnly', back: 'closed', left: '2panel', right: 'open' };
    d.openings = [{ id: 'p', kind: 'rollup', wall: 'partition', w: 10, h: 8, sill: 0, pos: 7, color: 'white' }];
    const s = buildSpec(normalizeDesign(d, false), ctx);
    expect(s).toContain("Garage + Carport — 24' W × 30' L × 10' H (enclosed garage 20' at the back, open carport 10' at the front)");
    expect(s).toContain('- Front end (carport): Gable only (top triangle)');
    expect(s).toContain("- Left side, carport part: 2 panels from the top (6′) (garage part closed)");
    expect(s).toContain("Garage/carport divider wall, 7' from the left eave corner to its near edge");
  });

  it('notes the location and the impact rule; impact designs list the rated parts', () => {
    const s = buildSpec(normalizeDesign(SAMPLE_DESIGN, true), { ...ctx, impact: true });
    expect(s).toContain('Location: ZIP 33401, Palm Beach County, FL');
    expect(s).toContain('Impact area: impact-rated windows and walk-in doors');
    expect(s).toContain('Walk-in door 36" × 80", Impact-rated (hi-wind), white');
    expect(s).toContain('Window 30" × 30", Impact-rated');
    expect(buildSpec(normalizeDesign(SAMPLE_DESIGN, false), { zip: null, county: null, impact: false })).toContain('Location: Not given');
  });

  it('flags a part on a wall that is not closed', () => {
    const d = normalizeDesign(SAMPLE_DESIGN, false);
    d.walls.left = 'open';
    expect(buildSpec(d, ctx)).toContain('(this wall is not closed: not shown on the model)');
  });

  it('never shows prices, manufacturers or wind numbers', () => {
    for (const s of [buildSpec(sample(), ctx), buildSpec(normalizeDesign(SAMPLE_DESIGN, true), { ...ctx, impact: true })]) {
      expect(s).not.toMatch(/\$|price|cost|CCI|Carolina|Coast to Coast|\bCA\b|mph|gauge|\bOC\b|certif/i);
    }
  });
});
