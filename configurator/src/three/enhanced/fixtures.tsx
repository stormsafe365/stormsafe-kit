import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { OpeningType } from '@/types/building';
import type { DoorStyle } from '../textures';
import {
  OPEN_SECS,
  WALK_DOOR_SWING_RAD_ENHANCED,
  rollUpTravel,
  sashTravel,
  swingAngle,
  walkDoorHingeX,
  walkDoorKnobX,
} from '../openingAnim';
import { useOpenAmount } from '../useOpenAmount';
import { chamferFillGeometry, chamferFrameGeometry, chamferPanelGeometry, cut45Leg } from '../cut45Geometry';
import { useEnhancedMaterials } from './ShellMeshes';
import { FIXTURE, panelCenterZ, rollUpClipY, trimCenterZ, walkDoorPivotZ } from './fixtureLayout';

/**
 * ENHANCED look — the ONE fixture look module for doors, windows, roll-ups and
 * frame-outs (render-upgrade Phase 7, HANDOFF Steps 4-5), used by the main
 * building (Openings.tsx) AND the lean-tos (LeanToSiding.tsx
 * DraggableLeanToOpening). The caller owns the group transform (the classic
 * wall position + rotation, local +Z = OUTWARD) and every pointer rule (drag,
 * the 5px click threshold, write-back); this draws inside it:
 *
 *  - ~2" trim (face 0.17, 0.07 proud) sitting ON the siding; the door leaf /
 *    curtain / glass sit flush in the wall hole behind the siding face; a
 *    shallow wall-colored reveal ONLY when sheeting surrounds the opening
 *    (never on a frame-out or an open wall); no contact shading (owner: go
 *    easy on shadows — the look stays even and bright for the PDFs).
 *  - roll-up: flush slatted curtain (cached P4 slat texture, 4 slats per ft,
 *    1 tile = 1 ft of door height), bottom rail in the door color, lift
 *    handle. Opens by RISING (h - 0.22) with a clip plane at the opening top,
 *    so nothing shows above it; a FIXED invisible hit plane the size of the
 *    opening takes the clicks (a clipped curtain still raycasts).
 *  - walk door: flat slab with the door-style face (std / 6-panel / 9-lite /
 *    diamond, white / black), a knob on BOTH faces, three hinges. Hinge LEFT /
 *    knob RIGHT seen from outside; hi-impact swings OUT, standard swings IN
 *    (openingAnim.swingAngle sign, ~88 degrees), pivoting on the face it
 *    swings toward so it clears the jamb trim.
 *  - window: double-hung; the upper sash is fixed on the outer track, the
 *    lower sash rides the inner track and slides up (h/2 - 0.06) behind it;
 *    sill below. Glass = the P4 glass material (keepTransparent).
 *  - frame-out: a see-through hole with the trim U (+ a bottom bar when it
 *    sits up the wall). Main building: the classic faint 8% pane (no shadow,
 *    keepTransparent); lean-to: an invisible click plane only.
 *
 * Open / close is view-only (useOpenAmount): never saved or priced, snapped
 * shut during a PDF capture, snapped under prefers-reduced-motion.
 * Materials are the shared cached enhanced materials (useEnhancedMaterials);
 * no mesh casts a shadow (the enhanced rig casts none).
 */

export interface EnhancedFixtureProps {
  type: OpeningType;
  w: number;
  h: number;
  sillHeight: number;
  /** Local z of the wall sheeting face (fixtureLayout.fixtureFaceZ). */
  faceZ: number;
  /** Trim color (palette code or hex). */
  trimColor: string;
  /** Wall color (palette code or hex) — the reveal. */
  wallColor: string;
  /** Unit color (hex): colored roll-up, black walk door, black window frame. */
  color?: string;
  doorStyle?: DoorStyle;
  /** Hi-impact / hi-wind walk door: swings OUT (standard swings IN). */
  impact?: boolean;
  /** Roll-up with both top corners cut at 45°. */
  cut45?: boolean;
  /** Sheeting surrounds the opening (draw the reveal). */
  sheeted: boolean;
  /** Frame-out: draw the faint see-through pane (main building) instead of nothing (lean-to). */
  frameOutPane: boolean;
  /** The editor store says this part is clicked open. */
  isOpen: boolean;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}

/** A color counts as dark (black door) when its luminance is low — same test as the classic fixture. */
const isDarkHex = (hex?: string): boolean => {
  if (!hex) return false;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 110;
};

// Lazily created shared materials that are not paint (no cache key needed).
let hitMat: THREE.MeshBasicMaterial | null = null;
/** Invisible (writes neither color nor depth) click target; ShellGroup must leave it alone. */
function hitMaterial(): THREE.MeshBasicMaterial {
  if (!hitMat) {
    hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    hitMat.name = 'enhanced:hit-plane';
    hitMat.userData.keepTransparent = true;
  }
  return hitMat;
}
let paneMat: THREE.MeshStandardMaterial | null = null;
/** The classic main-building frame-out pane: a faint open void (8%), no depth write, never forced opaque. */
function frameOutPaneMaterial(): THREE.MeshStandardMaterial {
  if (!paneMat) {
    paneMat = new THREE.MeshStandardMaterial({
      color: '#cfe0ec',
      transparent: true,
      opacity: 0.08,
      metalness: 0.1,
      roughness: 0.1,
      envMapIntensity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    paneMat.name = 'enhanced:frame-out-pane';
    paneMat.userData.keepTransparent = true;
  }
  return paneMat;
}

type Mat = THREE.Material;
function Box({ size, pos, material, onPointerDown }: { size: [number, number, number]; pos: [number, number, number]; material: Mat; onPointerDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <mesh position={pos} material={material} onPointerDown={onPointerDown}>
      <boxGeometry args={size} />
    </mesh>
  );
}

export function EnhancedFixture(p: EnhancedFixtureProps) {
  const { type, w, h, sillHeight, faceZ } = p;
  const mat = useEnhancedMaterials();
  const isGlass = type === 'window';
  const isWalk = type === 'walkDoor';
  const isFrameOut = type === 'frameOut';
  const isSlat = type === 'rollUpDoor' || type === 'garageDoor';
  const cut45 = type === 'rollUpDoor' && !!p.cut45;
  const onFloor = sillHeight <= 0.1;
  const F = FIXTURE;
  const tw = F.trimFace;
  const tp = F.trimProj;
  const tz = trimCenterZ(faceZ);
  const pz = panelCenterZ(faceZ);

  // A black window carries its frame color (classic rule); everything else uses the trim color.
  const trim = mat({ surface: 'trim', color: isGlass && p.color ? p.color : p.trimColor });

  // ── click-to-open (view-only) ──
  const swingRef = useRef<THREE.Group>(null);
  const rollRef = useRef<THREE.Group>(null);
  const sashRef = useRef<THREE.Group>(null);
  const secs = (OPEN_SECS as Record<string, number>)[type] ?? 1;
  useOpenAmount(
    p.isOpen && !isFrameOut,
    (t) => {
      if (swingRef.current) swingRef.current.rotation.y = swingAngle(p.impact, t, WALK_DOOR_SWING_RAD_ENHANCED); // hi-impact OUT, standard IN
      if (rollRef.current) rollRef.current.position.y = rollUpTravel(h) * t;
      if (sashRef.current) sashRef.current.position.y = sashTravel(h) * t;
    },
    { kind: 'timed', secs },
  );

  // ── 45° angle-cut roll-up geometry (shared shapes with the classic fixture) ──
  const cutC = cut45Leg(w, h);
  const cutGeo = useMemo(
    () => (cut45 ? { panel: chamferPanelGeometry(w, h, cutC, F.panelDepth), frame: chamferFrameGeometry(w, h, cutC, tw, tp), fill: chamferFillGeometry(w, h, cutC, faceZ) } : null),
    [cut45, w, h, cutC, tw, tp, faceZ, F.panelDepth],
  );
  useEffect(
    () => () => {
      if (cutGeo) for (const g of Object.values(cutGeo)) g.dispose();
    },
    [cutGeo],
  );

  // ── trim: header + jambs (+ bottom bar up the wall; a window gets a sill instead) ──
  const jh = onFloor ? h + tw : h + 2 * tw;
  const jy = onFloor ? tw / 2 : 0;
  const trimEls = cut45 ? (
    <>
      <mesh geometry={cutGeo!.frame} material={trim} position={[0, 0, tz]} />
      <mesh geometry={cutGeo!.fill} material={mat({ surface: 'reveal', color: p.wallColor })} />
    </>
  ) : (
    <>
      <Box size={[w + 2 * tw, tw, tp]} pos={[0, h / 2 + tw / 2, tz]} material={trim} />
      <Box size={[tw, jh, tp]} pos={[-w / 2 - tw / 2, jy, tz]} material={trim} />
      <Box size={[tw, jh, tp]} pos={[w / 2 + tw / 2, jy, tz]} material={trim} />
      {!onFloor && !isGlass && <Box size={[w + 2 * tw, tw, tp]} pos={[0, -h / 2 - tw / 2, tz]} material={trim} />}
    </>
  );

  // ── reveal: wall-colored jamb liner, only inside a sheeted wall ──
  const showReveal = p.sheeted && !isFrameOut && !cut45;
  const reveal = showReveal ? mat({ surface: 'reveal', color: p.wallColor }) : null;
  const rt = F.revealT;
  const rz = faceZ - F.reveal / 2;
  const revealEls = reveal && (
    <>
      <Box size={[rt, h, F.reveal]} pos={[-w / 2 + rt / 2, 0, rz]} material={reveal} />
      <Box size={[rt, h, F.reveal]} pos={[w / 2 - rt / 2, 0, rz]} material={reveal} />
      <Box size={[w, rt, F.reveal]} pos={[0, h / 2 - rt / 2, rz]} material={reveal} />
      {!onFloor && <Box size={[w, rt, F.reveal]} pos={[0, -h / 2 + rt / 2, rz]} material={reveal} />}
    </>
  );

  let unit: ReactNode = null;
  if (isSlat) {
    const clipTopY = rollUpClipY(sillHeight, h);
    const doorColor = p.color || '#ffffff';
    // A garage door reads as ~1 ft panels: the slat tile (4 slats) stretched over 4 ft.
    const slat = mat({ surface: 'slat', color: doorColor, heightFt: type === 'garageDoor' ? h / 4 : h, clipTopY });
    const rail = mat({ surface: 'opening', color: doorColor, clipTopY });
    const handle = mat({ surface: 'hardware', part: 'handle', clipTopY });
    unit = (
      <>
        {/* Curtain + bottom rail + handle rise together; the clip plane hides them above the opening. */}
        <group ref={rollRef}>
          {cutGeo ? (
            <mesh geometry={cutGeo.panel} material={slat} position={[0, 0, pz]} />
          ) : (
            <Box size={[w, h, F.panelDepth]} pos={[0, 0, pz]} material={slat} />
          )}
          {type === 'rollUpDoor' && (
            <>
              <Box size={[w, F.rail.h, F.rail.d]} pos={[0, -h / 2 + F.rail.up, faceZ + F.rail.zOff]} material={rail} />
              <Box size={[F.handle.w, F.handle.h, F.handle.d]} pos={[0, -h / 2 + F.handle.up, faceZ + F.handle.zOff]} material={handle} />
            </>
          )}
        </group>
        {/* FIXED hit plane: the whole opening stays clickable (open or shut). */}
        <mesh position={[0, 0, faceZ]} material={hitMaterial()} onPointerDown={p.onPointerDown} userData={{ captureIgnore: true }}>
          <planeGeometry args={[w, h]} />
        </mesh>
      </>
    );
  } else if (isWalk) {
    const door = mat({ surface: 'door', style: p.doorStyle ?? 'std', dark: isDarkHex(p.color) });
    const rose = mat({ surface: 'hardware', part: 'knobRose' });
    const knob = mat({ surface: 'hardware', part: 'knob' });
    const hinge = mat({ surface: 'hardware', part: 'hinge' });
    const pivotZ = walkDoorPivotZ(p.impact, faceZ);
    const half = F.panelDepth / 2;
    unit = (
      // Hinge pivot on the LEFT jamb (seen from outside); the leaf, knobs and hinges swing together.
      <group position={[walkDoorHingeX(w), 0, pivotZ]}>
        <group ref={swingRef}>
          <group position={[w / 2, 0, pz - pivotZ]}>
            <Box size={[w, h, F.panelDepth]} pos={[0, 0, 0]} material={door} onPointerDown={p.onPointerDown} />
            {([1, -1] as const).map((side) => (
              <group key={`knob${side}`} position={[walkDoorKnobX(w), -h / 2 + F.knobUp, side * half]}>
                <mesh position={[0, 0, side * 0.015]} rotation={[Math.PI / 2, 0, 0]} material={rose}>
                  <cylinderGeometry args={[0.07, 0.07, 0.03, 18]} />
                </mesh>
                <mesh position={[0, 0, side * 0.09]} material={knob}>
                  <sphereGeometry args={[0.06, 18, 14]} />
                </mesh>
              </group>
            ))}
            {[h / 2 - 0.6, 0, -h / 2 + 0.6].map((hy, i) => (
              <Box key={`hinge${i}`} size={[0.05, 0.22, 0.04]} pos={[-w / 2 + 0.05, hy, half - 0.005]} material={hinge} />
            ))}
          </group>
        </group>
      </group>
    );
  } else if (isGlass) {
    const glass = mat({ surface: 'glass' });
    const half = h / 2;
    const sashBars = (y0: number, z: number) => (
      <>
        <Box size={[w, F.sashRail, F.sashBarD]} pos={[0, y0 + half - F.sashRail / 2, z]} material={trim} />
        <Box size={[w, F.sashRail, F.sashBarD]} pos={[0, y0 + F.sashRail / 2, z]} material={trim} />
        <Box size={[F.sashStile, half, F.sashBarD]} pos={[-w / 2 + F.sashStile / 2, y0 + half / 2, z]} material={trim} />
        <Box size={[F.sashStile, half, F.sashBarD]} pos={[w / 2 - F.sashStile / 2, y0 + half / 2, z]} material={trim} />
      </>
    );
    unit = (
      <>
        {/* Upper sash: fixed, outer track. */}
        <Box size={[w, half, F.glassT]} pos={[0, half / 2, faceZ + F.upperSashZ]} material={glass} onPointerDown={p.onPointerDown} />
        {sashBars(0, faceZ + F.upperSashZ + 0.01)}
        {/* Lower sash: inner track, slides up behind the upper sash. */}
        <group ref={sashRef}>
          <Box size={[w, half, F.glassT]} pos={[0, -half / 2, faceZ + F.lowerSashZ]} material={glass} onPointerDown={p.onPointerDown} />
          {sashBars(-half, faceZ + F.lowerSashZ + 0.01)}
          <Box size={[w, F.meetingLip.h, F.meetingLip.d]} pos={[0, F.meetingLip.y, faceZ + F.meetingLip.z]} material={trim} />
        </group>
        {/* Sill below. */}
        <Box size={[w + 2.2 * tw, tw * 0.7, tp + 0.08]} pos={[0, -h / 2 - tw * 0.45, faceZ + tp * 0.4]} material={trim} />
      </>
    );
  } else if (isFrameOut) {
    // A see-through hole: nothing in it but (main building) the classic faint pane.
    unit = (
      <mesh position={[0, 0, faceZ]} material={p.frameOutPane ? frameOutPaneMaterial() : hitMaterial()} onPointerDown={p.onPointerDown} userData={{ captureIgnore: !p.frameOutPane }}>
        <planeGeometry args={[w, h]} />
      </mesh>
    );
  } else {
    unit = <Box size={[w, h, F.panelDepth]} pos={[0, 0, pz]} material={mat({ surface: 'opening', color: p.color || '#ffffff' })} onPointerDown={p.onPointerDown} />;
  }

  return (
    <group name={`enhanced-fixture-${type}`}>
      {trimEls}
      {revealEls}
      {unit}
    </group>
  );
}
