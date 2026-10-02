import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import { useEditorStore } from '@/store/useEditorStore';
import type { BuildingConfig, StorageMode } from '@/types/building';
import {
  INTERIOR,
  ceilingAt,
  clampToInterior,
  dragLook,
  eyeHeight,
  interiorKey,
  interiorPose,
  interiorRoom,
  lookDir,
  roofLineAt,
  walk,
  yawPitchOf,
  zoomFov,
  type Vec3,
} from '../interiorView';
import { interiorPress } from '../interiorPress';

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

describe('interior pose: End Storage (look at the partition)', () => {
  // The owner's case: 26x50x12, End Storage 30' from the back -> 20' main room at the front.
  const s = build({}, { mode: 'endBack', lengthFt: 30 });
  const p = interiorPose(s);
  it('main room is the front 20 ft (partition at z = -5)', () => {
    expect(s.enclosure.partitionZ).toBeCloseTo(-5, 9);
    expect(p.room.kind).toBe('endStorage');
    expect([p.room.z0, p.room.z1]).toEqual([-25, -5]);
    expect([p.room.x0, p.room.x1]).toEqual([-13, 13]);
  });
  it('stands at eye height just inside the front gable, centred, looking back at the partition', () => {
    expect(p.pos[0]).toBeCloseTo(0, 9);
    expect(p.pos[1]).toBeCloseTo(5.5, 9);
    expect(p.pos[2]).toBeCloseTo(-25 + INTERIOR.standOffFt, 9);
    expect(p.yaw).toBeCloseTo(0, 9); // +Z
    expect(p.fov).toBe(70);
    expect(insideBox(p.pos, s)).toBe(true);
  });
  it('aims at the middle of the partition: a gentle upward tilt', () => {
    const aimY = roofLineAt(s, 0) / 2; // 15.25 / 2
    expect(Math.tan(p.pitch) * (-5 - p.pos[2])).toBeCloseTo(aimY - 5.5, 9);
    expect(deg(p.pitch)).toBeGreaterThan(0);
    expect(deg(p.pitch)).toBeLessThan(10);
  });
  it('the whole 26 ft partition, floor to peak, fits the 70 deg frame (16:10 pane)', () => {
    const d = -5 - p.pos[2];
    const vHalf = (INTERIOR.fovDeg * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * 1.6);
    expect(Math.atan2(13, d)).toBeLessThan(hHalf);
    expect(Math.atan2(roofLineAt(s, 0) - p.pos[1], d) - p.pitch).toBeLessThan(vHalf);
    expect(Math.atan2(p.pos[1], d) + p.pitch).toBeLessThan(vHalf);
  });
  it('a short main room (26x40, 32 ft storage -> 8 ft room): the partition foot stays in frame, tilt within -8..10 deg', () => {
    const t = build({ length: 40 }, { mode: 'endBack', lengthFt: 32 });
    const q = interiorPose(t);
    expect([q.room.z0, q.room.z1]).toEqual([-20, -12]);
    const d = -12 - q.pos[2];
    const vHalf = (INTERIOR.fovDeg * Math.PI) / 360;
    expect(q.pos[1] - d * Math.tan(vHalf - q.pitch)).toBeLessThanOrEqual(0); // floor line of the far wall visible
    expect(deg(q.pitch)).toBeGreaterThanOrEqual(-8);
    expect(deg(q.pitch)).toBeLessThanOrEqual(10);
    expect(insideBox(q.pos, t)).toBe(true);
  });
  it('arrival tilt never exceeds +10 deg or drops below -8 deg (every test building)', () => {
    for (const t of [build(), build({ width: 50, length: 60, legHeight: 16 }), build({ length: 12 }, { mode: 'endBack', lengthFt: 10 })]) {
      const q = interiorPose(t);
      expect(deg(q.pitch)).toBeLessThanOrEqual(10 + 1e-9);
      expect(deg(q.pitch)).toBeGreaterThanOrEqual(-8 - 1e-9);
    }
  });
  it('storage at the FRONT: stand at the back gable, look forward (-Z)', () => {
    const f = build({}, { mode: 'end', lengthFt: 20 });
    const q = interiorPose(f);
    expect(f.enclosure.partitionZ).toBeCloseTo(-5, 9);
    expect([q.room.z0, q.room.z1]).toEqual([-5, 25]);
    expect(q.pos[2]).toBeCloseTo(25 - INTERIOR.standOffFt, 9);
    expect(Math.abs(q.yaw)).toBeCloseTo(Math.PI, 9);
    expect(lookDir(q.yaw, q.pitch)[2]).toBeLessThan(0);
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
  it('GCH open at the front: in the enclosed garage at the back, looking forward at the divider', () => {
    const s = build({ buildingType: 'utility', width: 30, length: 50, enclosedLengthFt: 30, openEnd: 'front' });
    const p = interiorPose(s);
    expect(p.room.kind).toBe('gch');
    expect([p.room.z0, p.room.z1]).toEqual([-5, 25]);
    expect(s.enclosure.partitionZ).toBeCloseTo(-5, 9);
    expect(p.pos[2]).toBeCloseTo(25 - INTERIOR.standOffFt, 9);
    expect(lookDir(p.yaw, p.pitch)[2]).toBeLessThan(0);
  });
  it('GCH open at the back: enclosed at the front, looking back at the divider', () => {
    const s = build({ buildingType: 'utility', width: 30, length: 50, enclosedLengthFt: 20, openEnd: 'back' });
    const p = interiorPose(s);
    expect([p.room.z0, p.room.z1]).toEqual([-25, -5]);
    expect(p.pos[2]).toBeCloseTo(-25 + INTERIOR.standOffFt, 9);
    expect(p.yaw).toBe(0);
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

describe('a press on a door / window inside never slides it', () => {
  const g = globalThis as unknown as { window?: EventTarget };
  let had: EventTarget | undefined;
  beforeEach(() => {
    had = g.window;
    g.window = new EventTarget();
  });
  afterEach(() => {
    g.window = had;
    useEditorStore.setState({ interiorView: false });
  });
  const ev = (type: string, x: number, y: number) => Object.assign(new Event(type), { clientX: x, clientY: y }) as unknown as PointerEvent;
  it('outside Interior: not handled (the normal drag / click code runs)', () => {
    let clicks = 0;
    expect(interiorPress(ev('pointerdown', 0, 0), () => clicks++)).toBe(false);
    g.window!.dispatchEvent(ev('pointerup', 0, 0));
    expect(clicks).toBe(0);
  });
  it('inside: a click still opens / selects; a drag does nothing to the part', () => {
    useEditorStore.setState({ interiorView: true });
    let clicks = 0;
    expect(interiorPress(ev('pointerdown', 10, 10), () => clicks++)).toBe(true);
    g.window!.dispatchEvent(ev('pointermove', 12, 11));
    g.window!.dispatchEvent(ev('pointerup', 12, 11));
    expect(clicks).toBe(1);
    expect(interiorPress(ev('pointerdown', 10, 10), () => clicks++)).toBe(true);
    g.window!.dispatchEvent(ev('pointermove', 60, 10));
    g.window!.dispatchEvent(ev('pointermove', 12, 10));
    g.window!.dispatchEvent(ev('pointerup', 12, 10));
    expect(clicks).toBe(1);
  });
});
