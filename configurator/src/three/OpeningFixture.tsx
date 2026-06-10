import { useMemo } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { OpeningType } from '@/types/building';
import { createSlatTexture } from './textures';

/**
 * The visual fixture for an opening (door / window / roll-up / framed opening):
 * proud trim, the panel, and per-type detail (slats, glazing + mullions, walk-
 * door knob/hinges). Positioned + oriented by the caller via `pos` / `rotY` so
 * it can sit on a main-building wall OR a lean-to wall — identical look either
 * way. Drag is optional via `onPanelPointerDown`.
 */
export const PANEL_COLOR: Record<OpeningType, string> = {
  rollUpDoor: '#ffffff',
  garageDoor: '#fbfcfd',
  walkDoor: '#ffffff',
  window: '#bfe9ff',
  frameOut: '#0c1622',
};

const _slatCache: Record<string, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }> = {};
export const slatTexFor = (type: OpeningType) =>
  (_slatCache[type] ??= createSlatTexture('#f7f9fc', type === 'rollUpDoor' ? 4 : 1));

export function TrimBar({ pos, size, color }: { pos: [number, number, number]; size: [number, number, number]; color: string }) {
  return (
    <mesh position={pos} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={0.08} roughness={0.5} envMapIntensity={0.3} />
    </mesh>
  );
}

export function OpeningFixture({
  pos,
  rotY,
  type,
  w,
  h,
  sillHeight,
  trimColor,
  panelColor,
  selected = false,
  onPanelPointerDown,
}: {
  pos: [number, number, number];
  rotY: number;
  type: OpeningType;
  w: number;
  h: number;
  sillHeight: number;
  trimColor: string;
  /** Override the panel color (hex) — e.g. a CCI colored roll-up door. */
  panelColor?: string;
  selected?: boolean;
  onPanelPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const isGlass = type === 'window';
  const isSlat = type === 'rollUpDoor' || type === 'garageDoor';
  const isFrameOut = type === 'frameOut';

  const panelMat = useMemo(() => {
    if (isSlat) {
      const base = slatTexFor(type);
      const map = base.map.clone();
      const bump = base.bump.clone();
      map.needsUpdate = bump.needsUpdate = true;
      const tiles = Math.max(2, Math.round(h)); // 1 tile = 1 ft of slats
      map.repeat.set(1, tiles);
      bump.repeat.set(1, tiles);
      // The slat texture is near-white, so the material color tints it — pass a
      // colored door's hex (CCI roll-ups) and the slats take that color; default
      // stays the standard white.
      return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.03, color: panelColor || PANEL_COLOR[type], metalness: 0.12, roughness: 0.5 });
    }
    if (isGlass) {
      const m = new THREE.MeshStandardMaterial({
        color: '#aab4ba',
        metalness: 0.35,
        roughness: 0.08,
        envMapIntensity: 1.25,
        transparent: true,
        opacity: 0.78,
      });
      m.userData.keepTransparent = true;
      return m;
    }
    if (isFrameOut) {
      const m = new THREE.MeshStandardMaterial({
        color: '#cfe0ec',
        transparent: true,
        opacity: 0.08,
        metalness: 0.1,
        roughness: 0.1,
        envMapIntensity: 0.6,
        depthWrite: false,
      });
      m.userData.keepTransparent = true;
      return m;
    }
    return new THREE.MeshStandardMaterial({ color: PANEL_COLOR[type], metalness: 0.3, roughness: 0.6 });
  }, [isSlat, isGlass, isFrameOut, type, h, panelColor]);

  const t = 0.17; // jamb/header face ~2"
  const trimDepth = 0.07;
  const panelDepth = isFrameOut ? 0.06 : isGlass ? 0.035 : 0.09;
  const panelZ = isGlass ? -0.025 : 0;
  const onFloor = sillHeight <= 0.1;
  const tc = selected ? '#22d3c8' : trimColor;
  const emissive = selected ? '#22d3c8' : '#000000';

  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* Proud jamb / header / sill trim — floor-mounted doors omit the sill. */}
      <TrimBar pos={[0, h / 2 + t / 2, 0]} size={[w + 2 * t, t, trimDepth]} color={tc} />
      <TrimBar pos={[-w / 2 - t / 2, onFloor ? t / 2 : 0, 0]} size={[t, onFloor ? h + t : h + 2 * t, trimDepth]} color={tc} />
      <TrimBar pos={[w / 2 + t / 2, onFloor ? t / 2 : 0, 0]} size={[t, onFloor ? h + t : h + 2 * t, trimDepth]} color={tc} />
      {!onFloor && <TrimBar pos={[0, -h / 2 - t / 2, 0]} size={[w + 2 * t, t, trimDepth]} color={tc} />}

      {/* Panel. For a framed opening (a real see-through cut) the issue is you
          look straight through it to the OPPOSITE wall's frame. A depth-only
          occluder sits in the opening: it writes depth but no color and renders
          first (renderOrder -1), so the far wall + its frame fail the depth test
          and aren't painted — the cut reads clean/empty (the trim border is the
          only thing left). DoubleSide so it occludes from inside too. */}
      {isFrameOut ? (
        <mesh renderOrder={-1} onPointerDown={onPanelPointerDown}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial colorWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : (
        <mesh position={[0, 0, panelZ]} material={panelMat} castShadow onPointerDown={onPanelPointerDown}>
          <boxGeometry args={[w, h, panelDepth]} />
        </mesh>
      )}
      {selected && (
        <mesh position={[0, 0, trimDepth / 2 + 0.02]}>
          <planeGeometry args={[w + t, h + t]} />
          <meshStandardMaterial color="#22d3c8" emissive={emissive} emissiveIntensity={0.25} transparent opacity={0.1} />
        </mesh>
      )}

      {/* Window — double-hung glazing with meeting rail + sill */}
      {isGlass && (
        <group>
          <TrimBar pos={[0, 0, trimDepth / 2 - 0.01]} size={[w + 0.02, 0.11, 0.05]} color={tc} />
          <TrimBar pos={[0, h / 2 - 0.03, trimDepth / 2 - 0.02]} size={[w, 0.06, 0.04]} color={tc} />
          <TrimBar pos={[0, -h / 2 + 0.03, trimDepth / 2 - 0.02]} size={[w, 0.06, 0.04]} color={tc} />
          <mesh position={[0, -h / 2 - t * 0.45, trimDepth * 0.4]} castShadow>
            <boxGeometry args={[w + 2.2 * t, t * 0.7, trimDepth + 0.08]} />
            <meshStandardMaterial color={tc} metalness={0.08} roughness={0.5} />
          </mesh>
        </group>
      )}

      {/* Walk door — round knob + 3 hinges */}
      {type === 'walkDoor' && (
        <group>
          <group position={[w / 2 - 0.2, -h / 2 + 3.0, panelDepth / 2]}>
            <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.07, 0.03, 18]} />
              <meshStandardMaterial color="#6b7077" metalness={0.85} roughness={0.28} />
            </mesh>
            <mesh position={[0, 0, 0.1]} castShadow>
              <sphereGeometry args={[0.06, 18, 14]} />
              <meshStandardMaterial color="#8b9097" metalness={0.9} roughness={0.22} />
            </mesh>
          </group>
          {[h / 2 - 0.6, 0, -h / 2 + 0.6].map((hy, i) => (
            <mesh key={`hinge${i}`} position={[-w / 2 + 0.05, hy, panelDepth / 2 - 0.005]} castShadow>
              <boxGeometry args={[0.05, 0.22, 0.04]} />
              <meshStandardMaterial color="#9aa0a7" metalness={0.7} roughness={0.4} />
            </mesh>
          ))}
        </group>
      )}

      {/* Roll-up door — heavier bottom rail + center lift handle */}
      {type === 'rollUpDoor' && (
        <group>
          <mesh position={[0, -h / 2 + 0.11, panelDepth / 2 + 0.005]} castShadow>
            <boxGeometry args={[w, 0.2, panelDepth + 0.02]} />
            <meshStandardMaterial color="#dfe2e7" metalness={0.3} roughness={0.5} />
          </mesh>
          <mesh position={[0, -h / 2 + 0.42, panelDepth / 2 + 0.04]} castShadow>
            <boxGeometry args={[0.5, 0.07, 0.05]} />
            <meshStandardMaterial color="#8a9099" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      )}
    </group>
  );
}
