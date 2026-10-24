import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, LeanTo, Opening, StorageMode } from '@/types/building';
import { roofSurface, sheetIntervalsAt, shellLayout, storagePartitionEdges as shellEdges, wallBatches, wallTopAt, type ShellInput, type ShellWall } from '../enhanced/shellGeometry';
import { storagePartitionEdges, storagePartitionWainscot } from '../Siding';

// Owner 10/24/26 (30x80x18, storage 68' from the back, a framed opening on
// each eave): "the partition wall doesn't look connected to the eave side
// walls — an odd little gap / slit where the partition meets the eave wall".
// ROOT CAUSE: a storage partition was sheeted framing line to framing line
// (End Storage: x = -W/2..W/2; Left / Right: z = -L/2..L/2) like an end wall,
// but the outside walls it butts against are sheeted SHEET_OUTSET further out
// (x = +-(W/2 + SO), z = +-(L/2 + SO)) and, being interior, it gets no corner
// flashing — a SHEET_OUTSET (2.2") slit stood open at each end, showing the
// eave girts / the storage room behind. Now each end of the partition's sheet
// runs on to the inside face of that wall's sheet wherever (and as high as)
// that wall is sheeted on the partition's sheet line.

const SO = SHEET_OUTSET;

const build = (over: Partial<BuildingConfig> = {}, storage: { mode: StorageMode; lengthFt: number } = { mode: 'endBack', lengthFt: 68 }) => {
  const cfg: BuildingConfig = {
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 30,
    length: 80,
    legHeight: 18,
    trussSpacingFt: 4,
    manufacturer: 'CCI',
    wainscot: { enabled: false, heightFt: 3 },
    openings: [],
    ...over,
    walls: { ...DEFAULT_CONFIG.walls, storage },
  };
  return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
};
const input = (cfg: BuildingConfig, s: StructureModel): ShellInput => ({
  structure: s,
  openings: cfg.openings,
  wallOrientation: cfg.panelOrientation,
  colors: cfg.colors,
  wainscot: cfg.wainscot,
});
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** Enhanced: the partition wall + the regions lying in its end pieces (beyond its framing lines). */
const enhanced = (cfg: BuildingConfig, s: StructureModel) => {
  const layout = shellLayout(input(cfg, s));
  const part = layout.walls.find((w) => w.plane.id === 'partition')!;
  const frame = part.plane.along === 'x' ? s.width / 2 : s.length / 2;
  const edges = part.regions.filter((r) => r.c1 <= -frame + 1e-9 || r.c0 >= frame - 1e-9);
  return { layout, part, edges, frame };
};
/** The sheeted vertical extent of the union of `regions` on the along-wall line c. */
const coveredAt = (regions: { c0: number; c1: number; y0: number; y1: number }[], c: number) =>
  regions
    .filter((r) => c >= r.c0 - 1e-9 && c <= r.c1 + 1e-9)
    .map((r) => [r6(r.y0), r6(r.y1)])
    .sort((a, b) => a[0] - b[0]);
// Eave framed openings: internal 'left' = program Right Eave Side; z = -L/2 + offset.
const fo = (side: Opening['side'], offset: number, width = 10, height = 8, sillHeight = 0): Opening => ({ id: `${side}-${offset}`, type: 'frameOut', side, offset, width, height, sillHeight });

describe("End Storage: the partition's sheet meets the eave sheets (the owner's 30x80x18, storage 68' from the back)", () => {
  const { cfg, s } = build({ openings: [fo('left', 6), fo('right', 6.5)] }); // FOs 1'..11' / 1.5'..11.5' from the front: beside the partition (12')
  const { part, edges, layout } = enhanced(cfg, s);
  it('the partition sheet is SO off its framing line toward the main room; the eave sheets SO outside theirs', () => {
    expect(s.enclosure.partitionZ).toBe(-28);
    expect(part.plane.at).toBeCloseTo(-28 - SO, 12);
    expect(Math.abs(layout.walls.find((w) => w.plane.id === 'left')!.plane.at)).toBeCloseTo(15 + SO, 12);
  });
  it('enhanced: an end piece on each side, framing line -> eave sheet face, slab -> eave sheet top', () => {
    const top = wallTopAt(roofSurface(s), 15 + SO);
    expect(edges.map((r) => [r6(r.c0), r6(r.c1), r6(r.y0), r6(r.y1)])).toEqual([
      [-15.18, -15, 0, r6(top)],
      [15, 15.18, 0, r6(top)],
    ]);
    // with the main run, the sheet now spans eave sheet to eave sheet with no gap at any height up to the eave
    for (const c of [-15.17, -15.09, 15.01, 15.17]) expect(coveredAt(part.regions, c)).toEqual([[0, r6(top)]]);
    // base trim to the corner too
    expect(part.base.map((b) => [r6(b.c0), r6(b.c1)])).toEqual([
      [-15, 15],
      [-15.18, -15],
      [15, 15.18],
    ]);
  });
  it("classic: the same pieces (the classic eave sheet's own top: the eave height)", () => {
    const e = storagePartitionEdges(s, cfg.openings);
    expect(e.map((p) => [p.plane, r6(p.at), r6(p.u0), r6(p.u1), r6(p.y0), r6(p.y1)])).toEqual([
      ['cross', -28.18, -15.18, -15, 0, 18],
      ['cross', -28.18, 15, 15.18, 0, 18],
    ]);
  });
  it('drawn: the enhanced wall batch has partition-plane triangles out to x = +-15.18', () => {
    const xs: number[] = [];
    for (const b of wallBatches(input(cfg, s)))
      for (let i = 0; i < b.position.length; i += 3) if (Math.abs(b.position[i + 2] - (-28 - SO)) < 1e-4) xs.push(b.position[i]);
    expect(Math.min(...xs)).toBeCloseTo(-15.18, 5);
    expect(Math.max(...xs)).toBeCloseTo(15.18, 5);
  });
});

describe('every eave condition at the partition line (both looks agree)', () => {
  const both = (over: Partial<BuildingConfig>, storage?: { mode: StorageMode; lengthFt: number }) => {
    const { cfg, s } = build(over, storage);
    const e = enhanced(cfg, s).edges.map((r) => [r6(r.c0), r6(r.c1), r6(r.y0)]);
    const c = storagePartitionEdges(s, cfg.openings).map((p) => [r6(p.u0), r6(p.u1), r6(p.y0)]);
    return { e, c, s, cfg };
  };
  it('closed both sides: two full-height pieces', () => {
    const { e, c } = both({});
    expect(e).toEqual([
      [-15.18, -15, 0],
      [15, 15.18, 0],
    ]);
    expect(c).toEqual(e);
  });
  it('an eave side OPEN: no piece on that side (the sheet ends at the post as before), the closed side still closes', () => {
    const { e, c } = both({ wallOverrides: { leftOpen: true, rightOpen: false } });
    expect(e).toEqual([[15, 15.18, 0]]);
    expect(c).toEqual(e);
  });
  it('a partial eave band (eave-down 6 ft): a hanging piece the height of the band, no base trim under it', () => {
    const { cfg, s } = build({ wallOverrides: { leftOpen: false, rightOpen: false, leftBandFt: 6 } });
    const { part, edges } = enhanced(cfg, s);
    const left = edges.filter((r) => r.c1 <= -15 + 1e-9);
    expect(left.map((r) => [r6(r.y0), r6(r.y1)])).toEqual([[12, r6(wallTopAt(roofSurface(s), -15.18))]]);
    expect(part.base.some((b) => b.c1 <= -15 + 1e-9)).toBe(false);
    expect(part.bottom).toEqual([]); // the eave band's own bottom trim finishes it
    const c = storagePartitionEdges(s, cfg.openings).filter((p) => p.u1 <= -15 + 1e-9);
    expect(c.map((p) => [p.y0, p.y1])).toEqual([[12, 18]]);
  });
  it('a framed opening CROSSING the partition line: the piece stops above it (the opening stays open)', () => {
    const { e, c, cfg, s } = both({ openings: [fo('right', 12, 10, 8)] }); // z -35..-25 across the sheet line -28.18
    expect(e).toEqual([
      [-15.18, -15, 0],
      [15, 15.18, 8],
    ]);
    expect(c).toEqual(e);
    const right = enhanced(cfg, s).edges.find((r) => r.c0 >= 15 - 1e-9)!;
    expect(r6(right.y1)).toBe(r6(wallTopAt(roofSurface(s), 15.18)));
  });
  it("a framed opening whose jamb IS the partition's bent (spans the sheet line, not the framing line): full piece, closing the slit at that jamb", () => {
    // right FO z -40..-28: its back jamb on the partition's framing line (-28), 0.18' past its sheet line (-28.18)
    const { e, c } = both({ openings: [fo('right', 6, 12, 8)] });
    expect(e).toEqual([
      [-15.18, -15, 0],
      [15, 15.18, 0],
    ]);
    expect(c).toEqual(e);
    // ...the storage at the front, an FO jamb on its bent from the main-room (back) side
    const f = both({ openings: [fo('left', 74, 12, 8)] }, { mode: 'end', lengthFt: 68 }); // partition at z 28, sheet 28.18; FO z 28..40
    expect(f.e).toEqual([
      [-15.18, -15, 0],
      [15, 15.18, 0],
    ]);
    expect(f.c).toEqual(f.e);
  });
  it('a framed opening ENDING beside the line (the owner\'s layout): the piece is full height', () => {
    // right FO z -39..-29 (1' short of the partition sheet), left one ending 0.1 ft short of it
    const { e, c } = both({ openings: [fo('right', 6), fo('left', 6.72, 10, 8)] });
    expect(e).toEqual([
      [-15.18, -15, 0],
      [15, 15.18, 0],
    ]);
    expect(c).toEqual(e);
  });
  it('vertical panels, a lean-to on the eave, a front-end storage room: same pieces', () => {
    const lt: LeanTo = { id: 'lt', type: 'attached', attachedSide: 'Left Eave', widthFt: 12, lengthFt: 80, lowLegHeightFt: 12, roofPitch: '2:12', enclosure: 'enclosed', openings: [] };
    for (const [over, st] of [
      [{ panelOrientation: 'Vertical' }, undefined],
      [{ leanTos: [lt] }, undefined],
      [{}, { mode: 'end', lengthFt: 12 }],
    ] as [Partial<BuildingConfig>, { mode: StorageMode; lengthFt: number } | undefined][]) {
      const { e, c } = both(over, st);
      expect(e).toEqual([
        [-15.18, -15, 0],
        [15, 15.18, 0],
      ]);
      expect(c).toEqual(e);
    }
  });
  it('narrow (12 ft) and wide (60 ft): pieces at +-(W/2 .. W/2 + SO)', () => {
    for (const W of [12, 60]) {
      const { e, c } = both({ width: W, legHeight: 12 }, { mode: 'endBack', lengthFt: 40 });
      expect(e).toEqual([
        [r6(-(W / 2 + SO)), -W / 2, 0],
        [W / 2, r6(W / 2 + SO), 0],
      ]);
      expect(c).toEqual(e);
    }
  });
});

describe('Left / Right lengthwise partition: its ends meet the end walls', () => {
  it('closed ends: full pieces (slab to the roofline at the sheet); gable-only front: the gable only; open back: none', () => {
    const { cfg, s } = build({ length: 40, legHeight: 12, wallOverrides: { front: 'gableOnly', back: 'open', leftOpen: false, rightOpen: false } }, { mode: 'right', lengthFt: 12 });
    const { edges } = enhanced(cfg, s);
    const X0 = 3 - SO;
    const top = r6(wallTopAt(roofSurface(s), X0));
    expect(edges.map((r) => [r6(r.c0), r6(r.c1), r6(r.y1)])).toEqual([[-20.18, -20, top]]);
    expect(r6(edges[0].y0)).toBeGreaterThan(11.8); // the gable starts at the eave line
    const c = storagePartitionEdges(s, cfg.openings);
    expect(c.map((p) => [p.plane, r6(p.at), r6(p.u0), r6(p.u1), p.y0])).toEqual([['side', r6(X0), -20.18, -20, 12]]);
    const closed = build({ length: 40, legHeight: 12 }, { mode: 'left', lengthFt: 10 });
    expect(enhanced(closed.cfg, closed.s).edges.map((r) => [r6(r.c0), r6(r.c1), r6(r.y0)])).toEqual([
      [-20.18, -20, 0],
      [20, 20.18, 0],
    ]);
  });
  it('an end-wall door over the partition line cuts the piece around it', () => {
    // right storage 12 -> sheet x 2.82; front door x -2..6 (offset 17, 8 wide) covers it up to 8'
    const { cfg, s } = build({ length: 40, legHeight: 12, openings: [{ id: 'd', type: 'rollUpDoor', side: 'front', offset: 17, width: 8, height: 8, sillHeight: 0 }] }, { mode: 'right', lengthFt: 12 });
    const front = enhanced(cfg, s).edges.filter((r) => r.c1 <= -20 + 1e-9);
    expect(front.map((r) => r6(r.y0))).toEqual([8]);
    expect(storagePartitionEdges(s, cfg.openings).filter((p) => p.u1 <= -20 + 1e-9).map((p) => p.y0)).toEqual([8]);
  });
});

describe('classic wainscot runs over the end pieces; the GCH divider is unchanged', () => {
  it('End Storage band + cap span eave sheet to eave sheet (only where a piece covers the band)', () => {
    const { cfg, s } = build({ wainscot: { enabled: true, heightFt: 3 }, wallOverrides: { leftOpen: true, rightOpen: false } });
    const b = storagePartitionWainscot(s, cfg.openings, cfg.wainscot)!;
    expect(b.cap.map((c) => [r6(c.u0), r6(c.u1)])).toEqual([[-15, 15.18]]); // open left side: band stops at the framing line there
    expect(r6(b.strips[0].u0)).toBe(-15);
    expect(r6(b.strips[b.strips.length - 1].u1)).toBe(15.18);
  });
  it('the GCH divider (an outside corner with its own corner trim) gets no pieces in either look', () => {
    const { cfg, s } = build({ buildingType: 'utility', length: 40, legHeight: 12, enclosedLengthFt: 20, openEnd: 'front' }, { mode: 'none', lengthFt: 0 });
    expect(storagePartitionEdges(s, cfg.openings)).toEqual([]);
    const { part } = enhanced(cfg, s);
    expect(part.regions.every((r) => r.c0 >= -15 - 1e-9 && r.c1 <= 15 + 1e-9)).toBe(true); // framing line to framing line, as before
    expect(shellEdges(shellLayout(input(cfg, s)).walls.filter((w) => w.plane.id !== 'partition'), s)).toEqual([]);
  });
});

describe('sheetIntervalsAt', () => {
  const wall = (over: Partial<ShellWall>): ShellWall => ({
    plane: { id: 'left', along: 'z', at: -15.18, n: [-1, 0, 0], u: [0, 0, 1] },
    flip: false,
    holes: [],
    regions: [],
    polys: [],
    base: [],
    bottom: [],
    cap: [],
    ...over,
  });
  it('merges touching regions (wainscot + wall), drops the line outside them', () => {
    const w = wall({ regions: [
      { c0: -40, c1: 40, y0: 0, y1: 3, wainscot: true },
      { c0: -40, c1: 40, y0: 3, y1: 17.8, wainscot: false },
    ] });
    expect(sheetIntervalsAt(w, -28.18)).toEqual([[0, 17.8]]);
    expect(sheetIntervalsAt(w, 41)).toEqual([]);
  });
  it('subtracts an opening only when it runs past the line on both sides', () => {
    const w = wall({
      regions: [{ c0: -40, c1: 40, y0: 0, y1: 17.8, wainscot: false }],
      holes: [
        { c: -30, w: 10, y0: 0, y1: 8 }, // -35..-25: across -28.18
        { c: 0, w: 4, y0: 4, y1: 7 }, // elsewhere
      ],
    });
    expect(sheetIntervalsAt(w, -28.18)).toEqual([[8, 17.8]]);
    expect(sheetIntervalsAt(w, -25)).toEqual([[0, 17.8]]); // the line on the jamb: sheet edge stays
    // it must also run past `alsoPast` (a partition's framing line) to cut
    expect(sheetIntervalsAt(w, -28.18, -28)).toEqual([[8, 17.8]]);
    expect(sheetIntervalsAt(w, -25.18, -25)).toEqual([[0, 17.8]]); // jamb on the framing line: not crossing
    expect(sheetIntervalsAt(w, 0)).toEqual([
      [0, 4],
      [7, 17.8],
    ]);
  });
  it('a gable polygon adds its height on the line', () => {
    const w = wall({ regions: [{ c0: -15, c1: 15, y0: 0, y1: 12, wainscot: false }], polys: [[[-15, 12], [15, 12], [0, 15.75]]] });
    const [[a, b]] = sheetIntervalsAt(w, 3);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(15.75 - 3 * (3.75 / 15), 9);
  });
});
