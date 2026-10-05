import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, Opening } from '@/types/building';
import { litFromRight, materialKey, type V3 } from '../enhanced/materials';
import {
  SHELL,
  roofBatches,
  roofSurface,
  shellLayout,
  trimBatches,
  wallBatches,
  wallTopAt,
  type ShellBatch,
  type ShellInput,
} from '../enhanced/shellGeometry';

// Render-upgrade Phase 5: the enhanced main shell geometry (pure).

const build = (over: Partial<BuildingConfig> = {}): { cfg: BuildingConfig; s: StructureModel } => {
  const cfg: BuildingConfig = { ...DEFAULT_CONFIG, ...over };
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
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const geoNormal = (t: Tri) => cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
const centroid = (t: Tri): V3 => [0, 1, 2].map((k) => (t.p[0][k] + t.p[1][k] + t.p[2][k]) / 3) as unknown as V3;
const allTris = (bs: ShellBatch[], pred: (b: ShellBatch) => boolean = () => true) => bs.filter(pred).flatMap(tris);

/** Texture-space gradient of u across a triangle, as a world vector (in the triangle's plane). */
function uGradient(t: Tri): V3 {
  const e1 = sub(t.p[1], t.p[0]);
  const e2 = sub(t.p[2], t.p[0]);
  const du1 = t.uv[1][0] - t.uv[0][0];
  const du2 = t.uv[2][0] - t.uv[0][0];
  const dv1 = t.uv[1][1] - t.uv[0][1];
  const dv2 = t.uv[2][1] - t.uv[0][1];
  const r = 1 / (du1 * dv2 - du2 * dv1);
  // tangent = dP/du
  return [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
}

/** Does any triangle of `ts` contain point q (all in one plane)? */
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

describe('enhanced shell — walls', () => {
  it('every PAINTED wall face points OUTWARD, its winding agrees, and +u runs left -> right seen from outside', () => {
    for (const panelOrientation of ['Vertical', 'Horizontal'] as const) {
      const { cfg, s } = build({ panelOrientation, wainscot: { enabled: true, heightFt: 3 } });
      // the painted faces (the unpainted backs face inward: panelBack.test.ts)
      const ts = allTris(wallBatches(input(cfg, s)).filter((b) => b.spec.surface === 'wall'));
      expect(ts.length).toBeGreaterThan(20);
      for (const t of ts) {
        const c = centroid(t);
        // outward: the normal points away from the building center (walls are the building's outer faces)
        const radial: V3 = [Math.abs(t.n[0]) > 0.5 ? c[0] : 0, 0, Math.abs(t.n[2]) > 0.5 ? c[2] : 0];
        expect(dot(t.n, radial)).toBeGreaterThan(0);
        expect(dot(geoNormal(t), t.n)).toBeGreaterThan(0);
        // u x up = outward normal  <=>  u runs left -> right as seen from outside
        const g = uGradient(t);
        const uxup = cross(g, [0, 1, 0]);
        expect(dot(uxup, t.n)).toBeGreaterThan(0.99);
      }
    }
  });

  it('UVs are world feet (the rib phase is world-anchored per strip)', () => {
    const { cfg, s } = build();
    for (const t of allTris(wallBatches(input(cfg, s)))) {
      for (let k = 0; k < 3; k++) expect(t.uv[k][1]).toBeCloseTo(t.p[k][1], 6); // v = height
      const g = uGradient(t);
      expect(Math.hypot(...g)).toBeCloseTo(1, 6); // 1 texture unit per foot along the wall
    }
  });

  it('walls stop SHELL.wallTopGap under the roof underside', () => {
    for (const roofPitch of [2, 3, 4, 6]) {
      const { cfg, s } = build({ roofPitch, openings: [] });
      const lay = shellLayout(input(cfg, s));
      const r = lay.roof;
      for (const w of lay.walls) {
        for (const t of allTris(wallBatches(input(cfg, s)))) {
          for (const p of t.p) {
            const under = r.topAt(p[0]) - SHELL.roofUnderGap;
            expect(p[1]).toBeLessThanOrEqual(under - SHELL.wallTopGap + 1e-6);
          }
        }
        if (w.plane.along === 'z') {
          const top = Math.max(...w.regions.map((g) => g.y1));
          expect(top).toBeCloseTo(wallTopAt(r, w.plane.at), 6);
        }
      }
    }
  });

  it('doors, windows and frame-outs cut REAL holes; the wainscot is the lower run of the same plane', () => {
    const openings: Opening[] = [
      { id: 'r', type: 'rollUpDoor', side: 'front', offset: 12, width: 10, height: 8, sillHeight: 0 },
      { id: 'w', type: 'window', side: 'right', offset: 10, width: 3, height: 3, sillHeight: 4 },
      { id: 'f', type: 'frameOut', side: 'back', offset: 6, width: 4, height: 4, sillHeight: 2 },
    ];
    const { cfg, s } = build({ openings, wainscot: { enabled: true, heightFt: 3 } });
    const bs = wallBatches(input(cfg, s));
    const ts = allTris(bs);
    const halfL = s.length / 2;
    const halfW = s.width / 2;
    const SO = SHEET_OUTSET;
    // roll-up on the front: world x = -halfW + 12
    expect(covers(ts, [-halfW + 12, 4, -(halfL + SO)])).toBe(false);
    expect(covers(ts, [-halfW + 12, 9, -(halfL + SO)])).toBe(true); // above the door
    // window on the right eave: z = -halfL + 10
    expect(covers(ts, [halfW + SO, 5.5, -halfL + 10])).toBe(false);
    expect(covers(ts, [halfW + SO, 1.5, -halfL + 10])).toBe(true); // wainscot below it
    // frame-out on the back: back offsets mirror, x = halfW - 6; it crosses the wainscot line
    expect(covers(ts, [halfW - 6, 2.5, halfL + SO])).toBe(false);
    expect(covers(ts, [halfW - 6, 4.5, halfL + SO])).toBe(false);
    // wainscot batch is its own material, same plane
    const wain = bs.filter((b) => (b.spec as { color?: string }).color === cfg.colors.wainscot && b.spec.surface === 'wall');
    expect(wain.length).toBeGreaterThan(0);
    for (const t of allTris(wain)) for (const p of t.p) expect(p[1]).toBeLessThanOrEqual(3 + 1e-6);
  });

  it('rib flip uses each wall\'s real +u (eave walls flip, gables do not; horizontal never)', () => {
    const v = build({ panelOrientation: 'Vertical' });
    const lay = shellLayout(input(v.cfg, v.s));
    const flip = Object.fromEntries(lay.walls.map((w) => [w.plane.id, w.flip]));
    expect(flip).toEqual({ left: true, right: true, front: false, back: false });
    for (const w of lay.walls) expect(w.flip).toBe(litFromRight(w.plane.n, w.plane.u));
    const h = build({ panelOrientation: 'Horizontal' });
    expect(shellLayout(input(h.cfg, h.s)).walls.every((w) => !w.flip)).toBe(true);
  });

  it('open sides / ends are not sheeted, eave-hung bands hang from the eave, halfClosed / gableOnly ends', () => {
    // Carport: open sides + ends -> only the gable triangles on gableOnly ends (if any)
    const cp = build({ buildingType: 'carport', openings: [] });
    const cpl = shellLayout(input(cp.cfg, cp.s));
    for (const w of cpl.walls) expect(w.regions.length).toBe(0);
    expect(cpl.corners).toEqual([]);
    // Carport with a 3 ft side panel on each side: bands [H-3, top] along the open bay, bottom trim, no base trim
    const sp = build({ buildingType: 'carport', openings: [], eavePanelFt: { left: 3, right: 3 } });
    const spl = shellLayout(input(sp.cfg, sp.s));
    const sides = spl.walls.filter((w) => w.plane.along === 'z');
    expect(sides.length).toBe(2);
    for (const w of sides) {
      expect(w.regions.length).toBe(1);
      expect(w.regions[0].y0).toBeCloseTo(sp.s.legHeight - 3, 6);
      expect(w.base).toEqual([]);
      expect(w.bottom.length).toBe(1);
    }
    // Garage with the left eave open: that wall is gone, only the two right corners remain
    const lo = build({ wallOverrides: { leftOpen: true, rightOpen: false }, openings: [] });
    const lol = shellLayout(input(lo.cfg, lo.s));
    expect(lol.walls.find((w) => w.plane.id === 'left')!.regions.length).toBe(0);
    expect(lol.corners.map((c) => c.sx).sort()).toEqual([1, 1]);
    // Enclosed garage: four corners, full height from the slab
    const g = build({ openings: [] });
    const gl = shellLayout(input(g.cfg, g.s));
    expect(gl.corners.length).toBe(4);
    for (const c of gl.corners) expect(c.y0).toBeCloseTo(0, 6);
  });

  it('single-slope (mono): right-triangle ends, tall -X wall reaches the high roof edge', () => {
    const { cfg, s } = build({ monoDropFt: 3, openings: [] });
    const lay = shellLayout(input(cfg, s));
    expect(lay.roof.mono).toBe(true);
    const front = lay.walls.find((w) => w.plane.id === 'front')!;
    expect(front.polys.length).toBe(1);
    const [a, b, apex] = front.polys[0];
    expect(apex[0]).toBeCloseTo(-s.width / 2, 6); // apex over the tall (-X) corner
    expect(a[1]).toBeCloseTo(b[1], 6);
    const left = lay.walls.find((w) => w.plane.id === 'left')!;
    const right = lay.walls.find((w) => w.plane.id === 'right')!;
    const topOf = (w: typeof left) => Math.max(...w.regions.map((r) => r.y1));
    expect(topOf(left) - topOf(right)).toBeGreaterThan(2.5);
    // corner trims run up to the roof on the tall corners too (the end's right triangle is sheeted there)
    const tall = lay.corners.filter((c) => c.sx < 0);
    const low = lay.corners.filter((c) => c.sx > 0);
    expect(tall.length).toBe(2);
    expect(low.length).toBe(2);
    for (const c of tall) expect(c.y1).toBeGreaterThan(topOf(right) + 2.5);
    for (const c of tall) expect(c.y1).toBeLessThan(topOf(left) + 1e-6);
  });
});

describe('enhanced shell — roof', () => {
  const roofOf = (over: Partial<BuildingConfig>) => {
    const { cfg, s } = build(over);
    return { s, bs: roofBatches({ structure: s, roofOrientation: cfg.roofOrientation, colors: cfg.colors }), r: roofSurface(s) };
  };
  const top = (bs: ShellBatch[]) => bs.filter((b) => b.spec.surface === 'roof');

  it('both planes meet EXACTLY on the ridge line (no gap) at 2/12, 3/12, 4/12, 6/12', () => {
    for (const roofPitch of [2, 3, 4, 6]) {
      const { bs, r } = roofOf({ roofPitch });
      const ts = allTris(top(bs));
      const ridgePts = ts.flatMap((t) => t.p).filter((p) => Math.abs(p[0]) < 1e-9);
      expect(ridgePts.length).toBeGreaterThan(0);
      // float32 vertices: both slopes share the exact same ridge value
      for (const p of ridgePts) expect(p[1]).toBe(ridgePts[0][1]);
      expect(ridgePts[0][1]).toBeCloseTo(r.ridgeY, 5);
      // both slopes reach x = 0
      expect(ts.some((t) => t.p.some((p) => p[0] === 0) && centroid(t)[0] > 0)).toBe(true);
      expect(ts.some((t) => t.p.some((p) => p[0] === 0) && centroid(t)[0] < 0)).toBe(true);
    }
  });

  it('overhang = structure.roofOverhangFt on the eaves AND the gables (0.5 and 1.0, never hardcoded)', () => {
    for (const roofOverhangFt of [0.5, 1.0]) {
      const { s, bs } = roofOf({ roofOverhangFt });
      expect(s.roofOverhangFt).toBe(roofOverhangFt);
      const pts = allTris(top(bs)).flatMap((t) => t.p);
      expect(Math.max(...pts.map((p) => Math.abs(p[0])))).toBeCloseTo(s.width / 2 + roofOverhangFt, 5);
      expect(Math.max(...pts.map((p) => Math.abs(p[2])))).toBeCloseTo(s.length / 2 + roofOverhangFt, 5);
      // roof length label = span + 2 * overhang
      expect(2 * Math.max(...pts.map((p) => Math.abs(p[2])))).toBeCloseTo(s.length + 2 * roofOverhangFt, 5);
    }
  });

  it('top skin faces up, the Galvalume underside sits 0.07 below facing down; nothing casts shadows', () => {
    const { bs } = roofOf({});
    for (const t of allTris(top(bs))) {
      expect(t.n[1]).toBeGreaterThan(0);
      expect(dot(geoNormal(t), t.n)).toBeGreaterThan(0);
    }
    const under = allTris(bs.filter((b) => b.spec.surface === 'roofUnder'));
    expect(under.length).toBe(allTris(top(bs)).length);
    for (const t of under) expect(t.n[1]).toBeLessThan(0);
    const topYs = allTris(top(bs)).flatMap((t) => t.p.map((p) => p[1])).sort((a, b) => a - b);
    const underYs = under.flatMap((t) => t.p.map((p) => p[1])).sort((a, b) => a - b);
    for (let i = 0; i < topYs.length; i++) expect(topYs[i] - underYs[i]).toBeCloseTo(SHELL.roofUnderGap, 5);
    for (const b of bs) expect(b.castShadow).toBe(false);
  });

  it('roof u runs left -> right seen from outside; v is distance along the slope', () => {
    const { bs, r } = roofOf({ roofPitch: 4 });
    for (const t of allTris(top(bs))) {
      const g = uGradient(t);
      // +u x (up-slope) = outward normal
      const c = centroid(t);
      const upSlope: V3 = [-Math.sign(c[0]), r.slope, 0];
      expect(dot(cross(g, upSlope), t.n)).toBeGreaterThan(0);
      // |dv/ds| = 1 along the slope
      const e = sub(t.p[1], t.p[0]);
      const ds = Math.hypot(e[0], e[1]);
      if (ds > 1e-6) expect(Math.abs(t.uv[1][1] - t.uv[0][1])).toBeCloseTo(ds, 6);
    }
  });

  it('ridge cap only on a pitched gable (not on mono, not at pitch 0)', () => {
    const trimCount = (over: Partial<BuildingConfig>) => {
      const { bs } = roofOf(over);
      return allTris(bs.filter((b) => b.spec.surface === 'trim')).length;
    };
    const pitched = trimCount({ roofPitch: 3 });
    const flat = trimCount({ roofPitch: 0 });
    const mono = trimCount({ monoDropFt: 3 });
    // eave (2 x 3 plates) + rakes: pitched 4 x 2 plates, flat / mono 2 x 2 plates; each plate 12 tris
    expect(flat).toBe((6 + 4) * 12);
    expect(mono).toBe((6 + 4) * 12);
    expect(pitched).toBeGreaterThan((6 + 8) * 12); // + the ridge-cap prism
    // mono has one plane (+ its underside)
    const m = roofOf({ monoDropFt: 3 });
    expect(allTris(top(m.bs)).length).toBe(2);
  });

  it('roofOrientation picks the rib map; the key for Galvalume trim stays metal', () => {
    const v = roofOf({ roofOrientation: 'Vertical' });
    const h = roofOf({ roofOrientation: 'Horizontal' });
    expect(top(v.bs).every((b) => (b.spec as { orientation: string }).orientation === 'vertical')).toBe(true);
    expect(top(h.bs).every((b) => (b.spec as { orientation: string }).orientation === 'horizontal')).toBe(true);
    const g = build({ colors: { ...DEFAULT_CONFIG.colors, trim: 'GALVALUME' } });
    const bs = roofBatches({ structure: g.s, roofOrientation: 'Vertical', colors: g.cfg.colors });
    expect(bs.some((b) => b.spec.surface === 'trim' && materialKey(b.spec).includes('|galv'))).toBe(true);
  });
});

describe('enhanced shell — wall trim', () => {
  it('base trim only where the sheet meets the slab, split at floor-level openings', () => {
    const openings: Opening[] = [
      { id: 'd', type: 'walkDoor', side: 'left', offset: 10, width: 3, height: 6.7, sillHeight: 0 },
      { id: 'w', type: 'window', side: 'left', offset: 20, width: 3, height: 3, sillHeight: 4 },
    ];
    const { cfg, s } = build({ openings });
    const ts = allTris(trimBatches(input(cfg, s)));
    const halfL = s.length / 2;
    const x = -(s.width / 2 + SHEET_OUTSET + SHELL.trimT); // outer face of the left base trim
    expect(covers(ts, [x, 0.1, -halfL + 10])).toBe(false); // door cuts it
    expect(covers(ts, [x, 0.1, -halfL + 20])).toBe(true); // window above does not
    expect(covers(ts, [x, 0.1, -halfL + 5])).toBe(true);
  });

  it('no corner or base trim on an open carport; corners stop under the roof', () => {
    const cp = build({ buildingType: 'carport', openings: [] });
    const lay = shellLayout(input(cp.cfg, cp.s));
    expect(lay.corners).toEqual([]);
    expect(lay.walls.every((w) => w.base.length === 0)).toBe(true);
    const g = build({ openings: [] });
    const gl = shellLayout(input(g.cfg, g.s));
    for (const c of gl.corners) expect(c.y1).toBeLessThan(gl.roof.topAt(Math.abs(g.s.width / 2 + SHEET_OUTSET)) - SHELL.roofUnderGap);
  });

  it('lapped trims: no base / bottom / corner trim face lies on a sheet (no z-fight seen from inside); outer faces stay T proud', () => {
    const T = SHELL.trimT;
    const cases = [
      build({ wainscot: { enabled: true, heightFt: 3 } }), // base + corner plates + Z-trim
      build({ buildingType: 'carport', openings: [], eavePanelFt: { left: 3, right: 3 } }), // bottom trim on hanging bands
      build({ wallOverrides: { leftOpen: false, rightOpen: false, front: 'gableOnly' }, openings: [] }), // bottom trim under a gable-only sheet
    ];
    let lapped = 0;
    for (const { cfg, s } of cases) {
      const inp = input(cfg, s);
      const lay = shellLayout(inp);
      const sheet = allTris(wallBatches(inp, lay));
      const trim = allTris(trimBatches(inp, lay));
      expect(trim.length).toBeGreaterThan(0);
      for (const t of trim) {
        // the centroid and points near each corner: none may be covered by a sheet triangle (same plane, inside it)
        const c = centroid(t);
        const probes: V3[] = [c, ...t.p.map((p) => [0, 1, 2].map((k) => c[k] + 0.9 * (p[k] - c[k])) as unknown as V3)];
        for (const q of probes) expect(covers(sheet, q)).toBe(false);
      }
      for (const w of lay.walls) {
        const ax = w.plane.along === 'z' ? 0 : 2;
        const inward = -Math.sign(w.plane.n[ax]);
        // back faces (normal pointing into the building) SHELL.trimLift off this sheet
        lapped += trim.filter((t) => t.n[ax] === inward && t.p.every((p) => Math.abs(p[ax] - (w.plane.at + w.plane.n[ax] * SHELL.trimLift)) < 1e-6)).length;
      }
    }
    expect(lapped).toBeGreaterThan(0);
    // outside unchanged: the left base trim's outer face is still T off the sheet, from the slab up to baseHeight
    const { cfg, s } = cases[0];
    const ts = allTris(trimBatches(input(cfg, s)));
    const x = -(s.width / 2 + SHEET_OUTSET + T);
    expect(covers(ts, [x, 0.01, 0])).toBe(true);
    expect(covers(ts, [x, SHELL.baseHeight - 0.01, 0])).toBe(true);
    // ... and the plate still spans the full thickness at its top (the top face runs from the sheet to the outer face)
    const top = ts.filter((t) => t.n[1] === 1 && t.p.every((p) => Math.abs(p[1] - SHELL.baseHeight) < 1e-6) && t.p.every((p) => p[0] < -s.width / 2));
    expect(Math.max(...top.flatMap((t) => t.p.map((p) => p[0])))).toBeCloseTo(-(s.width / 2 + SHEET_OUTSET), 6);
  });

  it('wainscot Z-trim breaks around an opening that crosses the line (never across a roll-up)', () => {
    const openings: Opening[] = [{ id: 'r', type: 'rollUpDoor', side: 'front', offset: 12, width: 10, height: 8, sillHeight: 0 }];
    const { cfg, s } = build({ openings, wainscot: { enabled: true, heightFt: 3 } });
    const ts = allTris(trimBatches(input(cfg, s)));
    const z = -(s.length / 2 + SHEET_OUTSET + SHELL.zTrim.standoff + SHELL.trimT);
    expect(covers(ts, [-s.width / 2 + 12, 3, z])).toBe(false);
    expect(covers(ts, [-s.width / 2 + 3, 3, z])).toBe(true);
  });
});
