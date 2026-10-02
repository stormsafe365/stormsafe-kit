import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { Opening } from '@/types/building';
import type { ViewMode } from '@/store/useEditorStore';

/** Panel opacity per view mode — Exterior draws nothing (the shell has the real sheeting). */
const GHOST_OPACITY: Record<ViewMode, number> = { exterior: 0, structure: 0.38, cutaway: 0.5 };
/** Just in front of the partition's sheet (main-room side) so it never fights the ghosted sheet. */
const LIFT = SHEET_OUTSET + 0.03;

/**
 * Outline of a main-building storage partition (End Storage cross wall or
 * Left/Right lengthwise wall) in its own plane coordinates (u along the wall,
 * v up), with its openings as holes. Exported for tests.
 */
export function storageGhostShape(structure: StructureModel, openings: Opening[]): { shape: THREE.Shape; plane: 'cross' | 'side'; at: number } | null {
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
    return { shape, plane: 'cross', at: enc.partitionZ + f * LIFT };
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
    return { shape, plane: 'side', at };
  }
  return null;
}

/**
 * Structure / Cutaway ghost the WHOLE shell (16% / 5%), so an interior storage
 * partition vanished with the outside walls. This draws the storage wall as a
 * tinted see-through panel + outline in those two views only, so the storage
 * room reads at a glance (its framing — bent, girts, base rail — is in the
 * Frame). Exterior draws nothing here. GCH dividers are untouched (none drawn).
 * Outside ShellGroup, capture-ignored, no shadows, never raycast.
 */
export function StoragePartitionGhost({
  structure,
  openings,
  color,
  edgeColor,
  viewMode,
}: {
  structure: StructureModel;
  openings: Opening[];
  color: string;
  edgeColor: string;
  viewMode: ViewMode;
}) {
  const opacity = GHOST_OPACITY[viewMode];
  const g = useMemo(() => (opacity > 0 ? storageGhostShape(structure, openings) : null), [structure, openings, opacity]);
  const geo = useMemo(() => (g ? new THREE.ShapeGeometry(g.shape) : null), [g]);
  const edges = useMemo(() => (geo ? new THREE.EdgesGeometry(geo) : null), [geo]);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
    [color, opacity],
  );
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: Math.min(1, opacity * 1.8) }), [edgeColor, opacity]);
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(() => () => edges?.dispose(), [edges]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => lineMat.dispose(), [lineMat]);
  if (!g || !geo || !edges) return null;
  // Shape space (u, v) → world: a cross wall is the XY plane at z = at; a
  // lengthwise wall turns it to run along Z at x = at.
  const pos: [number, number, number] = g.plane === 'cross' ? [0, 0, g.at] : [g.at, 0, 0];
  const rot: [number, number, number] = g.plane === 'cross' ? [0, 0, 0] : [0, -Math.PI / 2, 0];
  return (
    <group position={pos} rotation={rot} userData={{ captureIgnore: true, storageGhost: true }}>
      <mesh geometry={geo} material={mat} raycast={() => null} renderOrder={2} />
      <lineSegments geometry={edges} material={lineMat} raycast={() => null} renderOrder={3} />
    </group>
  );
}
