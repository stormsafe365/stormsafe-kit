import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useResolvedBuilding } from '@/engine/useResolvedBuilding';
import { useEditorStore, type CameraPreset } from '@/store/useEditorStore';

/**
 * Drives the camera for the named view presets and auto-frames the building
 * whenever its size changes. Lives inside the Canvas so it can read the live
 * camera + OrbitControls (registered via `makeDefault`).
 *
 * Presets compute a position that fits the relevant building face in view
 * (accounting for FOV + aspect), so close-ups never clip and big buildings
 * still fit. Motion is a smooth lerp; grabbing the mouse cancels it.
 *
 * The 'interior' preset is NOT framed here: it is the walk-in mode run by
 * InteriorWalk (its own pose, look-around controls and clamping). This rig
 * just stands aside while it is on (editor store `interiorView`).
 */
export function CameraRig() {
  const { structure } = useResolvedBuilding();
  const W = structure.width;
  const L = structure.length;
  const top = structure.peakHeight;

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const cmd = useEditorStore((s) => s.cameraCmd);
  // View-only Look flag: part of the refit key so a Look switch (which may
  // change the FOV) refits the frame. Classic never changes it.
  const renderStyle = useEditorStore((s) => s.renderStyle);

  const goalPos = useRef<THREE.Vector3 | null>(null);
  const goalLook = useRef<THREE.Vector3 | null>(null);
  // Look round trip: the exact classic camera pose (and any in-flight goal)
  // saved when the Look switches classic -> enhanced. Switching back restores
  // it verbatim, so the live classic view lands exactly where it was instead of
  // a refit lerp that stops within 0.06 ft on the far side. Dropped as soon as
  // anything else moves the camera (orbit/zoom, a preset, an instant view set,
  // a size change); the ordinary refit then applies.
  const lookReturn = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3;
    goalPos: THREE.Vector3 | null;
    goalLook: THREE.Vector3 | null;
    initialized: boolean;
  } | null>(null);

  /** Distance from `center` needed to fit a span (W×H) given the FOV/aspect. */
  const fitDistance = (spanW: number, spanH: number) => {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distV = spanH / 2 / Math.tan(vFov / 2);
    const distH = spanW / 2 / Math.tan(hFov / 2);
    return Math.max(distV, distH) * 1.18; // margin
  };

  const computePreset = (preset: CameraPreset) => {
    const halfW = W / 2;
    const halfL = L / 2;
    const midY = top * 0.5;
    const center = new THREE.Vector3(0, midY, 0);

    switch (preset) {
      case 'front': {
        // gable face at -Z, fit width × peak
        const d = fitDistance(W, top) + halfL;
        return { pos: new THREE.Vector3(0, midY, -d), look: center };
      }
      case 'back': {
        const d = fitDistance(W, top) + halfL;
        return { pos: new THREE.Vector3(0, midY, d), look: center };
      }
      case 'left': {
        // eave face at -X, fit length × peak
        const d = fitDistance(L, top) + halfW;
        return { pos: new THREE.Vector3(-d, midY, 0), look: center };
      }
      case 'right': {
        const d = fitDistance(L, top) + halfW;
        return { pos: new THREE.Vector3(d, midY, 0), look: center };
      }
      case 'top': {
        const d = fitDistance(W, L) + top;
        // tiny offset keeps OrbitControls out of the gimbal pole
        return { pos: new THREE.Vector3(0.001, d, 0.001), look: new THREE.Vector3(0, 0, 0) };
      }
      case 'structure': {
        // low 3/4 angle (front-facing), slightly closer, to read frame + purlins
        const dir = new THREE.Vector3(1, 0.5, -1.05).normalize();
        const d = fitDistance(Math.max(W, L), top) * 1.05 + Math.max(halfW, halfL) * 0.4;
        return { pos: center.clone().add(dir.multiplyScalar(d)), look: center };
      }
      case 'iso':
      default: {
        // Front-facing 3/4 (front gable at -Z, so dir uses -Z).
        const dir = new THREE.Vector3(1, 0.72, -1).normalize();
        const d = fitDistance(Math.max(W, L), top) + Math.max(halfW, halfL) * 0.5;
        return {
          pos: new THREE.Vector3(0, top * 0.45, 0).add(dir.multiplyScalar(d)),
          look: new THREE.Vector3(0, top * 0.45, 0),
        };
      }
    }
  };

  // Fire a preset whenever the command nonce changes.
  useEffect(() => {
    if (!cmd) return;
    lookReturn.current = null;
    if (cmd.preset === 'interior') {
      // Walk-in Interior: InteriorWalk places the camera (instantly) and owns it.
      goalPos.current = null;
      goalLook.current = null;
      return;
    }
    const { pos, look } = computePreset(cmd.preset);
    goalPos.current = pos;
    goalLook.current = look;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd?.nonce]);

  // Auto-frame on size (or Look) change: keep the current orbit DIRECTION but
  // refit the distance + recentre, so a resized building stays fully in frame.
  const prevKey = useRef('');
  const initialized = useRef(false);
  useEffect(() => {
    const sizeKey = `${W}x${L}x${top.toFixed(2)}`;
    const key = `${sizeKey}|${renderStyle}`;
    const changed = !!prevKey.current && prevKey.current !== key;

    // Look-only switch (same size). Classic never switches, so for the classic
    // look `back` is always null and lookReturn stays null: the branches below
    // are exactly the original first-load / size-change logic.
    const lookOnly = changed && prevKey.current.split('|')[0] === sizeKey;
    const back = lookOnly && renderStyle === 'classic' ? lookReturn.current : null;
    if (changed) {
      // classic -> enhanced: save the exact classic camera state (taken before
      // any refit below); any other change drops it.
      lookReturn.current =
        lookOnly && renderStyle === 'enhanced' && controls
          ? {
              pos: camera.position.clone(),
              target: controls.target.clone(),
              goalPos: goalPos.current ? goalPos.current.clone() : null,
              goalLook: goalLook.current ? goalLook.current.clone() : null,
              initialized: initialized.current,
            }
          : null;
    }

    // enhanced -> classic with nothing moved in between: put the classic
    // camera state back verbatim (pose, in-flight goal, first-frame flag).
    if (back && controls) {
      camera.position.copy(back.pos);
      controls.target.copy(back.target);
      controls.update();
      goalPos.current = back.goalPos;
      goalLook.current = back.goalLook;
      initialized.current = back.initialized;
    }
    // On first load, auto-frame with 'iso' preset
    else if (!initialized.current && controls) {
      initialized.current = true;
      const { pos, look } = computePreset('iso');
      goalPos.current = pos;
      goalLook.current = look;
    }
    // On size change, auto-frame with current orbit direction (inside the
    // walk-in Interior view InteriorWalk re-poses the camera in the new room).
    else if (changed && controls && !useEditorStore.getState().interiorView) {
      const center = new THREE.Vector3(0, top * 0.45, 0);
      const dir = camera.position.clone().sub(controls.target).normalize();
      const d = fitDistance(Math.max(W, L), top) + Math.max(W, L) * 0.25;
      goalPos.current = center.clone().add(dir.multiplyScalar(d));
      goalLook.current = center;
    }
    prevKey.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, L, top, renderStyle]);

  // Dev: expose camera + controls (+ gl/scene for scene-graph verification)
  // so a precise view can be set for screenshots.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ssCam = camera;
    (window as unknown as Record<string, unknown>).__ssControls = controls;
    (window as unknown as Record<string, unknown>).__ssGl = gl;
    (window as unknown as Record<string, unknown>).__ssScene = scene;
  }, [camera, controls, gl, scene]);

  // Instant (no-lerp) view setter — used by the PDF capture to jump the camera
  // to each preset and snapshot it deterministically. Recomputed when the
  // building size changes so the framing is always correct.
  useEffect(() => {
    const w = window as unknown as { __ssSetViewInstant?: (p: CameraPreset) => void };
    w.__ssSetViewInstant = (preset) => {
      if (!controls) return;
      // Leave the walk-in Interior view first: InteriorWalk restores the orbit
      // controls, FOV and near plane synchronously, so a PDF capture started
      // from Interior frames exactly like one started from any other view.
      const ed = useEditorStore.getState();
      if (ed.interiorView) ed.setInteriorView(false);
      if (preset === 'interior') {
        goalPos.current = null;
        goalLook.current = null;
        lookReturn.current = null;
        ed.setInteriorView(true); // InteriorWalk places the camera instantly
        return;
      }
      const { pos, look } = computePreset(preset);
      goalPos.current = null; // cancel any in-flight animation
      goalLook.current = null;
      lookReturn.current = null; // the camera moved: no Look round-trip restore
      camera.position.copy(pos);
      controls.target.copy(look);
      controls.update();
      camera.updateMatrixWorld();
    };
    return () => {
      delete w.__ssSetViewInstant;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, W, L, top, structure.enclosure]);

  // Grabbing the mouse to orbit cancels any in-flight animation.
  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      goalPos.current = null;
      goalLook.current = null;
      lookReturn.current = null;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame(() => {
    if (!goalPos.current || !goalLook.current || !controls) return;
    if (useEditorStore.getState().interiorView) return; // InteriorWalk owns the camera
    camera.position.lerp(goalPos.current, 0.14);
    controls.target.lerp(goalLook.current, 0.14);
    controls.update();
    if (
      camera.position.distanceTo(goalPos.current) < 0.06 &&
      controls.target.distanceTo(goalLook.current) < 0.06
    ) {
      goalPos.current = null;
      goalLook.current = null;
    }
  });

  return null;
}
