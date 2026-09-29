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
 * One mesh per batch (= per material), keyed by the batch id so a rebuild
 * (drag, resize, color) swaps geometry on the SAME mesh. Geometries are owned
 * here and disposed as soon as they are replaced or unmounted, and the
 * materials come from the shared cache — so renderer.info.memory stays flat
 * while a door is dragged.
 */
export function ShellMeshes({ batches, name }: { batches: ShellBatch[]; name: string }) {
  const material = useEnhancedMaterials();
  const geometries = useMemo(() => batches.map(toGeometry), [batches]);
  useEffect(
    () => () => {
      for (const g of geometries) g.dispose();
    },
    [geometries],
  );
  return (
    <group name={name}>
      {batches.map((b, i) => (
        <mesh key={b.id} geometry={geometries[i]} material={material(b.spec)} castShadow={b.castShadow} receiveShadow={false} />
      ))}
    </group>
  );
}
