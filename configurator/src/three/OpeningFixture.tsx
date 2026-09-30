import { useMemo, useRef } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { OpeningType } from '@/types/building';
import { useEditorStore } from '@/store/useEditorStore';
import { createSlatTexture, createDoorTexture, type DoorStyle } from './textures';
import { swingAngle, walkDoorHingeX, walkDoorKnobX } from './openingAnim';
import { useOpenAmount } from './useOpenAmount';

/**
 * The visual fixture for an opening (door / window / roll-up / framed opening):
 * proud trim, the panel, and per-type detail (slats, glazing + mullions, walk-
 * door knob/hinges). Positioned + oriented by the caller via `pos` / `rotY` so
 * it can sit on a main-building wall OR a lean-to wall — identical look either
 * way. Drag is optional via `onPanelPointerDown`.
 *
 * Click-to-open (CLASSIC lean-to fixtures, owner rule parity with the main
 * building; view-only): pass `openId` (the editor store's openIds key). The
 * walk door swings on a LEFT-jamb hinge (knob right, seen from outside) —
 * hi-impact (`impact`) OUT, standard IN (openingAnim.swingAngle); a roll-up
 * rolls up (the classic main-building scale motion) with a FIXED invisible hit
 * plane taking its clicks; a window's lower sash slides up. Shut, every mesh
 * sits exactly where it always did.
 */

/**
 * A FIXED invisible click target the size of an opening (writes neither color
 * nor depth; keepTransparent so ShellGroup never turns it into a depth
 * occluder). Roll-ups use it so the door stays clickable wherever the
 * rolled curtain is. captureIgnore: the PDF capture frames its camera on
 * the meshes' bounding boxes (their centroid seeds the fit), so an invisible
 * helper must not count, or every capture would shift a hair.
 */
export function OpeningHitPlane({
  w,
  h,
  z,
  onPointerDown,
}: {
  w: number;
  h: number;
  z: number;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  return (
    <mesh position={[0, 0, z]} onPointerDown={onPointerDown} userData={{ captureIgnore: true }}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} userData={{ keepTransparent: true }} />
    </mesh>
  );
}
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

const _doorTexCache: Record<string, THREE.CanvasTexture> = {};
const doorTexFor = (style: DoorStyle, dark: boolean) =>
  (_doorTexCache[style + (dark ? '-blk' : '-wht')] ??= createDoorTexture(style, dark));
const isDarkHex = (hex?: string): boolean => {
  if (!hex) return false;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 110;
};

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
  doorStyle,
  impact,
  openId,
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
  /** Walk-through door face style (std / 6-panel / 9-lite / diamond). */
  doorStyle?: DoorStyle;
  /** Hi-impact / hi-wind walk door: swings OUT (standard swings IN). */
  impact?: boolean;
  /** Editor-store openIds key: enables click-to-open (view-only). */
  openId?: string;
  onPanelPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const isGlass = type === 'window';
  const isSlat = type === 'rollUpDoor' || type === 'garageDoor';
  const isFrameOut = type === 'frameOut';
  const isWalk = type === 'walkDoor';
  const doorDark = isDarkHex(panelColor);

  // ── click-to-open (view-only; the caller's click rule toggles openIds) ──
  const isOpen = useEditorStore((s) => !!(openId && s.openIds[openId]));
  const swingRef = useRef<THREE.Group>(null);
  const rollRef = useRef<THREE.Group>(null);
  const sashRef = useRef<THREE.Group>(null);
  const glassRef = useRef<THREE.Mesh>(null);
  const lowerRef = useRef<THREE.Mesh>(null);

  const panelMat = useMemo(() => {
    if (isWalk) {
      const map = doorTexFor((doorStyle ?? 'std') as DoorStyle, doorDark);
      return new THREE.MeshStandardMaterial({ map, metalness: 0.18, roughness: 0.55 });
    }
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
  }, [isWalk, isSlat, isGlass, isFrameOut, type, h, panelColor, doorStyle, doorDark]);

  const t = 0.17; // jamb/header face ~2"
  const trimDepth = 0.07;
  const panelDepth = isFrameOut ? 0.06 : isGlass ? 0.035 : 0.09;
  const panelZ = isGlass ? -0.025 : 0;
  const onFloor = sillHeight <= 0.1;
  // Owner rule: no selection tint on ANY component (a picked / dragged part
  // keeps its real colors; the placement guides show what is picked).
  const tc = isGlass && panelColor ? panelColor : trimColor;

  useOpenAmount(isOpen && !isFrameOut, (t) => {
    if (swingRef.current) swingRef.current.rotation.y = swingAngle(impact, t); // hi-impact swings OUT, standard swings IN
    if (rollRef.current) {
      const k = 0.9 * t; // roll up to ~10% showing at the header (the classic main-building motion)
      rollRef.current.scale.y = 1 - k;
      rollRef.current.position.y = (h * k) / 2; // keep the top edge fixed
    }
    if (sashRef.current) sashRef.current.position.y = t * (h / 2) * 0.9;
    // Window: shut = the single classic glass pane; once it moves, that pane
    // becomes the fixed UPPER sash and the lower sash glass (hidden while
    // shut) rides up just in front of it with the meeting rail.
    if (glassRef.current && lowerRef.current) {
      const split = t > 0;
      glassRef.current.scale.y = split ? 0.5 : 1;
      glassRef.current.position.y = split ? h / 4 : 0;
      lowerRef.current.visible = split;
      lowerRef.current.position.z = panelZ + 0.03 * t;
    }
  });

  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* Proud jamb / header / sill trim — floor-mounted doors omit the sill. */}
      <TrimBar pos={[0, h / 2 + t / 2, 0]} size={[w + 2 * t, t, trimDepth]} color={tc} />
      <TrimBar pos={[-w / 2 - t / 2, onFloor ? t / 2 : 0, 0]} size={[t, onFloor ? h + t : h + 2 * t, trimDepth]} color={tc} />
      <TrimBar pos={[w / 2 + t / 2, onFloor ? t / 2 : 0, 0]} size={[t, onFloor ? h + t : h + 2 * t, trimDepth]} color={tc} />
      {!onFloor && <TrimBar pos={[0, -h / 2 - t / 2, 0]} size={[w + 2 * t, t, trimDepth]} color={tc} />}

      {/* Panel. A framed opening on a LEAN-TO is a true see-through cut: what's
          behind it is the lean-to interior (the main building's wall, posts,
          roof underside) and SHOULD stay visible — unlike the main building,
          whose frame-outs keep a depth occluder to hide the far wall's frame.
          So the opening renders NOTHING — just an invisible plane (writes
          neither color nor depth) kept purely as the click/drag target. */}
      {isFrameOut ? (
        <mesh onPointerDown={onPanelPointerDown}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} userData={{ keepTransparent: true }} />
        </mesh>
      ) : isWalk ? (
        // Walk door: hinge pivot on the LEFT jamb (seen from outside); the slab,
        // knob (RIGHT) and 3 hinges swing together.
        <group position={[walkDoorHingeX(w), 0, 0]}>
          <group ref={swingRef}>
            <group position={[w / 2, 0, 0]}>
              <mesh position={[0, 0, panelZ]} material={panelMat} castShadow onPointerDown={onPanelPointerDown}>
                <boxGeometry args={[w, h, panelDepth]} />
              </mesh>
              <group position={[walkDoorKnobX(w), -h / 2 + 3.0, panelDepth / 2]}>
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
          </group>
        </group>
      ) : isSlat ? (
        // Roll-up: the curtain + (roll-up) bottom rail + lift handle roll together.
        <group ref={rollRef}>
          <mesh position={[0, 0, panelZ]} material={panelMat} castShadow>
            <boxGeometry args={[w, h, panelDepth]} />
          </mesh>
          {type === 'rollUpDoor' && (
            <group>
              <mesh position={[0, -h / 2 + 0.11, panelDepth / 2 + 0.005]} castShadow>
                <boxGeometry args={[w, 0.2, panelDepth + 0.02]} />
                {/* Bottom rail matches the door color (a colored roll-up should be
                    ALL that color); default light gray for a standard white door. */}
                <meshStandardMaterial color={panelColor || '#dfe2e7'} metalness={0.3} roughness={0.5} />
              </mesh>
              <mesh position={[0, -h / 2 + 0.42, panelDepth / 2 + 0.04]} castShadow>
                <boxGeometry args={[0.5, 0.07, 0.05]} />
                <meshStandardMaterial color="#8a9099" metalness={0.6} roughness={0.4} />
              </mesh>
            </group>
          )}
        </group>
      ) : (
        <mesh ref={isGlass ? glassRef : undefined} position={[0, 0, panelZ]} material={panelMat} castShadow onPointerDown={onPanelPointerDown}>
          <boxGeometry args={[w, h, panelDepth]} />
        </mesh>
      )}

      {/* Window — double-hung glazing with meeting rail + sill. The lower
          sash (hidden while shut) and the meeting rail slide up together. */}
      {isGlass && (
        <group>
          <group ref={sashRef}>
            {/* captureIgnore: hidden while shut, it must not move the PDF framing (see OpeningHitPlane). */}
            <mesh ref={lowerRef} visible={false} position={[0, -h / 4, panelZ]} material={panelMat} castShadow onPointerDown={onPanelPointerDown} userData={{ captureIgnore: true }}>
              <boxGeometry args={[w, h / 2, panelDepth]} />
            </mesh>
            <TrimBar pos={[0, 0, trimDepth / 2 - 0.01]} size={[w + 0.02, 0.11, 0.05]} color={tc} />
          </group>
          <TrimBar pos={[0, h / 2 - 0.03, trimDepth / 2 - 0.02]} size={[w, 0.06, 0.04]} color={tc} />
          <TrimBar pos={[0, -h / 2 + 0.03, trimDepth / 2 - 0.02]} size={[w, 0.06, 0.04]} color={tc} />
          <mesh position={[0, -h / 2 - t * 0.45, trimDepth * 0.4]} castShadow>
            <boxGeometry args={[w + 2.2 * t, t * 0.7, trimDepth + 0.08]} />
            <meshStandardMaterial color={tc} metalness={0.08} roughness={0.5} />
          </mesh>
        </group>
      )}

      {/* Roll-up: a FIXED invisible hit plane the size of the opening takes the
          clicks / drags wherever the curtain is (draws nothing). */}
      {isSlat && <OpeningHitPlane w={w} h={h} z={panelDepth / 2} onPointerDown={onPanelPointerDown} />}
    </group>
  );
}
