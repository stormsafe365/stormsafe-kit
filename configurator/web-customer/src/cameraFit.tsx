/**
 * Customer camera framing that keeps the WHOLE build in view — lean-tos and
 * wrap-around corners included (the shared CameraRig presets frame the main
 * building only). Used for the first view, after a size / lean-to change or a
 * reopened design, and by the view buttons. The capture tool keeps its own
 * framing (CameraRig + CaptureHook) and this stays out of its way.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from './store';

export type FitView = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'structure' | 'keep';

/** Direction from the target to the camera. Left / right are the CUSTOMER's sides (seen from the front): left = 3D +X. */
const DIRS: Record<Exclude<FitView, 'keep'>, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.72, -1).normalize(), // the shared ISO / capture direction
  front: new THREE.Vector3(0, 0, -1),
  back: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, -0.02).normalize(),
  structure: new THREE.Vector3(1, 0.5, -1.05).normalize(),
};

/** Set by <CameraFit/>; the view buttons call it. */
export const cameraApi: { fit: (view: FitView, animate?: boolean) => void } = { fit: () => {} };

const isIgnored = (ob: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = ob; o; o = o.parent) if (o.userData?.captureIgnore) return true;
  return false;
};

/** Corners of every building mesh (skips scenery, ground planes and the drag guides), like the capture fit. */
function buildingCorners(scene: THREE.Scene): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const b = new THREE.Box3();
  scene.traverse((ob) => {
    const m = ob as THREE.Mesh;
    if (!m.isMesh || !m.geometry || !m.visible || isIgnored(m) || m.renderOrder >= 999) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const gb = m.geometry.boundingBox;
    if (!gb || !isFinite(gb.min.x)) return;
    m.updateWorldMatrix(true, false);
    b.copy(gb).applyMatrix4(m.matrixWorld);
    if (b.max.x - b.min.x > 150 || b.max.z - b.min.z > 150) return; // ground / sky
    if (b.max.y - b.min.y < 0.2 && Math.abs(b.min.y) < 0.5) return; // flat ground planes
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z));
  });
  return pts;
}

/** The bits of the orbit controls used here (three-stdlib OrbitControls). */
interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  dispatchEvent: (e: { type: string }) => void;
}

export function CameraFit() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const lastView = useRef<Exclude<FitView, 'keep'>>('iso');

  useEffect(() => {
    if (!controls) return;
    const fit = (view: FitView, animate = true) => {
      const pts = buildingCorners(scene);
      if (!pts.length) return;
      const box = new THREE.Box3().setFromPoints(pts);
      const center = box.getCenter(new THREE.Vector3());
      const dir =
        view === 'keep' ? camera.position.clone().sub(controls.target).normalize() : DIRS[view].clone();
      if (view !== 'keep') lastView.current = view;
      if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(DIRS.iso);
      // Camera basis for that direction (world up), then the distance that fits every corner.
      const fwd = dir.clone().negate();
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const tanH = tanV * (size.width / Math.max(1, size.height));
      let d = 0;
      for (const p of pts) {
        const r = p.clone().sub(center);
        const z = r.dot(dir);
        d = Math.max(d, z + Math.abs(r.dot(right)) / tanH, z + Math.abs(r.dot(up)) / tanV);
      }
      d = Math.max(4, d * 1.1);
      const pos = center.clone().add(dir.multiplyScalar(d));
      // Cancel the shared rig's own glide (it listens for 'start', the orbit-grab event).
      controls.dispatchEvent({ type: 'start' });
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (animate && !reduce) goal.current = { pos, target: center };
      else {
        goal.current = null;
        camera.position.copy(pos);
        controls.target.copy(center);
        controls.update();
      }
    };
    cameraApi.fit = fit;
    // A user grab cancels the glide.
    const cancel = () => {
      goal.current = null;
    };
    controls.addEventListener('start', cancel);
    return () => {
      controls.removeEventListener('start', cancel);
      cameraApi.fit = () => {};
    };
  }, [camera, controls, scene, size.width, size.height]);

  useFrame(() => {
    const g = goal.current;
    if (!g || !controls) return;
    if (useEditorStore.getState().captureMode) {
      goal.current = null;
      return;
    }
    camera.position.lerp(g.pos, 0.16);
    controls.target.lerp(g.target, 0.16);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.05 && controls.target.distanceTo(g.target) < 0.05) goal.current = null;
  });

  // First view once the model and the controls exist; then refit whenever the
  // build's footprint / height changes (not for doors or colors).
  const frameKey = useWebStore((s) => {
    const d = s.design;
    return [d.type, d.width, d.length, d.height, d.enclosedLength, ...d.leanTos.map((l) => `${l.side}:${l.width}:${l.length}:${l.start}:${l.lowLeg}`), d.wraps.join('')].join('|');
  });
  const first = useRef(true);
  useEffect(() => {
    if (!controls) return;
    const t = setTimeout(
      () => {
        cameraApi.fit(first.current ? 'iso' : 'keep', !first.current);
        first.current = false;
      },
      first.current ? 250 : 150,
    );
    return () => clearTimeout(t);
  }, [frameKey, controls]);

  // After a picture is taken the capture tool leaves the camera on its own ISO: put ours back.
  useEffect(
    () =>
      useEditorStore.subscribe((s, prev) => {
        if (prev.captureMode && !s.captureMode) setTimeout(() => cameraApi.fit(lastView.current, false), 30);
      }),
    [],
  );

  // A resized view (phone rotation, Bigger view) refits in place. A phone keyboard opening or closing
  // (html.vv-kb, App.tsx) does not: the camera stays while typing and is put back exactly as it was
  // after (a customer zoomed in on a door keeps that view), with no refit while the keyboard slides.
  const kbSaved = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const lastKb = useRef(false);
  const quietUntil = useRef(0);
  useEffect(() => {
    if (first.current) return;
    const kb = typeof document !== 'undefined' && document.documentElement.classList.contains('vv-kb');
    if (kb !== lastKb.current) {
      lastKb.current = kb;
      quietUntil.current = Date.now() + 700;
      if (kb) {
        kbSaved.current = controls ? { pos: camera.position.clone(), target: controls.target.clone() } : null;
      } else {
        const s = kbSaved.current;
        kbSaved.current = null;
        if (s && controls) {
          camera.position.copy(s.pos);
          controls.target.copy(s.target);
          controls.update();
        }
      }
      return;
    }
    if (kb || Date.now() < quietUntil.current) return;
    cameraApi.fit('keep', false);
  }, [size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
