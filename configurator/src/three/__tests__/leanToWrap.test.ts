import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, type Member, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, LeanTo } from '@/types/building';
import type { V3 } from '../enhanced/materials';
import type { ShellBatch } from '../enhanced/shellGeometry';
import { leanToBatches, leanToBatchKey } from '../enhanced/leanToShell';
import { siteRects } from '../enhanced/look';
import { eaveSurfaces, gableSurfaces, resolveWalls } from '../LeanToSiding';

// WRAP-AROUND lean-tos (owner 10/12/26) in the 3D: VIEW-ONLY — the program
// prices the wrap and tags both lean-tos with the corner (LeanTo.wrapCorners).
// The corner square gets a continuous roof (each lean-to's roof runs on to a
// 45° hip from the main corner to the drip corner), a corner post, a hip
// rafter, the purlins carried to the hip and base rails; the lean-tos' end
// walls stay in line with the main ends and the corner stays open (Sensei).
// A lean-to without wrapCorners derives and draws exactly as before.

const lt = (over: Partial<LeanTo>): LeanTo => ({
  id: 'lt-' + (over.attachedSide ?? 'Left Eave'),
  type: 'attached',
  attachedSide: 'Left Eave',
  widthFt: 12,
  lengthFt: 40,
  lowLegHeightFt: 10,
  roofPitch: '2:12',
  enclosure: 'open',
  openings: [],
  ...over,
});
/** 24 x 40 x 12 garage — Sensei's config D. */
const build = (leanTos: LeanTo[], over: Partial<BuildingConfig> = {}): { cfg: BuildingConfig; s: StructureModel } => {
  const cfg: BuildingConfig = { ...DEFAULT_CONFIG, buildingType: 'garage', width: 24, length: 40, legHeight: 12, openings: [], leanTos, ...over };
  return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
};
const batchesOf = (cfg: BuildingConfig, s: StructureModel) =>
  leanToBatches({ structure: s, mainOpenings: cfg.openings, wallOrientation: cfg.panelOrientation, roofOrientation: cfg.roofOrientation, colors: cfg.colors, wainscot: cfg.wainscot });

const near = (a: number, b: number, t = 0.01) => Math.abs(a - b) < t;
const at = (m: Member, a: V3, b: V3) => (near(m.start[0], a[0]) && near(m.start[1], a[1]) && near(m.start[2], a[2]) && near(m.end[0], b[0]) && near(m.end[1], b[1]) && near(m.end[2], b[2])) ||
  (near(m.start[0], b[0]) && near(m.start[1], b[1]) && near(m.start[2], b[2]) && near(m.end[0], a[0]) && near(m.end[1], a[1]) && near(m.end[2], a[2]));

interface Tri { p: V3[] }
const tris = (b: ShellBatch): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < b.position.length / 9; i++) {
    const p: V3[] = [];
    for (let k = 0; k < 3; k++) { const o = i * 9 + k * 3; p.push([b.position[o], b.position[o + 1], b.position[o + 2]]); }
    out.push({ p });
  }
  return out;
};
function coveringTris(ts: Tri[], x: number, z: number): Tri[] {
  return ts.filter((t) => {
    const P = t.p.map((p) => [p[0], p[2]] as [number, number]);
    const s = (a: number[], b: number[]) => (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const s0 = s(P[0], P[1]), s1 = s(P[1], P[2]), s2 = s(P[2], P[0]);
    return (s0 > 1e-9 && s1 > 1e-9 && s2 > 1e-9) || (s0 < -1e-9 && s1 < -1e-9 && s2 < -1e-9);
  });
}
const heightAt = (t: Tri, x: number, z: number) => {
  const [a, b, c] = t.p;
  const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  return a[1] - (n[0] * (x - a[0]) + n[2] * (z - a[2])) / n[1];
};

const LEFT = lt({ attachedSide: 'Left Eave', lengthFt: 40 });
const FRONT = lt({ attachedSide: 'Front Gable', lengthFt: 24 });

describe('wrap-around lean-tos — 3D geometry', () => {
  it('no wrapCorners: identical structure to before (no wrap keys, no extra members)', () => {
    const a = build([LEFT, FRONT]).s;
    expect(a.leanToWraps).toBeUndefined();
    expect(a.leanTos.every((l) => l.wrap === undefined)).toBe(true);
    const b = build([{ ...LEFT, wrapCorners: ['FL'] }, FRONT]).s; // only one side tagged → not drawn
    expect(b.leanToWraps).toBeUndefined();
    expect(b.members.length).toBe(a.members.length);
  });

  it('Front Left wrap: corner post, hip rafter, purlins to the hip, base rails; spans / walls unchanged', () => {
    const plain = build([LEFT, FRONT]).s;
    const { s } = build([{ ...LEFT, wrapCorners: ['FL'] }, { ...FRONT, wrapCorners: ['FL'] }]);
    const halfW = 12, halfL = 20, w = 12, lh = 10, cH = 12; // 10' low leg + 12 x 2/12 = 12' (= the main eave: flush)
    expect(s.leanToWraps).toEqual([{ corner: 'FL', sx: 1, zs: -1, widthFt: 12, lowLegHeightFt: 10, connH: cH, eaveId: 'lt-Left Eave', gableId: 'lt-Front Gable' }]);
    const L = s.leanTos.find((l) => l.attachedSide === 'Left Eave')!;
    const F = s.leanTos.find((l) => l.attachedSide === 'Front Gable')!;
    expect(L.wrap).toEqual({ start: { corner: 'FL', sx: 1, zs: -1, ext: 12, partnerId: 'lt-Front Gable' } });
    expect(F.wrap).toEqual({ end: { corner: 'FL', sx: 1, zs: -1, ext: 12, partnerId: 'lt-Left Eave' } });
    // spans / ends / outer walls are where they were (Sensei: the ends stay in line, the corner stays open)
    const pl = plain.leanTos.find((l) => l.attachedSide === 'Left Eave')!;
    expect([L.spanStart, L.spanEnd, L.inner, L.outer]).toEqual([pl.spanStart, pl.spanEnd, pl.inner, pl.outer]);
    const corner: V3 = [halfW + w, 0, -(halfL + w)];
    const extra = s.members.slice();
    expect(extra.some((m) => m.kind === 'leg' && at(m, corner, [corner[0], lh, corner[2]]))).toBe(true);
    expect(extra.some((m) => m.kind === 'rafter' && at(m, [halfW, cH, -halfL], [corner[0], lh, corner[2]]))).toBe(true);
    for (const t of [1 / 3, 2 / 3]) {
      const y = cH + (lh - cH) * t;
      expect(extra.some((m) => m.kind === 'purlin' && at(m, [halfW + w * t, y, -halfL], [halfW + w * t, y, -(halfL + w * t)]))).toBe(true);
      expect(extra.some((m) => m.kind === 'purlin' && at(m, [halfW, y, -(halfL + w * t)], [halfW + w * t, y, -(halfL + w * t)]))).toBe(true);
    }
    expect(extra.some((m) => m.kind === 'baseRail' && at(m, [halfW + w, 0, -halfL], corner))).toBe(true);
    expect(extra.some((m) => m.kind === 'baseRail' && at(m, [halfW, 0, -(halfL + w)], corner))).toBe(true);
    expect(s.members.length - plain.members.length).toBe(1 + 1 + 2 + 4 + 2); // post, hip, 2 edges, 4 purlins, 2 rails
  });

  it('every corner key maps to its own main corner (FR, BL, BR)', () => {
    const R = lt({ attachedSide: 'Right Eave' });
    const B = lt({ attachedSide: 'Back Gable', lengthFt: 24 });
    const all: LeanTo[] = [LEFT, R, FRONT, B].map((l) => ({ ...l, wrapCorners: ['FL', 'FR', 'BL', 'BR'] }));
    const { s } = build(all);
    expect(s.leanToWraps!.map((c) => [c.corner, c.sx, c.zs])).toEqual([['FL', 1, -1], ['FR', -1, -1], ['BL', 1, 1], ['BR', -1, 1]]);
    // Full Building: each eave lean-to wraps both ends, each gable lean-to both ends
    for (const l of s.leanTos) expect(Object.keys(l.wrap ?? {}).sort()).toEqual(['end', 'start']);
  });

  it('mismatched width / low leg, or a lean-to that stops short of the corner: no wrap drawn', () => {
    expect(build([{ ...LEFT, wrapCorners: ['FL'] }, { ...FRONT, widthFt: 10, wrapCorners: ['FL'] }]).s.leanToWraps).toBeUndefined();
    expect(build([{ ...LEFT, wrapCorners: ['FL'] }, { ...FRONT, lowLegHeightFt: 8, wrapCorners: ['FL'] }]).s.leanToWraps).toBeUndefined();
    expect(build([{ ...LEFT, lengthFt: 30, offsetFt: 10, wrapCorners: ['FL'] }, { ...FRONT, wrapCorners: ['FL'] }]).s.leanToWraps).toBeUndefined();
  });

  it('the slab covers the corner square', () => {
    const { s } = build([{ ...LEFT, wrapCorners: ['FL'] }, { ...FRONT, wrapCorners: ['FL'] }]);
    expect(siteRects(s)).toContainEqual({ x0: 12, x1: 24, z0: -32, z1: -20 });
    expect(siteRects(build([LEFT, FRONT]).s).length).toBe(3);
  });
});

describe('wrap-around lean-tos — roofs (enhanced and classic)', () => {
  it('enhanced: the corner square is roofed once everywhere, both planes meet on the hip, no rake at the wrapped ends', () => {
    const { cfg, s } = build([{ ...LEFT, wrapCorners: ['FL'] }, { ...FRONT, wrapCorners: ['FL'] }]);
    const roofs = batchesOf(cfg, s).filter((b) => b.spec.surface === 'roof').flatMap(tris);
    const halfW = 12, halfL = 20, w = 12, oh = s.roofOverhangFt;
    const lifts: number[] = [];
    for (const [dx, dz] of [[1, 3], [3, 1], [6, 6.5], [11, 2], [2, 11], [11.5, 11.9], [w + oh * 0.5, w + oh * 0.4]]) {
      const x = halfW + dx, z = -(halfL + dz);
      const cov = coveringTris(roofs, x, z);
      expect(cov.length).toBe(1);
      // the roof there is the LOWER of the two lean-to planes: connH − slope · max(dx, dz) (+ the sheet lift, the same everywhere)
      lifts.push(heightAt(cov[0], x, z) - (12 - (2 / 12) * Math.max(dx, dz)));
    }
    for (const l of lifts) { expect(l).toBeGreaterThanOrEqual(0); expect(l).toBeLessThan(0.2); expect(l).toBeCloseTo(lifts[0], 3); }
    // the wrap changes the batch key (memo) and adds roof area over the corner
    const plain = build([LEFT, FRONT]);
    expect(leanToBatchKey({ structure: s, mainOpenings: [], wallOrientation: cfg.panelOrientation, roofOrientation: cfg.roofOrientation, colors: cfg.colors, wainscot: cfg.wainscot }))
      .not.toBe(leanToBatchKey({ structure: plain.s, mainOpenings: [], wallOrientation: cfg.panelOrientation, roofOrientation: cfg.roofOrientation, colors: cfg.colors, wainscot: cfg.wainscot }));
    expect(coveringTris(batchesOf(plain.cfg, plain.s).filter((b) => b.spec.surface === 'roof').flatMap(tris), halfW + 6, -(halfL + 6.5)).length).toBe(0);
  });

  it('classic: each roof becomes a trapezoid ending on the hip (main corner → drip corner); no rake at the wrapped end', () => {
    const { s } = build([{ ...LEFT, wrapCorners: ['FL'] }, { ...FRONT, wrapCorners: ['FL'] }]);
    const oh = s.roofOverhangFt;
    const L = s.leanTos.find((l) => l.attachedSide === 'Left Eave')!;
    const F = s.leanTos.find((l) => l.attachedSide === 'Front Gable')!;
    const gL = eaveSurfaces(L, oh, resolveWalls(L));
    const gF = gableSurfaces(F, oh, resolveWalls(F));
    // inner (high) edge stops at the main corner z = -20; outer (drip) corner reaches z = -(20 + 12 + oh)
    expect(gL.roofTop.map((p) => +p[2].toFixed(3)).sort((a, b) => a - b)[0]).toBeCloseTo(-(20 + 12 + oh), 2);
    expect(gF.roofTop.map((p) => +p[0].toFixed(3)).sort((a, b) => b - a)[0]).toBeCloseTo(12 + 12 + oh, 2);
    const plainL = eaveSurfaces({ ...L, wrap: undefined }, oh, resolveWalls(L));
    // one rake fewer (the wrapped front end), one hip cap more → same trim count
    expect(gL.trim.length).toBe(plainL.trim.length);
    expect(gL.trim.some((b) => b.rot && Math.abs(b.rot[1]) > 0.1 && Math.abs(b.rot[2]) > 0.01)).toBe(true); // the hip cap (diagonal)
  });
});
