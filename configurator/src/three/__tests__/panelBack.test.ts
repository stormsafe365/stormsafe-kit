import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, LeanTo, StorageMode } from '@/types/building';
import { PANEL_BACK_HEX, PANEL_BACK_USERDATA, keptByRoofUnderClip, oneSided, sheetSides } from '../panelBack';
import { eaveSurfaces, endWallPaint, gableSurfaces, leanToRoomRect, outerWallPaint, polyNormal, resolveWalls, sideWallPolys } from '../LeanToSiding';
import { storageGhostShape, storageGhostSides } from '../StoragePartitionGhost';
import { disposeEnhancedMaterials, getEnhancedMaterial, materialKey, type V3 } from '../enhanced/materials';
import { disposeEnhancedTextures, normalMapTexture } from '../enhanced/normalMaps';
import { installFakeCanvas } from './fakeCanvas';
import { mainRoomRect, roofBatches, wallBatches, type ShellBatch, type ShellInput } from '../enhanced/shellGeometry';
import { leanToBatches } from '../enhanced/leanToShell';
import { CAP_SHEET_GAP, capBarBox, capSeenFromPaintedSide } from '../Trim';
import { shellCaptureData } from '../enhanced/ShellMeshes';

// Owner 10/5/26 (photo of a green carport): "you have color showing on the
// inside panels, the colors only shows on the outside - the inside panels
// almost look white". A sheet is painted on ONE face; its other face is the
// light unpainted panel back. Exterior walls: paint outside. Storage
// partitions: paint on the main-room face, back inside the storage room.

beforeAll(() => {
  installFakeCanvas();
});
afterAll(() => {
  disposeEnhancedMaterials();
  disposeEnhancedTextures();
  vi.unstubAllGlobals();
});

const build = (over: Partial<BuildingConfig> = {}, storage?: { mode: StorageMode; lengthFt: number }) => {
  const cfg: BuildingConfig = {
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 30,
    length: 45,
    legHeight: 12,
    manufacturer: 'CCI',
    wainscot: { enabled: true, heightFt: 3 },
    colors: { ...DEFAULT_CONFIG.colors, walls: 'WXR0077L', wainscot: 'WXA0090L' },
    ...over,
    walls: { ...DEFAULT_CONFIG.walls, ...(over.walls ?? {}), storage: storage ?? { mode: 'none', lengthFt: 0 } },
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

interface Tri {
  p: V3[];
  n: V3;
}
const tris = (b: ShellBatch): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < b.position.length / 9; i++) {
    const p: V3[] = [];
    for (let k = 0; k < 3; k++) p.push([b.position[i * 9 + k * 3], b.position[i * 9 + k * 3 + 1], b.position[i * 9 + k * 3 + 2]]);
    out.push({ p, n: [b.normal[i * 9], b.normal[i * 9 + 1], b.normal[i * 9 + 2]] });
  }
  return out;
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const geoNormal = (t: Tri) => cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
const centroid = (t: Tri): V3 => [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3, (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3];
const isPaint = (b: ShellBatch) => b.spec.surface === 'wall' && !b.spec.seal;
const isSeal = (b: ShellBatch) => b.spec.surface === 'wall' && !!b.spec.seal;
const isWallBack = (b: ShellBatch) => b.spec.surface === 'panelBack' && b.spec.part === 'wall';
const color = (b: ShellBatch) => (b.spec.surface === 'wall' ? b.spec.color : '');
/**
 * Sheet area per plane (the plane = the normal's axis + its coordinate on it),
 * winding- and triangulation-independent: the back face of a sheet covers
 * exactly the painted face's area on the same plane.
 */
const areaByPlane = (ts: Tri[]) => {
  const m = new Map<string, number>();
  for (const t of ts) {
    const g = geoNormal(t);
    const a = Math.hypot(...g) / 2;
    const ax = [0, 1, 2].reduce((best, k) => (Math.abs(t.n[k]) > Math.abs(t.n[best]) ? k : best), 0);
    const key = `${ax}:${t.p[0][ax].toFixed(3)}`;
    m.set(key, (m.get(key) ?? 0) + a);
  }
  return [...m.entries()].map(([k, v]) => [k, Math.round(v * 1000) / 1000] as const).sort((x, y) => (x[0] < y[0] ? -1 : 1));
};

describe('panelBack helpers', () => {
  it('the back is the light unpainted Galvalume back', () => {
    expect(PANEL_BACK_HEX.toLowerCase()).toBe('#dfe3e6');
  });
  it('sheetSides: paint on the face looking paintDir, back on the other', () => {
    expect(sheetSides([0, 0, 1], [0, 0, 1])).toEqual({ paint: THREE.FrontSide, back: THREE.BackSide });
    expect(sheetSides([0, 0, 1], [0, 0, -1])).toEqual({ paint: THREE.BackSide, back: THREE.FrontSide });
    // classic eave walls: BasisPanel normal = u x v = (0,0,1) x (0,1,0) = -X on both sides
    const n = new THREE.Vector3(0, 0, 1).cross(new THREE.Vector3(0, 1, 0));
    expect(n.toArray()).toEqual([-1, 0, 0]);
    expect(sheetSides([n.x, n.y, n.z], [-1, 0, 0]).paint).toBe(THREE.FrontSide); // left wall: paint outside (-X)
    expect(sheetSides([n.x, n.y, n.z], [1, 0, 0]).paint).toBe(THREE.BackSide); // right wall: paint outside (+X)
  });
  it('enhanced material: light, one-sided, the sheet ribs; painted walls are one-sided too', () => {
    const m = getEnhancedMaterial({ surface: 'panelBack', part: 'wall', ribs: 'wall-vertical' });
    expect(m.color.getHexString()).toBe('dfe3e6');
    expect(m.side).toBe(THREE.FrontSide);
    expect(m.normalMap).toBe(normalMapTexture('wall-vertical'));
    expect(m.polygonOffset).toBe(false);
    const w = getEnhancedMaterial({ surface: 'wall', color: 'WXR0077L', orientation: 'vertical' });
    expect(w.side).toBe(THREE.FrontSide);
    expect(w.shadowSide).toBe(THREE.DoubleSide);
    expect(materialKey({ surface: 'panelBack', part: 'roof', ribs: 'roof-vertical' })).not.toBe(materialKey({ surface: 'panelBack', part: 'wall', ribs: 'roof-vertical' }));
  });
  it('oneSided keeps the DoubleSide shadow (exterior shadows unchanged)', () => {
    const m = oneSided(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), THREE.BackSide);
    expect(m.side).toBe(THREE.BackSide);
    expect(m.shadowSide).toBe(THREE.DoubleSide);
    expect(PANEL_BACK_USERDATA.captureIgnore).toBe(true);
  });
});

describe('enhanced walls: painted face outside, panel back inside', () => {
  for (const panelOrientation of ['Vertical', 'Horizontal'] as const) {
    it(`${panelOrientation}: the panel back covers exactly the painted sheet, facing the other way; the back carries no wainscot`, () => {
      const { cfg, s } = build({ panelOrientation });
      const bs = wallBatches(input(cfg, s));
      const paint = bs.filter(isPaint).flatMap(tris);
      const back = bs.filter(isWallBack).flatMap(tris);
      expect(paint.length).toBeGreaterThan(20);
      expect(back.length).toBeGreaterThan(0);
      // painted faces point outward (radially), backs inward, windings agree with the normals
      for (const t of paint) {
        const c = centroid(t);
        expect(dot(t.n, [Math.abs(t.n[0]) > 0.5 ? c[0] : 0, 0, Math.abs(t.n[2]) > 0.5 ? c[2] : 0])).toBeGreaterThan(0);
      }
      for (const t of back) {
        const c = centroid(t);
        expect(dot(t.n, [Math.abs(t.n[0]) > 0.5 ? c[0] : 0, 0, Math.abs(t.n[2]) > 0.5 ? c[2] : 0])).toBeLessThan(0);
        expect(dot(geoNormal(t), t.n)).toBeGreaterThan(0);
      }
      // same sheet, both faces: the back (on the crack-free grid) covers exactly the painted area (wall + wainscot)
      expect(areaByPlane(back)).toEqual(areaByPlane(paint));
      // wainscot paint only on the outside
      expect(bs.filter((b) => color(b) === cfg.colors.wainscot).length).toBeGreaterThan(0);
      for (const b of bs.filter(isWallBack)) {
        expect(b.castShadow).toBe(false);
        expect(b.captureIgnore).toBe(true);
        expect(b.spec.surface === 'panelBack' && b.spec.interior).toBeFalsy();
      }
      // the painted batches are untouched: no capture tags, still cast shadows
      for (const b of bs.filter(isPaint)) {
        expect(b.castShadow).toBe(true);
        expect(b.captureIgnore).toBeUndefined();
      }
      expect(shellCaptureData(bs, bs.map(() => new THREE.BufferGeometry())).every((d, i) => (isWallBack(bs[i]) || isSeal(bs[i]) ? d?.captureIgnore : d === undefined))).toBe(true);
    });
  }

  it('crack seal: the same paint, sheet for sheet, behind the painted face (no shadow, no capture)', () => {
    const { cfg, s } = build({}, { mode: 'endBack', lengthFt: 9 });
    const doors = build({ openings: [...cfg.openings] });
    for (const { cfg: c, s: st } of [{ cfg, s }, doors]) {
      const bs = wallBatches(input(c, st));
      const seal = bs.filter(isSeal);
      expect(seal.length).toBeGreaterThan(0);
      for (const col of [c.colors.walls, c.colors.wainscot]) {
        const paint = bs.filter((b) => isPaint(b) && color(b) === col).flatMap(tris);
        const sl = bs.filter((b) => isSeal(b) && b.spec.surface === 'wall' && b.spec.color === col).flatMap(tris);
        expect(areaByPlane(sl)).toEqual(areaByPlane(paint));
        for (const t of sl) expect(dot(geoNormal(t), t.n)).toBeGreaterThan(0);
      }
      for (const b of seal) {
        expect(b.castShadow).toBe(false);
        expect(b.captureIgnore).toBe(true);
        const m = getEnhancedMaterial(b.spec);
        expect(m.polygonOffset).toBe(true);
        const interior = b.spec.surface === 'wall' && !!b.spec.interior;
        expect([m.polygonOffsetFactor, m.polygonOffsetUnits]).toEqual(interior ? [2, 8] : [1, 4]);
      }
    }
  });

  it('roof underside: the LIVE soffit outside the wall lines + the panel back over the room, on the SAME polygons', () => {
    const { cfg, s } = build();
    const bs = roofBatches({ structure: s, roofOrientation: cfg.roofOrientation, colors: cfg.colors });
    const soffit = bs.filter((b) => b.spec.surface === 'roofUnder');
    const back = bs.filter((b) => b.spec.surface === 'panelBack');
    expect(soffit.length).toBe(1);
    expect(back.length).toBeGreaterThan(0);
    const room = mainRoomRect(s);
    expect(room).toEqual({ x0: -(15 + 0.18), x1: 15 + 0.18, z0: -(22.5 + 0.18), z1: 22.5 + 0.18 });
    expect(soffit[0].spec).toEqual({ surface: 'roofUnder', room });
    expect(soffit[0].captureIgnore).toBeUndefined(); // the LIVE underside batch: still drives the capture framing
    for (const b of back) {
      expect(b.spec.surface === 'panelBack' && b.spec.part).toBe('roof');
      expect(b.spec.surface === 'panelBack' && b.spec.room).toEqual(room);
      expect(b.captureIgnore).toBe(true);
    }
    // same triangles, both facing down
    const pos = (xs: ShellBatch[]) => xs.flatMap((b) => Array.from(b.position));
    expect(pos(back)).toEqual(pos(soffit));
    for (const t of soffit.flatMap(tris)) expect(t.n[1]).toBeLessThan(0);
    // the LIVE underside without the room is unchanged: same polygons as before the split
    const m = getEnhancedMaterial(soffit[0].spec);
    expect(m.clipIntersection).toBe(true);
    expect(m.clippingPlanes!.length).toBe(4);
    const mb = getEnhancedMaterial(back[0].spec);
    expect(mb.clipIntersection).toBe(false);
    expect(mb.color.getHexString()).toBe('dfe3e6');
  });

  it('roofUnderClip: the soffit keeps only the overhang strip, the panel back only the room', () => {
    const rect = { x0: -15.18, x1: 15.18, z0: -22.68, z1: 22.68 };
    const cases: [V3, boolean][] = [
      [[0, 10, 0], true], // over the room
      [[15, 10, 22], true],
      [[15.4, 10, 0], false], // under the eave overhang
      [[0, 10, -22.9], false], // under the gable overhang
      [[-15.4, 10, 23], false], // overhang corner
    ];
    for (const [p, inside] of cases) {
      expect(keptByRoofUnderClip(rect, 'inside', p)).toBe(inside);
      expect(keptByRoofUnderClip(rect, 'soffit', p)).toBe(!inside);
    }
  });
});

describe('storage partitions: painted on the main-room face, back inside the storage room', () => {
  const partitionFaces = (bs: ShellBatch[], match: (t: Tri) => boolean) => ({
    paint: bs.filter(isPaint).flatMap((b) => tris(b).filter(match).map((t) => ({ t, b }))),
    back: bs.filter(isWallBack).flatMap((b) => tris(b).filter(match).map((t) => ({ t, b }))),
  });

  it('End Storage (back 9): wall colour + wainscot face the main room (-Z), the storage room sees the back', () => {
    const { cfg, s } = build({}, { mode: 'endBack', lengthFt: 9 });
    const zp = s.enclosure.partitionZ!;
    const f = s.enclosure.partitionFaces!;
    expect(f).toBe(-1); // main room is toward the front
    const bs = wallBatches(input(cfg, s));
    const onPart = (t: Tri) => t.p.every((p) => Math.abs(p[2] - (zp + f * 0.18)) < 1e-4);
    const { paint, back } = partitionFaces(bs, onPart);
    expect(paint.length).toBeGreaterThan(0);
    expect(back.length).toBe(paint.length);
    for (const { t } of paint) expect(t.n[2]).toBeCloseTo(f, 9);
    for (const { t } of back) expect(t.n[2]).toBeCloseTo(-f, 9);
    expect(new Set(paint.map(({ b }) => color(b)))).toEqual(new Set([cfg.colors.walls, cfg.colors.wainscot]));
    // the partition's back is depth-offset like its painted face (interior)
    for (const { b } of back) expect(b.spec.surface === 'panelBack' && b.spec.interior).toBe(true);
    expect(materialKey(back[0].b.spec)).toContain('|interior');
    expect(getEnhancedMaterial(back[0].b.spec).polygonOffset).toBe(true);
  });

  it('Left / Right lengthwise: painted toward the main room, back toward the storage room', () => {
    for (const mode of ['left', 'right'] as const) {
      const { cfg, s } = build({}, { mode, lengthFt: 10 });
      const sp = s.enclosure.sidePartition!;
      const X0 = sp.x + sp.faces * 0.18;
      const bs = wallBatches(input(cfg, s));
      const { paint, back } = partitionFaces(bs, (t) => t.p.every((p) => Math.abs(p[0] - X0) < 1e-4));
      expect(paint.length).toBeGreaterThan(0);
      for (const { t } of paint) expect(t.n[0]).toBeCloseTo(sp.faces, 9);
      for (const { t } of back) expect(t.n[0]).toBeCloseTo(-sp.faces, 9);
      expect(back.length).toBe(paint.length);
    }
  });

  it('GCH divider: painted toward the open carport bay (its wainscot side), back inside the enclosed garage', () => {
    const { cfg, s } = build({ buildingType: 'utility', enclosedLengthFt: 25, openEnd: 'front' });
    const zp = s.enclosure.partitionZ!;
    const ob = s.openBayZ!;
    const toBay = Math.sign((ob.start + ob.end) / 2 - zp);
    const bs = wallBatches(input(cfg, s));
    const { paint, back } = partitionFaces(bs, (t) => t.p.every((p) => Math.abs(p[2] - zp) < 1e-4));
    expect(paint.length).toBeGreaterThan(0);
    for (const { t } of paint) expect(Math.sign(t.n[2])).toBe(toBay);
    for (const { t } of back) expect(Math.sign(t.n[2])).toBe(-toBay);
  });

  it('classic + ghost: the storage ghost paints its main-room face, the storage-room face is the back', () => {
    const end = build({}, { mode: 'endBack', lengthFt: 9 });
    const ge = storageGhostShape(end.s, [])!;
    // cross wall: geometry +Z, main room toward -Z (faces -1) -> paint on the BackSide
    expect(storageGhostSides(ge)).toEqual({ paint: THREE.BackSide, back: THREE.FrontSide });
    const right = build({}, { mode: 'right', lengthFt: 10 });
    const gr = storageGhostShape(right.s, [])!;
    // lengthwise: geometry +Z turned to world -X; a right storage room faces the main room at -X
    expect(gr.faces).toBe(-1);
    expect(storageGhostSides(gr)).toEqual({ paint: THREE.FrontSide, back: THREE.BackSide });
  });
});

describe('lean-tos', () => {
  const leanTo = (over: Partial<LeanTo> = {}): LeanTo => ({
    id: 'lt-a',
    type: 'attached',
    attachedSide: 'Left Eave',
    widthFt: 10,
    lengthFt: 30,
    lowLegHeightFt: 7,
    roofPitch: '2:12',
    enclosure: 'enclosed',
    openings: [],
    ...over,
  });
  const ltBuild = (lts: LeanTo[]) => {
    const cfg: BuildingConfig = { ...DEFAULT_CONFIG, width: 24, length: 30, legHeight: 10, openings: [], leanTos: lts, wainscot: { enabled: true, heightFt: 3 } };
    return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
  };
  const batchesOf = (cfg: BuildingConfig, s: StructureModel) =>
    leanToBatches({ structure: s, mainOpenings: cfg.openings, wallOrientation: cfg.panelOrientation, roofOrientation: cfg.roofOrientation, colors: cfg.colors, wainscot: cfg.wainscot });

  it('enhanced: each lean-to wall sheet has its back twin; the storage partition paints toward the open part', () => {
    const { cfg, s } = ltBuild([leanTo({ storage: { end: 'back', lengthFt: 10 } })]);
    const bs = batchesOf(cfg, s);
    const paint = bs.filter(isPaint).flatMap(tris);
    const back = bs.filter(isWallBack).flatMap(tris);
    expect(paint.length).toBeGreaterThan(0);
    expect(areaByPlane(back)).toEqual(areaByPlane(paint));
    for (const b of bs.filter(isWallBack)) expect(b.captureIgnore).toBe(true);
    // the partition (across the run, z = storage line): painted face looks toward the open part (-Z here)
    const lt = s.leanTos[0];
    const st = lt.storage!;
    const zPart = st.runAt + st.faces * 0.18;
    const onPart = (t: Tri) => t.p.every((p) => Math.abs(p[2] - zPart) < 1e-4);
    const pp = bs.filter(isPaint).flatMap(tris).filter(onPart);
    expect(pp.length).toBeGreaterThan(0);
    for (const t of pp) expect(Math.sign(t.n[2])).toBe(st.faces);
    for (const t of bs.filter(isWallBack).flatMap(tris).filter(onPart)) expect(Math.sign(t.n[2])).toBe(-st.faces);
    // roof underside: the LIVE soffit outside the lean-to's room + the panel back inside it
    expect(bs.some((b) => b.spec.surface === 'panelBack' && b.spec.part === 'roof' && b.captureIgnore)).toBe(true);
    const soffit = bs.filter((b) => b.spec.surface === 'roofUnder');
    expect(soffit.length).toBe(1);
    const r = soffit[0].spec.surface === 'roofUnder' ? soffit[0].spec.room! : null;
    // eave lean-to: from its outer wall sheet in to the main frame line, between its end sheets
    const wallX = lt.outer.x + Math.sign(lt.outer.x - lt.inner.x) * 0.18;
    expect(r!.x0).toBeCloseTo(Math.min(lt.inner.x, wallX), 9);
    expect(r!.x1).toBeCloseTo(Math.max(lt.inner.x, wallX), 9);
    expect(r!.z0).toBeCloseTo(lt.spanStart - 0.18, 9);
    expect(r!.z1).toBeCloseTo(lt.spanEnd + 0.18, 9);
  });

  it('classic: paint directions — outer wall away from the building, ends along the run, partition toward the open part', () => {
    const { s } = ltBuild([leanTo({ storage: { end: 'back', lengthFt: 10 } }), leanTo({ id: 'lt-f', attachedSide: 'Front Gable', lengthFt: 24 })]);
    const [eave, gable] = s.leanTos;
    const ge = eaveSurfaces(eave, 0.5, resolveWalls(eave));
    expect(outerWallPaint(ge)).toEqual([Math.sign(eave.outer.x - eave.inner.x), 0, 0]);
    expect(endWallPaint(ge.gable, 'front')).toEqual([0, 0, -1]);
    expect(endWallPaint(ge.gable, 'back')).toEqual([0, 0, 1]);
    expect(endWallPaint(ge.gable, 'partition')).toEqual([0, 0, eave.storage!.faces]);
    const gg = gableSurfaces(gable, 0.5, resolveWalls(gable));
    expect(outerWallPaint(gg)).toEqual([0, 0, Math.sign(gable.outer.z - gable.inner.z)]);
    expect(endWallPaint(gg.gable, 'front')).toEqual([-1, 0, 0]);
    // classic lean-to roof underside split: the room = connection line out to the outer wall sheet, end sheet to end sheet
    expect(leanToRoomRect(ge)).toEqual({ x0: Math.min(eave.inner.x, ge.wall.plane), x1: Math.max(eave.inner.x, ge.wall.plane), z0: ge.gable.frontPlane, z1: ge.gable.backPlane });
    expect(leanToRoomRect(gg)).toEqual({ x0: gg.gable.frontPlane, x1: gg.gable.backPlane, z0: Math.min(gable.inner.z, gg.wall.plane), z1: Math.max(gable.inner.z, gg.wall.plane) });
    // the outer-wall strips' paint lands on their outward face
    for (const p of sideWallPolys(ge, 'closed', eave.lowLegHeightFt)) {
      const sides = sheetSides(polyNormal(p.corners), outerWallPaint(ge));
      const n = polyNormal(p.corners);
      const outwardFacingFront = dot(n, outerWallPaint(ge)) > 0;
      expect(sides.paint).toBe(outwardFacingFront ? THREE.FrontSide : THREE.BackSide);
    }
  });
});

describe('classic wainscot cap: nothing on the inside of the wall', () => {
  it('the inside variant is the LIVE bar cut CAP_SHEET_GAP outside its sheet', () => {
    // right eave wall: sheet at x = 15.18, paint +X, bar centred at x = 15.2 (0.16 square)
    const r = capBarBox([15.2, 3, -10], [15.2, 3, 10], { axis: 0, sign: 1, at: 15.18 });
    const lo = r.center.map((c, i) => c - r.size[i] / 2);
    const hi = r.center.map((c, i) => c + r.size[i] / 2);
    expect(lo[0]).toBeCloseTo(15.18 + CAP_SHEET_GAP, 9);
    expect(hi[0]).toBeCloseTo(15.28, 9); // the outer face stays where it was
    expect([lo[1], hi[1]]).toEqual([2.92, 3.08].map((v) => expect.closeTo(v, 9)));
    expect([lo[2], hi[2]]).toEqual([-10, 10]);
    // front end wall: sheet at z = -20.68, paint -Z
    const f = capBarBox([-5, 3, -20.7], [5, 3, -20.7], { axis: 2, sign: -1, at: -20.68 });
    expect(f.center[2] + f.size[2] / 2).toBeCloseTo(-20.68 - CAP_SHEET_GAP, 9);
    expect(f.center[2] - f.size[2] / 2).toBeCloseTo(-20.78, 9);
    expect(f.size[0]).toBeCloseTo(10, 9);
  });
  it('the LIVE bar draws only for a camera on the painted side', () => {
    const cut = { axis: 0 as const, sign: 1 as const, at: 15.18 };
    expect(capSeenFromPaintedSide(cut, { x: 40, z: 0 })).toBe(true); // outside the right wall
    expect(capSeenFromPaintedSide(cut, { x: 0, z: 0 })).toBe(false); // inside the building
    const part = { axis: 2 as const, sign: -1 as const, at: 13.32 }; // End Storage partition, main room toward -Z
    expect(capSeenFromPaintedSide(part, { x: 0, z: 0 })).toBe(true); // main room
    expect(capSeenFromPaintedSide(part, { x: 0, z: 18 })).toBe(false); // storage room
  });
});
