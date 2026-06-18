import { useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Opening, OpeningType, WallSide } from '@/types/building';
import { COMPONENT_OUTSET, openingWorldTransform, type StructureModel, type Vec3 } from '@/engine/geometry';
import { clampOffset, checkCollision } from '@/engine/layout';
import { TRUSS_CLEARANCE_FT } from '@/config/constants';
import { useBuildingStore } from '@/store/useBuildingStore';
import { useEditorStore } from '@/store/useEditorStore';
import { createSlatTexture, createDoorTexture, type DoorStyle } from './textures';

interface OpeningsProps {
  openings: Opening[];
  structure: StructureModel;
  trimColor: string;
}

/** Feet (decimal) → feet-inches string, e.g. 4.75 → 4'9". */
export function ftIn(ft: number): string {
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return i ? `${f}'${i}"` : `${f}'`;
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

export function Openings({ openings, structure, trimColor }: OpeningsProps) {
  // Render an opening wherever it's placed — doors / frame-outs commonly go on
  // open carport ends, gable-only ends, and partial-sheeted sides. The only
  // guard: a partition opening needs an actual partition (GCH split) to exist.
  const visible = openings.filter((o) => o.side !== 'partition' || structure.enclosure.partitionZ !== null);
  const selectedId = useEditorStore((s) => s.selectedOpeningId);
  const sel = visible.find((o) => o.id === selectedId);
  return (
    <group>
      {visible.map((o) => (
        <DraggableOpening key={o.id} opening={o} structure={structure} trimColor={trimColor} />
      ))}
      {sel && (
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
}: {
  opening: Opening;
  structure: StructureModel;
  trimColor: string;
}) {
  const updateOpening = useBuildingStore((s) => s.updateOpening);
  const { selectedOpeningId, selectOpening, setActiveWall, setDragging } = useEditorStore();
  // Camera/renderer for manual drag raycasting; controls disabled while dragging.
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const dragRef = useRef(false);

  const wall = structure.walls[opening.side];
  const selected = selectedOpeningId === opening.id;

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
  // Roll-up "45° Angle Cut": both top corners chamfered at 45°.
  const cut45 = opening.type === 'rollUpDoor' && !!opening.cut45;
  const cutC = Math.min(w / 3, h / 3, 1.5); // chamfer leg (equal H/V = 45°)

  const panelMat = useMemo(() => {
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
  }, [isWalk, isSlat, isGlass, isFrameOut, opening.type, h, opening.color, opening.doorStyle, doorDark]);

  // Door panel with both top corners cut at 45° (extruded chamfered rectangle).
  // Front-face UVs are normalized 0..1 over the bounding box so the slat texture
  // tiles exactly like the plain box panel does.
  const cutGeo = useMemo(() => {
    if (!cut45) return null;
    const c = cutC;
    const d = isFrameOut ? 0.06 : 0.09;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -h / 2);
    s.lineTo(w / 2, -h / 2);
    s.lineTo(w / 2, h / 2 - c);
    s.lineTo(w / 2 - c, h / 2);
    s.lineTo(-w / 2 + c, h / 2);
    s.lineTo(-w / 2, h / 2 - c);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
    uv.needsUpdate = true;
    return g;
  }, [cut45, cutC, w, h, isFrameOut]);

  const emissive = selected ? '#22d3c8' : '#000000';

  // --- Direct 3D drag: grab the component and slide it along its wall ---
  // Uses window-level listeners + manual raycast so the drag never depends on
  // R3F pointer-capture and OrbitControls can't fight it.
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    selectOpening(opening.id);
    setActiveWall(opening.side);
    setDragging(true);
    dragRef.current = true;
    if (controls) controls.enabled = false; // hard-disable orbit during the drag

    const oid = opening.id;
    const oside = opening.side;
    const ow = opening.width;
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
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
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Keep `dragging` true through this pointerup so the canvas's
      // click-empty-to-deselect doesn't fire and drop the selection.
      setTimeout(() => setDragging(false), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const t = 0.17; // jamb/header face ~2" (spec 2–3") — folded flashing
  const trimDepth = 0.07; // shallow proud depth (not a thick picture frame)
  const panelDepth = isFrameOut ? 0.06 : isGlass ? 0.035 : 0.09;
  const panelZ = isGlass ? -0.025 : 0; // recess glass behind the proud frame
  const onFloor = opening.sillHeight <= 0.1;
  // A black window carries its frame color (opening.color) — black-framed glass.
  const tc = selected ? '#22d3c8' : isGlass && opening.color ? opening.color : trimColor;

  return (
    <group>
      <group position={pos} rotation={[0, rotY, 0]}>
        {/* Proud jamb / header / sill trim — floor-mounted doors omit the sill.
            A 45° angle-cut roll-up shortens the jambs to the cut, runs a flat
            top trim only across the un-cut middle, and adds a diagonal trim bar
            down each chamfer. */}
        {cut45 ? (
          <>
            <TrimBar pos={[0, h / 2 + t / 2, 0]} size={[w - 2 * cutC + t, t, trimDepth]} color={tc} />
            <TrimBar pos={[-w / 2 - t / 2, onFloor ? (h - cutC) / 2 - t / 2 : -cutC / 2, 0]} size={[t, onFloor ? h - cutC + t : h - cutC + t, trimDepth]} color={tc} />
            <TrimBar pos={[w / 2 + t / 2, onFloor ? (h - cutC) / 2 - t / 2 : -cutC / 2, 0]} size={[t, onFloor ? h - cutC + t : h - cutC + t, trimDepth]} color={tc} />
            <mesh position={[-(w / 2 - cutC / 2), h / 2 - cutC / 2, 0]} rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[cutC * Math.SQRT2 + t, t, trimDepth]} />
              <meshStandardMaterial color={tc} metalness={0.08} roughness={0.5} />
            </mesh>
            <mesh position={[w / 2 - cutC / 2, h / 2 - cutC / 2, 0]} rotation={[0, 0, -Math.PI / 4]}>
              <boxGeometry args={[cutC * Math.SQRT2 + t, t, trimDepth]} />
              <meshStandardMaterial color={tc} metalness={0.08} roughness={0.5} />
            </mesh>
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
          <mesh position={[0, 0, panelZ]} geometry={cutGeo} material={panelMat} castShadow onPointerDown={onDown} />
        ) : (
          <mesh position={[0, 0, panelZ]} material={panelMat} castShadow={!isFrameOut} onPointerDown={onDown}>
            <boxGeometry args={[w, h, panelDepth]} />
          </mesh>
        )}
        {selected && (
          <mesh position={[0, 0, trimDepth / 2 + 0.02]}>
            <planeGeometry args={[w + t, h + t]} />
            <meshStandardMaterial color="#22d3c8" emissive={emissive} emissiveIntensity={0.25} transparent opacity={0.1} />
          </mesh>
        )}

        {/* Window — double-hung (1-over-1): a single proud white meeting rail
            splits the recessed glass top/bottom, with a sill below. */}
        {isGlass && (
          <group>
            {/* horizontal meeting rail across the middle */}
            <TrimBar pos={[0, 0, trimDepth / 2 - 0.01]} size={[w + 0.02, 0.11, 0.05]} color={tc} />
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

        {/* Walk door — round knob (latch side), 3 hinges (other side), kick seam */}
        {opening.type === 'walkDoor' && (
          <group>
            {/* knob: round backplate + ball, ~36" up, proud of the slab */}
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
            {/* hinges on the opposite (jamb) side */}
            {[h / 2 - 0.6, 0, -h / 2 + 0.6].map((hy, i) => (
              <mesh key={`hinge${i}`} position={[-w / 2 + 0.05, hy, panelDepth / 2 - 0.005]} castShadow>
                <boxGeometry args={[0.05, 0.22, 0.04]} />
                <meshStandardMaterial color="#9aa0a7" metalness={0.7} roughness={0.4} />
              </mesh>
            ))}
          </group>
        )}

        {/* Roll-up door — heavier bottom rail + center lift handle */}
        {opening.type === 'rollUpDoor' && (
          <group>
            <mesh position={[0, -h / 2 + 0.11, panelDepth / 2 + 0.005]} castShadow>
              <boxGeometry args={[w, 0.2, panelDepth + 0.02]} />
              {/* Bottom rail matches the door color (a colored roll-up should be
                  ALL that color); default light gray for a standard white door. */}
              <meshStandardMaterial color={opening.color || '#dfe2e7'} metalness={0.3} roughness={0.5} />
            </mesh>
            <mesh position={[0, -h / 2 + 0.42, panelDepth / 2 + 0.04]} castShadow>
              <boxGeometry args={[0.5, 0.07, 0.05]} />
              <meshStandardMaterial color="#8a9099" metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        )}

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
    case 'partition':
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -(structure.enclosure.partitionZ ?? 0));
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
    pushOut(openingWorldTransform(opening.side, along, y, structure).pos, opening.side, 0.22);

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

/** Push a wall point outward (toward the viewer side) by `d` ft. */
function pushOut(pos: Vec3, side: WallSide, d: number): Vec3 {
  switch (side) {
    case 'left':
      return [pos[0] - d, pos[1], pos[2]];
    case 'right':
      return [pos[0] + d, pos[1], pos[2]];
    case 'front':
    case 'partition':
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
