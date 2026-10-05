import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import * as THREE from 'three';
import {
  getEnhancedMaterial,
  materialKey,
  releaseEnhancedMaterial,
  retainEnhancedMaterial,
  type EnhancedMaterialSpec,
} from './materials';
import type { ShellBatch } from './shellGeometry';

/**
 * Cached enhanced materials for one component (render-upgrade Phase 5).
 *
 * Returns a getter to call DURING render. After every commit the component
 * retains exactly the keys it rendered with (retain the new set FIRST, then
 * release the old set, so a key kept across renders never hits zero and is
 * never rebuilt), and releases everything on unmount; the material library
 * disposes a material on its last release. If a material the render picked up
 * was evicted before the commit (another holder unmounting in the same
 * commit), the retain rebuilds it and the component re-renders once with the
 * live instance.
 */
export function useEnhancedMaterials(): (spec: EnhancedMaterialSpec) => THREE.MeshStandardMaterial {
  const held = useRef<Set<string>>(new Set());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const used = new Map<string, { spec: EnhancedMaterialSpec; material: THREE.MeshStandardMaterial }>();

  useLayoutEffect(() => {
    let stale = false;
    const next = new Set<string>();
    for (const [key, u] of used) {
      if (retainEnhancedMaterial(u.spec) !== u.material) stale = true;
      next.add(key);
    }
    for (const key of held.current) releaseEnhancedMaterial(key);
    held.current = next;
    if (stale) rerender();
  });
  useLayoutEffect(
    () => () => {
      for (const key of held.current) releaseEnhancedMaterial(key);
      held.current = new Set();
    },
    [],
  );

  return (spec) => {
    const key = materialKey(spec);
    let u = used.get(key);
    if (!u) {
      u = { spec, material: getEnhancedMaterial(spec) };
      used.set(key, u);
    }
    return u.material;
  };
}

function toGeometry(b: ShellBatch): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * PDF-capture framing data per batch (CaptureHook reads `userData`), so a
 * storage partition's wainscot never moves the PDF framing:
 *  - An interior storage partition sheet is ONE wall, but with wainscot on it
 *    is drawn as two batches (wall colour + wainscot colour). The first
 *    interior wall batch carries the union of all of them as its `captureBox`
 *    and the rest are `captureIgnore`, so CaptureHook sees exactly the one box
 *    it saw before the partition had wainscot.
 *  - A batch marked `captureIgnore` (the partition's Z-trim) is skipped.
 * Undefined for every other batch, and for the lone interior batch with
 * wainscot off (its own geometry box is already that box).
 */
export function shellCaptureData(batches: ShellBatch[], geometries: THREE.BufferGeometry[]): (Record<string, unknown> | undefined)[] {
  const out: (Record<string, unknown> | undefined)[] = batches.map((b) => (b.captureIgnore ? { captureIgnore: true } : undefined));
  const idx = batches.map((b, i) => (b.spec.surface === 'wall' && b.spec.interior && !b.captureIgnore ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return out;
  const box = new THREE.Box3();
  for (const i of idx) {
    const g = geometries[i];
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  out[idx[0]] = { captureBox: box };
  for (const i of idx.slice(1)) out[i] = { captureIgnore: true };
  return out;
}

/** Plain userData (the Frame.tsx pattern): a batch that stops carrying capture data drops it on the next render. */
const NO_TAG: Record<string, unknown> = {};

/**
 * One mesh per batch (= per material), keyed by the batch id so a rebuild
 * (drag, resize, color) swaps geometry on the SAME mesh. Geometries are owned
 * here and disposed as soon as they are replaced or unmounted, and the
 * materials come from the shared cache — so renderer.info.memory stays flat
 * while a door is dragged.
 */
export function ShellMeshes({ batches, name }: { batches: ShellBatch[]; name: string }) {
  const material = useEnhancedMaterials();
  const geometries = useMemo(() => batches.map(toGeometry), [batches]);
  const capture = useMemo(() => shellCaptureData(batches, geometries), [batches, geometries]);
  useEffect(
    () => () => {
      for (const g of geometries) g.dispose();
    },
    [geometries],
  );
  return (
    <group name={name}>
      {batches.map((b, i) => (
        <mesh
          key={b.id}
          ref={b.spec.surface === 'wall' && b.spec.interior ? attachOutsideOnlyDepthOffset : undefined}
          geometry={geometries[i]}
          material={material(b.spec)}
          castShadow={b.castShadow}
          receiveShadow={false}
          userData={capture[i] ?? NO_TAG}
        />
      ))}
    </group>
  );
}

const _walls = new THREE.Box3();
const _eye = new THREE.Vector3();
/**
 * An interior storage partition sheet's depth offset (materials.ts `interior`)
 * is only wanted seen from OUTSIDE the building, where it stops the edge-on
 * sheet rasterizing through the closed exterior sheet. From inside (Interior
 * view, orbiting in) it would only nudge the sheet behind its own base trim at
 * grazing angles (a stair-stepped edge), so each frame it is on only while the
 * camera is outside the walls' bounds.
 */
export function outsideOnlyDepthOffset(this: THREE.Object3D, _r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera, _g: THREE.BufferGeometry, material: THREE.Material) {
  if (!this.parent) return;
  _walls.setFromObject(this.parent);
  material.polygonOffset = !_walls.containsPoint(_eye.setFromMatrixPosition(camera.matrixWorld));
}
function attachOutsideOnlyDepthOffset(m: THREE.Mesh | null) {
  if (m) m.onBeforeRender = outsideOnlyDepthOffset;
}
