import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, LeanTo, LeanToOpening } from '@/types/building';
import type { V3 } from '../enhanced/materials';
import type { ShellBatch } from '../enhanced/shellGeometry';
import { leanToBatches, leanToBatchKey } from '../enhanced/leanToShell';
import { eaveSurfaces, endWallPlane, gableSurfaces, resolveWalls, sideWallPolys, storageRuns } from '../LeanToSiding';
import { leanToWallFrame, partitionVisible } from '../LeanToSpacing';

/**
 * Lean-to STORAGE SECTION — drawing (enhanced shell + classic surfaces +
 * Spacing frames). The partition is an end-type wall across the lean-to at
 * the storage boundary, its sheeted face toward the OPEN part; the storage
 * end and the storage stretch of the outer wall are closed.
 */

const SO = SHEET_OUTSET;

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

/** 30 x 40 x 12 garage, trusses 5' OC; the lean-to is x -15..-27, z -20..20. */
const build = (lts: LeanTo[], over: Partial<BuildingConfig> = {}): { cfg: BuildingConfig; s: StructureModel } => {
  const cfg: BuildingConfig = { ...DEFAULT_CONFIG, buildingType: 'garage', width: 30, length: 40, legHeight: 12, trussSpacingFt: 5, openings: [], leanTos: lts, ...over };
  return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
};
const batchesOf = ({ cfg, s }: { cfg: BuildingConfig; s: StructureModel }) =>
  leanToBatches({ structure: s, mainOpenings: cfg.openings, wallOrientation: cfg.panelOrientation, roofOrientation: cfg.roofOrientation, colors: cfg.colors, wainscot: cfg.wainscot });

interface Tri {
  p: V3[];
}
const tris = (b: ShellBatch): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < b.position.length / 9; i++) {
    const p: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3;
      p.push([b.position[o], b.position[o + 1], b.position[o + 2]]);
    }
    out.push({ p });
  }
  return out;
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Does any triangle contain q (in its plane)? */
const covers = (ts: Tri[], q: V3) =>
  ts.some((t) => {
    const n = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
    if (Math.abs(dot(sub(q, t.p[0]), n)) / Math.hypot(...n) > 1e-4) return false;
    const s0 = dot(cross(sub(t.p[1], t.p[0]), sub(q, t.p[0])), n);
    const s1 = dot(cross(sub(t.p[2], t.p[1]), sub(q, t.p[1])), n);
    const s2 = dot(cross(sub(t.p[0], t.p[2]), sub(q, t.p[2])), n);
    return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
  });
const wallTris = (bs: ShellBatch[], color?: string) => bs.filter((b) => b.spec.surface === 'wall' && (!color || b.spec.color === color)).flatMap(tris);
const trimTris = (bs: ShellBatch[]) => bs.filter((b) => b.spec.surface === 'trim').flatMap(tris);

const partitionDoor: LeanToOpening = { id: 'p1', type: 'rollUpDoor', wall: 'partition', widthFt: 10, heightFt: 8, sillFt: 0, offsetFt: 6 };

describe('enhanced lean-to — storage section', () => {
  // Open lean-to, 10' storage at the BACK (partition framing line z = 10, face toward -Z at z = 10 - SO).
  const plain = build([leanTo()]);
  const stor = build([leanTo({ storage: { end: 'back', lengthFt: 10 }, openings: [partitionDoor] })]);
  const outerX = -27 - SO;
  const partZ = 10 - SO;

  it('partition wall across the lean-to at the storage boundary (to just under the roof), cut around its roll-up', () => {
    const w = wallTris(batchesOf(stor));
    expect(covers(w, [-21, 9, partZ])).toBe(true); // above the door
    expect(covers(w, [-26.5, 5, partZ])).toBe(true); // beside the door (outer side)
    expect(covers(w, [-15.5, 11, partZ])).toBe(true); // tall side at the main wall
    expect(covers(w, [-21, 4, partZ])).toBe(false); // the door hole
    expect(covers(wallTris(batchesOf(plain)), [-21, 9, partZ])).toBe(false);
  });

  it('storage end closed + outer wall closed along the storage stretch only (the rest stays open)', () => {
    const w = wallTris(batchesOf(stor));
    expect(covers(w, [outerX, 5, 15])).toBe(true); // storage stretch z 10..20
    expect(covers(w, [outerX, 5, 0])).toBe(false); // open part
    expect(covers(w, [-21, 5, 20 + SO])).toBe(true); // back end (storage end) closed
    expect(covers(w, [-21, 5, -20 - SO])).toBe(false); // front end stays open
    const p = wallTris(batchesOf(plain));
    expect(covers(p, [outerX, 5, 15])).toBe(false);
    expect(covers(p, [-21, 5, 20 + SO])).toBe(false);
  });

  it('partial (3/4) outer wall + storage at the FRONT + wainscot: the band keeps running, the storage stretch is closed to the slab and is the only outer wainscot', () => {
    const b = build([leanTo({ enclosure: 'custom', customWalls: { side: 'q3', front: 'open', back: 'open' }, storage: { end: 'front', lengthFt: 10 } })], {
      wainscot: { enabled: true, heightFt: 3 },
    });
    const bs = batchesOf(b);
    const all = wallTris(bs);
    const wain = wallTris(bs, b.cfg.colors.wainscot);
    expect(covers(all, [outerX, 1, -15])).toBe(true); // storage stretch z -20..-10, low
    expect(covers(wain, [outerX, 1, -15])).toBe(true);
    expect(covers(all, [outerX, 1, 5])).toBe(false); // under the band (open)
    expect(covers(all, [outerX, 8, 5])).toBe(true); // the band
    expect(covers(wain, [outerX, 1, 5])).toBe(false);
    // Partition trim never pokes through the band: nothing outside the outer wall face, on the
    // partition's open side (its face at z = -10 + SO), between the band bottom (2.5) and the eave.
    const poke = trimTris(bs).some((t) => {
      const ys = t.p.map((q) => q[1]);
      return t.p.every((q) => q[0] < outerX - 0.001 && q[2] > -9.95 && q[2] < -9.5) && Math.max(...ys) > 2.5 + 0.35 && Math.min(...ys) < 10 - 0.6;
    });
    expect(poke).toBe(false);
  });

  it('memo key follows the storage section; the batches without one are unchanged by it', () => {
    const key = (x: { cfg: BuildingConfig; s: StructureModel }) =>
      leanToBatchKey({ structure: x.s, mainOpenings: [], wallOrientation: x.cfg.panelOrientation, roofOrientation: x.cfg.roofOrientation, colors: x.cfg.colors, wainscot: x.cfg.wainscot });
    const a = build([leanTo({ storage: { end: 'back', lengthFt: 10 } })]);
    const c = build([leanTo({ storage: { end: 'back', lengthFt: 12 } })]);
    expect(key(a)).not.toBe(key(c));
    expect(key(a)).not.toBe(key(plain));
    const again = build([leanTo({ storage: undefined })]);
    expect(JSON.stringify(batchesOf(again))).toBe(JSON.stringify(batchesOf(plain)));
  });
});

describe('classic lean-to surfaces — storage section', () => {
  it('partition plane, storage runs, band limited to the open part, extra corner trims', () => {
    const { s } = build([leanTo({ enclosure: 'custom', customWalls: { side: 'q2', front: 'open', back: 'open' }, storage: { end: 'back', lengthFt: 10 } })]);
    const lt = s.leanTos[0];
    const walls = resolveWalls(lt);
    expect(walls.back).toBe('closed');
    const geo = eaveSurfaces(lt, s.roofOverhangFt, walls);
    expect(geo.gable.partition).toEqual({ plane: 10 - SO, faces: -1 });
    expect(endWallPlane(geo.gable, 'partition')).toEqual({ plane: 10 - SO, outward: -1 });
    const runs = storageRuns(geo)!;
    expect(runs.seg).toEqual([10, 20]);
    expect(runs.band).toEqual([-20, 10]);
    for (const p of sideWallPolys(geo, 'q2', lt.lowLegHeightFt, [], runs.band)) for (const c of p.corners) expect(c[2]).toBeLessThanOrEqual(10 + 1e-9);
    const plainLt = build([leanTo({ enclosure: 'custom', customWalls: { side: 'q2', front: 'open', back: 'open' } })]).s.leanTos[0];
    const plainGeo = eaveSurfaces(plainLt, s.roofOverhangFt, resolveWalls(plainLt));
    expect(plainGeo.gable.partition).toBeUndefined();
    expect(storageRuns(plainGeo)).toBeNull();
    expect(geo.trim.length).toBeGreaterThan(plainGeo.trim.length);
  });

  it('gable lean-to: the partition sits across the run (X) at the storage boundary', () => {
    const { s } = build([leanTo({ attachedSide: 'Front Gable', lengthFt: 30, storage: { end: 'front', lengthFt: 8 } })]);
    const lt = s.leanTos[0];
    const geo = gableSurfaces(lt, s.roofOverhangFt, resolveWalls(lt));
    expect(lt.storage?.runAt).toBe(-15 + 8);
    expect(geo.gable.partition).toEqual({ plane: -7 + SO, faces: 1 });
  });
});

describe('Spacing overlay — partition wall frame', () => {
  it('partition frame: along the lean-to width, normal toward the open part, sloped height like an end wall', () => {
    const { s } = build([leanTo({ storage: { end: 'back', lengthFt: 10 } })]);
    const lt = s.leanTos[0];
    const walls = resolveWalls(lt);
    const geo = eaveSurfaces(lt, s.roofOverhangFt, walls);
    const f = leanToWallFrame(geo, 'partition');
    expect(f.len).toBe(12);
    expect(f.n).toEqual([0, 0, -1]);
    expect(f.pt(0, 0)).toEqual([-27, 0, 10 - SO]);
    expect(f.heightAt(0)).toBeCloseTo(10, 6); // outer edge = low leg
    expect(f.heightAt(12)).toBeCloseTo(12, 6); // at the main wall = connection
  });

  it('partition labels only show when it can be seen through the open part', () => {
    const st = { end: 'back' as const };
    expect(partitionVisible({ side: 'open', front: 'open', back: 'closed', storage: st })).toBe(true);
    expect(partitionVisible({ side: 'closed', front: 'open', back: 'closed', storage: st })).toBe(true);
    expect(partitionVisible({ side: 'q3', front: 'closed', back: 'closed', storage: st })).toBe(true);
    expect(partitionVisible({ side: 'closed', front: 'closed', back: 'closed', storage: st })).toBe(false);
    expect(partitionVisible({ side: 'open', front: 'open', back: 'open' })).toBe(false);
  });
});
