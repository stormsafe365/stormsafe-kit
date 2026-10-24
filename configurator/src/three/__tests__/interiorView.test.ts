import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import { useEditorStore } from '@/store/useEditorStore';
import type { BuildingConfig, LeanTo, LeanToOpening, Opening, StorageMode } from '@/types/building';
import { FIT_MARGIN, fitDistance } from '../cameraMath';
import {
  INTERIOR,
  ceilingAt,
  clampToInterior,
  crossWallHeight,
  dragLook,
  eyeHeight,
  interiorKey,
  interiorPose,
  interiorRoom,
  lookDir,
  lookPressStarts,
  openingSpan,
  partTakesPress,
  roofLineAt,
  sectionCut,
  spanCutAway,
  spanOnRoomWalls,
  walk,
  yawPitchOf,
  zoomFov,
  type Vec3,
} from '../interiorView';
import { eaveSurfaces, gableSurfaces, leanToOpeningSpan, resolveWalls } from '../LeanToSiding';

// Walk-in Interior camera (owner 10/2/26: "if you try to zoom out at all.. it
// takes out outside the building .. so there really is not an interior view").

const build = (over: Partial<BuildingConfig> = {}, storage?: { mode: StorageMode; lengthFt: number }): StructureModel => {
  const cfg: BuildingConfig = {
    ...DEFAULT_CONFIG,
    buildingType: 'garage',
    width: 26,
    length: 50,
    legHeight: 12,
    trussSpacingFt: 4,
    manufacturer: 'CCI',
    ...over,
    walls: { ...DEFAULT_CONFIG.walls, storage: storage ?? { mode: 'none', lengthFt: 0 } },
  };
  return deriveStructure(resolveBuilding(cfg));
};

const deg = (r: number) => (r * 180) / Math.PI;

/** True when p is inside the room box (walls − 1', floor + 2', under the roof − 1'). */
function insideBox(p: Vec3, s: StructureModel): boolean {
  const r = interiorRoom(s);
  const e = 1e-9;
  return (
    p[0] >= r.x0 + INTERIOR.wallMarginFt - e &&
    p[0] <= r.x1 - INTERIOR.wallMarginFt + e &&
    p[2] >= r.z0 + INTERIOR.wallMarginFt - e &&
    p[2] <= r.z1 - INTERIOR.wallMarginFt + e &&
    p[1] >= INTERIOR.floorMarginFt - e &&
    p[1] <= roofLineAt(s, p[0]) - INTERIOR.roofMarginFt + e
  );
}

// Owner 10/24/26 (30x80x18, storage 68' from the back -> a 12' main room):
// "the camera zooms in very close ... you only see a slab of wall with the
// door, no context". A cross wall (End Storage partition / GCH divider) is now
// framed like the outside views frame a wall (cameraMath fitDistance, 1.18).

/** NDC of world point q seen from a pose (yaw / pitch / vertical FOV) in a pane of `aspect`. */
function ndc(p: { pos: Vec3; yaw: number; pitch: number; fov: number }, aspect: number, q: Vec3): [number, number] {
  const f = lookDir(p.yaw, p.pitch);
  // right = f x up, up' = right x f
  const r: Vec3 = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[2]);
  r[0] /= rl;
  r[2] /= rl;
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const v: Vec3 = [q[0] - p.pos[0], q[1] - p.pos[1], q[2] - p.pos[2]];
  const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = d(v, f);
  const tv = Math.tan((p.fov * Math.PI) / 360);
  return [d(v, r) / (z * tv * aspect), d(v, u) / (z * tv)];
}

/** The far cross wall's outline (floor corners, eave corners, peak) of a framed room. */
function wallOutline(s: StructureModel, room: { x0: number; x1: number; z0: number; z1: number; dirZ: 1 | -1 }): Vec3[] {
  const z = room.dirZ > 0 ? room.z1 : room.z0;
  const pts: Vec3[] = [
    [room.x0, 0, z],
    [room.x1, 0, z],
    [room.x0, roofLineAt(s, room.x0), z],
    [room.x1, roofLineAt(s, room.x1), z],
  ];
  if (room.x0 < 0 && room.x1 > 0) pts.push([0, roofLineAt(s, 0), z]);
  return pts;
}

/** Largest |NDC| of the wall outline: the whole wall is in frame (< 1) with the views' margin (= 1 / 1.18 on the binding side). */
const frameFill = (s: StructureModel, aspect: number) => {
  const p = interiorPose(s, aspect);
  const n = wallOutline(s, p.room).map((q) => ndc(p, aspect, q));
  return { x: Math.max(...n.map((v) => Math.abs(v[0]))), y: Math.max(...n.map((v) => Math.abs(v[1]))), p };
};

describe('interior pose: End Storage (frame the partition like the outside views)', () => {
  // 26x50x12, End Storage 30' from the back -> 20' main room at the front.
  const s = build({}, { mode: 'endBack', lengthFt: 30 });
  const p = interiorPose(s, 1.6);
  it('main room is the front 20 ft (partition at z = -5)', () => {
    expect(s.enclosure.partitionZ).toBeCloseTo(-5, 9);
    expect(p.room.kind).toBe('endStorage');
    expect([p.room.z0, p.room.z1]).toEqual([-25, -5]);
    expect([p.room.x0, p.room.x1]).toEqual([-13, 13]);
  });
  it('square to the partition from the main room, centred, eye at half its height, level, at the fit distance', () => {
    const wallH = crossWallHeight(s, -13, 13);
    expect(wallH).toBeCloseTo(s.peakHeight, 9);
    expect(p.pos[0]).toBeCloseTo(0, 9);
    expect(p.pos[1]).toBeCloseTo(wallH / 2, 9);
    expect(p.pos[2]).toBeCloseTo(-5 - fitDistance(26, wallH, INTERIOR.frameFovDeg, 1.6), 9);
    expect(p.yaw).toBe(0); // +Z, at the partition
    expect(p.pitch).toBeCloseTo(0, 9);
    expect(p.fov).toBe(INTERIOR.frameFovDeg);
  });
  it('the whole partition, floor to peak and eave to eave, fits with the 1.18 margin on its binding side', () => {
    const f = frameFill(s, 1.6);
    expect(Math.max(f.x, f.y)).toBeCloseTo(1 / FIT_MARGIN, 9);
    expect(f.x).toBeLessThan(1);
    expect(f.y).toBeLessThan(1);
  });
  it('a deep enough room: the eye stands in it, nothing is cut', () => {
    expect(insideBox(p.pos, s)).toBe(true);
    expect(p.room.box).toEqual(interiorRoom(s).box);
    expect(sectionCut(p.room, p.pos)).toBeNull();
  });
  it('a pane of any shape frames it: narrow panes stand further back (width binds), wide ones are height-bound', () => {
    for (const aspect of [0.6, 1, 1.6, 2.4]) {
      const f = frameFill(s, aspect);
      expect(Math.max(f.x, f.y)).toBeCloseTo(1 / FIT_MARGIN, 9);
    }
    expect(interiorPose(s, 0.6).pos[2]).toBeLessThan(interiorPose(s, 1.6).pos[2]);
  });
  it('storage at the FRONT: from the back side, looking forward (-Z) at it', () => {
    const fr = build({}, { mode: 'end', lengthFt: 20 });
    const q = interiorPose(fr, 1.6);
    expect(fr.enclosure.partitionZ).toBeCloseTo(-5, 9);
    expect([q.room.z0, q.room.z1]).toEqual([-5, 25]);
    expect(q.pos[2]).toBeCloseTo(-5 + fitDistance(26, crossWallHeight(fr, -13, 13), INTERIOR.frameFovDeg, 1.6), 9);
    expect(Math.abs(q.yaw)).toBeCloseTo(Math.PI, 9);
    expect(lookDir(q.yaw, q.pitch)[2]).toBeLessThan(0);
    expect(Math.max(frameFill(fr, 1.6).x, frameFill(fr, 1.6).y)).toBeCloseTo(1 / FIT_MARGIN, 9);
  });
  it('arrival tilt never exceeds +10 deg or drops below -8 deg (every test building)', () => {
    for (const t of [build(), build({ width: 50, length: 60, legHeight: 16 }), build({ length: 12 }, { mode: 'endBack', lengthFt: 10 })]) {
      const q = interiorPose(t);
      expect(deg(q.pitch)).toBeLessThanOrEqual(10 + 1e-9);
      expect(deg(q.pitch)).toBeGreaterThanOrEqual(-8 - 1e-9);
    }
  });
});

describe('interior pose: a main room too short to frame its partition from inside -> section view', () => {
  // The owner's building: 30x80x18 CCI, storage 68' from the back -> a 12' main room.
  const s = build({ width: 30, length: 80, legHeight: 18 }, { mode: 'endBack', lengthFt: 68 });
  const p = interiorPose(s, 1.6);
  it('stands back past the front wall, at the fit distance, the clamp box extended to that spot only', () => {
    expect(p.room.kind).toBe('endStorage');
    expect([p.room.z0, p.room.z1]).toEqual([-40, -28]);
    const d = fitDistance(30, crossWallHeight(s, -15, 15), INTERIOR.frameFovDeg, 1.6);
    expect(d).toBeGreaterThan(12); // deeper than the room
    expect(p.pos[2]).toBeCloseTo(-28 - d, 9);
    expect(p.pos[2]).toBeLessThan(-40);
    const base = interiorRoom(s).box;
    expect(p.room.box).toEqual({ ...base, z0: p.pos[2] });
    expect(clampToInterior(p.pos, p.room, s)).toEqual(p.pos);
  });
  it('the whole wall in frame with the margin, at half its height, level', () => {
    const f = frameFill(s, 1.6);
    expect(Math.max(f.x, f.y)).toBeCloseTo(1 / FIT_MARGIN, 9);
    expect(p.pos[1]).toBeCloseTo(crossWallHeight(s, -15, 15) / 2, 9);
    expect(p.pitch).toBeCloseTo(0, 9);
  });
  it('section cut: the front wall (and anything past it) is clipped 1 ft inside its framing line while the eye is beyond it', () => {
    expect(sectionCut(p.room, p.pos)).toEqual({ z: -40 + INTERIOR.cutInsetFt, keep: 1 });
    // walk in past the cut line: nothing is cut any more; back out: cut again
    const inRoom = clampToInterior(walk(p.pos, p.yaw, 20, 0), p.room, s);
    expect(inRoom[2]).toBeGreaterThan(-39);
    expect(sectionCut(p.room, inRoom)).toBeNull();
    expect(sectionCut(p.room, clampToInterior(walk(inRoom, p.yaw, -40, 0), p.room, s))).toEqual({ z: -39, keep: 1 });
  });
  it('never past the arrival spot, never into the storage room', () => {
    const far = clampToInterior([0, 9, -200], p.room, s);
    expect(far[2]).toBeCloseTo(p.pos[2], 9);
    expect(clampToInterior([0, 9, 50], p.room, s)[2]).toBe(-28 - INTERIOR.wallMarginFt);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let q = p.pos;
    let yaw = 0;
    for (let i = 0; i < 1000; i++) {
      yaw += (rnd() - 0.5) * 2;
      q = clampToInterior(walk(q, yaw, (rnd() - 0.3) * 6, (rnd() - 0.5) * 6), p.room, s);
      expect(q[2]).toBeGreaterThanOrEqual(p.pos[2] - 1e-9);
      expect(q[2]).toBeLessThanOrEqual(-29 + 1e-9);
      expect(Math.abs(q[0])).toBeLessThanOrEqual(14 + 1e-9);
    }
  });
  it('storage at the FRONT end with a short main room: stands back past the BACK wall, cut keeps z < plane', () => {
    const f = build({ width: 30, length: 80, legHeight: 18 }, { mode: 'end', lengthFt: 68 });
    const q = interiorPose(f, 1.6);
    expect([q.room.z0, q.room.z1]).toEqual([28, 40]);
    expect(q.pos[2]).toBeGreaterThan(40);
    expect(sectionCut(q.room, q.pos)).toEqual({ z: 40 - INTERIOR.cutInsetFt, keep: -1 });
    expect(Math.max(frameFill(f, 1.6).x, frameFill(f, 1.6).y)).toBeCloseTo(1 / FIT_MARGIN, 9);
  });
  it('short and tall, narrow and wide (12 ft - 60 ft), partitions near either end: always the whole wall with the margin', () => {
    const cases: [Partial<BuildingConfig>, { mode: StorageMode; lengthFt: number }][] = [
      [{ width: 12, length: 21, legHeight: 8 }, { mode: 'end', lengthFt: 5 }],
      [{ width: 12, length: 40, legHeight: 8 }, { mode: 'endBack', lengthFt: 36 }],
      [{ width: 60, length: 80, legHeight: 16 }, { mode: 'endBack', lengthFt: 60 }],
      [{ width: 60, length: 80, legHeight: 20 }, { mode: 'end', lengthFt: 72 }],
      [{ width: 24, length: 40, legHeight: 12 }, { mode: 'endBack', lengthFt: 20 }],
      [{ width: 30, length: 80, legHeight: 18 }, { mode: 'endBack', lengthFt: 76 }], // a 4' main room
    ];
    for (const [over, st] of cases) {
      const t = build(over, st);
      for (const aspect of [1, 1.6, 2]) {
        const f = frameFill(t, aspect);
        expect(Math.max(f.x, f.y)).toBeCloseTo(1 / FIT_MARGIN, 9);
        expect(f.p.pos[1]).toBeGreaterThanOrEqual(INTERIOR.floorMarginFt);
        expect(f.p.pos[1]).toBeLessThanOrEqual(ceilingAt(t, f.p.pos[0]) + 1e-9);
      }
    }
  });
  it('plain and lengthwise-storage rooms keep their arrival and are never cut', () => {
    for (const t of [build(), build({ width: 30, length: 40 }, { mode: 'left', lengthFt: 12 })]) {
      const q = interiorPose(t, 1.6);
      expect(q.fov).toBe(INTERIOR.fovDeg);
      expect(q.room.box).toEqual(interiorRoom(t).box);
      expect(sectionCut(q.room, q.pos)).toBeNull();
      expect(sectionCut(q.room, [0, 5, -1000])).toBeNull();
    }
  });
});

describe('framing math shared with the outside views (cameraMath)', () => {
  it('fitDistance: the binding side lands on the 1.18 margin', () => {
    // 30 wide x 21.75 tall at 60 deg / 1.6: height binds
    const d = fitDistance(30, 21.75, 60, 1.6);
    const t = Math.tan(Math.PI / 6);
    expect(d).toBeCloseTo((21.75 / 2 / t) * 1.18, 9);
    expect(21.75 / 2 / (d * t)).toBeCloseTo(1 / 1.18, 9);
    // a very wide face: width binds
    const w = fitDistance(60, 10, 60, 1.6);
    expect(w).toBeCloseTo((30 / (t * 1.6)) * 1.18, 9);
    expect(FIT_MARGIN).toBe(1.18);
    expect(fitDistance(30, 21.75, 60, 1.6, 1)).toBeCloseTo(d / 1.18, 9);
  });
  it('CameraRig frames its named views with the same function (no second copy of the math)', () => {
    const rig = readFileSync(fileURLToPath(new URL('../CameraRig.tsx', import.meta.url)), 'utf8');
    expect(rig).toMatch(/import \{ fitDistance as fitSpan \} from '\.\/cameraMath';/);
    expect(rig).toMatch(/const fitDistance = \(spanW: number, spanH: number\) => fitSpan\(spanW, spanH, camera\.fov, camera\.aspect\);/);
    expect(rig).not.toMatch(/\* 1\.18/);
  });
  it('InteriorWalk poses for the live pane and cuts / restores the section with the eye (never left on after Interior ends)', () => {
    const w = readFileSync(fileURLToPath(new URL('../InteriorWalk.tsx', import.meta.url)), 'utf8');
    expect(w).toMatch(/interiorPose\(structureRef\.current, camera\.aspect\)/);
    expect(w).toMatch(/applyCut\(sectionCut\(w\.room, w\.pos\)\);/);
    expect(w).toMatch(/applyCut\(null\);/);
    expect(w).toMatch(/gl\.clippingPlanes = c\.saved;/);
  });
});

describe('interior pose: Left / Right lengthwise storage (down the main room)', () => {
  it('Left 12 ft on 30x40: main room x -3..15, from the front looking down its length', () => {
    const s = build({ width: 30, length: 40 }, { mode: 'left', lengthFt: 12 });
    const p = interiorPose(s);
    expect(p.room.kind).toBe('sideStorage');
    expect([p.room.x0, p.room.x1]).toEqual([-3, 15]);
    expect(p.pos[0]).toBeCloseTo(6, 9);
    expect(p.pos[2]).toBeCloseTo(-20 + INTERIOR.standOffFt, 9);
    expect(p.yaw).toBeCloseTo(0, 9);
    expect(insideBox(p.pos, s)).toBe(true);
  });
  it('Right 10 ft on 30x40: main room x -15..5', () => {
    const s = build({ width: 30, length: 40 }, { mode: 'right', lengthFt: 10 });
    const p = interiorPose(s);
    expect([p.room.x0, p.room.x1]).toEqual([-15, 5]);
    expect(p.pos[0]).toBeCloseTo(-5, 9);
  });
});

describe('interior pose: plain / carport / widespan / GCH / single-slope', () => {
  it('plain 24x30x10: just inside the front gable, centred, looking down the length', () => {
    const s = build({ width: 24, length: 30, legHeight: 10 });
    const p = interiorPose(s);
    expect(p.room.kind).toBe('plain');
    expect(p.pos).toEqual([0, 5.5, -15 + INTERIOR.standOffFt]);
    expect(p.yaw).toBe(0);
  });
  it('carport 20x30x6: eye height drops to eave - 1 (5 ft)', () => {
    const s = build({ buildingType: 'carport', width: 20, length: 30, legHeight: 6 });
    const p = interiorPose(s);
    expect(p.pos[1]).toBeCloseTo(5, 9);
    expect(insideBox(p.pos, s)).toBe(true);
  });
  it('widespan 50x60x14', () => {
    const s = build({ width: 50, length: 60, legHeight: 14 });
    const p = interiorPose(s);
    expect(p.pos).toEqual([0, 5.5, -30 + INTERIOR.standOffFt]);
    expect(insideBox(p.pos, s)).toBe(true);
  });
  it('GCH open at the front: in the enclosed garage at the back, the divider framed like the outside views', () => {
    const s = build({ buildingType: 'utility', width: 30, length: 50, enclosedLengthFt: 30, openEnd: 'front' });
    const p = interiorPose(s, 1.6);
    expect(p.room.kind).toBe('gch');
    expect([p.room.z0, p.room.z1]).toEqual([-5, 25]);
    expect(s.enclosure.partitionZ).toBeCloseTo(-5, 9);
    expect(p.pos[2]).toBeCloseTo(-5 + fitDistance(30, crossWallHeight(s, -15, 15), INTERIOR.frameFovDeg, 1.6), 9);
    expect(lookDir(p.yaw, p.pitch)[2]).toBeLessThan(0);
    expect(insideBox(p.pos, s)).toBe(true); // a 30' bay frames it from inside
    expect(Math.max(frameFill(s, 1.6).x, frameFill(s, 1.6).y)).toBeCloseTo(1 / FIT_MARGIN, 9);
  });
  it('GCH open at the back: enclosed at the front, looking back at the divider (framed)', () => {
    const s = build({ buildingType: 'utility', width: 30, length: 50, enclosedLengthFt: 20, openEnd: 'back' });
    const p = interiorPose(s, 1.6);
    expect([p.room.z0, p.room.z1]).toEqual([-25, -5]);
    expect(p.pos[2]).toBeCloseTo(-5 - fitDistance(30, crossWallHeight(s, -15, 15), INTERIOR.frameFovDeg, 1.6), 9);
    expect(p.yaw).toBe(0);
    expect(Math.max(frameFill(s, 1.6).x, frameFill(s, 1.6).y)).toBeCloseTo(1 / FIT_MARGIN, 9);
  });
  it('GCH fully enclosed (no divider) is posed like a plain garage', () => {
    const s = build({ buildingType: 'utility', width: 24, length: 30, enclosedLengthFt: 30 });
    expect(interiorRoom(s).kind).toBe('plain');
  });
  it('single-slope: the roof line falls from the tall (-X) eave to the low one', () => {
    const s = build({ width: 20, length: 30, legHeight: 12, monoDropFt: 3 });
    expect(roofLineAt(s, -10)).toBeCloseTo(12, 9);
    expect(roofLineAt(s, 10)).toBeCloseTo(9, 9);
    expect(ceilingAt(s, 10)).toBeCloseTo(8, 9);
    expect(interiorPose(s).pos[1]).toBeCloseTo(5.5, 9);
  });
  it('gable roof line: peak at the ridge, eave at the walls', () => {
    const s = build({ width: 24, length: 30, legHeight: 10 });
    expect(roofLineAt(s, 0)).toBeCloseTo(s.peakHeight, 9);
    expect(roofLineAt(s, 12)).toBeCloseTo(10, 9);
    expect(roofLineAt(s, -12)).toBeCloseTo(10, 9);
  });
  it('eye height: 5.5 ft, never above eave - 1, never below the floor margin', () => {
    expect(eyeHeight(12)).toBe(5.5);
    expect(eyeHeight(6)).toBe(5);
    expect(eyeHeight(2.5)).toBe(INTERIOR.floorMarginFt);
  });
});

describe('the camera can never leave the room', () => {
  const s = build({}, { mode: 'endBack', lengthFt: 30 });
  const room = interiorRoom(s);
  it('clamps to walls - 1 ft, floor + 2 ft and under the roof', () => {
    const hi = clampToInterior([100, 50, 100], room, s);
    expect(hi[0]).toBe(12);
    expect(hi[2]).toBe(-6);
    expect(hi[1]).toBeCloseTo(roofLineAt(s, 12) - 1, 9); // 12.25 - 1 under the sloped roof
    expect(hi[1]).toBeCloseTo(11.25, 9);
    expect(clampToInterior([-100, -50, -100], room, s)).toEqual([-12, 2, -24]);
    const inside: Vec3 = [1, 5.5, -10];
    expect(clampToInterior(inside, room, s)).toEqual(inside);
  });
  it('never into the storage room: the partition is a wall too', () => {
    expect(clampToInterior([0, 5.5, 20], room, s)[2]).toBe(-6);
  });
  it('a long random walk (keys + turns) stays inside every step', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let p = interiorPose(s).pos;
    let yaw = 0;
    for (let i = 0; i < 2000; i++) {
      yaw += (rnd() - 0.5) * 2;
      p = clampToInterior(walk(p, yaw, (rnd() - 0.3) * 6, (rnd() - 0.5) * 6), room, s);
      expect(insideBox(p, s)).toBe(true);
    }
  });
  it('a room narrower than 2 ft collapses the box to its middle (never inverted)', () => {
    const t = build({ width: 12, length: 20, legHeight: 8 }, { mode: 'left', lengthFt: 11 });
    const r = interiorRoom(t);
    expect(r.box.x0).toBe(r.box.x1);
    expect(r.box.x0).toBeCloseTo((r.x0 + r.x1) / 2, 9);
    expect(clampToInterior([-50, 5, 0], r, t)[0]).toBeCloseTo(r.box.x0, 9);
  });
});

describe('look / zoom / walk math', () => {
  it('scroll zoom changes only the FOV, clamped 30-85 deg (20 scroll-outs = 85)', () => {
    let f: number = INTERIOR.fovDeg;
    for (let i = 0; i < 20; i++) f = zoomFov(f, 100);
    expect(f).toBe(85);
    for (let i = 0; i < 100; i++) f = zoomFov(f, -100);
    expect(f).toBe(30);
    expect(zoomFov(70, 100)).toBeGreaterThan(70);
    expect(zoomFov(70, -100)).toBeLessThan(70);
    expect(zoomFov(70, 1e9)).toBeLessThanOrEqual(85);
  });
  it('drag = grab the scene: drag right turns the head left (+yaw), drag down looks up; pitch capped at 85 deg', () => {
    const r = dragLook(0, 0, 100, 50, 0.01);
    expect(r.yaw).toBeCloseTo(1, 9);
    expect(r.pitch).toBeCloseTo(0.5, 9);
    expect(deg(dragLook(0, 0, 0, 1e6, 0.01).pitch)).toBeCloseTo(85, 9);
    expect(deg(dragLook(0, 0, 0, -1e6, 0.01).pitch)).toBeCloseTo(-85, 9);
    // +yaw from +Z swings the view toward +X, which is the camera's LEFT when looking +Z
    expect(lookDir(r.yaw, 0)[0]).toBeGreaterThan(0);
  });
  it('walk: forward along the yaw, right = the camera right (looking +Z, right is -X)', () => {
    expect(walk([0, 5, 0], 0, 2, 0)).toEqual([0, 5, 2]);
    const w = walk([0, 5, 0], 0, 0, 3);
    expect(w[0]).toBeCloseTo(-3, 9);
    expect(w[2]).toBeCloseTo(0, 9);
    expect(w[1]).toBe(5);
  });
  it('lookDir / yawPitchOf round trip', () => {
    for (const [y, p] of [[0.3, 0.2], [-2.5, -0.7], [3, 1.2]]) {
      const r = yawPitchOf(lookDir(y, p));
      expect(r.yaw).toBeCloseTo(y, 9);
      expect(r.pitch).toBeCloseTo(p, 9);
    }
  });
  it('re-pose key: changes with the size or partition, not with colors', () => {
    const a = build({}, { mode: 'endBack', lengthFt: 30 });
    expect(interiorKey(build({ colors: { ...DEFAULT_CONFIG.colors, walls: 'WXA0090L' } }, { mode: 'endBack', lengthFt: 30 }))).toBe(interiorKey(a));
    expect(interiorKey(build({}, { mode: 'endBack', lengthFt: 10 }))).not.toBe(interiorKey(a));
    expect(interiorKey(build({ length: 60 }, { mode: 'endBack', lengthFt: 30 }))).not.toBe(interiorKey(a));
    expect(interiorKey(build({ legHeight: 14 }, { mode: 'endBack', lengthFt: 30 }))).not.toBe(interiorKey(a));
  });
});

describe('editor store: entering / leaving Interior', () => {
  beforeEach(() => useEditorStore.setState({ interiorView: false, renderStyle: 'enhanced', viewMode: 'exterior' }));
  it('the Interior preset turns it on; any other preset turns it off', () => {
    const E = useEditorStore.getState();
    E.goToView('interior');
    expect(useEditorStore.getState().interiorView).toBe(true);
    for (const v of ['iso', 'front', 'back', 'left', 'right', 'top', 'structure'] as const) {
      useEditorStore.getState().goToView('interior');
      useEditorStore.getState().goToView(v);
      expect(useEditorStore.getState().interiorView).toBe(false);
    }
  });
  it('a Look switch leaves Interior; re-picking the same Look does not', () => {
    useEditorStore.getState().goToView('interior');
    useEditorStore.getState().setRenderStyle('enhanced');
    expect(useEditorStore.getState().interiorView).toBe(true);
    useEditorStore.getState().setRenderStyle('classic');
    expect(useEditorStore.getState().interiorView).toBe(false);
  });
  it('Structure mode (fires its framing) leaves Interior; Cutaway / Exterior keep it', () => {
    useEditorStore.getState().goToView('interior');
    useEditorStore.getState().setViewMode('cutaway');
    expect(useEditorStore.getState().interiorView).toBe(true);
    useEditorStore.getState().setViewMode('exterior');
    expect(useEditorStore.getState().interiorView).toBe(true);
    useEditorStore.getState().setViewMode('structure');
    expect(useEditorStore.getState().interiorView).toBe(false);
  });
  it('subscribers see the change synchronously inside the update (the orbit view is restored before React renders)', () => {
    const seen: boolean[] = [];
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.interiorView !== prev.interiorView) seen.push(s.interiorView);
    });
    useEditorStore.getState().goToView('interior');
    expect(seen).toEqual([true]);
    useEditorStore.getState().setRenderStyle('classic');
    expect(seen).toEqual([true, false]);
    unsub();
  });
});

// Owner 10/3/26: "I added a roll up door & walk through door to the partition
// wall inside the building & cant click & move the walk door or roll up door".
// Inside, a press ON a part now drags it exactly like outside (Openings /
// LeanToSiding onDown: select, setDragging, raycast, clamp, write-back); the
// look-around (InteriorWalk) only takes a press that no part took.
describe('Interior pointer routing: a press on a part drags it, a press beside one looks around', () => {
  const src = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  const base = { inside: true, active: false, partDragging: false, pointerType: 'mouse', button: 0 };
  it('look-around starts on a primary-button press on empty space inside (mouse, touch, pen)', () => {
    expect(lookPressStarts(base)).toBe(true);
    expect(lookPressStarts({ ...base, pointerType: 'touch', button: 0 })).toBe(true);
    expect(lookPressStarts({ ...base, pointerType: 'pen', button: 0 })).toBe(true);
  });
  it('never under a press a part already took (its handler set dragging first)', () => {
    expect(lookPressStarts({ ...base, partDragging: true })).toBe(false);
    // The editor store flips dragging synchronously on the part's press, so the
    // canvas listener that runs right after it sees it.
    useEditorStore.getState().setDragging(true);
    expect(lookPressStarts({ ...base, partDragging: useEditorStore.getState().dragging })).toBe(false);
    useEditorStore.getState().setDragging(false);
    expect(lookPressStarts({ ...base, partDragging: useEditorStore.getState().dragging })).toBe(true);
  });
  it('not outside Interior, not for a second pointer, not for the right / middle mouse button', () => {
    expect(lookPressStarts({ ...base, inside: false })).toBe(false);
    expect(lookPressStarts({ ...base, active: true })).toBe(false);
    expect(lookPressStarts({ ...base, button: 2 })).toBe(false);
    expect(lookPressStarts({ ...base, button: 1 })).toBe(false);
  });
  it('Openings / LeanToSiding take a press only through partTakesPress (no Interior-only gate); InteriorWalk routes its press through lookPressStarts', () => {
    for (const [f, room, span] of [
      ['../Openings.tsx', 'structure', 'openingSpan(opening, structure)'],
      ['../LeanToSiding.tsx', 'building', 'leanToOpeningSpan(geo, opening)'],
    ]) {
      const code = src(f);
      expect(code).not.toMatch(/interiorPress/);
      // The routing rule runs first; a press not taken returns before anything
      // (no stopPropagation, no select, no dragging) so the look-around gets it.
      const gate = `if (!partTakesPress({ inside: useEditorStore.getState().interiorView, room: interiorRoom(${room}), span: ${span}, cut: useEditorStore.getState().interiorCut })) return;`;
      expect(code).toContain(gate);
      expect(code.slice(code.indexOf(gate) + gate.length)).toMatch(/^\s*e\.stopPropagation\(\);[\s\S]{0,600}?setDragging\(true\);/);
    }
    expect(existsSync(fileURLToPath(new URL('../interiorPress.ts', import.meta.url)))).toBe(false);
    const walk = src('../InteriorWalk.tsx');
    expect(walk).toMatch(
      /if \(!lookPressStarts\(\{ inside: !!walkRef\.current, active: !!drag, partDragging: useEditorStore\.getState\(\)\.dragging, pointerType: e\.pointerType, button: e\.button \}\)\) return;/,
    );
    // The look-around's move handler still yields to a part drag, and the orbit
    // controls stay off inside after the part's release re-enables them.
    expect(walk).toMatch(/if \(!w \|\| useEditorStore\.getState\(\)\.dragging\) return;/);
    expect(walk).toMatch(/if \(controls && controls\.enabled\) controls\.enabled = false;/);
  });
  it('the Viewport hint says so', () => {
    expect(src('../../components/Viewport.tsx')).toMatch(/Drag a door to move it · drag elsewhere to look around/);
  });
});

// Verifier 10/3/26 (branch partition-drag, gate run): inside, a press on
// visually EMPTY partition wall where an out-of-sight part projects grabbed
// that part and rewrote its program position — the back gable's 8x8 roll-up at
// 21' (in the storage room behind the partition) and the Right Eave window at
// 40.75' (also in the storage room). R3F raycasts interactive objects only, so
// the walls never block a press. Inside, only a part on the walls of the room
// you stand in takes a press; every other press looks around.
describe("Interior press routing: only a part on the room's own walls takes a press", () => {
  const op = (side: Opening['side'], offset: number, width = 10, height = 10, sillHeight = 0): Opening => ({
    id: `${side}-${offset}`,
    type: 'rollUpDoor',
    side,
    offset,
    width,
    height,
    sillHeight,
  });
  const takes = (s: StructureModel, o: Opening, inside = true) => partTakesPress({ inside, room: interiorRoom(s), span: openingSpan(o, s) });

  describe('End Storage 30 ft at the back of 26x50x12 (main room x -13..13, z -25..-5)', () => {
    const s = build({}, { mode: 'endBack', lengthFt: 30 });
    it("the partition doors take a press (the owner's 10x10 roll-up at 13 and the walk door)", () => {
      expect(takes(s, op('partition', 13))).toBe(true);
      expect(takes(s, op('partition', 7.5, 3, 6.67))).toBe(true);
      expect(takes(s, op('partition', 1.5, 3, 6.67))).toBe(true); // at the corner
    });
    it('so do the front gable behind you and the eave walls of the main room', () => {
      expect(takes(s, op('front', 8))).toBe(true);
      expect(takes(s, op('front', 21, 8, 8))).toBe(true);
      expect(takes(s, op('left', 10, 2.5, 1.25, 4))).toBe(true);
      expect(takes(s, op('right', 6.5, 3, 6.67))).toBe(true);
    });
    it("the back gable is the storage room's wall: the verifier's hidden 8x8 roll-up at 21 does not", () => {
      expect(takes(s, op('back', 21, 8, 8))).toBe(false);
      expect(takes(s, op('back', 4, 8, 8))).toBe(false); // at the back gable's corner, 1' from the eave line
    });
    it("an eave part past the partition is in the storage room: the verifier's Right Eave window at 40.75 does not", () => {
      expect(takes(s, op('right', 40.75, 2.5, 1.25, 4))).toBe(false);
      expect(takes(s, op('left', 30, 3, 6.67))).toBe(false);
      expect(takes(s, op('left', 48.75, 2.5, 1.25, 4))).toBe(false);
    });
    it('a part straddling the partition line takes a press once at least 1 ft of it is in the main room', () => {
      // Left Eave, 3 ft wide, centre z = -25 + offset: 20 -> span -6.5..-3.5 (1.5 ft in); 21 -> -5.5..-2.5 (0.5 ft in)
      expect(takes(s, op('left', 20, 3, 6.67))).toBe(true);
      expect(takes(s, op('left', 21, 3, 6.67))).toBe(false);
    });
    it("outside the Interior every part takes a press (today's behaviour, unchanged)", () => {
      expect(takes(s, op('back', 21, 8, 8), false)).toBe(true);
      expect(takes(s, op('right', 40.75, 2.5, 1.25, 4), false)).toBe(true);
      expect(takes(s, op('partition', 13), false)).toBe(true);
    });
    it('the storage at the FRONT (room z -5..25): the partition and back gable take a press, the front gable does not', () => {
      const f = build({}, { mode: 'end', lengthFt: 20 });
      expect(takes(f, op('partition', 13))).toBe(true);
      expect(takes(f, op('back', 21, 8, 8))).toBe(true);
      expect(takes(f, op('front', 8))).toBe(false);
      expect(takes(f, op('right', 40.75, 2.5, 1.25, 4))).toBe(true);
      expect(takes(f, op('right', 6.5, 3, 6.67))).toBe(false);
    });
  });

  describe('GCH 28x40x14, 20 ft enclosed at the back (room z 0..20): the divider, the back gable and the enclosed bay', () => {
    const s = build({ buildingType: 'utility', width: 28, length: 40, legHeight: 14, enclosedLengthFt: 20, openEnd: 'front' });
    it('divider + back gable + eave parts in the enclosed bay take a press', () => {
      expect(interiorRoom(s).kind).toBe('gch');
      expect(takes(s, op('partition', 14))).toBe(true);
      expect(takes(s, op('back', 10, 8, 8))).toBe(true);
      expect(takes(s, op('left', 30, 3, 6.67))).toBe(true);
    });
    it('eave parts in the open bay and the (open) front gable line do not', () => {
      expect(takes(s, op('left', 5, 3, 6.67))).toBe(false);
      expect(takes(s, op('right', 10, 2.5, 1.25, 4))).toBe(false);
      expect(takes(s, op('front', 8))).toBe(false);
    });
  });

  describe('Left lengthwise storage 12 ft on 30x40 (room x -3..15)', () => {
    const s = build({ width: 30, length: 40 }, { mode: 'left', lengthFt: 12 });
    it("the right eave wall and the main room's stretch of the gables take a press; the storage's left eave wall does not", () => {
      expect(takes(s, op('right', 10, 3, 6.67))).toBe(true);
      expect(takes(s, op('left', 10, 3, 6.67))).toBe(false);
      expect(takes(s, op('front', 20))).toBe(true); // x -5..5
      expect(takes(s, op('front', 6))).toBe(false); // x -14..-4, all on the storage side of x = -3
      expect(takes(s, op('front', 9))).toBe(true); // x -11..-1: 2 ft in the room
      expect(takes(s, op('back', 20))).toBe(true);
    });
  });

  it('a plain garage: every part is on the room (the whole footprint)', () => {
    const s = build();
    for (const o of [op('front', 8), op('back', 21, 8, 8), op('left', 48.75, 2.5, 1.25, 4), op('right', 6.5, 3, 6.67)]) expect(takes(s, o)).toBe(true);
  });

  describe('lean-to parts are never on the main room (a lean-to wall is outside it), so inside they never take a press', () => {
    const lt = (o: Partial<LeanTo> = {}): LeanTo => ({ id: 'lt1', type: 'attached', attachedSide: 'Left Eave', widthFt: 12, lengthFt: 50, lowLegHeightFt: 10, roofPitch: '2:12', enclosure: 'enclosed', openings: [], ...o });
    const lo = (wall: LeanToOpening['wall'], offsetFt: number, widthFt = 6, heightFt = 6, sillFt = 0): LeanToOpening => ({ id: `lt-${wall}-${offsetFt}`, type: 'rollUpDoor', wall, widthFt, heightFt, sillFt, offsetFt });
    it('Left Eave lean-to on the End Storage building: outer wall, both end walls (on the gable lines, past the eave) and its storage partition', () => {
      const s = build({ leanTos: [lt({ enclosure: 'custom', customWalls: { side: '2panel', front: 'closed', back: 'closed' }, storage: { end: 'back', lengthFt: 10 } })] }, { mode: 'endBack', lengthFt: 30 });
      const L = s.leanTos[0];
      const geo = eaveSurfaces(L, s.roofOverhangFt, resolveWalls(L));
      const room = interiorRoom(s);
      for (const o of [lo('outer', 6), lo('outer', 20), lo('front', 6), lo('back', 6), lo('partition', 6)]) {
        const span = leanToOpeningSpan(geo, o);
        expect(spanOnRoomWalls(room, span[0], span[1])).toBe(false);
        expect(partTakesPress({ inside: true, room, span })).toBe(false);
        expect(partTakesPress({ inside: false, room, span })).toBe(true);
      }
      // its front end wall IS on the room's front line (z = -25) — the span lies past the eave (x beyond 13), so no overlap
      const fr = leanToOpeningSpan(geo, lo('front', 6));
      expect(Math.abs(fr[0][2] - room.z0)).toBeLessThan(INTERIOR.wallLineTolFt);
      expect(Math.min(Math.abs(fr[0][0]), Math.abs(fr[1][0]))).toBeGreaterThanOrEqual(13 - 1e-9);
    });
    it('Front Gable lean-to on a plain 30x40: outer wall and both end walls', () => {
      const s = build({ width: 30, length: 40, leanTos: [lt({ attachedSide: 'Front Gable', lengthFt: 30, widthFt: 10 })] });
      const L = s.leanTos[0];
      const geo = gableSurfaces(L, s.roofOverhangFt, resolveWalls(L));
      const room = interiorRoom(s);
      for (const o of [lo('outer', 6), lo('front', 3, 3, 6.67), lo('back', 3, 3, 6.67)]) expect(partTakesPress({ inside: true, room, span: leanToOpeningSpan(geo, o) })).toBe(false);
    });
  });

  it('spanOnRoomWalls: parallel to a line within 1 ft, overlapping its extent by 1 ft or more; never a perpendicular span', () => {
    const room = { x0: -13, x1: 13, z0: -25, z1: -5 };
    expect(spanOnRoomWalls(room, [-8, 5, -5.34], [2, 5, -5.34])).toBe(true); // on the partition line (fixture proud of it)
    expect(spanOnRoomWalls(room, [-8, 5, -6.5], [2, 5, -6.5])).toBe(false); // 1.5 ft off the line
    expect(spanOnRoomWalls(room, [13.34, 5, -20], [13.34, 5, -17])).toBe(true); // right eave, in the room
    expect(spanOnRoomWalls(room, [13.34, 5, -4.5], [13.34, 5, -1.5])).toBe(false); // right eave, past the partition (0.5 ft in)
    expect(spanOnRoomWalls(room, [13.34, 5, -6], [13.34, 5, -3])).toBe(true); // exactly 1 ft in
    expect(spanOnRoomWalls(room, [-13, 5, -25.3], [-11, 5, -25.3])).toBe(true); // front gable corner part, 2 ft wide
    expect(spanOnRoomWalls(room, [-12.5, 5, 25.3], [-12.9, 5, 25.3])).toBe(false); // on the back gable, hugging the eave line: perpendicular, never
    expect(spanOnRoomWalls(room, [-21, 5, -25.2], [-15, 5, -25.2])).toBe(false); // lean-to end wall on the front line, past the eave
    expect(spanOnRoomWalls(room, [-14, 5, -25.2], [-12, 5, -25.2])).toBe(true); // 1 ft of it inside the room's line
  });
});

// The section view (owner 10/24/26 framing): the main room's end wall behind
// the eye is clipped away, but R3F still raycasts its parts — a press where
// a hidden front-gable door projects must not grab it (it would rewrite its
// program position). Only parts wholly on the cut side are skipped.
describe('Interior press routing in the section view: parts the cut clipped away never take a press', () => {
  const s = build({ width: 30, length: 80, legHeight: 18 }, { mode: 'endBack', lengthFt: 68 });
  const p = interiorPose(s, 1.6);
  const cut = sectionCut(p.room, p.pos)!;
  const room = interiorRoom(s);
  const op = (side: Opening['side'], offset: number, width = 10, height = 10, sillHeight = 0): Opening => ({ id: `${side}-${offset}`, type: 'rollUpDoor', side, offset, width, height, sillHeight });
  const takes = (o: Opening, c: typeof cut | null = cut) => partTakesPress({ inside: true, room, span: openingSpan(o, s), cut: c });
  it('the cut is on (the eye stands past the 12 ft room)', () => {
    expect(cut).toEqual({ z: -39, keep: 1 });
  });
  it('the front gable (clipped) does not; the partition and the main-room eave walls do', () => {
    expect(takes(op('front', 15))).toBe(false);
    expect(takes(op('front', 15), null)).toBe(true); // no cut (walked in): as before
    expect(takes(op('partition', 15, 6, 6))).toBe(true);
    expect(takes(op('left', 6, 10, 8))).toBe(true); // 1..11 ft from the front: mostly past the cut
    expect(takes(op('right', 0.5, 0.8, 3))).toBe(false); // wholly within the cut-away first foot
  });
  it('spanCutAway: only a span wholly on the clipped side', () => {
    expect(spanCutAway(null, [[0, 1, -45], [1, 1, -45]])).toBe(false);
    expect(spanCutAway(cut, [[0, 1, -45], [1, 1, -45]])).toBe(true);
    expect(spanCutAway(cut, [[0, 1, -40], [0, 1, -30]])).toBe(false); // straddles: part of it is drawn
    expect(spanCutAway({ z: 39, keep: -1 }, [[0, 1, 45], [1, 1, 45]])).toBe(true);
    expect(spanCutAway({ z: 39, keep: -1 }, [[0, 1, 30], [1, 1, 30]])).toBe(false);
  });
  it('outside the walk-in view the cut is never consulted', () => {
    expect(partTakesPress({ inside: false, room, span: openingSpan(op('front', 15), s), cut })).toBe(true);
  });
  it('the editor store carries the cut (null by default)', () => {
    useEditorStore.setState({ interiorCut: null });
    expect(useEditorStore.getState().interiorCut).toBeNull();
    useEditorStore.getState().setInteriorCut(cut);
    expect(useEditorStore.getState().interiorCut).toEqual(cut);
    useEditorStore.getState().setInteriorCut(null);
    expect(useEditorStore.getState().interiorCut).toBeNull();
  });
});
