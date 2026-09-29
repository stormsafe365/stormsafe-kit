import { useMemo } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '@/engine/geometry';

const UP = new THREE.Vector3(0, 1, 0);

interface SteelMemberProps {
  start: Vec3;
  end: Vec3;
  /** Cross-section size in feet. */
  size: number;
  color: string;
  metalness?: number;
  roughness?: number;
  /**
   * An explicit material to use INSTEAD of the per-member color / metalness /
   * roughness one (the enhanced Look's shared bare-Galvalume frame material).
   * Owned by the caller; omitted = the classic JSX material, unchanged.
   */
  material?: THREE.Material;
  /** Shadow flags (default true = classic). The enhanced Look casts none. */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * A single length of square steel tube rendered as a BoxGeometry stretched and
 * oriented between two world-space points. Used for every frame member; the
 * caller varies `size` by gauge so 12-gauge reads visibly heavier than 14.
 */
export function SteelMember({
  start,
  end,
  size,
  color,
  metalness = 0.7,
  roughness = 0.45,
  material,
  castShadow = true,
  receiveShadow = true,
}: SteelMemberProps) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    return { position: mid, quaternion: quat, length: len };
  }, [start, end]);

  if (material) {
    return (
      <mesh position={position} quaternion={quaternion} material={material} castShadow={castShadow} receiveShadow={receiveShadow}>
        <boxGeometry args={[size, length, size]} />
      </mesh>
    );
  }
  return (
    <mesh position={position} quaternion={quaternion} castShadow={castShadow} receiveShadow={receiveShadow}>
      {/* Box is unit-tall on Y, then stretched to the member length. */}
      <boxGeometry args={[size, length, size]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </mesh>
  );
}
