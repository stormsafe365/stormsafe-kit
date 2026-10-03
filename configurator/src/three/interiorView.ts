import type { StructureModel } from '@/engine/geometry';

/**
 * Walk-in INTERIOR camera mode — pure math (no three.js, no React), so the
 * pose, the room box and the clamping are unit-testable. InteriorWalk.tsx
 * drives the live camera with it.
 *
 * World convention (geometry.ts): X = width (-W/2..W/2), Y = up (0 = slab),
 * Z = length (-L/2..L/2, front gable at -L/2). 1 unit = 1 ft.
 *
 * Look direction from yaw / pitch (radians):
 *   dir = (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))
 * so yaw 0 looks down +Z (toward the back gable), yaw π toward the front.
 */
export const INTERIOR = {
  /** Standing eye height (ft) — never above eave − 1'. */
  eyeFt: 5.5,
  /** The camera stays at least this far in from every wall line (ft). */
  wallMarginFt: 1,
  /** ...and at least this far above the slab (ft). */
  floorMarginFt: 2,
  /** ...and at least this far below the roof line (rafter / roof underside) (ft). */
  roofMarginFt: 1,
  /** Arrival: this far in from the end wall behind you (ft). */
  standOffFt: 1.5,
  /** Arrival vertical FOV (deg): wide enough that a whole end wall fits. */
  fovDeg: 70,
  /** Scroll-zoom FOV range (deg). */
  fovMinDeg: 30,
  fovMaxDeg: 85,
  /** Near plane while inside (ft) — nothing within reach clips. */
  nearFt: 0.1,
  /** Look up / down limit (rad, ±85°). */
  pitchMax: (85 * Math.PI) / 180,
  /** Arrival tilt range (rad, -8°..+10°). */
  arrivePitchMin: (-8 * Math.PI) / 180,
  arrivePitchMax: (10 * Math.PI) / 180,
  /** Keyboard walk speed (ft/s) and turn speed (rad/s). */
  walkFtPerS: 8,
  turnRadPerS: Math.PI / 2,
} as const;

export type Vec3 = [number, number, number];

/** The room the camera walks in, and the box it can never leave. */
export interface InteriorRoom {
  /** Which kind of building / room drove the pose (for tests + the hint). */
  kind: 'plain' | 'endStorage' | 'sideStorage' | 'gch';
  /** Room bounds on the floor plan (wall / partition framing lines). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Clamp box: the room shrunk by INTERIOR.wallMarginFt (collapsed to the middle if the room is narrower). */
  box: { x0: number; x1: number; z0: number; z1: number; yMin: number };
  /** Eave height (ft) — the LOW eave for a single-slope. */
  eaveFt: number;
  /** Arrival: stand at the z0 end looking +Z (dirZ 1) or at the z1 end looking −Z (dirZ −1). */
  dirZ: 1 | -1;
}

/** Roof line (rafter / roof underside) height at plan X — gable peak at 0, single-slope tall at −X. */
export function roofLineAt(s: Pick<StructureModel, 'width' | 'peakHeight' | 'rise' | 'monoDropFt'>, x: number): number {
  const halfW = s.width / 2;
  if (!(halfW > 0)) return s.peakHeight;
  const cx = Math.max(-halfW, Math.min(halfW, x));
  if ((s.monoDropFt ?? 0) > 0.01) return s.peakHeight - s.rise * ((cx + halfW) / s.width);
  return s.peakHeight - Math.abs(cx) * (s.rise / halfW);
}

/** Shrink [lo, hi] by m on both sides; a span narrower than 2m collapses to its middle. */
function inset(lo: number, hi: number, m: number): [number, number] {
  const a = lo + m;
  const b = hi - m;
  if (a <= b) return [a, b];
  const mid = (lo + hi) / 2;
  return [mid, mid];
}

/**
 * The MAIN room of the building (the part left after any storage partition)
 * and which way the arrival pose looks:
 *  - End Storage: the room between the partition and the opposite gable,
 *    looking at the partition (so its doors read).
 *  - Left / Right lengthwise storage: the room beside the partition, looking
 *    down its length from the front.
 *  - GCH (utility with a divider): the enclosed garage, from its closed end
 *    looking toward the divider / open bay.
 *  - Anything else (garage, carport, widespan, single-slope): the whole
 *    footprint, from just inside the front gable looking down the length.
 */
export function interiorRoom(s: StructureModel): InteriorRoom {
  const halfW = s.width / 2;
  const halfL = s.length / 2;
  const enc = s.enclosure;
  let x0 = -halfW;
  let x1 = halfW;
  let z0 = -halfL;
  let z1 = halfL;
  let kind: InteriorRoom['kind'] = 'plain';
  let dirZ: 1 | -1 = 1;

  if (enc.partitionKind === 'storage' && enc.partitionZ !== null) {
    kind = 'endStorage';
    const pz = enc.partitionZ;
    // The sheet faces the main room: −Z face = storage at the back.
    if ((enc.partitionFaces ?? -1) < 0) {
      z1 = pz;
      dirZ = 1; // stand at the front gable, look back at the partition
    } else {
      z0 = pz;
      dirZ = -1; // storage at the front: stand at the back gable, look forward
    }
  } else if (enc.sidePartition) {
    kind = 'sideStorage';
    const { x, faces } = enc.sidePartition;
    if (faces < 0) x1 = x;
    else x0 = x;
    dirZ = 1;
  } else if (enc.type === 'utility' && enc.partitionZ !== null && enc.sideZ) {
    kind = 'gch';
    z0 = enc.sideZ.start;
    z1 = enc.sideZ.end;
    // The divider is one end of the enclosed bay; look toward it.
    dirZ = Math.abs(enc.partitionZ - z1) <= Math.abs(enc.partitionZ - z0) ? 1 : -1;
  }

  const m = INTERIOR.wallMarginFt;
  const [bx0, bx1] = inset(x0, x1, m);
  const [bz0, bz1] = inset(z0, z1, m);
  return {
    kind,
    x0,
    x1,
    z0,
    z1,
    box: { x0: bx0, x1: bx1, z0: bz0, z1: bz1, yMin: INTERIOR.floorMarginFt },
    eaveFt: s.legHeight,
    dirZ,
  };
}

/** Highest the camera may be at plan X: under the roof line by the margin (never below the floor margin). */
export function ceilingAt(s: StructureModel, x: number): number {
  return Math.max(INTERIOR.floorMarginFt, roofLineAt(s, x) - INTERIOR.roofMarginFt);
}

/** Clamp a camera position into the room box: walls − 1', floor + 2', under the roof. */
export function clampToInterior(p: Vec3, room: InteriorRoom, s: StructureModel): Vec3 {
  const { box } = room;
  const x = Math.min(box.x1, Math.max(box.x0, p[0]));
  const z = Math.min(box.z1, Math.max(box.z0, p[2]));
  const y = Math.min(ceilingAt(s, x), Math.max(box.yMin, p[1]));
  return [x, y, z];
}

/** Standing eye height: 5.5', never above eave − 1', never below the floor margin. */
export function eyeHeight(eaveFt: number): number {
  return Math.max(INTERIOR.floorMarginFt, Math.min(INTERIOR.eyeFt, eaveFt - 1));
}

export interface InteriorPose {
  pos: Vec3;
  yaw: number;
  pitch: number;
  fov: number;
  room: InteriorRoom;
}

/** Look direction for yaw / pitch (see the convention above). */
export function lookDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

/** Yaw / pitch of a (not necessarily unit) direction. */
export function yawPitchOf(d: Vec3): { yaw: number; pitch: number } {
  const h = Math.hypot(d[0], d[2]);
  return { yaw: Math.atan2(d[0], d[2]), pitch: Math.atan2(d[1], h) };
}

/**
 * Arrival pose: eye height, just inside the end of the main room opposite
 * what it looks at, centred across the room, aimed at the middle of the far
 * wall (the storage partition, the GCH divider or the far gable). When the
 * room is too short for the whole wall to fit, the tilt drops so the wall's
 * foot (where its doors meet the floor) stays in frame and the top crops.
 */
export function interiorPose(s: StructureModel): InteriorPose {
  const room = interiorRoom(s);
  const xc = (room.x0 + room.x1) / 2;
  const standZ = room.dirZ > 0 ? room.z0 + INTERIOR.standOffFt : room.z1 - INTERIOR.standOffFt;
  const farZ = room.dirZ > 0 ? room.z1 : room.z0;
  const eye = eyeHeight(room.eaveFt);
  const pos = clampToInterior([xc, eye, standZ], room, s);
  // Aim at the middle of the far wall's height at this X (floor .. roof line),
  // so the whole wall sits in the wide frame with some floor and roof around it.
  const aimY = roofLineAt(s, pos[0]) / 2;
  const d = Math.max(0.5, Math.abs(farZ - pos[2]));
  const vHalf = (INTERIOR.fovDeg * Math.PI) / 360;
  const keepFoot = vHalf - Math.atan2(pos[1] + 0.25, d); // bottom frame edge 3" under the wall's foot
  const pitch = Math.max(INTERIOR.arrivePitchMin, Math.min(INTERIOR.arrivePitchMax, Math.atan2(aimY - pos[1], d), keepFoot));
  const yaw = room.dirZ > 0 ? 0 : Math.PI;
  return { pos, yaw, pitch, fov: INTERIOR.fovDeg, room };
}

/** Scroll zoom: wheel delta (px, + = away / zoom out) → new FOV, clamped. */
export function zoomFov(fov: number, deltaPx: number): number {
  const d = Math.max(-240, Math.min(240, deltaPx));
  const next = fov * Math.exp(d * 0.001);
  return Math.min(INTERIOR.fovMaxDeg, Math.max(INTERIOR.fovMinDeg, next));
}

/**
 * Drag to look around ("grab the scene": what is under the cursor follows it).
 * `radPerPx` ≈ the vertical FOV over the viewport height.
 */
export function dragLook(yaw: number, pitch: number, dxPx: number, dyPx: number, radPerPx: number): { yaw: number; pitch: number } {
  const p = pitch + dyPx * radPerPx;
  return { yaw: yaw + dxPx * radPerPx, pitch: Math.max(-INTERIOR.pitchMax, Math.min(INTERIOR.pitchMax, p)) };
}

/** Walk on the floor plane: forward along the look yaw, strafe to its right. */
export function walk(p: Vec3, yaw: number, forwardFt: number, rightFt: number): Vec3 {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Right of the look direction (y up): forward × up = (−fz, 0, fx).
  const rx = -fz;
  const rz = fx;
  return [p[0] + fx * forwardFt + rx * rightFt, p[1], p[2] + fz * forwardFt + rz * rightFt];
}

/**
 * Whether a pointerdown on the canvas starts the look-around drag (InteriorWalk).
 * The parts' own handlers (Openings / LeanToSiding onDown, run first by R3F)
 * set `dragging` when they take a press — that press drags the part, inside
 * exactly as outside (owner 10/3/26: doors on the storage partition could not
 * be moved from the Interior view), so it never also turns the camera. A press
 * beside every part looks around as before. Only the primary mouse button.
 */
export function lookPressStarts(p: { inside: boolean; active: boolean; partDragging: boolean; pointerType: string; button: number }): boolean {
  if (!p.inside || p.active || p.partDragging) return false;
  if (p.pointerType === 'mouse' && p.button !== 0) return false;
  return true;
}

/** Key that changes only when the room box / pose would change (size, eave, partitions). */
export function interiorKey(s: StructureModel): string {
  const r = interiorRoom(s);
  const f = (v: number) => v.toFixed(3);
  return [r.kind, f(r.x0), f(r.x1), f(r.z0), f(r.z1), r.dirZ, f(s.legHeight), f(s.peakHeight), f(s.rise), f(s.monoDropFt ?? 0)].join('|');
}
