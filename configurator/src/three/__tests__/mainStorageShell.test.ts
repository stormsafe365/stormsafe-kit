import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, StorageMode } from '@/types/building';
import { fixtureFaceZ } from '../enhanced/fixtureLayout';
import { outsideOnlyDepthOffset } from '../enhanced/ShellMeshes';
import { storageGhostShape } from '../StoragePartitionGhost';
import { roofSurface, shellLayout, structureKey, trimBatches, wallBatches, wallTopAt, type ShellInput } from '../enhanced/shellGeometry';

// Main-building storage partitions in the ENHANCED shell (owner 10/1/26): an
// interior wall sheeted on its main-room face, no exterior corner trims — and
// the GCH divider exactly as before. Since 10/3/26 the building's wainscot
// runs on that face too (partitionWainscot.test.ts has the full band rules).

const build = (over: Partial<BuildingConfig> = {}, storage?: { mode: StorageMode; lengthFt: number }) => {
  const cfg: BuildingConfig = {
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 30,
    length: 40,
    legHeight: 12,
    trussSpacingFt: 4,
    manufacturer: 'CCI',
    wainscot: { enabled: true, heightFt: 3 },
    ...over,
    walls: { ...DEFAULT_CONFIG.walls, storage: storage ?? { mode: 'none', lengthFt: 0 } },
  };
  return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
};
const input = (cfg: BuildingConfig, s: StructureModel): ShellInput & { trimColor: string } => ({
  structure: s,
  openings: cfg.openings,
  wallOrientation: cfg.panelOrientation,
  colors: cfg.colors,
  wainscot: cfg.wainscot,
  trimColor: cfg.colors.trim,
});

describe('enhanced shell: End Storage partition', () => {
  const { cfg, s } = build({}, { mode: 'endBack', lengthFt: 12 });
  const layout = shellLayout(input(cfg, s));
  const part = layout.walls.find((w) => w.plane.id === 'partition')!;
  it('sheet one SHEET_OUTSET off its framing line, on the main-room (−Z) face, gable to the roof', () => {
    expect(part.plane.along).toBe('x');
    expect(part.plane.at).toBeCloseTo(8 - SHEET_OUTSET, 9);
    expect(part.plane.n).toEqual([0, 0, -1]);
    expect(part.polys.length).toBe(1);
  });
  it("interior wall: the building's wainscot band + Z-trim line on its main-room face, no corner trims", () => {
    expect(part.regions.filter((r) => r.wainscot)).toEqual([{ c0: -15, c1: 15, y0: 0, y1: 3, wainscot: true }]);
    expect(part.cap).toEqual([{ y: 3, c0: -15, c1: 15 }]);
    expect(layout.corners.some((c) => c.end === 'partition')).toBe(false);
    // the outside walls still get their wainscot
    expect(layout.walls.find((w) => w.plane.id === 'front')!.regions.some((r) => r.wainscot)).toBe(true);
  });
  it('front-end storage faces +Z', () => {
    const f = build({}, { mode: 'end', lengthFt: 20 });
    const p = shellLayout(input(f.cfg, f.s)).walls.find((w) => w.plane.id === 'partition')!;
    expect(p.plane.at).toBeCloseTo(0 + SHEET_OUTSET, 9);
    expect(p.plane.n).toEqual([0, 0, 1]);
  });
  it('builds wall + trim batches with the partition sheet in its plane', () => {
    const tri = wallBatches(input(cfg, s)).flatMap((b) => Array.from({ length: b.position.length / 3 }, (_, i) => b.position[i * 3 + 2]));
    expect(tri.some((z) => Math.abs(z - (8 - SHEET_OUTSET)) < 1e-6)).toBe(true);
    expect(() => trimBatches(input(cfg, s))).not.toThrow();
  });
  it('fixtures on it sit like any wall (not in-plane like the GCH divider)', () => {
    expect(fixtureFaceZ('partition', false)).toBe(fixtureFaceZ('front'));
    expect(fixtureFaceZ('partition')).toBe(0);
  });
});

describe('enhanced shell: Left / Right lengthwise partition', () => {
  const { cfg, s } = build({}, { mode: 'right', lengthFt: 12 }); // x = 3, faces −X
  const layout = shellLayout(input(cfg, s));
  const part = layout.walls.find((w) => w.plane.id === 'partition')!;
  it('full length, floor to just under the roof at its x, facing the main room', () => {
    const X0 = 3 - SHEET_OUTSET;
    expect(part.plane).toEqual({ id: 'partition', along: 'z', at: X0, n: [-1, 0, 0], u: [0, 0, 1] });
    expect(part.regions).toEqual([
      { c0: -20, c1: 20, y0: 0, y1: 3, wainscot: true },
      { c0: -20, c1: 20, y0: 3, y1: wallTopAt(roofSurface(s), X0), wainscot: false },
    ]);
    expect(part.cap).toEqual([{ y: 3, c0: -20, c1: 20 }]);
    expect(part.holes).toEqual([]);
  });
  it('wainscot off: the single full-height sheet, as before', () => {
    const off = build({ wainscot: { enabled: false, heightFt: 3 } }, { mode: 'right', lengthFt: 12 });
    const p = shellLayout(input(off.cfg, off.s)).walls.find((w) => w.plane.id === 'partition')!;
    expect(p.regions).toEqual([{ c0: -20, c1: 20, y0: 0, y1: wallTopAt(roofSurface(off.s), 3 - SHEET_OUTSET), wainscot: false }]);
    expect(p.cap).toEqual([]);
  });
});

describe('GCH divider unchanged', () => {
  it('a utility ignores walls.storage: same layout, same mesh key', () => {
    const base = { buildingType: 'utility' as const, enclosedLengthFt: 20, openEnd: 'front' as const };
    const a = build(base);
    const la = shellLayout(input(a.cfg, a.s));
    for (const mode of ['end', 'endBack', 'left', 'right'] as const) {
      const b = build(base, { mode, lengthFt: 12 });
      expect(JSON.stringify(shellLayout(input(b.cfg, b.s)))).toBe(JSON.stringify(la)); // (roof.topAt is a fresh closure)
      expect(structureKey(b.s)).toBe(structureKey(a.s));
    }
    const p = la.walls.find((w) => w.plane.id === 'partition')!;
    expect(p.plane.at).toBe(a.s.enclosure.partitionZ); // in its framing plane, as before
  });
  it('a garage without storage: same mesh key as before the feature (no new enclosure keys)', () => {
    const g = build();
    expect(structureKey(g.s)).not.toContain('partitionKind');
    expect(structureKey(g.s)).not.toContain('sidePartition');
  });
});

describe('the storage partition sheet is its own depth-offset batch (visual verifier r2)', () => {
  // The painted partition sheet (its unpainted back is a 'panelBack' batch: panelBack.test.ts).
  const seal = (b: { spec: unknown }) => (b.spec as { seal?: boolean }).seal === true;
  const interior = (b: { spec: unknown }) => (b.spec as { surface?: string }).surface === 'wall' && (b.spec as { interior?: boolean }).interior === true && !seal(b);
  const interiorBack = (b: { spec: unknown }) => (b.spec as { surface?: string }).surface === 'panelBack' && (b.spec as { interior?: boolean }).interior === true;
  const zs = (b: { position: Float32Array }, k: number) => Array.from({ length: b.position.length / 3 }, (_, i) => b.position[i * 3 + k]);
  it('End Storage: the interior batches hold exactly the partition sheet (wall + wainscot colour); outer walls unchanged', () => {
    const { cfg, s } = build({}, { mode: 'endBack', lengthFt: 12 });
    const bs = wallBatches(input(cfg, s));
    const inner = bs.filter(interior);
    expect(inner.map((b) => (b.spec as { color: string }).color).sort()).toEqual([cfg.colors.walls, cfg.colors.wainscot].sort());
    for (const b of inner) {
      expect(b.id).toContain('|interior');
      expect(zs(b, 2).every((z) => Math.abs(z - (8 - SHEET_OUTSET)) < 1e-6)).toBe(true);
    }
    // wainscot off: the one wall-colour interior batch, as before
    const off = build({ wainscot: { enabled: false, heightFt: 3 } }, { mode: 'endBack', lengthFt: 12 });
    const offInner = wallBatches(input(off.cfg, off.s)).filter(interior);
    expect(offInner.length).toBe(1);
    expect((offInner[0].spec as { color: string }).color).toBe(off.cfg.colors.walls);
    // the outer walls' batches are byte-for-byte those of the same garage without storage
    const bare = build();
    // (the partition's back + crack seal are its own capture-ignored batches: panelBack.test.ts)
    const outer = bs.filter((b) => !interior(b) && !interiorBack(b) && !(seal(b) && (b.spec as { interior?: boolean }).interior));
    const ref = wallBatches(input(bare.cfg, bare.s));
    expect(outer.map((b) => b.id)).toEqual(ref.map((b) => b.id));
    outer.forEach((b, i) => expect(Array.from(b.position)).toEqual(Array.from(ref[i].position)));
  });
  it('Left/Right: the lengthwise sheet (wall + wainscot colour) is the interior batch', () => {
    const { cfg, s } = build({}, { mode: 'right', lengthFt: 12 });
    const inner = wallBatches(input(cfg, s)).filter(interior);
    expect(inner.length).toBe(2);
    for (const b of inner) expect(zs(b, 0).every((x) => Math.abs(x - (3 - SHEET_OUTSET)) < 1e-6)).toBe(true);
  });
  it('its depth offset is on only while the camera is outside the walls (no grazing-angle effect inside)', () => {
    const walls = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(30, 15, 40).translate(0, 7.5, 0));
    const part = new THREE.Mesh(new THREE.PlaneGeometry(40, 12));
    walls.add(shell, part);
    walls.updateMatrixWorld(true);
    const mat = new THREE.MeshStandardMaterial({ polygonOffset: true });
    const cam = new THREE.PerspectiveCamera();
    const at = (x: number, y: number, z: number) => {
      cam.position.set(x, y, z);
      cam.updateMatrixWorld(true);
      outsideOnlyDepthOffset.call(part, {} as THREE.WebGLRenderer, {} as THREE.Scene, cam, part.geometry, mat);
      return mat.polygonOffset;
    };
    expect(at(0, 8, -68)).toBe(true); // Front view
    expect(at(-60, 8, 0)).toBe(true); // Left view
    expect(at(0, 6, -15)).toBe(false); // Interior view
    expect(at(40, 30, -40)).toBe(true); // orbiting back out
  });
  it('no interior batch on a GCH divider or a garage without storage', () => {
    const gch = build({ buildingType: 'utility', enclosedLengthFt: 20, openEnd: 'front' }, { mode: 'endBack', lengthFt: 12 });
    expect(wallBatches(input(gch.cfg, gch.s)).some(interior)).toBe(false);
    const g = build();
    expect(wallBatches(input(g.cfg, g.s)).some(interior)).toBe(false);
  });
});

describe('Structure / Cutaway storage ghost (storageGhostShape)', () => {
  it('End Storage: the partition outline (gable to the roofline) just off its sheet, with its doors as holes', () => {
    const { cfg, s } = build(
      { openings: [{ id: 'd', type: 'rollUpDoor', side: 'partition', offset: 15, width: 10, height: 10, sillHeight: 0 }] },
      { mode: 'endBack', lengthFt: 12 },
    );
    const g = storageGhostShape(s, cfg.openings)!;
    expect(g.plane).toBe('cross');
    expect(g.at).toBeCloseTo(8 - (SHEET_OUTSET + 0.03), 9);
    const pts = g.shape.getPoints();
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(s.peakHeight, 9);
    expect(g.shape.holes.length).toBe(1);
  });
  it('Left/Right: a full-length rectangle up to the roofline at its x', () => {
    const { cfg, s } = build({}, { mode: 'left', lengthFt: 12 }); // x = -3, faces +X
    const g = storageGhostShape(s, cfg.openings)!;
    expect(g.plane).toBe('side');
    expect(g.at).toBeCloseTo(-3 + SHEET_OUTSET + 0.03, 9);
    const xs = g.shape.getPoints().map((p) => p.x);
    expect(Math.min(...xs)).toBe(-20);
    expect(Math.max(...xs)).toBe(20);
  });
  it('nothing for a GCH divider or a garage without storage', () => {
    const gch = build({ buildingType: 'utility', enclosedLengthFt: 20, openEnd: 'front' }, { mode: 'endBack', lengthFt: 12 });
    expect(storageGhostShape(gch.s, [])).toBe(null);
    expect(storageGhostShape(build().s, [])).toBe(null);
  });
});
