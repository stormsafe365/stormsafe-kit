import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, LeanTo, LeanToOpening, Opening, StorageMode } from '@/types/building';
import type { V3 } from '../enhanced/materials';
import { leanToBatches } from '../enhanced/leanToShell';
import { shellLayout, trimBatches, wallBatches, type ShellBatch, type ShellInput } from '../enhanced/shellGeometry';
import { eaveSurfaces, gableWainscotStrips, leanToWainscotCaps, resolveWalls } from '../LeanToSiding';
import { storagePartitionWainscot } from '../Siding';
import * as THREE from 'three';
import { storageGhostShape, storageGhostWainscot, storageGhostWainscotGeometries } from '../StoragePartitionGhost';
import { shellCaptureData } from '../enhanced/ShellMeshes';
import { captureBoxOf } from '../captureBox';

/**
 * The building's WAINSCOT on interior storage partitions (owner 10/3/26:
 * "if I add wainscot to the building it would also go on the partition wall",
 * Sensei reference). Every partition face a person can see from a room gets
 * the same band + cap line as the outside walls, cut around the partition's
 * openings; wainscot OFF leaves the partition exactly as it was.
 *   - End Storage cross wall and Left / Right lengthwise wall (main building):
 *     classic (Siding storagePartitionWainscot -> Siding + Trim), enhanced
 *     (shellLayout regions + Z-trim) and the Structure / Cutaway ghost.
 *   - Lean-to storage partition: already carried the band in both Looks
 *     (pinned here so it stays).
 */

const SO = SHEET_OUTSET;
const O2 = SO + 0.02; // the outside walls' band / cap plane off the framing line

/** 26 x 50 x 12 CCI garage (the owner's test build), storage per `storage`. */
const build = (storage: { mode: StorageMode; lengthFt: number }, over: Partial<BuildingConfig> = {}) => {
  const cfg: BuildingConfig = {
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 26,
    length: 50,
    legHeight: 12,
    manufacturer: 'CCI',
    wainscot: { enabled: true, heightFt: 3 },
    openings: [],
    ...over,
    walls: { ...DEFAULT_CONFIG.walls, storage },
  };
  return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
};
const OFF = { wainscot: { enabled: false, heightFt: 3 } };

// Partition openings (x = -13 + offset across the cross wall).
const rollUp: Opening = { id: 'r', type: 'rollUpDoor', side: 'partition', offset: 9, width: 10, height: 10, sillHeight: 0 }; // x -9..1, floor to 10'
const lowWin: Opening = { id: 'w', type: 'window', side: 'partition', offset: 20, width: 3, height: 3, sillHeight: 2 }; // x 5.5..8.5, crosses the 3' line
const highWin: Opening = { id: 'h', type: 'window', side: 'partition', offset: 20, width: 3, height: 3, sillHeight: 5 }; // wholly above the band

const input = (cfg: BuildingConfig, s: StructureModel): ShellInput & { trimColor: string } => ({
  structure: s,
  openings: cfg.openings,
  wallOrientation: cfg.panelOrientation,
  colors: cfg.colors,
  wainscot: cfg.wainscot,
  trimColor: cfg.colors.trim,
});

// ── triangle helpers ───────────────────────────────────────────────────────
type Tri = V3[];
const tris = (b: ShellBatch): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < b.position.length / 9; i++)
    out.push([0, 1, 2].map((k): V3 => [b.position[i * 9 + k * 3], b.position[i * 9 + k * 3 + 1], b.position[i * 9 + k * 3 + 2]]));
  return out;
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Does any triangle contain q (in its plane)? */
const covers = (ts: Tri[], q: V3) =>
  ts.some((t) => {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    if (Math.abs(dot(sub(q, t[0]), n)) / Math.hypot(...n) > 1e-4) return false;
    const s0 = dot(cross(sub(t[1], t[0]), sub(q, t[0])), n);
    const s1 = dot(cross(sub(t[2], t[1]), sub(q, t[1])), n);
    const s2 = dot(cross(sub(t[0], t[2]), sub(q, t[2])), n);
    return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
  });
const wallTris = (bs: ShellBatch[], color: string) => bs.filter((b) => b.spec.surface === 'wall' && b.spec.color === color).flatMap(tris);
const trimTris = (bs: ShellBatch[]) => bs.filter((b) => b.spec.surface === 'trim').flatMap(tris);
/** Trim triangles lying wholly in the slab z0..z1 with every vertex inside [x0, x1] x [y0, y1]. */
const trimIn = (ts: Tri[], x: [number, number], y: [number, number], z: [number, number]) =>
  ts.filter((t) => t.every((p) => p[0] >= x[0] && p[0] <= x[1] && p[1] >= y[0] && p[1] <= y[1] && p[2] >= z[0] && p[2] <= z[1]));
/** Trim triangles in the y / z slab whose x extent overlaps the open interval (x0, x1). */
const trimAcross = (ts: Tri[], x: [number, number], y: [number, number], z: [number, number]) =>
  ts.filter(
    (t) =>
      t.every((p) => p[1] >= y[0] && p[1] <= y[1] && p[2] >= z[0] && p[2] <= z[1]) &&
      Math.max(...t.map((p) => p[0])) > x[0] &&
      Math.min(...t.map((p) => p[0])) < x[1],
  );
const flatTris = (a: Float32Array): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < a.length / 9; i++) out.push([0, 1, 2].map((k): V3 => [a[i * 9 + k * 3], a[i * 9 + k * 3 + 1], a[i * 9 + k * 3 + 2]]));
  return out;
};
const area = (ts: Tri[]) => ts.reduce((s, t) => s + Math.hypot(...cross(sub(t[1], t[0]), sub(t[2], t[0]))) / 2, 0);

// ── classic: storagePartitionWainscot (drawn by Siding, capped by Trim) ─────

describe('classic: End Storage partition wainscot', () => {
  it("the outside walls' band on the main-room face, full width, with its cap", () => {
    const { cfg, s } = build({ mode: 'endBack', lengthFt: 30 });
    const pz = s.enclosure.partitionZ!;
    expect(pz).toBe(-5);
    expect(s.enclosure.partitionFaces).toBe(-1);
    const b = storagePartitionWainscot(s, cfg.openings, cfg.wainscot)!;
    expect(b.plane).toBe('cross');
    expect(b.at).toBeCloseTo(pz - O2, 12); // proud of its sheet (pz - SO), toward the main room
    expect(b.wH).toBe(3);
    expect(b.strips).toEqual([{ u0: -13, u1: 13, y0: 0, y1: 3 }]);
    expect(b.cap).toEqual([{ u0: -13, u1: 13 }]);
  });

  it('front-end storage: the band faces +Z (its main room)', () => {
    const { cfg, s } = build({ mode: 'end', lengthFt: 20 });
    const b = storagePartitionWainscot(s, cfg.openings, cfg.wainscot)!;
    expect(s.enclosure.partitionFaces).toBe(1);
    expect(b.at).toBeCloseTo(s.enclosure.partitionZ! + O2, 12);
  });

  it('openings cut the band and break the cap like on an outside wall', () => {
    const { cfg, s } = build({ mode: 'endBack', lengthFt: 30 }, { openings: [rollUp, lowWin, highWin] });
    const b = storagePartitionWainscot(s, cfg.openings, cfg.wainscot)!;
    const at = (u: number, y: number) => b.strips.some((t) => u > t.u0 && u < t.u1 && y > t.y0 && y < t.y1);
    expect(at(-11, 1.5)).toBe(true); // beside the roll-up
    expect(at(-4, 1.5)).toBe(false); // the roll-up: no band across the doorway
    expect(at(7, 1)).toBe(true); // under the low window
    expect(at(7, 2.5)).toBe(false); // the low window reaches down into the band
    expect(at(11, 2.5)).toBe(true);
    // the high window (sill 5') leaves the band alone; the cap breaks at the roll-up and the low window only
    expect(b.cap).toEqual([
      { u0: -13, u1: -9 },
      { u0: 1, u1: 5.5 },
      { u0: 8.5, u1: 13 },
    ]);
    // total band area = 26 x 3 - the doorway (10 x 3) - the window's part (3 x 1)
    expect(b.strips.reduce((a, t) => a + (t.u1 - t.u0) * (t.y1 - t.y0), 0)).toBeCloseTo(45, 9);
  });

  it("height follows the outside walls' clamp min(height, H - 0.5)", () => {
    const { cfg, s } = build({ mode: 'endBack', lengthFt: 20 }, { legHeight: 6, wainscot: { enabled: true, heightFt: 6 } });
    expect(storagePartitionWainscot(s, cfg.openings, cfg.wainscot)!.wH).toBe(5.5);
  });

  it('Left / Right lengthwise partition: full length on its main-room face, full cap', () => {
    const l = build({ mode: 'left', lengthFt: 12 }); // x = -1, faces +X
    const bl = storagePartitionWainscot(l.s, l.cfg.openings, l.cfg.wainscot)!;
    expect(bl.plane).toBe('side');
    expect(bl.at).toBeCloseTo(-1 + O2, 12);
    expect(bl.strips).toEqual([{ u0: -25, u1: 25, y0: 0, y1: 3 }]);
    expect(bl.cap).toEqual([{ u0: -25, u1: 25 }]);
    const r = build({ mode: 'right', lengthFt: 12 }); // x = 1, faces -X
    expect(storagePartitionWainscot(r.s, r.cfg.openings, r.cfg.wainscot)!.at).toBeCloseTo(1 - O2, 12);
  });

  it('wainscot off, a GCH divider, or no storage partition: nothing (the partition draws as before)', () => {
    for (const mode of ['end', 'endBack', 'left', 'right'] as const) {
      const { cfg, s } = build({ mode, lengthFt: 12 }, { ...OFF, openings: [rollUp] });
      expect(storagePartitionWainscot(s, cfg.openings, cfg.wainscot)).toBeNull();
    }
    const gch = build({ mode: 'endBack', lengthFt: 12 }, { buildingType: 'utility', enclosedLengthFt: 20, openEnd: 'front' });
    expect(storagePartitionWainscot(gch.s, [], gch.cfg.wainscot)).toBeNull();
    const plain = build({ mode: 'none', lengthFt: 0 });
    expect(storagePartitionWainscot(plain.s, [], plain.cfg.wainscot)).toBeNull();
  });

  it('Siding draws the band only from storagePartitionWainscot (last in the group) and Trim caps it', () => {
    const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const siding = src('../Siding.tsx');
    expect(siding).toMatch(/const storageBand = storagePartitionWainscot\(structure, openings, wainscot\);/);
    // the band block is the group's last child (nothing before it moves), in a
    // captureIgnore group (the PDF capture framing never sees it)
    expect(siding).toMatch(/export const CAPTURE_IGNORE: Record<string, unknown> = \{ captureIgnore: true \};/);
    expect(siding).toMatch(
      /\{storageBand && \(\s*<group userData=\{CAPTURE_IGNORE\}>\s*\{storageBand\.strips\.map\([\s\S]*?\}\)\}\s*<\/group>\s*\)\}\s*<\/group>\s*\);\s*\}\s*function EndWall/,
    );
    const trim = src('../Trim.tsx');
    expect(trim).toMatch(/storagePartitionWainscot\(structure, openings, \{ enabled: true, heightFt \}\)/);
    // the partition's cap bars: their own captureIgnore group, after the outside walls' bars
    expect(trim).toMatch(/if \(sb\)\s*for \(const c of sb\.cap\)\s*partBars\.push\(/);
    expect(trim).toMatch(
      /\{bars\.map\(\(b, i\) => \([\s\S]*?\)\)\}\s*\{partBars\.length > 0 && \(\s*<group userData=\{CAPTURE_IGNORE\}>\s*\{partBars\.map\(/,
    );
    expect(trim).not.toMatch(/bars\.push\(sb\./);
  });
});

// ── enhanced: shellLayout regions + wall / Z-trim batches ───────────────────

describe('enhanced: End Storage partition wainscot', () => {
  const { cfg, s } = build({ mode: 'endBack', lengthFt: 30 }, { openings: [rollUp, lowWin, highWin] });
  const zp = -5 - SO; // the partition sheet (main-room face, -Z)
  const layout = shellLayout(input(cfg, s));
  const part = layout.walls.find((w) => w.plane.id === 'partition')!;
  const walls = wallBatches(input(cfg, s));
  const wain = wallTris(walls, cfg.colors.wainscot);
  const wall = wallTris(walls, cfg.colors.walls);

  it('band region + Z-trim line on the partition, like an outside end wall', () => {
    expect(part.plane.at).toBeCloseTo(zp, 12);
    expect(part.regions.filter((r) => r.wainscot)).toEqual([{ c0: -13, c1: 13, y0: 0, y1: 3, wainscot: true }]);
    expect(part.cap).toEqual([{ y: 3, c0: -13, c1: 13 }]);
  });

  it('the band is cut around the openings (wainscot colour in the partition plane)', () => {
    expect(covers(wain, [-11, 1.5, zp])).toBe(true);
    expect(covers(wain, [-4, 1.5, zp])).toBe(false); // roll-up
    expect(covers(wain, [7, 1, zp])).toBe(true);
    expect(covers(wain, [7, 2.5, zp])).toBe(false); // low window
    expect(covers(wain, [11, 2.9, zp])).toBe(true);
    // above the line it is the wall colour (and the doorway stays open to its head)
    expect(covers(wall, [-11, 5, zp])).toBe(true);
    expect(covers(wall, [-4, 5, zp])).toBe(false);
    expect(covers(wall, [-4, 11, zp])).toBe(true);
    expect(covers(wall, [-11, 1.5, zp])).toBe(false);
  });

  it('the Z-trim runs on the main-room face at the line, broken at the roll-up and the low window', () => {
    const t = trimTris(trimBatches(input(cfg, s)));
    const z: [number, number] = [zp - 0.2, zp - 0.001]; // proud of the sheet toward the main room (-Z)
    const y: [number, number] = [2.8, 3.2];
    expect(trimIn(t, [-13, -9], y, z).length).toBeGreaterThan(0);
    expect(trimIn(t, [1, 5.5], y, z).length).toBeGreaterThan(0);
    expect(trimIn(t, [8.5, 13], y, z).length).toBeGreaterThan(0);
    expect(trimAcross(t, [-8.9, 0.9], y, z).length).toBe(0); // across the doorway
    expect(trimAcross(t, [5.6, 8.4], y, z).length).toBe(0); // across the window
    expect(trimAcross(t, [-12, -10], y, z).length).toBeGreaterThan(0); // (the probe does see a plate)
    // nothing on the storage-room side
    expect(trimIn(t, [-13, 13], y, [zp + 0.001, -5 + 0.5]).length).toBe(0);
  });

  it('wainscot off: one full-height wall region, no line, no wainscot colour on the partition', () => {
    const off = build({ mode: 'endBack', lengthFt: 30 }, { ...OFF, openings: [rollUp, lowWin] });
    const p = shellLayout(input(off.cfg, off.s)).walls.find((w) => w.plane.id === 'partition')!;
    expect(p.regions.length).toBe(1);
    expect(p.regions[0]).toMatchObject({ c0: -13, c1: 13, y0: 0, wainscot: false });
    expect(p.cap).toEqual([]);
    expect(covers(wallTris(wallBatches(input(off.cfg, off.s)), off.cfg.colors.wainscot), [-11, 1.5, zp])).toBe(false);
  });
});

describe('enhanced: Left / Right partition wainscot', () => {
  it('band + Z-trim the full length on the main-room face', () => {
    const { cfg, s } = build({ mode: 'left', lengthFt: 12 }); // x = -1, faces +X
    const X0 = -1 + SO;
    const bs = wallBatches(input(cfg, s));
    expect(covers(wallTris(bs, cfg.colors.wainscot), [X0, 1.5, 0])).toBe(true);
    expect(covers(wallTris(bs, cfg.colors.wainscot), [X0, 1.5, 24.5])).toBe(true);
    expect(covers(wallTris(bs, cfg.colors.walls), [X0, 1.5, 0])).toBe(false);
    expect(covers(wallTris(bs, cfg.colors.walls), [X0, 6, 0])).toBe(true);
    const t = trimTris(trimBatches(input(cfg, s)));
    const zt = trimIn(t, [X0 + 0.001, X0 + 0.2], [2.8, 3.2], [-25, 25]);
    expect(zt.length).toBeGreaterThan(0);
    expect(Math.min(...zt.flatMap((q) => q.map((p) => p[2])))).toBeCloseTo(-25, 6);
    expect(Math.max(...zt.flatMap((q) => q.map((p) => p[2])))).toBeCloseTo(25, 6);
  });
});

// ── Structure / Cutaway ghost ───────────────────────────────────────────────

/** Any vertex sitting strictly inside another triangle's edge (a T-junction)? */
function tJunctions(ts: Tri[]): number {
  const verts = ts.flat();
  let n = 0;
  for (const t of ts)
    for (let e = 0; e < 3; e++) {
      const a = t[e];
      const b = t[(e + 1) % 3];
      const ab = sub(b, a);
      const len2 = dot(ab, ab);
      for (const v of verts) {
        const av = sub(v, a);
        const k = dot(av, ab) / len2;
        if (k <= 1e-9 || k >= 1 - 1e-9) continue;
        if (Math.hypot(...cross(av, ab)) / Math.sqrt(len2) < 1e-6) n++;
      }
    }
  return n;
}

describe('Structure / Cutaway ghost: the band in the wainscot colour + its line', () => {
  it('End Storage: band + wall parts tile the ghost exactly (holes cut, gable solid), no T-junctions', () => {
    const { cfg, s } = build({ mode: 'endBack', lengthFt: 30 }, { openings: [rollUp, lowWin, highWin] });
    const g = storageGhostWainscot(s, cfg.openings, cfg.wainscot)!;
    const band = flatTris(g.band);
    const wall = flatTris(g.wall);
    expect(area(band)).toBeCloseTo(26 * 3 - 10 * 3 - 3 * 1, 6);
    const gable = (26 * (s.peakHeight - 12)) / 2;
    expect(area(band) + area(wall)).toBeCloseTo(26 * 12 + gable - 10 * 10 - 2 * 3 * 3, 6);
    // the band never goes above the line, and the whole ghost is the storageGhostShape outline's area
    expect(Math.max(...band.flat().map((p) => p[1]))).toBeCloseTo(3, 9);
    const sh = storageGhostShape(s, cfg.openings)!;
    const shapeArea = Math.abs(sh.shape.getPoints().reduce((a, p, i, arr) => a + p.x * arr[(i + 1) % arr.length].y - arr[(i + 1) % arr.length].x * p.y, 0) / 2);
    expect(area(band) + area(wall)).toBeCloseTo(shapeArea - 10 * 10 - 2 * 3 * 3, 6);
    expect(tJunctions([...band, ...wall])).toBe(0);
    // the line: broken at the roll-up and the low window only
    const cap = Array.from(g.cap);
    expect(cap).toEqual([-13, 3, 0, -9, 3, 0, 1, 3, 0, 5.5, 3, 0, 8.5, 3, 0, 13, 3, 0]);
  });

  it("its meshes are lit like the plain ghost's ShapeGeometry (normal +Z on every vertex — not black)", () => {
    const { cfg, s } = build({ mode: 'endBack', lengthFt: 30 }, { openings: [rollUp] });
    const geos = storageGhostWainscotGeometries(storageGhostWainscot(s, cfg.openings, cfg.wainscot)!);
    const plain = new THREE.ShapeGeometry(storageGhostShape(s, cfg.openings)!.shape).getAttribute('normal');
    expect([plain.getX(0), plain.getY(0), plain.getZ(0)]).toEqual([0, 0, 1]);
    for (const g of [geos.wall, geos.band]) {
      const n = g.getAttribute('normal');
      expect(n.count).toBe(g.getAttribute('position').count);
      for (let i = 0; i < n.count; i++) expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([0, 0, 1]);
    }
    expect(geos.cap.getAttribute('position').count).toBe(4); // two segments (broken at the roll-up)
  });

  it('Left / Right: a full-length band under the rest of the wall, one line', () => {
    const { cfg, s } = build({ mode: 'right', lengthFt: 12 });
    const g = storageGhostWainscot(s, cfg.openings, cfg.wainscot)!;
    expect(area(flatTris(g.band))).toBeCloseTo(50 * 3, 6);
    expect(Array.from(g.cap)).toEqual([-25, 3, 0, 25, 3, 0]);
  });

  it('wainscot off / GCH / no storage: no split (the single wall-colour ghost, as before)', () => {
    for (const mode of ['end', 'endBack', 'left', 'right'] as const) {
      const { cfg, s } = build({ mode, lengthFt: 12 }, OFF);
      expect(storageGhostWainscot(s, cfg.openings, cfg.wainscot)).toBeNull();
      expect(storageGhostShape(s, cfg.openings)).not.toBeNull();
    }
    const gch = build({ mode: 'endBack', lengthFt: 12 }, { buildingType: 'utility', enclosedLengthFt: 20, openEnd: 'front' });
    expect(storageGhostWainscot(gch.s, [], gch.cfg.wainscot)).toBeNull();
  });
});

// ── lean-to storage partition (already carried the band — pinned) ───────────

const leanTo = (o: Partial<LeanTo> = {}): LeanTo => ({
  id: 'lt1',
  type: 'attached',
  attachedSide: 'Right Eave',
  widthFt: 12,
  lengthFt: 40,
  lowLegHeightFt: 10,
  roofPitch: '2:12',
  enclosure: 'open',
  openings: [],
  ...o,
});
const ltDoor: LeanToOpening = { id: 'p1', type: 'rollUpDoor', wall: 'partition', widthFt: 10, heightFt: 8, sillFt: 0, offsetFt: 6 }; // x -26..-16
/** 30 x 40 x 12 garage; the lean-to is x -15..-27, storage 10' at the back: partition sheet z = 10 - SO, facing -Z. */
const ltBuild = (wainOn: boolean) => {
  const cfg: BuildingConfig = {
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 30,
    length: 40,
    legHeight: 12,
    trussSpacingFt: 5,
    openings: [],
    wainscot: { enabled: wainOn, heightFt: 3 },
    leanTos: [leanTo({ storage: { end: 'back', lengthFt: 10 }, openings: [ltDoor] })],
  };
  return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
};

describe('lean-to storage partition wainscot (both Looks)', () => {
  const zp = 10 - SO;
  it('enhanced: band on the open-side face cut at its door, Z-trim at the line', () => {
    const { cfg, s } = ltBuild(true);
    const bs = leanToBatches({ structure: s, mainOpenings: [], wallOrientation: cfg.panelOrientation, roofOrientation: cfg.roofOrientation, colors: cfg.colors, wainscot: cfg.wainscot });
    const wain = wallTris(bs, cfg.colors.wainscot);
    expect(covers(wain, [-26.5, 1.5, zp])).toBe(true);
    expect(covers(wain, [-15.5, 1.5, zp])).toBe(true);
    expect(covers(wain, [-21, 1.5, zp])).toBe(false); // the door
    expect(covers(wallTris(bs, cfg.colors.walls), [-26.5, 6, zp])).toBe(true);
    expect(trimIn(trimTris(bs), [-27.5, -26], [2.8, 3.2], [zp - 0.2, zp - 0.001]).length).toBeGreaterThan(0);
    const off = ltBuild(false);
    const bo = leanToBatches({ structure: off.s, mainOpenings: [], wallOrientation: off.cfg.panelOrientation, roofOrientation: off.cfg.roofOrientation, colors: off.cfg.colors, wainscot: off.cfg.wainscot });
    expect(covers(wallTris(bo, off.cfg.colors.wainscot), [-26.5, 1.5, zp])).toBe(false);
  });
  it('classic: band strips 0.02 proud of the partition sheet, cap bar broken at the door', () => {
    const { s } = ltBuild(true);
    const lt = s.leanTos[0];
    const walls = resolveWalls(lt);
    const geo = eaveSurfaces(lt, s.roofOverhangFt, walls);
    const strips = gableWainscotStrips(geo, 'partition', 3, lt.openings);
    expect(strips.length).toBe(2); // either side of the door
    for (const st of strips) for (const c of st.corners) expect(c[2]).toBeCloseTo(zp - 0.02, 9);
    const xs = strips.map((st) => [Math.min(...st.corners.map((c) => c[0])), Math.max(...st.corners.map((c) => c[0]))]).sort((a, b) => a[0] - b[0]);
    expect(xs).toEqual([
      [-27, -26],
      [-16, -15],
    ]);
    const bars = leanToWainscotCaps(geo, 3, walls, lt.openings).filter((b) => Math.abs(b.pos[2] - zp) < 0.2);
    expect(bars.map((b) => [b.pos[0] - b.size[0] / 2, b.pos[0] + b.size[0] / 2]).sort((a, b) => a[0] - b[0])).toEqual([
      [-27, -26],
      [-16, -15],
    ]);
  });
});

// ── PDF capture framing (10/5/26 gate) ──────────────────────────────────────
// CaptureHook seeds its camera from the average of every mesh's box corners.
// The partition's wainscot pieces sit inside the partition sheet's own box,
// but as NEW meshes (and the enhanced sheet split in two) they moved that
// average, so every PDF / contract view of a wainscot + storage build came out
// ~0.5% re-framed (even views where the partition cannot be seen). They are
// now kept out of the fit: the framing sees exactly what it saw before.

/** The enhanced layout as LIVE (de56edf) built it: the partition one full-height wall-colour region, no Z-trim line. */
const liveLayout = (inp: ShellInput) => {
  const lay = shellLayout(inp);
  const p = lay.walls.find((w) => w.plane.id === 'partition')!;
  const c0 = Math.min(...p.regions.map((r) => r.c0));
  const c1 = Math.max(...p.regions.map((r) => r.c1));
  const y1 = Math.max(...p.regions.map((r) => r.y1));
  p.regions = [{ c0, c1, y0: 0, y1, wainscot: false }];
  p.cap = [];
  return lay;
};
const geo = (b: ShellBatch) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  return g;
};
const isInterior = (b: ShellBatch) => b.spec.surface === 'wall' && !!b.spec.interior;
/** CaptureHook's fit point list for these batches (ShellMeshes userData + captureBoxOf, same corner order). */
const capturePoints = (bs: ShellBatch[]) => {
  const geos = bs.map(geo);
  const data = shellCaptureData(bs, geos);
  const pts: number[] = [];
  bs.forEach((_, i) => {
    const m = new THREE.Mesh(geos[i]);
    if (data[i]) m.userData = data[i]!;
    if (m.userData.captureIgnore) return;
    const bx = captureBoxOf(m)!;
    for (const X of [bx.min.x, bx.max.x]) for (const Y of [bx.min.y, bx.max.y]) for (const Z of [bx.min.z, bx.max.z]) pts.push(X, Y, Z);
  });
  return pts;
};

describe('PDF capture framing: the partition wainscot never moves it', () => {
  const cases: [string, { mode: StorageMode; lengthFt: number }, Opening[]][] = [
    ['End Storage back 30 (roll-up, low + high window)', { mode: 'endBack', lengthFt: 30 }, [rollUp, lowWin, highWin]],
    ['End Storage front 20 (roll-up)', { mode: 'end', lengthFt: 20 }, [rollUp]],
    ['Left storage 12', { mode: 'left', lengthFt: 12 }, []],
    ['Right storage 10', { mode: 'right', lengthFt: 10 }, []],
  ];
  for (const [name, storage, openings] of cases) {
    it(`${name}: enhanced walls + trim give CaptureHook exactly the LIVE fit points`, () => {
      const { cfg, s } = build(storage, { openings });
      const inp = input(cfg, s);
      // walls: the sheet is split in two (wall + wainscot colour) ...
      const now = wallBatches(inp);
      const live = wallBatches(inp, liveLayout(inp));
      const interior = now.filter(isInterior);
      expect(interior.map((b) => (b.spec.surface === 'wall' ? b.spec.color : '')).sort()).toEqual([cfg.colors.walls, cfg.colors.wainscot].sort());
      expect(live.filter(isInterior).length).toBe(1);
      // ... every other wall batch is LIVE's, byte for byte, in LIVE's order
      const outside = (bs: ShellBatch[]) => bs.filter((b) => !isInterior(b)).map((b) => [b.id, Array.from(b.position)]);
      expect(outside(now)).toEqual(outside(live));
      // ... and the fit sees ONE box for the two pieces: LIVE's sheet box
      expect(capturePoints(now)).toEqual(capturePoints(live));
      const data = shellCaptureData(now, now.map(geo));
      expect(data.filter((d) => d?.captureBox).length).toBe(1);
      expect(data.filter((d) => d?.captureIgnore).length).toBe(1);
      now.forEach((b, i) => {
        if (!isInterior(b)) expect(data[i]).toBeUndefined();
      });
      // trim: the main batch is LIVE's byte for byte; the partition's Z-trim is its own capture-ignored batch
      const tNow = trimBatches(inp);
      const tLive = trimBatches(inp, liveLayout(inp));
      expect(tLive.some((b) => b.captureIgnore)).toBe(false);
      expect(tNow.filter((b) => !b.captureIgnore).map((b) => [b.id, Array.from(b.position)])).toEqual(tLive.map((b) => [b.id, Array.from(b.position)]));
      const zt = tNow.filter((b) => b.captureIgnore);
      expect(zt.length).toBe(1);
      expect(zt[0].id).toBe(`${tLive[0].id}|partition-cap`);
      expect(zt[0].spec).toEqual(tLive[0].spec);
      expect(zt[0].position.length).toBeGreaterThan(0);
      expect(new Set(tNow.map((b) => b.id)).size).toBe(tNow.length);
      expect(capturePoints(tNow)).toEqual(capturePoints(tLive));
    });
  }

  it('wainscot off / GCH divider: nothing tagged, the one trim batch (exactly as before)', () => {
    const off = build({ mode: 'endBack', lengthFt: 30 }, { ...OFF, openings: [rollUp] });
    const gch = build({ mode: 'endBack', lengthFt: 12 }, { buildingType: 'utility', enclosedLengthFt: 20, openEnd: 'front' });
    for (const { cfg, s } of [off, gch]) {
      const w = wallBatches(input(cfg, s));
      const t = trimBatches(input(cfg, s));
      expect(shellCaptureData(w, w.map(geo)).every((d) => d === undefined)).toBe(true);
      expect(t.some((b) => b.captureIgnore)).toBe(false);
      expect(shellCaptureData(t, t.map(geo)).every((d) => d === undefined)).toBe(true);
    }
    // the GCH divider keeps its Z-trim in the main trim batch
    const g = shellLayout(input(gch.cfg, gch.s)).walls.find((w) => w.plane.id === 'partition')!;
    expect(g.cap.length).toBeGreaterThan(0);
  });

  it('captureBoxOf: userData.captureBox wins, else the geometry box (computed once, as before)', () => {
    const g = new THREE.BoxGeometry(2, 4, 6);
    const m = new THREE.Mesh(g);
    expect(g.boundingBox).toBeNull();
    const b = captureBoxOf(m)!;
    expect([b.min.toArray(), b.max.toArray()]).toEqual([
      [-1, -2, -3],
      [1, 2, 3],
    ]);
    expect(g.boundingBox).toBe(b);
    const proxy = new THREE.Box3(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 9, 1));
    m.userData = { captureBox: proxy };
    expect(captureBoxOf(m)).toBe(proxy);
    m.userData = { captureBox: { min: 0 } }; // not a Box3: ignored
    expect(captureBoxOf(m)).toBe(g.boundingBox);
  });

  it('ShellMeshes passes the data as mesh userData; CaptureHook reads boxes through captureBoxOf', () => {
    const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const sm = src('../enhanced/ShellMeshes.tsx');
    expect(sm).toMatch(/const capture = useMemo\(\(\) => shellCaptureData\(batches, geometries\), \[batches, geometries\]\);/);
    expect(sm).toMatch(/userData=\{capture\[i\] \?\? NO_TAG\}/);
    const hook = src('../CaptureHook.tsx');
    expect(hook).toMatch(/if \(isCaptureIgnored\(m\)\) return;[^\n]*\n\s*const b = captureBoxOf\(m\);/);
    expect(hook).not.toMatch(/m\.geometry\.boundingBox/);
  });
});
