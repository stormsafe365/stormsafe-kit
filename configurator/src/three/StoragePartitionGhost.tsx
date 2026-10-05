import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { Opening, Wainscot } from '@/types/building';
import type { ViewMode } from '@/store/useEditorStore';
import { PANEL_BACK_HEX, sheetSides } from './panelBack';

/** Panel opacity per view mode — Exterior draws nothing (the shell has the real sheeting). */
const GHOST_OPACITY: Record<ViewMode, number> = { exterior: 0, structure: 0.38, cutaway: 0.5 };
/** Just in front of the partition's sheet (main-room side) so it never fights the ghosted sheet. */
const LIFT = SHEET_OUTSET + 0.03;

/**
 * Outline of a main-building storage partition (End Storage cross wall or
 * Left/Right lengthwise wall) in its own plane coordinates (u along the wall,
 * v up), with its openings as holes. Exported for tests.
 */
export function storageGhostShape(
  structure: StructureModel,
  openings: Opening[],
): { shape: THREE.Shape; plane: 'cross' | 'side'; at: number; faces: 1 | -1 } | null {
  const enc = structure.enclosure;
  const W = structure.width;
  const L = structure.length;
  const halfW = W / 2;
  const halfL = L / 2;
  const peak = structure.peakHeight;
  const mono = structure.monoDropFt > 0.01;
  const roofAt = (x: number) => (mono ? peak - structure.rise * ((x + halfW) / W) : peak - Math.abs(x) * (structure.rise / halfW));

  if (enc.partitionKind === 'storage' && enc.partitionZ !== null) {
    const f = enc.partitionFaces ?? -1;
    const shape = new THREE.Shape();
    shape.moveTo(-halfW, 0);
    shape.lineTo(halfW, 0);
    shape.lineTo(halfW, roofAt(halfW));
    if (!mono) shape.lineTo(0, peak);
    shape.lineTo(-halfW, roofAt(-halfW));
    shape.closePath();
    for (const o of openings) {
      if (o.side !== 'partition') continue;
      const x0 = -halfW + o.offset - o.width / 2;
      const y0 = o.sillHeight ?? 0;
      const hole = new THREE.Path();
      hole.moveTo(x0, y0);
      hole.lineTo(x0, y0 + o.height);
      hole.lineTo(x0 + o.width, y0 + o.height);
      hole.lineTo(x0 + o.width, y0);
      hole.closePath();
      shape.holes.push(hole);
    }
    return { shape, plane: 'cross', at: enc.partitionZ + f * LIFT, faces: f };
  }
  if (enc.sidePartition) {
    const { x, faces } = enc.sidePartition;
    const at = x + faces * LIFT;
    const shape = new THREE.Shape();
    shape.moveTo(-halfL, 0);
    shape.lineTo(halfL, 0);
    shape.lineTo(halfL, roofAt(at));
    shape.lineTo(-halfL, roofAt(at));
    shape.closePath();
    return { shape, plane: 'side', at, faces };
  }
  return null;
}

/**
 * Which side of the ghost geometry (its (u, v) plane, front face +Z) is the
 * painted main-room face. A cross wall keeps +Z = world +Z; a lengthwise wall
 * is turned -90 deg about Y, so +Z = world -X. Exported for tests.
 */
export function storageGhostSides(g: { plane: 'cross' | 'side'; faces: 1 | -1 } | null): { paint: THREE.Side; back: THREE.Side } {
  if (!g) return { paint: THREE.DoubleSide, back: THREE.DoubleSide };
  return sheetSides(g.plane === 'cross' ? [0, 0, 1] : [-1, 0, 0], g.plane === 'cross' ? [0, 0, g.faces] : [g.faces, 0, 0]);
}

/** Sorted distinct values (within 1e-6). */
function gridLines(vals: number[]): number[] {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > 1e-6) out.push(v);
  return out;
}

/**
 * The storage ghost split at the building's wainscot line (owner 10/3/26: the
 * partition carries the building's wainscot like the outside walls). Same
 * (u, v) plane as storageGhostShape: `band` = the ghost below the line (the
 * wainscot colour), `wall` = the rest (the wall colour), both cut around the
 * partition's openings, as triangle lists (x, y, 0); `cap` = the wainscot
 * line as line segments, broken where an opening crosses it (the WainscotCap
 * +-0.08 rule). Both triangle sets come off ONE grid — every hole edge and the
 * band line split every row / column, and the gable fans from its apex over
 * every column edge on the eave line — so neighbouring cells share whole
 * edges (no T-junction cracks in the see-through panel). The eave-line
 * rectangle is cut, the gable above it never is (classic EndWall rule). null =
 * wainscot off or no storage partition: the ghost is the single panel, exactly
 * as before. Exported for tests.
 */
export function storageGhostWainscot(
  structure: StructureModel,
  openings: Opening[],
  wainscot: Wainscot,
): { wall: Float32Array; band: Float32Array; cap: Float32Array } | null {
  const enc = structure.enclosure;
  const H = structure.legHeight;
  const wH = wainscot.enabled ? Math.min(wainscot.heightFt, H - 0.5) : 0;
  if (!(wH > 0)) return null;
  const W = structure.width;
  const halfW = W / 2;
  const halfL = structure.length / 2;
  const peak = structure.peakHeight;
  const mono = structure.monoDropFt > 0.01;
  const roofAt = (x: number) => (mono ? peak - structure.rise * ((x + halfW) / W) : peak - Math.abs(x) * (structure.rise / halfW));

  let u0: number;
  let u1: number;
  let top: number;
  let apex: [number, number] | null = null;
  let holes: { a: number; b: number; y0: number; y1: number }[] = [];
  if (enc.partitionKind === 'storage' && enc.partitionZ !== null) {
    u0 = -halfW;
    u1 = halfW;
    top = Math.min(roofAt(-halfW), roofAt(halfW)); // the eave line
    apex = mono ? [-halfW, peak] : [0, peak];
    holes = openings
      .filter((o) => o.side === 'partition')
      .map((o) => {
        const x0 = -halfW + o.offset - o.width / 2;
        const sill = o.sillHeight ?? 0;
        return { a: Math.max(-halfW, x0), b: Math.min(halfW, x0 + o.width), y0: Math.max(0, sill), y1: Math.min(top, sill + o.height) };
      })
      .filter((h) => h.b - h.a > 1e-6 && h.y1 - h.y0 > 1e-6);
  } else if (enc.sidePartition) {
    const { x, faces } = enc.sidePartition;
    u0 = -halfL;
    u1 = halfL;
    top = roofAt(x + faces * LIFT);
  } else {
    return null;
  }
  if (wH >= top - 0.02) return null;

  const xs = gridLines([u0, u1, ...holes.flatMap((h) => [h.a, h.b])]);
  const ys = gridLines([0, wH, top, ...holes.flatMap((h) => [h.y0, h.y1])]);
  const wall: number[] = [];
  const band: number[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const cx = (a + b) / 2;
    for (let j = 0; j + 1 < ys.length; j++) {
      const y0 = ys[j];
      const y1 = ys[j + 1];
      const cy = (y0 + y1) / 2;
      if (holes.some((h) => cx > h.a && cx < h.b && cy > h.y0 && cy < h.y1)) continue;
      (cy < wH ? band : wall).push(a, y0, 0, b, y0, 0, b, y1, 0, a, y0, 0, b, y1, 0, a, y1, 0);
    }
  }
  if (apex && apex[1] - top > 1e-6) for (let i = 0; i + 1 < xs.length; i++) wall.push(xs[i], top, 0, xs[i + 1], top, 0, apex[0], apex[1], 0);

  // The wainscot line, broken where an opening crosses it (a lengthwise partition has no openings).
  let segs: [number, number][] = [[u0, u1]];
  if (apex)
    for (const o of openings) {
      if (o.side !== 'partition') continue;
      const sill = o.sillHeight ?? 0;
      if (!(sill < wH + 0.08 && sill + o.height > wH - 0.08)) continue;
      const a = -halfW + o.offset - o.width / 2;
      const b = a + o.width;
      const next: [number, number][] = [];
      for (const [s, e] of segs) {
        if (b <= s || a >= e) {
          next.push([s, e]);
          continue;
        }
        if (a > s) next.push([s, a]);
        if (b < e) next.push([b, e]);
      }
      segs = next;
    }
  const cap: number[] = [];
  for (const [s, e] of segs) if (e - s > 0.05) cap.push(s, wH, 0, e, wH, 0);
  return { wall: new Float32Array(wall), band: new Float32Array(band), cap: new Float32Array(cap) };
}

/**
 * BufferGeometries of a storageGhostWainscot split: the two triangle sets lit
 * like the plain ghost's ShapeGeometry (normal +Z in the (u, v) plane — without
 * it the lit material renders them black), the cap as plain line positions.
 * Exported for tests.
 */
export function storageGhostWainscotGeometries(split: { wall: Float32Array; band: Float32Array; cap: Float32Array }): {
  wall: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  cap: THREE.BufferGeometry;
} {
  const lit = (p: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const n = new Float32Array(p.length);
    for (let i = 2; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    return g;
  };
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.BufferAttribute(split.cap, 3));
  return { wall: lit(split.wall), band: lit(split.band), cap };
}

/**
 * Structure / Cutaway ghost the WHOLE shell (16% / 5%), so an interior storage
 * partition vanished with the outside walls. This draws the storage wall as a
 * tinted see-through panel + outline in those two views only, so the storage
 * room reads at a glance (its framing — bent, girts, base rail — is in the
 * Frame). With the building's wainscot on, the panel carries the band in the
 * wainscot colour + its line (storageGhostWainscot), like the real sheet.
 * Exterior draws nothing here. GCH dividers are untouched (none drawn).
 * Outside ShellGroup, capture-ignored, no shadows, never raycast.
 */
export function StoragePartitionGhost({
  structure,
  openings,
  color,
  edgeColor,
  viewMode,
  wainscot,
  wainscotColor,
}: {
  structure: StructureModel;
  openings: Opening[];
  color: string;
  edgeColor: string;
  viewMode: ViewMode;
  /** The building's wainscot (absent / off = the single wall-colour panel, as before). */
  wainscot?: Wainscot;
  wainscotColor?: string;
}) {
  const opacity = GHOST_OPACITY[viewMode];
  const g = useMemo(() => (opacity > 0 ? storageGhostShape(structure, openings) : null), [structure, openings, opacity]);
  // The painted (wall colour + wainscot) face looks into the MAIN room; the
  // storage-room face is the unpainted panel back (panelBack.ts).
  const sides = storageGhostSides(g);
  const backMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: PANEL_BACK_HEX, roughness: 0.85, metalness: 0, transparent: true, opacity, depthWrite: false, side: sides.back }),
    [opacity, sides.back],
  );
  useEffect(() => () => backMat.dispose(), [backMat]);
  const geo = useMemo(() => (g ? new THREE.ShapeGeometry(g.shape) : null), [g]);
  const edges = useMemo(() => (geo ? new THREE.EdgesGeometry(geo) : null), [geo]);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, transparent: true, opacity, depthWrite: false, side: sides.paint }),
    [color, opacity, sides.paint],
  );
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: Math.min(1, opacity * 1.8) }), [edgeColor, opacity]);
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(() => () => edges?.dispose(), [edges]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => lineMat.dispose(), [lineMat]);
  // Wainscot split — built only while the wainscot is on (nothing extra is
  // created otherwise, so the plain ghost is exactly the old one).
  const wainOn = !!wainscot?.enabled;
  const wainFt = wainscot?.heightFt ?? 0;
  const split = useMemo(
    () => (g && wainOn ? storageGhostWainscot(structure, openings, { enabled: true, heightFt: wainFt }) : null),
    [g, structure, openings, wainOn, wainFt],
  );
  const splitGeo = useMemo(() => (split ? storageGhostWainscotGeometries(split) : null), [split]);
  const bandColor = wainscotColor ?? color;
  const bandMat = useMemo(
    () =>
      split
        ? new THREE.MeshStandardMaterial({ color: bandColor, roughness: 0.85, metalness: 0, transparent: true, opacity, depthWrite: false, side: sides.paint })
        : null,
    [split, bandColor, opacity, sides.paint],
  );
  useEffect(
    () => () => {
      if (splitGeo) for (const k of ['wall', 'band', 'cap'] as const) splitGeo[k].dispose();
    },
    [splitGeo],
  );
  useEffect(() => () => bandMat?.dispose(), [bandMat]);
  if (!g || !geo || !edges) return null;
  // Shape space (u, v) → world: a cross wall is the XY plane at z = at; a
  // lengthwise wall turns it to run along Z at x = at.
  const pos: [number, number, number] = g.plane === 'cross' ? [0, 0, g.at] : [g.at, 0, 0];
  const rot: [number, number, number] = g.plane === 'cross' ? [0, 0, 0] : [0, -Math.PI / 2, 0];
  return (
    <group position={pos} rotation={rot} userData={{ captureIgnore: true, storageGhost: true }}>
      {splitGeo && bandMat ? (
        <>
          <mesh geometry={splitGeo.wall} material={mat} raycast={() => null} renderOrder={2} />
          <mesh geometry={splitGeo.band} material={bandMat} raycast={() => null} renderOrder={2} />
        </>
      ) : (
        <mesh geometry={geo} material={mat} raycast={() => null} renderOrder={2} />
      )}
      <mesh geometry={geo} material={backMat} raycast={() => null} renderOrder={2} />
      <lineSegments geometry={edges} material={lineMat} raycast={() => null} renderOrder={3} />
      {splitGeo && <lineSegments geometry={splitGeo.cap} material={lineMat} raycast={() => null} renderOrder={3} />}
    </group>
  );
}
