import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, LeanTo, LeanToOpening } from '@/types/building';
import { litFromRight, type V3 } from '../enhanced/materials';
import { Emitter, SHELL, box, cutPlate, plumbAt, rakeTrim, roofBatches, roofSurface, shellLayout, trimBatches, type ShellBatch } from '../enhanced/shellGeometry';
import { LEAN_TO, leanToBatches, leanToRoofCuts, mergeSpans } from '../enhanced/leanToShell';
import { cutHoles, polyArea, type P2 } from '../polyCut';

// Render-upgrade Phase 6: the enhanced lean-to shell (pure geometry) and the
// main-shell interplay (roof cut-backs, corner-trim cuts).

const SO = SHEET_OUTSET;
const T = SHELL.trimT;

const leanTo = (over: Partial<LeanTo> = {}): LeanTo => ({
  id: 'lt-' + (over.attachedSide ?? 'Left Eave'),
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

/** 24 x 30 x 10 garage, 3:12, no main openings. */
const build = (leanTos: LeanTo[], over: Partial<BuildingConfig> = {}): { cfg: BuildingConfig; s: StructureModel } => {
  const cfg: BuildingConfig = { ...DEFAULT_CONFIG, width: 24, length: 30, legHeight: 10, openings: [], leanTos, ...over };
  return { cfg, s: deriveStructure(resolveBuilding(cfg)) };
};

const batchesOf = (cfg: BuildingConfig, s: StructureModel) =>
  leanToBatches({
    structure: s,
    mainOpenings: cfg.openings,
    wallOrientation: cfg.panelOrientation,
    roofOrientation: cfg.roofOrientation,
    colors: cfg.colors,
    wainscot: cfg.wainscot,
  });

interface Tri {
  p: V3[];
  n: V3;
  uv: [number, number][];
}
const tris = (b: ShellBatch): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < b.position.length / 9; i++) {
    const p: V3[] = [];
    const uv: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3;
      p.push([b.position[o], b.position[o + 1], b.position[o + 2]]);
      uv.push([b.uv[i * 6 + k * 2], b.uv[i * 6 + k * 2 + 1]]);
    }
    out.push({ p, n: [b.normal[i * 9], b.normal[i * 9 + 1], b.normal[i * 9 + 2]], uv });
  }
  return out;
};
const allTris = (bs: ShellBatch[], pred: (b: ShellBatch) => boolean = () => true) => bs.filter(pred).flatMap(tris);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const geoNormal = (t: Tri) => cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
const centroid = (t: Tri): V3 => [0, 1, 2].map((k) => (t.p[0][k] + t.p[1][k] + t.p[2][k]) / 3) as unknown as V3;
const surface = (name: string) => (b: ShellBatch) => b.spec.surface === name;

function uGradient(t: Tri): V3 {
  const e1 = sub(t.p[1], t.p[0]);
  const e2 = sub(t.p[2], t.p[0]);
  const du1 = t.uv[1][0] - t.uv[0][0];
  const du2 = t.uv[2][0] - t.uv[0][0];
  const dv1 = t.uv[1][1] - t.uv[0][1];
  const dv2 = t.uv[2][1] - t.uv[0][1];
  const r = 1 / (du1 * dv2 - du2 * dv1);
  return [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
}

/** Does any triangle of `ts` contain point q (in its plane)? */
function covers(ts: Tri[], q: V3): boolean {
  return ts.some((t) => {
    const n = geoNormal(t);
    if (Math.abs(dot(sub(q, t.p[0]), n)) / Math.hypot(...n) > 1e-4) return false;
    const s0 = dot(cross(sub(t.p[1], t.p[0]), sub(q, t.p[0])), n);
    const s1 = dot(cross(sub(t.p[2], t.p[1]), sub(q, t.p[1])), n);
    const s2 = dot(cross(sub(t.p[0], t.p[2]), sub(q, t.p[2])), n);
    return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
  });
}

/** Plan-projected: does any triangle of `ts` cover (x, z) seen from above? */
function coversPlan(ts: Tri[], x: number, z: number): boolean {
  return ts.some((t) => {
    const P = t.p.map((p) => [p[0], p[2]] as [number, number]);
    const s = (a: number[], b: number[]) => (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const s0 = s(P[0], P[1]);
    const s1 = s(P[1], P[2]);
    const s2 = s(P[2], P[0]);
    return (s0 > 1e-9 && s1 > 1e-9 && s2 > 1e-9) || (s0 < -1e-9 && s1 < -1e-9 && s2 < -1e-9);
  });
}

/** Any box face of a trim batch lying in the plane `axis = value` whose centroid satisfies pred. */
const trimFaceAt = (bs: ShellBatch[], axis: 0 | 1 | 2, value: number, pred: (c: V3) => boolean) =>
  allTris(bs, surface('trim')).some((t) => t.p.every((p) => Math.abs(p[axis] - value) < 1e-4) && pred(centroid(t)));

describe('polyCut', () => {
  it('cuts a sloped-top outline around a hole into convex pieces with the exact area left', () => {
    const trap: P2[] = [[0, 0], [10, 0], [10, 7], [0, 9]];
    const pieces = cutHoles(trap, [{ c: 4, w: 2, y0: 0, y1: 5 }]);
    const area = pieces.reduce((a, p) => a + Math.abs(polyArea(p)), 0);
    expect(area).toBeCloseTo(Math.abs(polyArea(trap)) - 10, 6);
    for (const p of pieces) {
      // convex: every turn has the same sign
      const s = Math.sign(polyArea(p));
      for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        const c = p[(i + 2) % p.length];
        expect(s * ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('splits the concave half-end outline into convex columns (no holes)', () => {
    const half: P2[] = [[5, 7], [5, 0], [10, 0], [10, 7], [0, 9], [0, 7]];
    const pieces = cutHoles(half, []);
    expect(pieces.length).toBe(2);
    expect(pieces.reduce((a, p) => a + Math.abs(polyArea(p)), 0)).toBeCloseTo(Math.abs(polyArea(half)), 6);
  });
});

describe('enhanced lean-to — walls', () => {
  const variants = ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable'] as const;

  it('every wall face points OUTWARD from its lean-to, +u runs left -> right from outside, UVs are world feet', () => {
    for (const attachedSide of variants) {
      for (const panelOrientation of ['Vertical', 'Horizontal'] as const) {
        const { cfg, s } = build([leanTo({ attachedSide, lengthFt: 20, offsetFt: 2 })], { panelOrientation, wainscot: { enabled: true, heightFt: 3 } });
        const lt = s.leanTos[0];
        const cx = (lt.inner.x + lt.outer.x) / 2;
        const cz = (lt.inner.z + lt.outer.z) / 2;
        const eave = attachedSide.includes('Eave');
        const ctr: V3 = eave ? [cx, 0, (lt.spanStart + lt.spanEnd) / 2] : [(lt.spanStart + lt.spanEnd) / 2, 0, cz];
        const ts = allTris(batchesOf(cfg, s), surface('wall'));
        expect(ts.length).toBeGreaterThan(6);
        for (const t of ts) {
          const c = centroid(t);
          const radial: V3 = [Math.abs(t.n[0]) > 0.5 ? c[0] - ctr[0] : 0, 0, Math.abs(t.n[2]) > 0.5 ? c[2] - ctr[2] : 0];
          expect(dot(t.n, radial)).toBeGreaterThan(0);
          expect(dot(geoNormal(t), t.n)).toBeGreaterThan(0);
          const g = uGradient(t);
          expect(dot(cross(g, [0, 1, 0]), t.n)).toBeGreaterThan(0.99);
          expect(Math.hypot(...g)).toBeCloseTo(1, 6);
          for (let k = 0; k < 3; k++) expect(t.uv[k][1]).toBeCloseTo(t.p[k][1], 6);
        }
      }
    }
  });

  it('rib flip follows each lean-to wall\'s real +u (vertical only)', () => {
    const { cfg, s } = build([leanTo({ attachedSide: 'Right Eave' })], { panelOrientation: 'Vertical' });
    for (const b of batchesOf(cfg, s).filter(surface('wall'))) {
      const flip = !!(b.spec as { flipX?: boolean }).flipX;
      for (const t of tris(b)) expect(flip).toBe(litFromRight(t.n, uGradient(t)));
    }
  });

  it('walls stop SHELL.wallTopGap under the lean-to roof underside (sloped on the ends)', () => {
    for (const attachedSide of variants) {
      const { cfg, s } = build([leanTo({ attachedSide })]);
      const lt = s.leanTos[0];
      const eave = attachedSide.includes('Eave');
      const inner = eave ? lt.inner.x : lt.inner.z;
      const outer = eave ? lt.outer.x : lt.outer.z;
      const out = Math.sign(outer - inner);
      const slope = (lt.peakHeightFt - lt.lowLegHeightFt) / Math.abs(outer - inner);
      const top = (a: number) => lt.peakHeightFt - (a - inner) * out * slope + SHELL.roofLift * Math.hypot(1, slope);
      for (const t of allTris(batchesOf(cfg, s), surface('wall')))
        for (const p of t.p) expect(p[1]).toBeLessThanOrEqual(top(eave ? p[0] : p[2]) - SHELL.roofUnderGap - SHELL.wallTopGap + 1e-6);
    }
  });

  it('partial ends (half end, gable only, q1-q3) are CUT around their frame-outs; the outer band too', () => {
    const fo = (wall: LeanToOpening['wall'], offsetFt: number, sillFt = 0, heightFt = 8): LeanToOpening => ({
      id: 'fo-' + wall + offsetFt,
      type: 'frameOut',
      wall,
      widthFt: 4,
      heightFt,
      sillFt,
      offsetFt,
    });
    for (const front of ['q1', 'q2', 'q3', 'halfEnd', 'closed'] as const) {
      const { cfg, s } = build([
        leanTo({ enclosure: 'custom', customWalls: { front, back: 'gable', side: '2panel' }, openings: [fo('front', 3), fo('back', 3, 7.2, 1.2), fo('outer', 10)] }),
      ]);
      const lt = s.leanTos[0];
      const ts = allTris(batchesOf(cfg, s), surface('wall'));
      const zF = lt.spanStart - SO; // front end plane
      const minA = Math.min(lt.inner.x, lt.outer.x);
      // Left Eave: minA = inner. The frame-out (a = minA + 1..5, 0..8 ft) sits under the half end's header
      // and inside every roof-down band: 7.8 ft up inside it is open, beside it (a = minA + 6, 7.2 ft) is sheeted.
      expect(covers(ts, [minA + 3, 7.8, zF])).toBe(false);
      expect(covers(ts, [minA + 6, 7.2, zF])).toBe(true);
      // gable-only back end: the frame-out reaching above the low eave cuts the triangle
      expect(covers(ts, [minA + 3, 7.9, lt.spanEnd + SO])).toBe(false);
      // 2-panel outer band: [lh - 6, top], cut at the frame-out
      const xw = lt.outer.x + SO;
      expect(covers(ts, [xw, 6, lt.spanStart + 10])).toBe(false);
      expect(covers(ts, [xw, 6, lt.spanStart + 20])).toBe(true);
      expect(covers(ts, [xw, 0.5, lt.spanStart + 20])).toBe(false);
    }
  });

  it('the CLASSIC lean-to is not cut by this phase: classic partial ends stay the single classic panel', () => {
    // Scope guard (owner-rule list): the partial-end cutting is enhanced-only.
    const classic = readFileSync(fileURLToPath(new URL('../LeanToSiding.tsx', import.meta.url)), 'utf8');
    expect(classic).not.toMatch(/polyCut|partialEndPieces|cutHoles/);
  });
});

describe('enhanced lean-to — roof + trim', () => {
  it('overhang = structure.roofOverhangFt at the outer eave and both ends (never at the building)', () => {
    for (const roofOverhangFt of [0.5, 1.0]) {
      for (const attachedSide of ['Left Eave', 'Front Gable'] as const) {
        const { cfg, s } = build([leanTo({ attachedSide, lengthFt: 20, offsetFt: 2 })], { roofOverhangFt });
        const lt = s.leanTos[0];
        const ts = allTris(batchesOf(cfg, s), surface('roof'));
        const pts = ts.flatMap((t) => t.p);
        const eave = attachedSide.includes('Eave');
        const run = pts.map((p) => (eave ? p[2] : p[0]));
        const across = pts.map((p) => (eave ? p[0] : p[2]));
        expect(Math.min(...run)).toBeCloseTo(lt.spanStart - roofOverhangFt, 5);
        expect(Math.max(...run)).toBeCloseTo(lt.spanEnd + roofOverhangFt, 5);
        const outer = eave ? lt.outer.x : lt.outer.z;
        const inner = eave ? lt.inner.x : lt.inner.z;
        const out = Math.sign(outer - inner);
        const far = out > 0 ? Math.max(...across) : Math.min(...across);
        const near = out > 0 ? Math.min(...across) : Math.max(...across);
        expect(far).toBeCloseTo(outer + out * roofOverhangFt, 5);
        expect(near).toBeCloseTo(inner, 5);
        for (const t of ts) expect(t.n[1]).toBeGreaterThan(0);
        const under = allTris(batchesOf(cfg, s), surface('roofUnder'));
        expect(under.length).toBe(ts.length);
        for (const t of under) expect(t.n[1]).toBeLessThan(0);
      }
    }
  });

  it('flashing sits ON the main wall sheeting face (visible), none against an open main side', () => {
    const { cfg, s } = build([leanTo({ attachedSide: 'Left Eave' })]);
    const xFace = s.width / 2 + SO + T; // outer face of the flashing plate on the +X wall
    const lt = s.leanTos[0];
    expect(trimFaceAt(batchesOf(cfg, s), 0, xFace, (c) => c[1] > lt.peakHeightFt && c[1] < lt.peakHeightFt + 0.4)).toBe(true);
    // Carport (open sides): no flashing on the main wall line.
    const cp = build([leanTo({ attachedSide: 'Left Eave' })], { buildingType: 'carport' });
    expect(trimFaceAt(batchesOf(cp.cfg, cp.s), 0, xFace, () => true)).toBe(false);
  });

  it('the wall flashing\'s back face is lapped SHELL.trimLift off the main sheet (no z-fight seen from inside the main building)', () => {
    for (const attachedSide of ['Left Eave', 'Front Gable'] as const) {
      const { cfg, s } = build([leanTo({ attachedSide, lengthFt: attachedSide === 'Left Eave' ? 30 : 24 })]);
      const lt = s.leanTos[0];
      const [axis, face, along, half] =
        attachedSide === 'Left Eave' ? ([0, s.width / 2 + SO, 2, s.length / 2] as const) : ([2, -(s.length / 2 + SO), 0, s.width / 2] as const);
      const out = attachedSide === 'Left Eave' ? 1 : -1;
      const band = (t: Tri) => centroid(t)[1] > lt.peakHeightFt - 0.1 && centroid(t)[1] < lt.peakHeightFt + 0.4;
      const ts = allTris(batchesOf(cfg, s), surface('trim')).filter(band);
      // nothing lies in the main sheet's plane over the sheet (past the main corner, e.g. a rake end, is not over it);
      // the flashing's back face (facing into the building) sits trimLift out
      const onSheet = (t: Tri) => t.p.every((p) => Math.abs(p[axis] - face) < 1e-6) && Math.abs(centroid(t)[along]) < half;
      expect(ts.some(onSheet)).toBe(false);
      expect(ts.some((t) => t.n[axis] === -out && t.p.every((p) => Math.abs(p[axis] - (face + out * SHELL.trimLift)) < 1e-6))).toBe(true);
      // ... and its outer face is still T proud of the sheet
      expect(ts.some((t) => t.n[axis] === out && t.p.every((p) => Math.abs(p[axis] - (face + out * T)) < 1e-6))).toBe(true);
    }
  });

  it('corner L trims only where two sheeted edges meet; base trim only where a sheet meets the slab', () => {
    const open = build([leanTo({ enclosure: 'open' })]);
    const ob = batchesOf(open.cfg, open.s);
    expect(allTris(ob, surface('wall')).length).toBe(0);
    expect(allTris(ob, (b) => b.spec.surface === 'trim' && b.castShadow).length).toBe(0); // no wall trims at all
    const enc = build([leanTo()]);
    const lt = enc.s.leanTos[0];
    const eb = batchesOf(enc.cfg, enc.s);
    const xw = lt.outer.x + SO;
    // outer corner plate on the outer wall face at the front end, full height from the slab
    expect(trimFaceAt(eb, 0, xw + T, (c) => c[2] < lt.spanStart && c[2] > lt.spanStart - SO - 0.01)).toBe(true);
    // base trim along the outer wall
    expect(trimFaceAt(eb, 1, SHELL.baseHeight, (c) => Math.abs(c[0] - (xw + T / 2)) < 0.02 && c[2] > 0)).toBe(true);
  });

  it('two lean-tos wrapping a corner: roofs mitered on the hip (no overlap), rakes stop at the hip', () => {
    const { cfg, s } = build([leanTo({ attachedSide: 'Left Eave' }), leanTo({ attachedSide: 'Front Gable', lengthFt: 24 })]);
    const bs = batchesOf(cfg, s);
    const roofs = bs.filter(surface('roof'));
    const halfW = s.width / 2;
    const halfL = s.length / 2;
    const oh = s.roofOverhangFt;
    // In the overlap square each plan point is covered by exactly one lean-to roof.
    for (const [dx, dz] of [[0.1, 0.3], [0.3, 0.1], [0.4, 0.45], [0.25, 0.05]]) {
      const x = halfW + dx;
      const z = -halfL - dz;
      expect(roofs.flatMap(tris).filter((t) => coversPlan([t], x, z)).length).toBe(1);
    }
    // Rakes stop at the hip corner Q = (halfW + oh, -(halfL + oh)): the eave lean-to's front rake face
    // (plane z = -(halfL + oh + T)) never runs inboard of Q, the gable lean-to's back rake face
    // (plane x = halfW + oh + T) never runs past Q toward the building.
    expect(trimFaceAt(bs, 2, -(halfL + oh + T), (c) => c[0] < halfW + oh - 0.02)).toBe(false);
    expect(trimFaceAt(bs, 0, halfW + oh + T, (c) => c[2] > -(halfL + oh) + 0.02)).toBe(false);
    expect(trimFaceAt(bs, 2, -(halfL + oh + T), (c) => c[0] > halfW + oh + 1)).toBe(true);
    expect(trimFaceAt(bs, 0, halfW + oh + T, (c) => c[2] < -(halfL + oh) - 1)).toBe(true);
  });
});

describe('enhanced lean-to — main-shell interplay', () => {
  it('step-down lean-tos cut nothing on the main roof; the plain roof is byte-identical', () => {
    const { cfg, s } = build([leanTo()]);
    expect(leanToRoofCuts(s)).toEqual({ eave: [], gable: [] });
    const plain = roofBatches({ structure: s, roofOrientation: cfg.roofOrientation, colors: cfg.colors });
    const withCuts = roofBatches({ structure: s, roofOrientation: cfg.roofOrientation, colors: cfg.colors, cuts: leanToRoofCuts(s) });
    expect(withCuts.map((b) => [b.id, Array.from(b.position)])).toEqual(plain.map((b) => [b.id, Array.from(b.position)]));
  });

  it('FLUSH eave lean-to: the main eave overhang + eave trim are skipped along it (render only)', () => {
    // 24 x 30 x 10 at 3:12 + Left Eave 12 ft at 3:12, low leg 7 -> connection 10 = the main eave.
    const { cfg, s } = build([leanTo({ widthFt: 12, lowLegHeightFt: 7, roofPitch: '3:12', lengthFt: 16, offsetFt: 7 })]);
    expect(s.leanTos[0].peakHeightFt).toBeCloseTo(10, 6);
    const cuts = leanToRoofCuts(s);
    expect(cuts.eave.length).toBe(1);
    const { sx, z0, z1 } = cuts.eave[0];
    expect(sx).toBe(1);
    const lt = s.leanTos[0];
    expect(z0).toBeCloseTo(lt.spanStart - s.roofOverhangFt - LEAN_TO.cutGap, 6);
    expect(z1).toBeCloseTo(lt.spanEnd + s.roofOverhangFt + LEAN_TO.cutGap, 6);
    const bs = roofBatches({ structure: s, roofOrientation: cfg.roofOrientation, colors: cfg.colors, cuts });
    const top = allTris(bs, surface('roof'));
    const r = roofSurface(s);
    const xw = s.width / 2 + SO;
    const zm = (lt.spanStart + lt.spanEnd) / 2;
    expect(coversPlan(top, xw + 0.2, zm)).toBe(false); // no overhang along the lean-to
    expect(coversPlan(top, xw - 0.2, zm)).toBe(true);
    expect(coversPlan(top, xw + 0.2, -s.length / 2 + 0.5)).toBe(true); // overhang resumes past it
    expect(coversPlan(top, -(xw + 0.2), zm)).toBe(true); // other eave untouched
    // no eave trim along the cut
    const trims = allTris(bs, surface('trim'));
    expect(trims.some((t) => Math.abs(centroid(t)[0] - r.dripX) < 0.1 && Math.abs(centroid(t)[2] - zm) < 2)).toBe(false);
    // a step-down lean-to (connection 0.5 ft+ lower) is not flush
    const low = build([leanTo({ widthFt: 12, lowLegHeightFt: 6, roofPitch: '3:12' })]);
    expect(leanToRoofCuts(low.s).eave).toEqual([]);
  });

  it('gable lean-to connecting near the eave trims the main gable overhang only near the eave corners', () => {
    const { s } = build([leanTo({ attachedSide: 'Front Gable', widthFt: 12, lowLegHeightFt: 8, roofPitch: '2:12', lengthFt: 24 })]);
    const cuts = leanToRoofCuts(s);
    expect(cuts.eave).toEqual([]);
    expect(cuts.gable.length).toBe(2);
    for (const c of cuts.gable) {
      expect(c.sz).toBe(-1);
      expect(Math.min(Math.abs(c.x0), Math.abs(c.x1))).toBeGreaterThan(s.width / 4); // never near the ridge
    }
  });

  it('main corner trim is NEVER cut by a lean-to: full height where an end wall continues it; the lean-to end-wall trims break around it', () => {
    // Golden classic / lab: a full-height main corner trim at the junction (Phase 6 review: B, D, K, L).
    for (const enclosure of ['enclosed', 'open'] as const) {
      const { cfg, s } = build([leanTo({ enclosure })], { wainscot: { enabled: true, heightFt: 3 } });
      const lt = s.leanTos[0];
      const inp = { structure: s, openings: [], wallOrientation: cfg.panelOrientation, colors: cfg.colors, wainscot: cfg.wainscot };
      const lay = shellLayout(inp);
      const xw = s.width / 2 + SO;
      const zw = s.length / 2 + SO;
      for (const zs of [-1, 1]) {
        const k = lay.corners.find((c) => c.sx === 1 && c.zs === zs && c.end !== 'partition');
        expect(k).toBeDefined();
        expect(k!.y0).toBeCloseTo(0, 6);
        expect(k!.y1).toBeGreaterThan(s.legHeight - 0.5);
      }
      // the main corner trim stands below the lean-to roof at the +X front corner
      const tb = allTris(trimBatches({ ...inp, trimColor: cfg.colors.trim }, lay));
      expect(tb.some((t) => {
        const c = centroid(t);
        return Math.abs(c[0] - xw) < 0.3 && Math.abs(c[2] + zw) < 0.3 && c[1] > 1 && c[1] < lt.lowLegHeightFt;
      })).toBe(true);
      // the lean-to's own wall trims (base, Z) on the end planes stop at the main corner plate's footprint
      const cw = SHELL.cornerWidth;
      const wallTrims = allTris(batchesOf(cfg, s), (b) => b.spec.surface === 'trim' && b.castShadow);
      if (enclosure === 'enclosed') expect(wallTrims.length).toBeGreaterThan(0);
      for (const t of wallTrims) {
        if (!t.p.every((p) => Math.abs(Math.abs(p[2]) - zw) < 0.05)) continue;
        const c = centroid(t);
        expect(c[0] > xw - cw + 1e-6 && c[0] < xw + T - 1e-6).toBe(false);
      }
    }
  });

  it('an outer corner L runs the full height of both sheeted edges (3/4 outer wall over a closed end; closed outer wall beside an end band)', () => {
    const cw = SHELL.cornerWidth;
    for (const [customWalls, expectBottom] of [
      [{ front: 'closed', back: 'open', side: 'q3' }, 0], // K_CCI: the end wall is sheeted to the slab under the 3/4 outer wall
      [{ front: 'q2', back: 'halfEnd', side: 'closed' }, 0], // Q_CCI: the outer wall is sheeted to the slab under the end band
    ] as const) {
      const { cfg, s } = build([leanTo({ enclosure: 'custom', customWalls: { ...customWalls } })]);
      const lt = s.leanTos[0];
      const xwL = lt.outer.x + SO; // outer wall sheet plane (Left Eave -> +X)
      const zF = lt.spanStart - SO; // front end plane
      const ts = allTris(batchesOf(cfg, s), surface('trim')).filter(
        (t) => t.p.every((p) => Math.abs(p[0] - (xwL + T)) < 1e-4) && t.p.every((p) => p[2] > zF - 0.03 && p[2] < zF + cw + 1e-4),
      );
      expect(ts.length).toBeGreaterThan(0);
      expect(Math.min(...ts.flatMap((t) => t.p.map((p) => p[1])))).toBeCloseTo(expectBottom, 6);
      // and up to under the roof
      expect(Math.max(...ts.flatMap((t) => t.p.map((p) => p[1])))).toBeGreaterThan(lt.lowLegHeightFt - 0.5);
    }
    expect(mergeSpans([0, 5], [3, 8])).toEqual([[0, 8]]);
    expect(mergeSpans([5, 8], [0, 2])).toEqual([[0, 2], [5, 8]]);
    expect(mergeSpans([0, 2], [2, 8])).toEqual([[0, 8]]);
  });

  it('wall trims stand LEAN_TO.trimLift off the sheet: no trim face lies in a sheet plane (no z-fight seen from inside)', () => {
    for (const enclosure of ['enclosed', 'custom'] as const) {
      const { cfg, s } = build(
        [leanTo({ enclosure, customWalls: enclosure === 'custom' ? { front: 'closed', back: 'open', side: 'q3' } : undefined })],
        { wainscot: { enabled: true, heightFt: 3 } },
      );
      const lt = s.leanTos[0];
      const planes: [0 | 2, number][] = [[0, lt.outer.x + SO], [2, lt.spanStart - SO], [2, lt.spanEnd + SO]];
      const bs = batchesOf(cfg, s);
      const wallTrims = allTris(bs, (b) => b.spec.surface === 'trim' && b.castShadow);
      expect(wallTrims.length).toBeGreaterThan(0);
      for (const t of wallTrims)
        for (const [axis, v] of planes) expect(t.p.every((p) => Math.abs(p[axis] - v) < 1e-6)).toBe(false);
      // the outer faces stay T proud of the sheet (base trim along a closed outer wall; bottom trim of the 3/4 wall)
      const yEdge = enclosure === 'enclosed' ? 0 : 0.25 * lt.lowLegHeightFt;
      expect(trimFaceAt(bs, 0, lt.outer.x + SO + T, (c) => Math.abs(c[1] - yEdge) < 0.1 && c[2] > 0)).toBe(true);
    }
  });

  it('the wall flashing face stops against the standing main corner trim (no gap, no overlap); its leg still reaches over the corner', () => {
    for (const enclosure of ['enclosed', 'open'] as const) {
      const { cfg, s } = build([leanTo({ enclosure })]); // Left Eave -> the +X wall, full length
      const lt = s.leanTos[0];
      const bs = batchesOf(cfg, s);
      const xw = s.width / 2 + SO;
      const halfL = s.length / 2;
      const inset = SHELL.cornerWidth - SO; // the corner plate on this wall reaches halfL - inset
      // (on the wall: the corner closures past the ends share the plane x = xw + T)
      const face = allTris(bs, surface('trim')).filter(
        (t) => t.p.every((p) => Math.abs(p[0] - (xw + T)) < 1e-4 && Math.abs(p[2]) <= halfL + SO + 1e-6) && centroid(t)[1] > lt.peakHeightFt - 0.1,
      );
      expect(face.length).toBeGreaterThan(0);
      const zs = face.flatMap((t) => t.p.map((p) => p[2]));
      expect(Math.min(...zs)).toBeCloseTo(-halfL + inset, 6);
      expect(Math.max(...zs)).toBeCloseTo(halfL - inset, 6);
      // the main corner plate (never cut by the lean-to) covers the flashing band at both ends
      const inp = { structure: s, openings: [], wallOrientation: cfg.panelOrientation, colors: cfg.colors, wainscot: cfg.wainscot };
      const corners = shellLayout(inp).corners.filter((k) => k.sx === 1);
      const yFl = Math.min(...face.flatMap((t) => t.p.map((p) => p[1])));
      for (const zs2 of [-1, 1]) expect(corners.some((k) => k.zs === zs2 && k.y0 <= yFl + 1e-6 && k.y1 > yFl + LEAN_TO.flash.face - 1e-6)).toBe(true);
      // the leg (on the lean-to roof) still runs out over both corners
      const leg = allTris(bs, surface('trim')).filter((t) => {
        const c = centroid(t);
        return c[0] > xw + T + 0.01 && c[0] < xw + LEAN_TO.flash.leg && Math.abs(c[1] - lt.peakHeightFt) < 0.2 && Math.abs(c[2]) < halfL + SO + T;
      });
      const lz = leg.flatMap((t) => t.p.map((p) => p[2]));
      // ... to the main corner trim's outer face (where the lean-to roof closure starts)
      expect(Math.min(...lz)).toBeCloseTo(-(halfL + SO + T), 6);
      expect(Math.max(...lz)).toBeCloseTo(halfL + SO + T, 6);
    }
  });

  it('gable cut: a short rake closes the gable overhang where it resumes and a cap closes the cut roof edge from the lean-to roof up', () => {
    const { cfg, s } = build([leanTo({ attachedSide: 'Front Gable', widthFt: 12, lowLegHeightFt: 8, roofPitch: '2:12', lengthFt: 24 })]);
    const cuts = leanToRoofCuts(s);
    expect(cuts.gable.length).toBe(2);
    const bs = roofBatches({ structure: s, roofOrientation: cfg.roofOrientation, colors: cfg.colors, cuts });
    const zF = s.length / 2 + SO;
    const zE = s.length / 2 + s.roofOverhangFt;
    const r = roofSurface(s);
    for (const c of cuts.gable) {
      expect(c.capY).toBeDefined();
      const lo = Math.min(c.x0, c.x1);
      const hi = Math.max(c.x0, c.x1);
      // cap: outer face on the plane z = -(zF + T), from the lean-to roof up, inside the cut
      expect(trimFaceAt(bs, 2, -(zF + T), (p) => p[0] > lo && p[0] < hi && p[1] > c.capY!)).toBe(true);
      // closing rake at the boundary nearer the ridge (the one at the drip needs none)
      const inner = Math.abs(lo) < Math.abs(hi) ? lo : hi;
      expect(Math.abs(inner)).toBeLessThan(r.dripX - 0.1);
      // (its face is square to the roof plane, so match it by position: across the overhang, at the boundary)
      const closing = allTris(bs, surface('trim')).filter((t) => {
        const q = centroid(t);
        return Math.abs(q[0] - inner) < 0.1 && q[2] < -zF && q[2] > -zE - 2 * T && Math.abs(q[1] - r.topAt(inner)) < 0.25;
      });
      expect(closing.length).toBeGreaterThan(0);
    }
    // nothing capped where the main roof keeps its gable overhang (near the ridge)
    expect(trimFaceAt(bs, 2, -(zF + T), (p) => Math.abs(p[0]) < 1)).toBe(false);
  });

  it('the wall flashing follows a gable wall top that dips into its band (no bare wall between the lean-to roof and the main rake)', () => {
    const { cfg, s } = build([leanTo({ attachedSide: 'Front Gable', widthFt: 12, lowLegHeightFt: 8, roofPitch: '2:12', lengthFt: 24 })]);
    const ts = allTris(batchesOf(cfg, s), surface('trim'));
    const zF = s.length / 2 + SO;
    const r = roofSurface(s);
    const y0 = leanToRoofCuts(s).gable[0].capY! - LEAN_TO.flash.below;
    const gaps = SHELL.roofUnderGap + SHELL.wallTopGap;
    const wallTop = (x: number) => r.topAt(x) - gaps;
    // right slope: where the end wall's top is 0.12 over the flashing bottom (inside the 0.22 band)
    const x = (r.ridgeY - (y0 + 0.12 + gaps)) / r.slope;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(s.width / 2);
    expect(covers(ts, [x, y0 + 0.08, -(zF + T)])).toBe(true);
    expect(covers(ts, [x, wallTop(x) + 0.03, -(zF + T)])).toBe(false);
    // where the band is fully sheeted it is the full-height face
    expect(covers(ts, [0, y0 + LEAN_TO.flash.face - 0.01, -(zF + T)])).toBe(true);
  });

  it('past a main corner the lean-to roof + rake stop at the corner trim face (plumb rake end) and a closure continues the corner trim', () => {
    // Phase 6 review: J_CA / K_CCI — no roof, underside or rake end poking past the main wall plane beside the corner trim.
    const cases = [
      ['Left Eave', 'enclosed', 30],
      ['Left Eave', 'open', 30],
      ['Front Gable', 'open', 24],
    ] as const;
    for (const [attachedSide, enclosure, lengthFt] of cases) {
      const { cfg, s } = build([leanTo({ attachedSide, enclosure, lengthFt })]);
      const lt = s.leanTos[0];
      const eave = attachedSide.includes('Eave');
      const inner = eave ? lt.inner.x : lt.inner.z;
      const outer = eave ? lt.outer.x : lt.outer.z;
      const out = Math.sign(outer - inner);
      const mainFace = inner + out * SO;
      const aCut = mainFace + out * T;
      const E = (eave ? s.length : s.width) / 2 + SO + T;
      const rS = lt.spanStart - s.roofOverhangFt;
      expect(rS).toBeLessThan(-E); // the roof does overhang past both main corners
      const across = (p: V3) => (eave ? p[0] : p[2]);
      const run = (p: V3) => (eave ? p[2] : p[0]);
      const plan = (a: number, r: number): [number, number] => (eave ? [a, r] : [r, a]);
      const bs = batchesOf(cfg, s);
      const roof = allTris(bs, surface('roof'));
      for (const r of [-(E + 0.1), E + 0.1]) {
        expect(coversPlan(roof, ...plan(inner + out * 0.05, r))).toBe(false); // nothing past the wall plane beyond the corner
        expect(coversPlan(roof, ...plan(aCut + out * 0.1, r))).toBe(true); // the overhang itself stays
      }
      expect(coversPlan(roof, ...plan(inner + out * 0.05, 0))).toBe(true); // between the corners it still runs into the wall
      // Beyond the corners no roof skin / underside / roof trim vertex sits inside the main wall face plane
      // (a square-cut rake end would lean its face bottom past it: the rake end is PLUMB on aCut) ...
      for (const b of bs.filter((x) => !x.castShadow))
        for (const t of tris(b)) for (const p of t.p) if (Math.abs(run(p)) > E + 1e-6) expect(out * (across(p) - mainFace)).toBeGreaterThanOrEqual(-1e-6);
      const rakeEnd = allTris(bs, surface('trim')).flatMap((t) => t.p).filter((p) => Math.abs(across(p) - aCut) < 1e-6 && Math.abs(run(p)) > E + 0.1);
      expect(rakeEnd.length).toBeGreaterThanOrEqual(8);
      // ... and the closure plate lies on the attached wall's plane (a = mainFace .. aCut), from under the rake face to its top.
      const closure = allTris(bs, surface('trim')).filter((t) => t.p.every((p) => Math.abs(across(p) - mainFace) < 1e-6 && Math.abs(run(p)) >= E - 1e-6));
      expect(closure.length).toBeGreaterThanOrEqual(4); // both ends
      const slope = (lt.peakHeightFt - lt.lowLegHeightFt) / Math.abs(outer - inner);
      const topA = lt.peakHeightFt - (aCut - inner) * out * slope + SHELL.roofLift * Math.hypot(1, slope); // roof top skin at aCut
      const ys = closure.flatMap((t) => t.p.map((p) => p[1]));
      expect(Math.min(...ys)).toBeLessThan(topA - SHELL.roofUnderGap - 0.05); // covers the underside end (and the rake face bottom)
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(topA + SHELL.rake.faceCenter + SHELL.rake.face / 2); // up to the rake face top
    }
  });

  it('a lean-to that stops short of the corner: no roof clip, no closure (its rakes run to the framing line)', () => {
    const { cfg, s } = build([leanTo({ lengthFt: 20, offsetFt: 5 })]);
    const lt = s.leanTos[0];
    const bs = batchesOf(cfg, s);
    const roof = allTris(bs, surface('roof'));
    const oh = s.roofOverhangFt;
    for (const r of [lt.spanStart - oh + 0.05, lt.spanEnd + oh - 0.05]) expect(coversPlan(roof, lt.inner.x + 0.05, r)).toBe(true);
    const xw = s.width / 2 + SO;
    expect(allTris(bs, surface('trim')).some((t) => t.p.every((p) => Math.abs(p[0] - xw) < 1e-6) && Math.abs(centroid(t)[2]) > s.length / 2)).toBe(false);
  });
});

describe('enhanced shell — plumb-cut trim ends (cutPlate)', () => {
  const from: V3 = [10, 8, 0];
  const to: V3 = [0, 10, 0];
  const up: V3 = [0.2 / Math.hypot(0.2, 1), 1 / Math.hypot(0.2, 1), 0];
  const side: V3 = [0, 0, -1];
  const pts = (e: Emitter): V3[] => Array.from({ length: e.pos.length / 3 }, (_, i) => [e.pos[i * 3], e.pos[i * 3 + 1], e.pos[i * 3 + 2]]);

  it('rakeTrim with no cut planes is the plain two-box rake (byte-identical)', () => {
    const a = new Emitter();
    rakeTrim(a, from, to, up, side);
    const b = new Emitter();
    rakeTrim(b, from, to, up, side, null, null);
    expect(b.pos).toEqual(a.pos);
    expect(b.nor).toEqual(a.nor);
  });

  it('a plumb cut puts that whole end ON the plane; the other end stays square; every face winds outward', () => {
    const plain = new Emitter();
    rakeTrim(plain, from, to, up, side);
    const cut = new Emitter();
    rakeTrim(cut, from, to, up, side, null, plumbAt('x', 0.5));
    expect(cut.pos.length).toBe(plain.pos.length); // 2 plates x 6 faces x 2 triangles
    const P = pts(cut);
    expect(Math.min(...P.map((p) => p[0]))).toBeCloseTo(0.5, 9);
    expect(P.filter((p) => Math.abs(p[0] - 0.5) < 1e-9).length).toBeGreaterThanOrEqual(8);
    // the far end (x > 9) is exactly the plain rake's
    const key = (p: V3) => p.map((v) => v.toFixed(9)).join(',');
    const far = new Set(pts(plain).filter((p) => p[0] > 9).map(key));
    expect(new Set(P.filter((p) => p[0] > 9).map(key))).toEqual(far);
    // outward: each triangle's normal attribute agrees with its winding and points away from its plate's center
    const half = P.length / 2;
    for (const [lo, hi] of [[0, half], [half, P.length]]) {
      const c = [0, 1, 2].map((k) => P.slice(lo, hi).reduce((s2, p) => s2 + p[k], 0) / (hi - lo)) as unknown as V3;
      for (let i = lo; i < hi; i += 3) {
        const t: Tri = { p: [P[i], P[i + 1], P[i + 2]], n: [cut.nor[i * 3], cut.nor[i * 3 + 1], cut.nor[i * 3 + 2]], uv: [] };
        expect(dot(geoNormal(t), t.n)).toBeGreaterThan(0);
        expect(dot(t.n, sub(centroid(t), c))).toBeGreaterThan(0);
      }
    }
  });

  it('cutPlate with no cuts spans the same box as box()', () => {
    const f = { o: [1, 2, 3] as V3, x: [1, 0, 0] as V3, y: [0, 1, 0] as V3, z: [0, 0, 1] as V3 };
    const a = new Emitter();
    cutPlate(a, f, 4, [-0.1, 0.2], [0, 0.05], null, null);
    const b = new Emitter();
    box(b, f, [2, 0.05, 0.025], [4, 0.3, 0.05]);
    const bb = (e: Emitter) => [0, 1, 2].map((k) => [Math.min(...pts(e).map((p) => p[k])), Math.max(...pts(e).map((p) => p[k]))]);
    for (const [[a0, a1], [b0, b1]] of bb(a).map((r, k) => [r, bb(b)[k]])) {
      expect(a0).toBeCloseTo(b0, 9);
      expect(a1).toBeCloseTo(b1, 9);
    }
    expect(a.pos.length).toBe(b.pos.length);
  });
});
