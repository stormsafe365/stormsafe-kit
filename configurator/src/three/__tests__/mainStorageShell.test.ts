import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, StorageMode } from '@/types/building';
import { fixtureFaceZ } from '../enhanced/fixtureLayout';
import { storageGhostShape } from '../StoragePartitionGhost';
import { roofSurface, shellLayout, structureKey, trimBatches, wallBatches, wallTopAt, type ShellInput } from '../enhanced/shellGeometry';

// Main-building storage partitions in the ENHANCED shell (owner 10/1/26): an
// interior wall sheeted on its main-room face, no wainscot, no exterior
// corner trims — and the GCH divider exactly as before.

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
  it('interior wall: no wainscot band, no corner trims', () => {
    expect(part.regions.every((r) => !r.wainscot)).toBe(true);
    expect(part.cap.length).toBe(0);
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
    expect(part.regions).toEqual([{ c0: -20, c1: 20, y0: 0, y1: wallTopAt(roofSurface(s), X0), wainscot: false }]);
    expect(part.holes).toEqual([]);
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
