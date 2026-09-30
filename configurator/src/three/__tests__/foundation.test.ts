import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '@/engine/ruleEngine';
import { deriveStructure, type StructureModel } from '@/engine/geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { FoundationType } from '@/types/building';
import { FOUNDATION, foundationLayout, mainIsOpen, railSizeFt, slabJoints } from '../foundationLayout';
import { anchorGeometry, footingGeometry, footingSection, rebarGeometry, unionSolidGeometry } from '../foundationGeometry';

// Foundation / anchoring DRAWING (owner 9/29/26) per the CCI "FOUNDATION/
// ANCHORING RECOMMENDATIONS (FL ONLY)" details 1A / 1B / 1 / 1C.

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const build = (over: Record<string, unknown>) => {
  const resolved = resolveBuilding({ ...DEFAULT_CONFIG, openings: [], leanTos: [], trussSpacingFt: 5, ...over } as never);
  return { s: deriveStructure(resolved), gauge: resolved.config.framingGauge };
};
const layoutOf = (over: Record<string, unknown>, f?: FoundationType) => {
  const { s, gauge } = build(over);
  return { s, l: foundationLayout(s, f, gauge) };
};
const garage = { buildingType: 'garage', width: 24, length: 30, legHeight: 10 };
const carport = { buildingType: 'carport', width: 24, length: 30, legHeight: 10 };
const wide = { buildingType: 'garage', width: 40, length: 60, legHeight: 14, manufacturer: 'CA', trussSpacingFt: 4 };
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
    // One wedge anchor per leg = the program's 2 x truss count.
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

  it('32-60 wide (CA 40x60x14 double legs): detail 1 footing 18" x 16", 3 #5, TWO anchors per leg', () => {
    const { s, l } = layoutOf(wide, 'concrete');
    const eaves = l.footings.filter((f) => f.run === 'z');
    expect(eaves.length).toBe(2);
    for (const f of l.footings) {
      expect(f.width).toBe(1.5);
      expect(f.depth).toBeCloseTo(16 / 12);
      expect(f.bars).toBe(3);
    }
    expect(l.anchors.length).toBe(4 * legPositions(s));
    // Side by side: same run position, one per rail (0.4 ft apart).
    const at = l.anchors.filter((a) => Math.abs(a.z - l.anchors[0].z) < 1e-6 && Math.sign(a.x) === Math.sign(l.anchors[0].x));
    expect(at.length).toBe(2);
    expect(Math.abs(at[0].x - at[1].x)).toBeCloseTo(0.4);
    // Both anchors land on the 18" footing.
    const f = eaves.find((q) => Math.sign(q.c) === Math.sign(at[0].x))!;
    for (const a of at) {
      const u = (f.outer - a.x) * f.out;
      expect(u).toBeGreaterThan(0.25);
      expect(u).toBeLessThan(f.width);
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
    it(`${t}: no slab, no footing, one helical eye anchor per leg (program count)`, () => {
      const { s, l } = layoutOf(wide, t);
      expect(l.slab).toBeNull();
      expect(l.pad!.length).toBe(1);
      expect(l.padTop).toBe(0);
      expect(l.footings).toEqual([]);
      expect(l.anchor).toBe('eye');
      expect(l.anchors.length).toBe(2 * legPositions(s));
      // On the outer rail, eye on its inside face.
      for (const a of l.anchors) {
        expect(Math.abs(a.c)).toBeCloseTo(20);
        expect(a.inward).toBe(a.c > 0 ? -1 : 1);
      }
    });
  }
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

  it('the union slab has no internal faces (an eave lean-to adds only its outline)', () => {
    const one = unionSolidGeometry([{ x0: 0, x1: 10, z0: 0, z1: 10 }], 0, -1, 6);
    const two = unionSolidGeometry([{ x0: 0, x1: 10, z0: 0, z1: 10 }, { x0: 10, x1: 20, z0: 0, z1: 10 }], 0, -1, 6);
    // one box = 6 quads; two adjacent cells = 4 top/bottom + 6 sides = 10 quads (no shared wall)
    expect(one.attributes.position.count).toBe(6 * 6);
    expect(two.attributes.position.count).toBe(10 * 6);
  });

  it('anchor hardware: above-surface parts sit on / beside the rail, embedment below', () => {
    const { l } = layoutOf(garage, 'concrete');
    const above = anchorGeometry(l).above!;
    above.computeBoundingBox();
    expect(above.boundingBox!.min.y).toBeGreaterThan(0);
    const below = anchorGeometry(l).below!;
    below.computeBoundingBox();
    expect(below.boundingBox!.min.y).toBeLessThanOrEqual(-FOUNDATION.wedgeEmbed + 1e-6);
    expect(below.boundingBox!.min.y).toBeGreaterThan(-FOUNDATION.slabT); // stays inside the 4" slab
    const eye = anchorGeometry(layoutOf(garage, 'ground').l);
    eye.below!.computeBoundingBox();
    expect(eye.below!.boundingBox!.min.y).toBeLessThan(-2.5); // the helical rod
  });
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

  it('site + details are capture-ignored; classic draws the details only off the exterior view', () => {
    expect(site).toMatch(/captureIgnore: true/);
    // Exterior: never moves the PDF framing; Structure / Cutaway captures frame the footings.
    expect(details).toMatch(/captureIgnore: exterior/);
    expect(model).toMatch(/\(renderStyle === 'enhanced' \|\| viewMode !== 'exterior'\) && \(\s*<FoundationDetails/);
    expect(details).not.toMatch(/castShadow/);
  });
});
