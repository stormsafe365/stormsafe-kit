import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '@/engine/ruleEngine';
import { deriveStructure, type StructureModel } from '@/engine/geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { FoundationType } from '@/types/building';
import { FOUNDATION, foundationLayout, mainIsOpen, railSizeFt, sectionReach, slabJoints } from '../foundationLayout';
import { anchorGeometry, barLayout, footingGeometry, footingSection, rebarGeometry, unionSolidGeometry } from '../foundationGeometry';

// Foundation / anchoring DRAWING (owner 9/29/26) per each manufacturer's own
// FL details (owner 9/30/26): CCI "FOUNDATION/ANCHORING RECOMMENDATIONS (FL
// ONLY)" 1A / 1B / 1 + Base Rail Anchorage; CA "Enclosed Generic Engineering"
// sheet CA-1. Every anchor fastens ON TOP of the base rail (owner 9/30/26).

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const build = (over: Record<string, unknown>) => {
  const resolved = resolveBuilding({ ...DEFAULT_CONFIG, openings: [], leanTos: [], trussSpacingFt: 5, ...over } as never);
  return { s: deriveStructure(resolved), gauge: resolved.config.framingGauge, mfr: resolved.config.manufacturer };
};
const layoutOf = (over: Record<string, unknown>, f?: FoundationType) => {
  const { s, gauge, mfr } = build(over);
  return { s, l: foundationLayout(s, f, gauge, mfr) };
};
const garage = { buildingType: 'garage', width: 24, length: 30, legHeight: 10, manufacturer: 'CCI' };
const carport = { buildingType: 'carport', width: 24, length: 30, legHeight: 10, manufacturer: 'CCI' };
const wide = { buildingType: 'garage', width: 40, length: 60, legHeight: 14, manufacturer: 'CA', trussSpacingFt: 4 };
const caGarage = { ...garage, manufacturer: 'CA' };
const caCarport = { ...carport, manufacturer: 'CA' };
const leanTo = {
  ...garage,
  width: 30,
  length: 60,
  legHeight: 12,
  manufacturer: 'CCI',
  leanTos: [{ id: 'lt', type: 'attached', attachedSide: 'Right Eave', widthFt: 12, lengthFt: 30, lowLegHeightFt: 8, roofPitch: '2:12', enclosure: 'enclosed', openings: [] }],
};

/** Distance (ft) from (x, z) to the outline of the union of `rects` (0 when outside). */
const edgeDistance = (rects: { x0: number; x1: number; z0: number; z1: number }[], x: number, z: number) => {
  const inside = (px: number, pz: number) => rects.some((r) => px >= r.x0 && px <= r.x1 && pz >= r.z0 && pz <= r.z1);
  if (!inside(x, z)) return 0;
  let d = 0;
  while (d < 5 && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => inside(x + Math.cos((k * Math.PI) / 4) * d, z + Math.sin((k * Math.PI) / 4) * d))) d += 0.01;
  return d;
};

const legPositions = (s: StructureModel) => s.framePositionsZ.length;

describe('foundation layout — concrete (details 1A / 1B / 1)', () => {
  it("unset Foundation Type ('— select —') draws concrete", () => {
    expect(layoutOf(garage).l.type).toBe('concrete');
  });

  it('24x30 enclosed: 4" slab 6" past the rails, 1A footings (12" x 14", 2 #5) on the eaves + closed ends', () => {
    const { s, l } = layoutOf(garage, 'concrete');
    const e = railSizeFt('14-gauge') / 2 + 0.5;
    expect(l.slab).toEqual([{ x0: -12 - e, x1: 12 + e, z0: -15 - e, z1: 15 + e }]);
    expect(l.gradeY).toBeCloseTo(-2 / 12);
    expect(l.footingTop).toBe('slab');
    expect(l.footings.length).toBe(4);
    for (const f of l.footings) {
      expect(f.width).toBe(1);
      expect(f.depth).toBeCloseTo(14 / 12);
      expect(f.bars).toBe(2);
      expect(Math.abs(f.outer - f.c)).toBeCloseTo(e);
    }
    // The thickened edge turns every corner: gable strips run corner to corner, all four ends mitered.
    const ends = l.footings.filter((f) => f.run === 'x');
    expect(ends.every((f) => f.miter0 && f.miter1 && Math.abs(f.r0 + 12 + e) < 1e-9 && Math.abs(f.r1 - 12 - e) < 1e-9)).toBe(true);
    expect(l.footings.filter((f) => f.run === 'z').every((f) => f.miter0 && f.miter1)).toBe(true);
    // Main-building anchors sit on the EAVE rails (the program's one per leg).
    expect(l.anchors.every((a) => a.run === 'z' && Math.abs(Math.abs(a.x) - 12) < 1e-9)).toBe(true);
    // One wedge anchor per DRAWN leg (2 x the 3D's bents; 30 / 5 divides evenly, so = the program's count here).
    expect(l.anchor).toBe('wedge');
    expect(l.anchors.length).toBe(2 * legPositions(s));
    expect(s.width).toBe(24);
  });

  it('every anchor sits on a base rail, beside its leg, >= 3" from the slab edge', () => {
    for (const cfg of [garage, carport, wide, leanTo]) {
      const { l } = layoutOf(cfg, 'concrete');
      for (const a of l.anchors) expect(edgeDistance(l.slab!, a.x, a.z)).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('OPEN carport (roof only): plain 4" slab, no footing (1B), anchors >= 6" from the edge', () => {
    const { s, l } = layoutOf(carport, 'concrete');
    expect(mainIsOpen(s)).toBe(true);
    expect(l.mainOpen).toBe(true);
    expect(l.footings).toEqual([]);
    expect(l.anchors.length).toBe(2 * legPositions(s));
    for (const a of l.anchors) expect(edgeDistance(l.slab!, a.x, a.z)).toBeGreaterThanOrEqual(0.5);
  });

  it('a carport with a side panel or a closed end is partially enclosed (1A footings)', () => {
    expect(layoutOf({ ...carport, eavePanelFt: { left: 3, right: 0 } }, 'concrete').l.footings.length).toBeGreaterThan(0);
    expect(layoutOf({ ...carport, wallOverrides: { leftOpen: false, rightOpen: false, front: 'closed' } }, 'concrete').l.footings.length).toBe(3);
    // Gable-only (roof-level triangle) stays open.
    expect(layoutOf({ ...carport, openEndGableSheeting: true }, 'concrete').l.footings.length).toBe(0);
  });

  it('CCI 32-60 wide (40x60x14, ladder legs): detail 1 footing 18" x 16", 3 #5, TWO anchors per leg', () => {
    const { s, l } = layoutOf({ ...wide, manufacturer: 'CCI' }, 'concrete');
    expect(l.maker).toBe('CCI');
    const eaves = l.footings.filter((f) => f.run === 'z');
    expect(eaves.length).toBe(2);
    for (const f of l.footings) {
      expect(f.width).toBe(1.5);
      expect(f.depth).toBeCloseTo(16 / 12);
      expect(f.bars).toBe(3);
      expect(f.step).toBe(0);
    }
    expect(l.anchors.length).toBe(4 * legPositions(s));
    // Side by side: same run position, one per rail (the ladder column's two chords).
    const at = l.anchors.filter((a) => Math.abs(a.z - l.anchors[0].z) < 1e-6 && Math.sign(a.x) === Math.sign(l.anchors[0].x));
    expect(at.length).toBe(2);
    expect(Math.abs(at[0].x - at[1].x)).toBeCloseTo(1.3);
    // Both anchors land in the thickened edge (bottom width + haunch, in plan).
    const f = eaves.find((q) => Math.sign(q.c) === Math.sign(at[0].x))!;
    for (const a of at) {
      const u = (f.outer - a.x) * f.out;
      expect(u).toBeGreaterThan(0.25);
      expect(u).toBeLessThan(sectionReach(f));
    }
  });

  it('lean-to: slab covers it, its outer rail gets a 1A footing, every lean-to post an anchor', () => {
    const { s, l } = layoutOf(leanTo, 'concrete');
    expect(l.slab!.length).toBe(2);
    const lt = s.leanTos[0];
    const outer = l.footings.find((f) => Math.abs(f.c - lt.outer.x) < 1e-6)!;
    expect(outer).toBeTruthy();
    expect(outer.width).toBe(1);
    const ltPosts = l.anchors.filter((a) => Math.abs(a.c - lt.outer.x) < 1e-6);
    expect(ltPosts.length).toBe(lt.trussOffsets.length);
    // Main legs: 2 x truss count; the lean-to's inner posts stand on main legs here.
    expect(l.anchors.filter((a) => Math.abs(Math.abs(a.c) - 15) < 1e-6).length).toBe(2 * legPositions(s));
    // An OPEN lean-to: no footing on its line (1B), anchors still drawn.
    const open = layoutOf({ ...leanTo, leanTos: [{ ...leanTo.leanTos[0], enclosure: 'open' }] }, 'concrete').l;
    expect(open.footings.some((f) => Math.abs(f.c - lt.outer.x) < 1e-6)).toBe(false);
    expect(open.anchors.filter((a) => Math.abs(a.c - lt.outer.x) < 1e-6).length).toBe(lt.trussOffsets.length);
  });

  it('enclosed lean-to: its END lines get the 1A thickened edge, main footing -> outer strip, mitered', () => {
    const { s, l } = layoutOf(leanTo, 'concrete');
    const lt = s.leanTos[0];
    const e = railSizeFt('14-gauge') / 2 + 0.5;
    const sg = Math.sign(lt.outer.x - lt.inner.x); // the program's Right Eave renders at -X
    const beyondMain = (f: { run: string; r0: number; r1: number }) => f.run === 'x' && (sg * (f.r0 + f.r1)) / 2 > 15;
    const outer = l.footings.find((f) => f.run === 'z' && Math.abs(f.c - lt.outer.x) < 1e-6)!;
    const ends = l.footings.filter(beyondMain);
    expect(ends.map((f) => f.c).sort((a, b) => a - b)).toEqual([Math.min(lt.spanStart, lt.spanEnd), Math.max(lt.spanStart, lt.spanEnd)]);
    for (const f of ends) {
      expect(f.width).toBe(1);
      expect(f.bars).toBe(2);
      // From the main eave footing's outer face out to the lean-to's slab corner, mitered there only.
      const near = sg > 0 ? f.r0 : f.r1;
      const far = sg > 0 ? f.r1 : f.r0;
      expect(near).toBeCloseTo(sg * (15 + e));
      expect(far).toBeCloseTo(lt.outer.x + sg * e);
      expect(sg > 0 ? [f.miter0, f.miter1] : [f.miter1, f.miter0]).toEqual([false, true]);
      // Its outer face is the lean-to slab's end edge.
      const front = Math.abs(f.c - Math.min(lt.spanStart, lt.spanEnd)) < 1e-6;
      expect(f.out).toBe(front ? -1 : 1);
      expect(f.outer).toBeCloseTo(f.c + f.out * e);
    }
    expect(outer.miter0 && outer.miter1).toBe(true);
    // Flush with the main building's closed front: it continues the main front footing (same line, abutting).
    const mainFront = l.footings.find((f) => f.run === 'x' && Math.abs(f.c + 30) < 1e-6 && Math.abs((f.r0 + f.r1) / 2) < 1e-6)!;
    const ltFront = ends.find((f) => Math.abs(f.c + 30) < 1e-6)!;
    expect(ltFront.outer).toBeCloseTo(mainFront.outer);
    expect(sg > 0 ? ltFront.r0 : ltFront.r1).toBeCloseTo(sg > 0 ? mainFront.r1 : mainFront.r0);
    // The frame is untouched: no lean-to END base rail, and no anchors on the end lines.
    expect(s.members.some((m) => m.kind === 'baseRail' && Math.abs(m.start[0] - m.end[0]) > 1e-6 && Math.min(sg * m.start[0], sg * m.end[0]) > 15 + 1e-6)).toBe(false);
    expect(l.anchors.some((a) => a.run === 'x' && sg * a.x > 15)).toBe(false);
    // Custom: only a closed end gets it; an open lean-to (1B) gets none.
    const custom = layoutOf({ ...leanTo, leanTos: [{ ...leanTo.leanTos[0], enclosure: 'custom', customWalls: { side: 'closed', front: 'closed', back: 'open' } }] }, 'concrete');
    const cEnds = custom.l.footings.filter(beyondMain);
    expect(cEnds.length).toBe(1);
    expect(cEnds[0].c).toBeCloseTo(Math.min(lt.spanStart, lt.spanEnd));
    const cOuter = custom.l.footings.find((f) => f.run === 'z' && Math.abs(f.c - lt.outer.x) < 1e-6)!;
    expect([cOuter.miter0, cOuter.miter1]).toEqual([true, false]);
    const open = layoutOf({ ...leanTo, leanTos: [{ ...leanTo.leanTos[0], enclosure: 'open' }] }, 'concrete');
    expect(open.l.footings.filter(beyondMain).length).toBe(0);
  });

  it('gable lean-to on a closed end: end strips run from the main end footing out, mitered', () => {
    const g = { ...leanTo, leanTos: [{ ...leanTo.leanTos[0], attachedSide: 'Front Gable', widthFt: 10, lengthFt: 30 }] };
    const { s, l } = layoutOf(g, 'concrete');
    const lt = s.leanTos[0];
    const e = railSizeFt('14-gauge') / 2 + 0.5;
    expect(lt.outer.z).toBeLessThan(-30);
    const ends = l.footings.filter((f) => f.run === 'z' && f.r0 < -30 - e + 1e-6 && f.r1 <= -30 - e + 1e-6);
    expect(ends.length).toBe(2);
    for (const f of ends) {
      expect(f.r1).toBeCloseTo(-30 - e); // abuts the main front footing's outer face
      expect(f.r0).toBeCloseTo(lt.outer.z - e);
      expect(f.miter0).toBe(true);
    }
  });

  it('no anchor where a floor-level door cut the leg away', () => {
    const cut = layoutOf({ ...garage, openings: [{ id: 'r', type: 'rollUpDoor', side: 'left', offset: 15, width: 10, height: 8, sillHeight: 0 }] }, 'concrete');
    const full = layoutOf(garage, 'concrete');
    expect(cut.l.anchors.length).toBeLessThan(full.l.anchors.length);
    // ...and none floats over the doorway (no rail there).
    for (const a of cut.l.anchors) expect(a.x < 0 && a.z > -5 && a.z < 5).toBe(false);
  });

  it('saw-cut control joints: panels <= 12 ft, clipped to the slab', () => {
    const { l } = layoutOf(garage, 'concrete');
    const xs = l.joints.filter((j) => j.run === 'z').map((j) => j.at);
    const zs = l.joints.filter((j) => j.run === 'x').map((j) => j.at);
    expect(xs.length).toBe(2); // 25.2 ft -> 3 panels
    expect(zs.length).toBe(2); // 31.2 ft -> 3 panels
    const L = slabJoints([{ x0: 0, x1: 10, z0: 0, z1: 30 }, { x0: 10, x1: 30, z0: 0, z1: 10 }]);
    for (const j of L) {
      // an L-shaped slab: no joint crosses the open notch (x > 10, z > 10)
      if (j.run === 'z' && j.at > 10) expect(j.r1).toBeLessThanOrEqual(10 + 1e-9);
      if (j.run === 'x' && j.at > 10) expect(j.r1).toBeLessThanOrEqual(10 + 1e-9);
    }
  });
});

describe('foundation layout — footers / ground / gravel / asphalt', () => {
  it('footers only: no slab, stand-alone footing strips, wedge anchors into them', () => {
    const { s, l } = layoutOf(garage, 'footers');
    expect(l.slab).toBeNull();
    expect(l.footingTop).toBe('self');
    expect(l.footings.length).toBe(4);
    expect(l.anchor).toBe('wedge');
    expect(l.anchors.length).toBe(2 * legPositions(s));
    // Footers under an open carport too (there is no slab to anchor into).
    expect(layoutOf(carport, 'footers').l.footings.length).toBe(2);
    // The dirt between the footings is at grade.
    expect(l.padTop).toBeLessThan(0);
  });

  it('footers only under a ladder column: the strip widens so the inner rail bears on it', () => {
    const { l } = layoutOf({ ...wide, width: 56, legHeight: 12 }, 'footers');
    const f = l.footings.find((q) => q.run === 'z')!;
    expect(f.width).toBeGreaterThan(1.5);
  });

  for (const t of ['ground', 'gravel', 'asphalt'] as const) {
    it(`${t}: no slab, no footing, one helical ground anchor per drawn leg, on the outer rail`, () => {
      for (const mfr of ['CA', 'CCI'] as const) {
        const { s, l } = layoutOf({ ...wide, manufacturer: mfr }, t);
        expect(l.slab).toBeNull();
        expect(l.pad!.length).toBe(1);
        expect(l.padTop).toBe(0);
        expect(l.footings).toEqual([]);
        expect(l.anchor).toBe('helical');
        expect(l.anchors.length).toBe(2 * legPositions(s));
        for (const a of l.anchors) {
          expect(Math.abs(a.c)).toBeCloseTo(20);
          expect(a.inward).toBe(a.c > 0 ? -1 : 1);
        }
      }
    });
  }

  it('ground anchor per maker: CA 30" earth auger with a double 4" helix; CCI 3 ft, 6" plates', () => {
    const ca = layoutOf(caGarage, 'ground').l;
    expect(ca.maker).toBe('CA');
    expect(ca.anchorDepth).toBeCloseTo(28 / 12); // 30" rod, ~2" of it through the rail + nut
    expect(ca.helix).toEqual({ r: 2 / 12, at: [0.25, 0.6] });
    const cci = layoutOf(garage, 'ground').l;
    expect(cci.anchorDepth).toBe(3);
    expect(cci.helix).toEqual({ r: 0.25, at: [0.35, 0.8] });
    expect(layoutOf(garage, 'concrete').l.helix).toBeNull();
  });
});

describe("foundation layout — CA's own details (sheet CA-1)", () => {
  it('unset manufacturer draws CA (the program maps every non-CCI ACTIVE_MFR to CA)', () => {
    const { s, gauge } = build(garage);
    expect(foundationLayout(s, 'concrete', gauge).maker).toBe('CA');
    expect(foundationLayout(s, 'concrete', gauge, 'CCI').maker).toBe('CCI');
  });

  it('enclosed on concrete: thickened edge 12" x 12", (2) #5 @ 6" O.C., 4" inner face + 45 degree haunch; 2-1/2" embedment', () => {
    const { s, l } = layoutOf(caGarage, 'concrete');
    expect(l.footings.length).toBe(4);
    for (const f of l.footings) {
      expect(f.width).toBe(1);
      expect(f.depth).toBe(1);
      expect(f.bars).toBe(2);
      expect(f.step).toBeCloseTo(4 / 12);
      const { us, y } = barLayout(f);
      expect(us).toEqual([0.25, 0.75]); // 6" O.C., centered in the 12" width
      expect(y).toBeCloseTo(-0.75); // 3" up from the bottom
    }
    const T = FOUNDATION.slabT;
    const sec = footingSection(l.footings[0], 'underSlab', true);
    expect(sec.length).toBe(5);
    const expected = [[0, -T], [0, -1], [1, -1], [1, -1 + 4 / 12], [1 + 4 / 12, -T]];
    sec.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i][0]);
      expect(p[1]).toBeCloseTo(expected[i][1]);
    });
    expect(l.anchor).toBe('wedge');
    expect(l.anchorDepth).toBeCloseTo(2.5 / 12);
    // Side posts: every one (no intermediate end-wall posts are drawn on this building).
    expect(l.anchors.length).toBe(2 * legPositions(s));
  });

  it('open carport: the existing-slab detail (plain slab, no thickened edge, 2-1/2" embedment)', () => {
    const { s, l } = layoutOf(caCarport, 'concrete');
    expect(l.mainOpen).toBe(true);
    expect(l.slab!.length).toBe(1);
    expect(l.footings).toEqual([]);
    expect(l.anchorDepth).toBeCloseTo(2.5 / 12);
    expect(l.anchors.length).toBe(2 * legPositions(s));
  });

  it('wide span (40x60x14 double legs): the same CA-1 section and ONE anchor per post / truss', () => {
    const { s, l } = layoutOf(wide, 'concrete');
    expect(l.footings.every((f) => f.width === 1 && f.depth === 1 && f.bars === 2 && f.barSpacing === 0.5)).toBe(true);
    expect(l.anchors.length).toBe(2 * legPositions(s));
    for (const a of l.anchors) expect(Math.abs(a.c)).toBeCloseTo(20); // the outer chord's rail
  });

  it('lean-tos use the CA-1 section too (outer strip + closed end lines)', () => {
    const { l } = layoutOf({ ...leanTo, manufacturer: 'CA' }, 'concrete');
    expect(l.footings.length).toBeGreaterThan(4);
    expect(l.footings.every((f) => f.depth === 1 && f.step > 0)).toBe(true);
  });

  it('EVERY OTHER end-wall post on concrete / footers (CA-1); every post on ground; CCI every post', () => {
    // A gable lean-to along a CLOSED main front wall: its posts there are the end wall's posts.
    const cfg = {
      buildingType: 'garage', width: 30, length: 40, legHeight: 12, trussSpacingFt: 5,
      leanTos: [{ id: 'g', type: 'attached', attachedSide: 'Front Gable', widthFt: 12, lengthFt: 30, lowLegHeightFt: 10, roofPitch: '2:12', enclosure: 'enclosed', openings: [] }],
    };
    const endPosts = (s: StructureModel) =>
      s.members.filter((m) => m.kind === 'leg' && Math.abs(m.start[1]) < 1e-6 && Math.abs(m.start[2] + 20) < 1e-6 && Math.abs(m.start[0]) < 15 - 1e-6).length;
    const onEnd = (l: { anchors: { run: string; c: number; x: number }[] }) =>
      l.anchors.filter((a) => a.run === 'x' && Math.abs(a.c + 20) < 1e-6 && Math.abs(a.x) < 15).length;
    const ca = layoutOf({ ...cfg, manufacturer: 'CA' }, 'concrete');
    const n = endPosts(ca.s);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(onEnd(ca.l)).toBe(Math.floor(n / 2));
    // Alternating along the wall: no two anchored end-wall posts are neighbours.
    const xs = ca.l.anchors.filter((a) => a.run === 'x' && Math.abs(a.c + 20) < 1e-6 && Math.abs(a.x) < 15).map((a) => a.x).sort((a, b) => a - b);
    const posts = ca.s.members
      .filter((m) => m.kind === 'leg' && Math.abs(m.start[1]) < 1e-6 && Math.abs(m.start[2] + 20) < 1e-6 && Math.abs(m.start[0]) < 15 - 1e-6)
      .map((m) => m.start[0])
      .sort((a, b) => a - b);
    const idx = xs.map((x) => posts.findIndex((p) => Math.abs(p - x) < 0.5));
    expect(idx.every((i, k) => k === 0 || i - idx[k - 1] === 2)).toBe(true);
    expect(onEnd(layoutOf({ ...cfg, manufacturer: 'CA' }, 'footers').l)).toBe(Math.floor(n / 2));
    expect(onEnd(layoutOf({ ...cfg, manufacturer: 'CA' }, 'ground').l)).toBe(n);
    expect(onEnd(layoutOf({ ...cfg, manufacturer: 'CCI' }, 'concrete').l)).toBe(n);
    // Side posts are never thinned: the lean-to's outer posts + every main leg keep theirs.
    const cci = layoutOf({ ...cfg, manufacturer: 'CCI' }, 'concrete').l;
    expect(cci.anchors.length - ca.l.anchors.length).toBe(n - Math.floor(n / 2));
  });
});

describe('foundation geometry', () => {
  it('thickened-edge section: 4" slab band, bottom width, 45 degree haunch', () => {
    const f = { width: 1, depth: 14 / 12 };
    expect(footingSection(f, 'underSlab', true)).toEqual([[0, -4 / 12], [0, -14 / 12], [1, -14 / 12], [1 + 10 / 12, -4 / 12]]);
    expect(footingSection(f, 'full', false)).toEqual([[0, 0], [0, -14 / 12], [1, -14 / 12], [1, 0]]);
  });

  it('builds closed, finite geometry for every foundation type', () => {
    for (const t of ['concrete', 'footers', 'ground', 'gravel', 'asphalt'] as const) {
      for (const cfg of [garage, carport, wide, leanTo]) {
        const { l } = layoutOf(cfg, t);
        const geos = [
          l.footings.length ? footingGeometry(l.footings, l.footingTop === 'slab' ? 'underSlab' : 'full', false, 6) : null,
          rebarGeometry(l.footings),
          anchorGeometry(l).above,
          anchorGeometry(l).below,
          unionSolidGeometry(l.slab ?? l.pad!, 0, -FOUNDATION.slabT, 6),
        ];
        for (const g of geos) {
          if (!g) continue;
          const p = g.attributes.position.array as Float32Array;
          expect(p.length).toBeGreaterThan(0);
          expect(Array.from(p).every(Number.isFinite)).toBe(true);
        }
        expect(anchorGeometry(l).above).not.toBeNull();
      }
    }
  });

  it("CA-1's stepped section: the end caps exactly cover the section (no folded fan over the step's inside corner)", () => {
    const strip = { ...layoutOf(caGarage, 'concrete').l.footings[0], run: 'z' as const, c: 0, out: -1 as const, outer: 0, r0: 0, r1: 10, miter0: false, miter1: false };
    const shoelace = (p: Array<[number, number]>) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
    for (const [mode, haunch] of [['underSlab', true], ['full', true], ['full', false]] as const) {
      const g = footingGeometry([strip], mode, haunch, 6);
      const p = g.attributes.position.array as Float32Array;
      let cap = 0;
      for (let i = 0; i < p.length; i += 9) {
        if (![2, 5, 8].every((k) => Math.abs(p[i + k]) < 1e-6)) continue; // triangles on the r0 = 0 cap
        const [ax, ay, bx, by, cx, cy] = [p[i], p[i + 1], p[i + 3], p[i + 4], p[i + 6], p[i + 7]];
        cap += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      }
      expect(cap).toBeCloseTo(shoelace(footingSection(strip, mode, haunch)), 5);
    }
  });

  it('the union slab has no internal faces (an eave lean-to adds only its outline)', () => {
    const one = unionSolidGeometry([{ x0: 0, x1: 10, z0: 0, z1: 10 }], 0, -1, 6);
    const two = unionSolidGeometry([{ x0: 0, x1: 10, z0: 0, z1: 10 }, { x0: 10, x1: 20, z0: 0, z1: 10 }], 0, -1, 6);
    // one box = 6 quads; two adjacent cells = 4 top/bottom + 6 sides = 10 quads (no shared wall)
    expect(one.attributes.position.count).toBe(6 * 6);
    expect(two.attributes.position.count).toBe(10 * 6);
  });

  it('anchor hardware: above-surface parts sit on the rail, embedment below', () => {
    for (const cfg of [garage, caGarage]) {
      const { l } = layoutOf(cfg, 'concrete');
      const above = anchorGeometry(l).above!;
      above.computeBoundingBox();
      expect(above.boundingBox!.min.y).toBeGreaterThan(0);
      const below = anchorGeometry(l).below!;
      below.computeBoundingBox();
      expect(below.boundingBox!.min.y).toBeCloseTo(-l.anchorDepth);
      expect(below.boundingBox!.min.y).toBeGreaterThan(-FOUNDATION.slabT); // stays inside the 4" slab
    }
    expect(layoutOf(garage, 'concrete').l.anchorDepth).toBeCloseTo(3 / 12); // CCI: >= 2-1/2", drawn 3"
    expect(layoutOf(caGarage, 'concrete').l.anchorDepth).toBeCloseTo(2.5 / 12); // CA: 2-1/2"
    const ground = anchorGeometry(layoutOf(garage, 'ground').l);
    ground.below!.computeBoundingBox();
    expect(ground.below!.boundingBox!.min.y).toBeLessThan(-2.5); // the helical rod
  });

  for (const gauge of ['14-gauge', '12-gauge'] as const) {
    for (const mfr of ['CCI', 'CA'] as const) {
      it(`ground anchor (${mfr}, ${gauge} rail): ON TOP of the rail like the wedge anchor, the auger below grade`, () => {
        const h = railSizeFt(gauge) / 2;
        const spec = FOUNDATION.helical[mfr];
        const spot = { x: 12, z: 0, run: 'z' as const, c: 12, inward: -1 as const };
        const one = { anchor: 'helical' as const, railHalf: h, anchorDepth: spec.depth, helix: { r: spec.helixR, at: spec.helixAt }, anchors: [spot] };
        const wedge = { anchor: 'wedge' as const, railHalf: h, anchorDepth: 3 / 12, helix: null, anchors: [spot] };
        const { above, below } = anchorGeometry(one);
        above!.computeBoundingBox();
        const bb = above!.boundingBox!;
        // Washer + nut + threaded end sit on the rail's top (y = h), centered on the rail —
        // the exact hardware the concrete wedge anchor shows (visible from inside the building).
        expect(bb.min.y).toBeCloseTo(h);
        expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(12);
        expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(railSizeFt(gauge) + 1e-6); // the 2" washer fits the rail top
        const w = anchorGeometry(wedge).above!;
        expect(Array.from(above!.attributes.position.array)).toEqual(Array.from(w.attributes.position.array));
        // The rod comes up THROUGH the rail (its centerline) from the auger tip below grade.
        below!.computeBoundingBox();
        const b = below!.boundingBox!;
        expect(b.min.y).toBeLessThan(-spec.depth + 0.01);
        expect(b.max.y).toBeCloseTo(h);
        expect((b.min.x + b.max.x) / 2).toBeCloseTo(12);
        expect(b.max.x - b.min.x).toBeLessThanOrEqual(2 * spec.helixR + 0.01); // helix plates, centered on the rod
      });
    }
  }
});

describe('foundation wiring (view-only, never priced)', () => {
  const host = src('../../build/BuildHost.tsx');
  const model = src('../BuildingModel.tsx');
  const site = src('../enhanced/EnhancedSite.tsx');
  const details = src('../FoundationDetails.tsx');

  it('BuildHost mirrors #foundation into the view-only store field', () => {
    expect(host).toMatch(/val\('foundation'\)/);
    expect(host).toMatch(/st\.setFoundation\(foundation\)/);
    // Nothing is ever written back to the program's #foundation.
    expect(host).not.toMatch(/G\('foundation'\)[^;]*\.value\s*=/);
  });

  it("the drawing follows the quote's (view-only) manufacturer: CA's details for CA, CCI's for CCI", () => {
    expect(model).toMatch(/foundationLayout\(structure, config\.foundation, config\.framingGauge, config\.manufacturer\)/);
  });

  it('site + details are capture-ignored in EVERY view; classic draws the details only off the exterior view', () => {
    expect(site).toMatch(/captureIgnore: true/);
    // No view (exterior, Structure, Cutaway) lets the footings / helical rods move the PDF framing.
    expect(details).toMatch(/userData=\{\{ captureIgnore: true, foundationDetails: true \}\}/);
    expect(details).not.toMatch(/captureIgnore: exterior/);
    expect(model).toMatch(/\(renderStyle === 'enhanced' \|\| viewMode !== 'exterior'\) && \(\s*<FoundationDetails/);
    expect(details).not.toMatch(/castShadow/);
  });
});
