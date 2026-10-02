import { useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Opening, OpeningType, WallSide } from '@/types/building';
import { COMPONENT_OUTSET, SHEET_OUTSET, openingWorldTransform, type LeanToStructure, type StructureModel, type Vec3 } from '@/engine/geometry';
import { clampOffset, checkCollision } from '@/engine/layout';
import { cciCenterClearanceFt } from '@/engine/clearance';
import { TRUSS_CLEARANCE_FT } from '@/config/constants';
import { useBuildingStore } from '@/store/useBuildingStore';
import { useEditorStore } from '@/store/useEditorStore';
import { createSlatTexture, createDoorTexture, type DoorStyle } from './textures';
import { CLICK_DRAG_THRESHOLD_PX, swingAngle, walkDoorHingeX, walkDoorKnobX } from './openingAnim';
import { ftIn, roofLengthLabel } from './dimLabels';
import { useOpenAmount } from './useOpenAmount';
import { interiorPress } from './interiorPress';
import { OpeningHitPlane } from './OpeningFixture';
import { chamferFillGeometry, chamferFrameGeometry, chamferPanelGeometry, cut45Leg } from './cut45Geometry';
import { EnhancedFixture } from './enhanced/fixtures';
import { fixtureFaceZ, mainOpeningsSheeted } from './enhanced/fixtureLayout';

// Re-exported: LeanToSiding and others import ftIn from here.
export { ftIn };

interface OpeningsProps {
  openings: Opening[];
  structure: StructureModel;
  trimColor: string;
  wallColor: string;
  /**
   * Fixture look. Omitted = classic (today's fixtures, the default). 'enhanced'
   * draws enhanced/fixtures.tsx inside the SAME wall transform; placement,
   * drag, click threshold, write-back, guides and Spacing are shared.
   */
  look?: 'classic' | 'enhanced';
}

const PANEL_COLOR: Record<OpeningType, string> = {
  rollUpDoor: '#ffffff', // white doors (standard)
  garageDoor: '#fbfcfd',
  walkDoor: '#ffffff',
  window: '#bfe9ff',
  frameOut: '#0c1622',
};

// Per-type slat textures: roll-up doors get a tight ~3" slat curtain, garage
// doors a wider ~12" panel — both distinct from the wall rib profile.
const _slatCache: Record<string, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }> = {};
const slatTexFor = (type: OpeningType) =>
  (_slatCache[type] ??= createSlatTexture('#f7f9fc', type === 'rollUpDoor' ? 4 : 1));

// Walk-door face textures, cached per (style, white/black).
const _doorTexCache: Record<string, THREE.CanvasTexture> = {};
const doorTexFor = (style: DoorStyle, dark: boolean) =>
  (_doorTexCache[style + (dark ? '-blk' : '-wht')] ??= createDoorTexture(style, dark));
// A color counts as "black/dark" when its luminance is low (the bridge sends a
// black hex for black doors; white doors leave color unset).
const isDarkHex = (hex?: string): boolean => {
  if (!hex) return false;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
};

export function Openings({ openings, structure, trimColor, wallColor, look = 'classic' }: OpeningsProps) {
  // Render an opening wherever it's placed — doors / frame-outs commonly go on
  // open carport ends, gable-only ends, and partial-sheeted sides. The only
  // guard: a partition opening needs an actual partition (GCH split) to exist.
  const visible = openings.filter((o) => o.side !== 'partition' || structure.enclosure.partitionZ !== null);
  const selectedId = useEditorStore((s) => s.selectedOpeningId);
  const showSpacing = useEditorStore((s) => s.showSpacing);
  const sel = visible.find((o) => o.id === selectedId);
  const enhanced = look === 'enhanced';
  // Enhanced only: which openings have sheeting around them (they get a reveal).
  const sheetedKey = enhanced ? JSON.stringify(visible.map((o) => [o.id, o.type, o.side, o.offset, o.width, o.height, o.sillHeight])) : '';
  const sheeted = useMemo(
    () => (enhanced ? mainOpeningsSheeted(structure, visible) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sheetedKey covers the openings
    [enhanced, structure, sheetedKey],
  );
  return (
    <group>
      {visible.map((o) => (
        <DraggableOpening
          key={o.id}
          opening={o}
          structure={structure}
          trimColor={trimColor}
          wallColor={wallColor}
          enhanced={enhanced}
          sheeted={!!sheeted?.[o.id]}
        />
      ))}
      {showSpacing && <SpacingOverlay openings={visible} structure={structure} />}
      {sel && !showSpacing && (
        <OpeningDimensions
          opening={sel}
          structure={structure}
          siblings={visible.filter((o) => o.side === sel.side)}
        />
      )}
    </group>
  );
}

function DraggableOpening({
  opening,
  structure,
  trimColor,
  wallColor,
  enhanced = false,
  sheeted = false,
}: {
  opening: Opening;
  structure: StructureModel;
  trimColor: string;
  wallColor: string;
  /** Draw the enhanced fixture (same transform, same pointer handling). */
  enhanced?: boolean;
  /** Enhanced only: sheeting surrounds this opening (reveal). */
  sheeted?: boolean;
}) {
  const updateOpening = useBuildingStore((s) => s.updateOpening);
  const { selectOpening, setActiveWall, setDragging } = useEditorStore();
  // Camera/renderer for manual drag raycasting; controls disabled while dragging.
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const dragRef = useRef(false);

  // Click-to-open animation (Sensei-style): walk door swings open on its
  // hinges, roll-up/garage door rolls up, window's lower sash slides up. A
  // CLICK toggles it; a real drag (CLICK_DRAG_THRESHOLD_PX = 5px or more) still just slides the part.
  const isOpen = useEditorStore((s) => !!s.openIds[opening.id]);
  const toggleOpen = useEditorStore((s) => s.toggleOpen);
  const swingRef = useRef<THREE.Group>(null);
  const rollRef = useRef<THREE.Group>(null);
  const sashRef = useRef<THREE.Group>(null);
  // Classic motion (the enhanced fixture runs its own). useOpenAmount keeps the
  // classic ease, snaps shut when a PDF capture starts (captureMode) and snaps
  // under prefers-reduced-motion.
  useOpenAmount(isOpen, (t) => {
    if (swingRef.current) swingRef.current.rotation.y = swingAngle(opening.impact, t); // hi-impact swings OUT, standard swings IN (hinge left, knob right)
    if (rollRef.current) {
      const k = 0.9 * t; // roll up to ~10% showing at the header
      rollRef.current.scale.y = 1 - k;
      rollRef.current.position.y = (opening.height * k) / 2; // keep the top edge fixed
    }
    if (sashRef.current) sashRef.current.position.y = t * (opening.height / 2) * 0.9;
  });

  const wall = structure.walls[opening.side];

  // World-space plane of this opening's wall — drags raycast against it.
  const wallPlane = useMemo(() => plyForWall(opening.side, structure), [opening.side, structure]);

  const yCenter = opening.sillHeight + opening.height / 2;
  const { pos, rotY } = openingWorldTransform(opening.side, opening.offset, yCenter, structure);

  const w = opening.width;
  const h = opening.height;
  const isGlass = opening.type === 'window';
  const isSlat = opening.type === 'rollUpDoor' || opening.type === 'garageDoor';
  const isFrameOut = opening.type === 'frameOut';
  const isWalk = opening.type === 'walkDoor';
  const doorDark = isDarkHex(opening.color);
  // Roll-up "45° Angle Cut": a SMALL manufacturer-style clip on both top
  // corners (~6"–10"), not a structural brace. Subtle + proportional so the
  // door still reads as a clean rectangle with clipped corners (matches Sensei
  // / IdeaRoom), never a trapezoid.
  const cut45 = opening.type === 'rollUpDoor' && !!opening.cut45;
  const cutC = cut45Leg(w, h); // chamfer leg (equal H/V = 45°)

  const panelMat = useMemo(() => {
    if (enhanced) return null; // the enhanced fixture uses the shared enhanced materials
    if (isWalk) {
      // Walk-through door face: style (std/6-panel/9-lite/diamond) + white/black.
      const map = doorTexFor((opening.doorStyle ?? 'std') as DoorStyle, doorDark);
      return new THREE.MeshStandardMaterial({ map, metalness: 0.18, roughness: 0.55 });
    }
    if (isSlat) {
      const base = slatTexFor(opening.type);
      const map = base.map.clone();
      const bump = base.bump.clone();
      map.needsUpdate = bump.needsUpdate = true;
      const tiles = Math.max(2, Math.round(h)); // 1 tile = 1 ft of slats
      map.repeat.set(1, tiles);
      bump.repeat.set(1, tiles);
      // The slat texture is near-white, so the material color tints it — a CCI
      // colored roll-up door carries its own hex (opening.color); default white.
      return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.03, color: opening.color || PANEL_COLOR[opening.type], metalness: 0.12, roughness: 0.5 });
    }
    if (isGlass) {
      // Neutral grey reflective glazing (matches IdeaRoom — not bright blue).
      const m = new THREE.MeshStandardMaterial({
        color: '#aab4ba',
        metalness: 0.35,
        roughness: 0.08,
        envMapIntensity: 1.25,
        transparent: true,
        opacity: 0.78,
      });
      // Don't let the view-mode shell-opacity pass stomp the glass back to solid.
      m.userData.keepTransparent = true;
      return m;
    }
    if (isFrameOut) {
      // A framed opening is an OPEN cut: just framing, you see right through it.
      // The wall sheeting is actually cut around it, so this pane only needs to
      // READ as a faint open void — very low opacity, depthWrite off so it never
      // hides what's behind. keepTransparent stops ShellGroup forcing it opaque.
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
    return new THREE.MeshStandardMaterial({
      color: PANEL_COLOR[opening.type],
      metalness: 0.3,
      roughness: 0.6,
    });
  }, [enhanced, isWalk, isSlat, isGlass, isFrameOut, opening.type, h, opening.color, opening.doorStyle, doorDark]);

  // Door panel with both top corners cut at 45° (extruded chamfered rectangle).
  const t = 0.17; // jamb/header face ~2" (spec 2–3") — folded flashing
  const trimDepth = 0.07; // shallow proud depth (not a thick picture frame)

  // 45° angle-cut shapes (cut45Geometry.ts, shared with the enhanced fixture):
  // the chamfered panel (UVs 0..1 so the slats tile like the box panel), ONE
  // continuous folded U-frame trim following the chamfered outline, and
  // wall-colored corner caps at the WALL plane so the cut corners read as
  // solid sheeting instead of a see-through gap. Classic only.
  const cutGeo = useMemo(
    () => (cut45 && !enhanced ? chamferPanelGeometry(w, h, cutC, isFrameOut ? 0.06 : 0.09) : null),
    [cut45, enhanced, cutC, w, h, isFrameOut],
  );
  const cutFrameGeo = useMemo(
    () => (cut45 && !enhanced ? chamferFrameGeometry(w, h, cutC, t, trimDepth) : null),
    [cut45, enhanced, cutC, w, h, t, trimDepth],
  );
  const cutFillGeo = useMemo(
    // z = the wall sheeting plane in the fixture frame
    () => (cut45 && !enhanced ? chamferFillGeometry(w, h, cutC, -(COMPONENT_OUTSET - SHEET_OUTSET)) : null),
    [cut45, enhanced, cutC, w, h],
  );

  // --- Direct 3D drag: grab the component and slide it along its wall ---
  // Uses window-level listeners + manual raycast so the drag never depends on
  // R3F pointer-capture and OrbitControls can't fight it.
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    // Walk-in Interior: a drag looks around (never slides the part); a click
    // still selects it and opens / closes it.
    if (
      interiorPress(e.nativeEvent, () => {
        selectOpening(opening.id);
        setActiveWall(opening.side);
        if (opening.type !== 'frameOut') toggleOpen(opening.id);
      })
    )
      return;
    selectOpening(opening.id);
    setActiveWall(opening.side);
    setDragging(true);
    dragRef.current = true;
    if (controls) controls.enabled = false; // hard-disable orbit during the drag

    const oid = opening.id;
    const oside = opening.side;
    const ow = opening.width;
    const sx = e.nativeEvent.clientX, sy = e.nativeEvent.clientY;
    let moved = 0;
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      moved = Math.max(moved, Math.hypot(ev.clientX - sx, ev.clientY - sy));
      if (moved < CLICK_DRAG_THRESHOLD_PX) return; // not a drag yet — a click stays a click (opens/closes)
      if (!useEditorStore.getState().dragMoved) useEditorStore.getState().setDragMoved(true);
      const rect = gl.domElement.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(wallPlane, hit)) {
        updateOpening(oid, { offset: clampOffset(worldToOffset(oside, hit, structure), ow, wall) });
      }
    };
    const up = () => {
      dragRef.current = false;
      if (controls) controls.enabled = true;
      if (moved < CLICK_DRAG_THRESHOLD_PX && opening.type !== 'frameOut') toggleOpen(oid);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Keep `dragging` true through this pointerup so the canvas's
      // click-empty-to-deselect doesn't fire and drop the selection.
      setTimeout(() => setDragging(false), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (enhanced) {
    // Same wall transform, same onDown (drag / click / write-back); only the look differs.
    return (
      <group>
        <group position={pos} rotation={[0, rotY, 0]}>
          <EnhancedFixture
            type={opening.type}
            w={w}
            h={h}
            sillHeight={opening.sillHeight}
            faceZ={fixtureFaceZ(opening.side, structure.enclosure.partitionKind !== 'storage')}
            trimColor={trimColor}
            wallColor={wallColor}
            color={opening.color}
            doorStyle={opening.doorStyle}
            impact={opening.impact}
            cut45={cut45}
            sheeted={sheeted}
            frameOutPane
            isOpen={isOpen}
            onPointerDown={onDown}
          />
        </group>
      </group>
    );
  }

  const panelDepth = isFrameOut ? 0.06 : isGlass ? 0.035 : 0.09;
  const panelZ = isGlass ? -0.025 : 0; // recess glass behind the proud frame
  const onFloor = opening.sillHeight <= 0.1;
  // A black window carries its frame color (opening.color) — black-framed glass.
  const tc = isGlass && opening.color ? opening.color : trimColor;
  const pm = panelMat!; // classic: always built

  return (
    <group>
      <group position={pos} rotation={[0, rotY, 0]}>
        {/* Proud jamb / header / sill trim — floor-mounted doors omit the sill.
            A 45° angle-cut roll-up shortens the jambs to the cut, runs a flat
            top trim only across the un-cut middle, and adds a diagonal trim bar
            down each chamfer. */}
        {cut45 ? (
          <>
            {/* One continuous folded U-frame (jambs + header + corner clips) —
                uniform width, cleanly mitered corners, open at the floor. */}
            {cutFrameGeo && (
              <mesh geometry={cutFrameGeo}>
                <meshStandardMaterial color={tc} metalness={0.08} roughness={0.5} />
              </mesh>
            )}
            {/* Wall-colored caps so the clipped corners read as solid sheeting, not a see-through hole. */}
            {cutFillGeo && (
              <mesh geometry={cutFillGeo}>
                <meshStandardMaterial color={wallColor} metalness={0.0} roughness={0.9} side={THREE.DoubleSide} />
              </mesh>
            )}
          </>
        ) : (
          <>
            <TrimBar pos={[0, h / 2 + t / 2, 0]} size={[w + 2 * t, t, trimDepth]} color={tc} />
            <TrimBar pos={[-w / 2 - t / 2, onFloor ? t / 2 : 0, 0]} size={[t, onFloor ? h + t : h + 2 * t, trimDepth]} color={tc} />
            <TrimBar pos={[w / 2 + t / 2, onFloor ? t / 2 : 0, 0]} size={[t, onFloor ? h + t : h + 2 * t, trimDepth]} color={tc} />
          </>
        )}
        {!onFloor && <TrimBar pos={[0, -h / 2 - t / 2, 0]} size={[w + 2 * t, t, trimDepth]} color={tc} />}

        {/* Panel — flush slab (door) or recessed glazing (window) — grab + drag.
            45° cut roll-up uses the chamfered extrusion instead of a box. */}
        {cutGeo ? (
          <group ref={rollRef}>
            <mesh position={[0, 0, panelZ]} geometry={cutGeo} material={pm} castShadow />
            <RollUpRail w={w} h={h} panelDepth={panelDepth} color={opening.color} />
          </group>
        ) : isWalk ? (
          // Hinge pivot on the left jamb so the slab SWINGS open (click to toggle).
          <group position={[walkDoorHingeX(w), 0, 0]}>
            <group ref={swingRef}>
              <group position={[w / 2, 0, 0]}>
                <mesh position={[0, 0, panelZ]} material={pm} castShadow onPointerDown={onDown}>
                  <boxGeometry args={[w, h, panelDepth]} />
                </mesh>
                <WalkDoorHardware w={w} h={h} panelDepth={panelDepth} />
              </group>
            </group>
          </group>
        ) : isGlass ? (
          // Double-hung: fixed upper sash + a lower sash that slides up when opened.
          <>
            <mesh position={[0, h / 4, panelZ]} material={pm} onPointerDown={onDown}>
              <boxGeometry args={[w, h / 2, panelDepth]} />
            </mesh>
            <group ref={sashRef}>
              <mesh position={[0, -h / 4, panelZ + 0.03]} material={pm} onPointerDown={onDown}>
                <boxGeometry args={[w, h / 2, panelDepth]} />
              </mesh>
              {/* meeting rail rides on top of the lower sash */}
              <TrimBar pos={[0, 0, trimDepth / 2 - 0.01]} size={[w + 0.02, 0.11, 0.05]} color={tc} />
            </group>
          </>
        ) : (
          <group ref={isSlat ? rollRef : undefined}>
            <mesh position={[0, 0, panelZ]} material={pm} castShadow={!isFrameOut} onPointerDown={isSlat ? undefined : onDown}>
              <boxGeometry args={[w, h, panelDepth]} />
            </mesh>
            {opening.type === 'rollUpDoor' && <RollUpRail w={w} h={h} panelDepth={panelDepth} color={opening.color} />}
          </group>
        )}

        {/* Window — double-hung (1-over-1): a single proud white meeting rail
            splits the recessed glass top/bottom, with a sill below. */}
        {isGlass && (
          <group>
            {/* (meeting rail now rides on the sliding lower sash, above) */}
            {/* thin sash frame just inside the jambs for depth */}
            <TrimBar pos={[0, h / 2 - 0.03, trimDepth / 2 - 0.02]} size={[w, 0.06, 0.04]} color={tc} />
            <TrimBar pos={[0, -h / 2 + 0.03, trimDepth / 2 - 0.02]} size={[w, 0.06, 0.04]} color={tc} />
            {/* proud sill board under the opening */}
            <mesh position={[0, -h / 2 - t * 0.45, trimDepth * 0.4]} castShadow>
              <boxGeometry args={[w + 2.2 * t, t * 0.7, trimDepth + 0.08]} />
              <meshStandardMaterial color={tc} metalness={0.08} roughness={0.5} />
            </mesh>
          </group>
        )}

        {/* Walk-door hardware + roll-up rail live INSIDE the moving panel groups
            above (WalkDoorHardware / RollUpRail) so they travel with the slab. */}

        {/* Roll-up / garage door: a FIXED invisible hit plane the size of the
            opening takes the clicks and drags, so the door stays clickable
            (to close) wherever the rolled curtain is. Draws nothing. */}
        {isSlat && <OpeningHitPlane w={w} h={h} z={panelDepth / 2} onPointerDown={onDown} />}

        {/* Components are added / duplicated / removed in the pricing program
            (the source of truth that also prices them); the 3D only positions
            them, so no on-model add/dup/delete toolbar here. */}
      </group>
    </group>
  );
}

/** World-space plane of a wall's outer (sheeting) face, for drag raycasting. */
function plyForWall(side: WallSide, structure: StructureModel): THREE.Plane {
  const halfW = structure.width / 2;
  const halfL = structure.length / 2;
  const o = COMPONENT_OUTSET;
  switch (side) {
    case 'left':
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), halfW + o);
    case 'right':
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -(halfW + o));
    case 'front':
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), halfL + o);
    case 'back':
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -(halfL + o));
    case 'partition': {
      // GCH divider: in its sheet plane. End Storage: the fixture face, like any wall.
      const enc = structure.enclosure;
      const z = (enc.partitionZ ?? 0) + (enc.partitionKind === 'storage' ? partFaces(structure) * o : 0);
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    }
  }
}

function TrimBar({
  pos,
  size,
  color,
}: {
  pos: [number, number, number];
  size: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={pos} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={0.08} roughness={0.5} envMapIntensity={0.3} />
    </mesh>
  );
}

/** Walk door: round knob (latch side, ~36" up) + 3 hinges (jamb side). */
function WalkDoorHardware({ w, h, panelDepth }: { w: number; h: number; panelDepth: number }) {
  return (
    <group>
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
  );
}

/** Roll-up door: heavier bottom rail (door-colored) + center lift handle. */
function RollUpRail({ w, h, panelDepth, color }: { w: number; h: number; panelDepth: number; color?: string }) {
  return (
    <group>
      <mesh position={[0, -h / 2 + 0.11, panelDepth / 2 + 0.005]} castShadow>
        <boxGeometry args={[w, 0.2, panelDepth + 0.02]} />
        <meshStandardMaterial color={color || '#dfe2e7'} metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, -h / 2 + 0.42, panelDepth / 2 + 0.04]} castShadow>
        <boxGeometry args={[0.5, 0.07, 0.05]} />
        <meshStandardMaterial color="#8a9099" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

export const RED = '#ef4444';
export const RED_DIM = '#fb7185';

/**
 * IdeaRoom-style live placement guides for the selected/dragging component:
 *  - red measurement lines + ft-in chips to the nearest neighbor AND each corner
 *  - a height dimension (turns red on a truss conflict)
 *  - vertical red truss/post guides through/behind the component (bright when hit)
 * All guides draw on top (depthTest off) and the labels face the camera.
 */
function OpeningDimensions({
  opening,
  structure,
  siblings,
}: {
  opening: Opening;
  structure: StructureModel;
  siblings: Opening[];
}) {
  const wall = structure.walls[opening.side];
  const { width: w, height: h, sillHeight: sill, offset } = opening;
  const L = offset - w / 2;
  const R = offset + w / 2;
  const span = wall.spanFt;
  const eave = wall.eaveHeightFt;
  const top = Math.min(eave - 0.2, sill + h);
  const baseY = 0.4;

  // Nearest neighbor opening edge on each side (null if none).
  let leftN: number | null = null;
  let rightN: number | null = null;
  for (const o of siblings) {
    if (o.id === opening.id) continue;
    const oL = o.offset - o.width / 2;
    const oR = o.offset + o.width / 2;
    if (oR <= L + 1e-6) leftN = Math.max(leftN ?? -Infinity, oR);
    if (oL >= R - 1e-6) rightN = Math.min(rightN ?? Infinity, oL);
  }

  // Truss/post positions on this wall.
  const trusses = wall.trussLines.map((t) => t.posFt);
  const guideTrusses = trusses.filter((p) => p >= L - 1.5 && p <= R + 1.5);
  // A door needs a side frame when an INTERIOR frame leg is inside the opening
  // OR within the jamb clearance (2") of either edge — shared checkCollision()
  // so the 3D guide, the building flag and the quote's side-frame pricing all
  // agree. (A leg exactly the clearance away clears.)
  const isInterior = (p: number) => p > 0.05 && p < span - 0.05;
  const edgeDist = (p: number) => (p < L ? L - p : p > R ? p - R : -1);
  const hit = checkCollision(offset, w, wall).hit;

  // Point on the guide plane (pushed just in front of the component).
  const pt = (along: number, y: number): Vec3 =>
    pushOut(openingWorldTransform(opening.side, along, y, structure).pos, opening.side, 0.22, partFaces(structure));

  return (
    <group>
      {/* Vertical truss/post guides (only while editing this component) */}
      {guideTrusses.map((p, i) => {
        const conflict = isInterior(p) && edgeDist(p) < TRUSS_CLEARANCE_FT;
        return (
          <GuideLine
            key={`tr-${i}`}
            a={pt(p, 0)}
            b={pt(p, eave)}
            color={conflict ? RED : RED_DIM}
            thick={conflict ? 0.07 : 0.04}
          />
        );
      })}

      {/* Distance to nearest neighbor (top), if any */}
      {leftN !== null && <Measure a={pt(leftN, top)} b={pt(L, top)} mid={pt((leftN + L) / 2, top)} label={ftIn(L - leftN)} />}
      {rightN !== null && <Measure a={pt(R, top)} b={pt(rightN, top)} mid={pt((R + rightN) / 2, top)} label={ftIn(rightN - R)} />}

      {/* Distance to each corner (bottom) */}
      <Measure a={pt(0, baseY)} b={pt(L, baseY)} mid={pt(L / 2, baseY)} label={ftIn(L)} />
      <Measure a={pt(R, baseY)} b={pt(span, baseY)} mid={pt((R + span) / 2, baseY)} label={ftIn(span - R)} />

      {/* Height (red on conflict) */}
      <Measure a={pt(L - 0.05, sill)} b={pt(L - 0.05, top)} mid={pt(L - 0.05, (sill + top) / 2)} label={ftIn(h)} vertical danger={hit} />

      {hit && <Chip3D at={pt(offset, Math.min(eave - 0.1, top + 0.9))} label="⚠ on truss" danger />}
    </group>
  );
}

const SPACING_SIDES: WallSide[] = ['front', 'back', 'left', 'right'];

/** Size chip text: walk doors + windows in inches (36"x80"), big doors in ft. */
function sizeLabel(o: Opening): string {
  if (o.type === 'walkDoor' || o.type === 'window') return `${Math.round(o.width * 12)}"x${Math.round(o.height * 12)}"`;
  return `${ftIn(o.width)}x${ftIn(o.height)}`;
}

/**
 * "Spacing" overlay: on every wall FACING the camera, every component's size
 * plus the full spacing chain (corner → component → component → corner),
 * sill heights, wall height, overall width and (gables) peak height — all at
 * once, unlike Sensei which only shows spacing for the clicked component.
 * Back-facing walls are skipped so an iso view isn't a wall of labels.
 */
function SpacingOverlay({ openings, structure }: { openings: Opening[]; structure: StructureModel }) {
  const camera = useThree((s) => s.camera);
  const [facing, setFacing] = useState('');
  useFrame(() => {
    const f = SPACING_SIDES.filter((side) => {
      const wall = structure.walls[side];
      if (!wall) return false;
      const c = openingWorldTransform(side, wall.spanFt / 2, wall.eaveHeightFt / 2, structure).pos;
      const o = pushOut(c, side, 1, partFaces(structure));
      const dot =
        (camera.position.x - c[0]) * (o[0] - c[0]) +
        (camera.position.y - c[1]) * (o[1] - c[1]) +
        (camera.position.z - c[2]) * (o[2] - c[2]);
      return dot > 0;
    }).join(',');
    if (f !== facing) setFacing(f);
  });
  return (
    <group>
      {facing
        .split(',')
        .filter(Boolean)
        .map((side) => (
          <WallSpacing key={side} side={side as WallSide} openings={openings.filter((o) => o.side === side)} structure={structure} />
        ))}
      {(structure.leanTos ?? []).map((lt) => (
        <LeanToSpacing key={lt.id} lt={lt} structure={structure} />
      ))}
    </group>
  );
}

/**
 * Spacing overlay for each LEAN-TO (owner 9/29/26: "it should reflect all
 * dimensions of the lean-to, not just the main building"). On the lean-to end
 * facing the camera: LOW LEG height, HIGH SIDE (connection) height, width out
 * from the building and roof pitch. When its outer side faces the camera: its
 * length, roof-edge length with overhang, and where it starts/stops along a
 * longer building wall — plus, with a storage section, the storage length
 * (end wall -> partition). Lean-to door/window/roll-up/frame-out sizes, gaps and
 * sills on lean-to walls (incl. the storage partition) are drawn by
 * LeanToSpacing.tsx (render-upgrade P7).
 */
function LeanToSpacing({ lt, structure }: { lt: LeanToStructure; structure: StructureModel }) {
  const camera = useThree((st) => st.camera);
  const eaveAtt = lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
  const inA = eaveAtt ? lt.inner.x : lt.inner.z; // at the building (high side)
  const outA = eaveAtt ? lt.outer.x : lt.outer.z; // free edge (low leg)
  const dirA = Math.sign(outA - inA) || 1; // away from the building
  const s0 = lt.spanStart, s1 = lt.spanEnd;
  const lh = lt.lowLegHeightFt, hh = lt.peakHeightFt;
  const W = Math.abs(outA - inA), L = Math.abs(s1 - s0);
  const oh = structure.roofOverhangFt ?? 0;
  // main-building extent along the lean-to's run axis
  const runMin = eaveAtt ? -structure.length / 2 : -structure.width / 2;
  const runMax = -runMin;
  // local (across, run, up) → world
  const P = (a: number, r: number, y: number): Vec3 => (eaveAtt ? [a, y, r] : [r, y, a]);

  const [face, setFace] = useState('outer,front');
  useFrame(() => {
    const camA = eaveAtt ? camera.position.x : camera.position.z;
    const camR = eaveAtt ? camera.position.z : camera.position.x;
    const f = [
      (camA - outA) * dirA > 0 ? 'outer' : '',
      camR < s0 ? 'front' : '',
      camR > s1 ? 'back' : '',
    ].filter(Boolean).join(',');
    if (f !== face) setFace(f);
  });
  const sees = (k: string) => face.split(',').includes(k);
  const seeFront = sees('front'), seeBack = sees('back'), seeOuter = sees('outer');
  // Dimension the END you can see (front if both/neither).
  const endR = seeBack && !seeFront ? s1 : s0;
  const endOut = endR === s0 ? -1 : 1;
  const OFF = 0.6;
  const rEnd = endR + endOut * OFF;
  const pitch = W > 0 ? Math.round(((hh - lh) / W) * 12 * 2) / 2 : 0;
  // Storage length line: at the slab like "lean-to L", one step further out
  // from the wall (clear of the wall's gap chain, sill heights and door chips).
  const STOR_OFF = OFF + 1.2;
  // Behind the building (none of its walls face the camera) → show nothing; the
  // labels draw on top of everything and would float through the main walls.
  if (!seeFront && !seeBack && !seeOuter) return null;
  return (
    <group>
      {/* End facing the camera: low leg, high side, width, pitch */}
      <Measure a={P(outA + dirA * OFF, rEnd, 0)} b={P(outA + dirA * OFF, rEnd, lh)} mid={P(outA + dirA * OFF, rEnd, lh * 0.55)} label={`${ftIn(lh)} low leg`} vertical />
      <Measure a={P(inA + dirA * 1.2, rEnd - endOut * 0.6 + endOut * 1.4, 0)} b={P(inA + dirA * 1.2, rEnd - endOut * 0.6 + endOut * 1.4, hh)} mid={P(inA + dirA * 1.2, rEnd - endOut * 0.6 + endOut * 1.4, hh * 0.62)} label={`${ftIn(hh)} high side`} vertical />
      <Measure a={P(inA, rEnd, 0.3)} b={P(outA, rEnd, 0.3)} mid={P((inA + outA) / 2, rEnd, 0.3)} label={`${ftIn(W)} lean-to W`} />
      {pitch > 0 && <Chip3D at={P((inA + outA) / 2, rEnd, (lh + hh) / 2 + 0.55)} label={`${pitch}:12 pitch`} />}

      {/* Outer side facing the camera: length, roof edge, where it sits on the building */}
      {seeOuter && (
        <>
          <Measure a={P(outA + dirA * OFF, s0, 0.3)} b={P(outA + dirA * OFF, s1, 0.3)} mid={P(outA + dirA * OFF, (s0 + s1) / 2, 0.3)} label={`${ftIn(L)} lean-to L`} />
          <Measure a={P(outA + dirA * (OFF + oh), s0 - oh, lh + 0.45)} b={P(outA + dirA * (OFF + oh), s1 + oh, lh + 0.45)} mid={P(outA + dirA * (OFF + oh), (s0 + s1) / 2, lh + 0.45)} label={`${ftIn(L + 2 * oh)} roof`} />
          {s0 - runMin > 0.05 && (
            <Measure a={P(outA + dirA * OFF, runMin, 0.3)} b={P(outA + dirA * OFF, s0, 0.3)} mid={P(outA + dirA * OFF, (runMin + s0) / 2, 0.3)} label={`${ftIn(s0 - runMin)} no lean-to`} />
          )}
          {runMax - s1 > 0.05 && (
            <Measure a={P(outA + dirA * OFF, s1, 0.3)} b={P(outA + dirA * OFF, runMax, 0.3)} mid={P(outA + dirA * OFF, (s1 + runMax) / 2, 0.3)} label={`${ftIn(runMax - s1)} no lean-to`} />
          )}
          {/* Storage section: its length along the outer wall, end wall -> partition. */}
          {lt.storage && (
            <Measure
              a={P(outA + dirA * STOR_OFF, s0 + lt.storage.segStart, 0.3)}
              b={P(outA + dirA * STOR_OFF, s0 + lt.storage.segEnd, 0.3)}
              mid={P(outA + dirA * STOR_OFF, s0 + (lt.storage.segStart + lt.storage.segEnd) / 2, 0.3)}
              label={`${ftIn(lt.storage.lengthFt)} storage`}
            />
          )}
        </>
      )}
    </group>
  );
}

function WallSpacing({ side, openings, structure }: { side: WallSide; openings: Opening[]; structure: StructureModel }) {
  const wall = structure.walls[side];
  const span = wall.spanFt;
  const eave = wall.eaveHeightFt;
  const peak = wall.peakHeightFt;
  const gable = peak > eave + 0.1;
  const items = [...openings].sort((a, b) => a.offset - b.offset);
  const pt = (along: number, y: number): Vec3 => pushOut(openingWorldTransform(side, along, y, structure).pos, side, 0.22, partFaces(structure));
  // CCI center clearance (owner 9/29/26): how much headroom there is in the
  // middle before you hit the center braces — CCI chart, gable walls only.
  const mfr = useBuildingStore((st) => st.manufacturer);
  const roofStyle = useBuildingStore((st) => st.roofStyle);
  const centerClr = gable && (side === 'front' || side === 'back') && !structure.monoDropFt
    ? cciCenterClearanceFt(mfr, roofStyle, structure.width, structure.legHeight)
    : null;

  // Spacing chain: every corner/edge stop; label each GAP (openings get a size chip instead).
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const stops = Array.from(
    new Set([0, span, ...items.flatMap((o) => [r3(o.offset - o.width / 2), r3(o.offset + o.width / 2)])]),
  ).sort((a, b) => a - b);
  const isOpening = (a: number, b: number) =>
    items.some((o) => Math.abs(o.offset - o.width / 2 - a) < 0.02 && Math.abs(o.offset + o.width / 2 - b) < 0.02);
  const gaps: Array<[number, number]> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (b - a > 0.05 && !isOpening(a, b)) gaps.push([a, b]);
  }
  const gapY = Math.min(1.3, eave * 0.25);
  const allY = 0.3;
  const oh = structure.roofOverhangFt ?? 0;

  return (
    <group>
      {gaps.map(([a, b], i) => (
        <Measure key={`g${i}`} a={pt(a, gapY)} b={pt(b, gapY)} mid={pt((a + b) / 2, gapY)} label={ftIn(b - a)} />
      ))}
      {items.map((o) => {
        const top = o.sillHeight + o.height;
        const chipY = gable ? top + 0.6 : Math.min(eave - 0.35, top + 0.6);
        const L = o.offset - o.width / 2;
        return (
          <group key={o.id}>
            <Chip3D at={pt(o.offset, chipY)} label={sizeLabel(o)} />
            {o.sillHeight > 0.1 && (
              <Measure
                a={pt(L - 0.2, 0)}
                b={pt(L - 0.2, o.sillHeight)}
                mid={pt(L - 0.2, o.sillHeight / 2)}
                label={`sill ${ftIn(o.sillHeight)}`}
                vertical
              />
            )}
          </group>
        );
      })}
      <Measure a={pt(0, allY)} b={pt(span, allY)} mid={pt(span / 2, allY)} label={`${ftIn(span)}W`} />
      <Measure a={pt(0.35, 0)} b={pt(0.35, eave)} mid={pt(0.35, eave * 0.6)} label={`${ftIn(eave)}H`} vertical />
      {/* Roof line: wall length + overhang past each end (6" std => 50' wall = 51' roof). */}
      {!gable && (
        <Measure
          a={pt(-oh, eave + 0.45)}
          b={pt(span + oh, eave + 0.45)}
          mid={pt(span / 2, eave + 0.45)}
          label={roofLengthLabel(span, oh)}
        />
      )}
      {gable && (
        <Measure a={pt(span / 2, eave)} b={pt(span / 2, peak)} mid={pt(span / 2, (eave + peak) / 2)} label={`${ftIn(peak)}H`} vertical />
      )}
      {centerClr != null && (
        <Measure
          a={pt(span / 2 + 1.2, 0)}
          b={pt(span / 2 + 1.2, centerClr)}
          mid={pt(span / 2 + 1.2, centerClr * 0.5)}
          label={`${ftIn(centerClr)} center clearance`}
          vertical
        />
      )}
    </group>
  );
}

/** A red dimension line with end ticks and a centered ft-in chip. */
export function Measure({
  a,
  b,
  mid,
  label,
  vertical,
  danger,
}: {
  a: Vec3;
  b: Vec3;
  mid: Vec3;
  label: string;
  vertical?: boolean;
  danger?: boolean;
}) {
  const tick = 0.22;
  const col = danger ? '#dc2626' : RED;
  return (
    <group>
      <GuideLine a={a} b={b} color={col} />
      {!vertical && (
        <>
          <GuideLine a={[a[0], a[1] - tick, a[2]]} b={[a[0], a[1] + tick, a[2]]} color={col} />
          <GuideLine a={[b[0], b[1] - tick, b[2]]} b={[b[0], b[1] + tick, b[2]]} color={col} />
        </>
      )}
      <Chip3D at={mid} label={label} danger={danger} />
    </group>
  );
}

const UP_Y = new THREE.Vector3(0, 1, 0);

/** A thin always-on-top guide line (a stretched box), guaranteed to render. */
export function GuideLine({ a, b, color, thick = 0.06 }: { a: Vec3; b: Vec3; color: string; thick?: number }) {
  const data = useMemo(() => {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length();
    if (!(len > 0.02) || !isFinite(len)) return null; // skip degenerate segments
    const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP_Y, dir.divideScalar(len));
    return { position: mid, quaternion: q, length: len };
  }, [a, b]);
  if (!data) return null;
  return (
    <mesh position={data.position} quaternion={data.quaternion} renderOrder={999}>
      <boxGeometry args={[thick, data.length, thick]} />
      <meshBasicMaterial color={color} depthTest={false} transparent toneMapped={false} />
    </mesh>
  );
}

export function Chip3D({ at, label, danger }: { at: Vec3; label: string; danger?: boolean }) {
  return (
    <Html position={at} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          background: danger ? '#dc2626' : '#1d4ed8',
          border: `1px solid ${danger ? '#fecaca' : '#93c5fd'}`,
          color: '#ffffff',
          font: '700 14px ui-monospace, monospace',
          padding: '3px 8px',
          borderRadius: 5,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,.55)',
        }}
      >
        {label}
      </div>
    </Html>
  );
}

/** ±Z the partition's viewer side faces: the GCH open bay (−Z), or an End Storage room's main-room face. */
function partFaces(structure: StructureModel): -1 | 1 {
  return structure.enclosure.partitionKind === 'storage' ? (structure.enclosure.partitionFaces ?? -1) : -1;
}

/** Push a wall point outward (toward the viewer side) by `d` ft. `pf` = the partition's viewer side (partFaces). */
function pushOut(pos: Vec3, side: WallSide, d: number, pf: -1 | 1 = -1): Vec3 {
  switch (side) {
    case 'left':
      return [pos[0] - d, pos[1], pos[2]];
    case 'right':
      return [pos[0] + d, pos[1], pos[2]];
    case 'partition':
      return [pos[0], pos[1], pos[2] + pf * d];
    case 'front':
      return [pos[0], pos[1], pos[2] - d];
    case 'back':
      return [pos[0], pos[1], pos[2] + d];
  }
}

function worldToOffset(side: WallSide, point: THREE.Vector3, structure: StructureModel): number {
  const halfW = structure.width / 2;
  const eaveStart = -structure.length / 2; // eaves span the full length from the front
  switch (side) {
    case 'front':
    case 'partition':
      return point.x + halfW;
    case 'back':
      return halfW - point.x;
    case 'left':
    case 'right':
      return point.z - eaveStart;
  }
}
