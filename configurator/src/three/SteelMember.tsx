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

  return (
    <mesh position={position} quaternion={quaternion} castShadow receiveShadow>
      {/* Box is unit-tall on Y, then stretched to the member length. */}
      <boxGeometry args={[size, length, size]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </mesh>
  );
}
