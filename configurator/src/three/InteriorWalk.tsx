import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useResolvedBuilding } from '@/engine/useResolvedBuilding';
import { useEditorStore } from '@/store/useEditorStore';
import type { StructureModel } from '@/engine/geometry';
import {
  INTERIOR,
  clampToInterior,
  dragLook,
  interiorKey,
  interiorPose,
  lookDir,
  walk,
  zoomFov,
  type InteriorRoom,
  type Vec3,
} from './interiorView';

/** Live walk-in state: current values + the goals they ease toward. */
interface WalkState {
  room: InteriorRoom;
  pos: Vec3;
  yaw: number;
  pitch: number;
  fov: number;
  goalPos: Vec3;
  goalYaw: number;
  goalPitch: number;
  goalFov: number;
}

/** The orbit view to put back exactly when Interior ends. */
interface SavedOrbit {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  target: THREE.Vector3;
  fov: number;
  near: number;
}

const WALK_KEYS: Record<string, 'f' | 'b' | 'l' | 'r' | 'tl' | 'tr'> = {
  KeyW: 'f',
  ArrowUp: 'f',
  KeyS: 'b',
  ArrowDown: 'b',
  KeyA: 'l',
  KeyD: 'r',
  ArrowLeft: 'tl',
  ArrowRight: 'tr',
};

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

/**
 * WALK-IN INTERIOR view (camera preset 'interior', editor store `interiorView`).
 *
 * On entry the camera is placed INSTANTLY at eye height just inside the main
 * room (interiorPose: End Storage looks at the partition, Left/Right storage
 * looks down the main room, a GCH looks from the enclosed garage toward the
 * divider, otherwise from the front gable down the length) with a wide 70°
 * FOV, and the OrbitControls are switched off. While it is on:
 *   drag   = look around in place (turn the head; nothing moves the eye),
 *   scroll = zoom by FOV (30°–85°), no pan, no dolly,
 *   W/A/S/D + ↑/↓ = step around, ←/→ = turn,
 * and the eye is clamped EVERY frame into the room box (walls − 1', floor
 * + 2', under the roof line − 1'), so it can never leave the building.
 * Near plane 0.1' while inside, so nothing within reach clips.
 *
 * Leaving (any other preset, the Structure framing, a Look switch, the PDF
 * capture's instant view setter) puts the orbit camera back EXACTLY as it was
 * before entering — position, orientation, target, FOV and near plane — and
 * re-enables the controls, synchronously inside the store update (so a new
 * Look's rig saves / restores the orbit FOV, and a capture frames as usual);
 * the preset / refit then runs from there exactly as before. A size or
 * partition change while inside re-poses the camera in the new room.
 * A PDF capture started inside brings you back in when it is done, at the
 * exact spot / look / zoom you left (the images themselves are unchanged).
 */
export function InteriorWalk() {
  const { structure } = useResolvedBuilding();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const gl = useThree((s) => s.gl);
  const cmd = useEditorStore((s) => s.cameraCmd);
  const interiorOn = useEditorStore((s) => s.interiorView);
  const classic = useEditorStore((s) => s.renderStyle) === 'classic';

  const structureRef = useRef<StructureModel>(structure);
  structureRef.current = structure;
  const walkRef = useRef<WalkState | null>(null);
  const savedRef = useRef<SavedOrbit | null>(null);
  /**
   * Where you stood when a PDF capture took you out (captureMode on): the
   * capture brings you back in when it ends, exactly here — same spot, look
   * direction and zoom, and the same orbit view to return to on leaving.
   */
  const resumeRef = useRef<{ walk: WalkState; saved: SavedOrbit | null; key: string } | null>(null);
  const keys = useRef(new Set<string>());

  /** Write the current walk state onto the camera (clamped). */
  const applyCamera = (w: WalkState) => {
    w.pos = clampToInterior(w.pos, w.room, structureRef.current);
    camera.position.set(w.pos[0], w.pos[1], w.pos[2]);
    const d = lookDir(w.yaw, w.pitch);
    camera.lookAt(w.pos[0] + d[0], w.pos[1] + d[1], w.pos[2] + d[2]);
    if (Math.abs(camera.fov - w.fov) > 1e-6) {
      camera.fov = w.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    // Keep the (disabled) controls' target just ahead of the eye.
    if (controls) controls.target.set(w.pos[0] + d[0], w.pos[1] + d[1], w.pos[2] + d[2]);
  };

  /** Arrival pose for the current building (instant, no fly-through). */
  const placeAtPose = () => {
    const p = interiorPose(structureRef.current);
    const w: WalkState = {
      room: p.room,
      pos: p.pos,
      yaw: p.yaw,
      pitch: p.pitch,
      fov: p.fov,
      goalPos: [...p.pos] as Vec3,
      goalYaw: p.yaw,
      goalPitch: p.pitch,
      goalFov: p.fov,
    };
    walkRef.current = w;
    applyCamera(w);
  };

  const enter = () => {
    if (!controls || walkRef.current) return;
    // Coming back in at the end of a PDF capture that started inside: resume
    // the exact pose (and keep the orbit view saved before Interior began).
    const resume = resumeRef.current;
    resumeRef.current = null;
    const resuming = !!resume && useEditorStore.getState().captureMode && resume.key === interiorKey(structureRef.current);
    savedRef.current = resuming
      ? resume!.saved
      : {
          pos: camera.position.clone(),
          quat: camera.quaternion.clone(),
          target: controls.target.clone(),
          fov: camera.fov,
          near: camera.near,
        };
    controls.enabled = false;
    camera.near = INTERIOR.nearFt;
    camera.updateProjectionMatrix();
    keys.current.clear();
    gl.domElement.style.cursor = 'grab';
    if (resuming) {
      const w = resume!.walk;
      walkRef.current = { ...w, pos: [...w.pos] as Vec3, goalPos: [...w.pos] as Vec3, goalYaw: w.yaw, goalPitch: w.pitch, goalFov: w.fov };
      applyCamera(walkRef.current);
    } else placeAtPose();
  };

  const exit = () => {
    if (!walkRef.current) return;
    // A PDF capture is taking the camera out: remember where you stood.
    resumeRef.current = useEditorStore.getState().captureMode
      ? { walk: { ...walkRef.current, pos: [...walkRef.current.pos] as Vec3 }, saved: savedRef.current, key: interiorKey(structureRef.current) }
      : null;
    walkRef.current = null;
    keys.current.clear();
    gl.domElement.style.cursor = '';
    const s = savedRef.current;
    savedRef.current = null;
    if (s) {
      camera.position.copy(s.pos);
      camera.quaternion.copy(s.quat);
      camera.fov = s.fov;
      camera.near = s.near;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      if (controls) controls.target.copy(s.target);
    }
    if (controls) controls.enabled = !useEditorStore.getState().dragging;
  };

  // Enter / leave synchronously inside the store update (before React
  // re-renders): a Look switch mounts the new Look's rig in the same commit,
  // and it must see the orbit FOV, not the interior one.
  useLayoutEffect(() => {
    if (useEditorStore.getState().interiorView) enter();
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.interiorView === prev.interiorView) return;
      if (s.interiorView) enter();
      else exit();
    });
    return () => {
      unsub();
      exit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, gl]);

  // Clicking Interior again (already inside) goes back to the arrival pose.
  useEffect(() => {
    if (cmd?.preset === 'interior' && walkRef.current) placeAtPose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd?.nonce]);

  // A size / partition change while inside: re-pose in the new main room.
  const key = interiorKey(structure);
  const prevKey = useRef(key);
  useEffect(() => {
    if (prevKey.current !== key && walkRef.current) placeAtPose();
    prevKey.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Drag = look around, scroll = FOV zoom, keys = step / turn — only while inside.
  useEffect(() => {
    const el = gl.domElement;
    const doc = el.ownerDocument;
    let drag: { id: number; x: number; y: number } | null = null;

    const onMove = (e: PointerEvent) => {
      const w = walkRef.current;
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      // A door / window being dragged on the model owns this press.
      if (!w || useEditorStore.getState().dragging) return;
      const radPerPx = ((camera.fov * Math.PI) / 180) / Math.max(1, el.clientHeight);
      const next = dragLook(w.goalYaw, w.goalPitch, dx, dy, radPerPx);
      // 1:1 with the pointer (no easing lag on a drag).
      w.goalYaw = w.yaw = next.yaw;
      w.goalPitch = w.pitch = next.pitch;
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (walkRef.current) el.style.cursor = 'grab';
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
    };
    const onDown = (e: PointerEvent) => {
      if (!walkRef.current || drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      // Keep the drag when the pointer runs over the quote panel (an iframe
      // would otherwise swallow the moves) or off the window.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture unavailable: the document listeners still work */
      }
      el.style.cursor = 'grabbing';
      doc.addEventListener('pointermove', onMove);
      doc.addEventListener('pointerup', onUp);
      doc.addEventListener('pointercancel', onUp);
    };
    const onWheel = (e: WheelEvent) => {
      const w = walkRef.current;
      if (!w) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      w.goalFov = zoomFov(w.goalFov, px);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!walkRef.current || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = WALK_KEYS[e.code];
      if (!k) return;
      e.preventDefault();
      keys.current.add(k);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = WALK_KEYS[e.code];
      if (k) keys.current.delete(k);
    };
    const onBlur = () => keys.current.clear();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
    };
  }, [gl, camera]);

  useFrame((_, delta) => {
    const on = useEditorStore.getState().interiorView;
    // Fallbacks (the store subscription normally does both synchronously).
    if (on && !walkRef.current && controls) enter();
    else if (!on && walkRef.current) exit();
    const w = walkRef.current;
    if (!w) return;
    // A part's drag / click handler re-enables the orbit controls on release;
    // inside they must stay off (the look-around handler owns the pointer).
    if (controls && controls.enabled) controls.enabled = false;
    const dt = Math.min(0.1, Math.max(0, delta));
    const k = keys.current;
    if (k.size) {
      const turn = (k.has('tl') ? 1 : 0) - (k.has('tr') ? 1 : 0);
      if (turn) w.goalYaw = w.yaw = w.yaw + turn * INTERIOR.turnRadPerS * dt;
      const fwd = (k.has('f') ? 1 : 0) - (k.has('b') ? 1 : 0);
      const right = (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0);
      if (fwd || right) {
        const step = INTERIOR.walkFtPerS * dt;
        w.goalPos = walk(w.goalPos, w.yaw, fwd * step, right * step);
      }
    }
    w.goalPos = clampToInterior(w.goalPos, w.room, structureRef.current);
    // Ease toward the goals (frame-rate independent); snap when close.
    const a = 1 - Math.exp(-dt * 18);
    const ease = (cur: number, goal: number, eps: number) => (Math.abs(goal - cur) < eps ? goal : cur + (goal - cur) * a);
    w.yaw = ease(w.yaw, w.goalYaw, 1e-5);
    w.pitch = ease(w.pitch, w.goalPitch, 1e-5);
    w.fov = ease(w.fov, w.goalFov, 1e-3);
    w.pos = [ease(w.pos[0], w.goalPos[0], 1e-4), ease(w.pos[1], w.goalPos[1], 1e-4), ease(w.pos[2], w.goalPos[2], 1e-4)];
    applyCamera(w);
  });

  // Classic look only: its ground is the dark page color, which reads as a
  // void from inside, so while Interior is on lay a light concrete floor over
  // the main footprint (the new look already has its slab). View-only:
  // flat + captureIgnore, and unmounted the moment Interior ends (a PDF
  // capture leaves Interior first).
  if (!interiorOn || !classic) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} userData={{ captureIgnore: true }}>
      <planeGeometry args={[structure.width, structure.length]} />
      <meshStandardMaterial color="#acada8" roughness={0.95} metalness={0} />
    </mesh>
  );
}
