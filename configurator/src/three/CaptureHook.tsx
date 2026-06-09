import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '@/store/useEditorStore';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exposes window.__ssCapture3D() — used by the pricing program's PDF export to
 * embed the live 3D modeler. Cycles the camera through ISO + the four
 * elevations, lets each framing settle, and snapshots the canvas as a PNG data
 * URL (the Canvas is created with preserveDrawingBuffer, so toDataURL works).
 * Restores the ISO view afterward. Returns { iso, front, back, left, right }.
 *
 * For the duration of the capture it DROPS the fog, pushes the far plane out,
 * and lifts the orbit distance clamp — otherwise a long building's elevation
 * (camera far back) gets clipped by maxDistance or washed out by fog. Everything
 * is restored in `finally` so the live interactive view is untouched.
 */
export function CaptureHook() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as { maxDistance: number } | null;

  useEffect(() => {
    const w = window as unknown as {
      __ssCapture3D?: () => Promise<Record<string, string>>;
      __ssSetViewInstant?: (p: string) => void;
    };
    w.__ssCapture3D = async () => {
      const setView = w.__ssSetViewInstant;
      const goToView = useEditorStore.getState().goToView;
      const views = ['iso', 'front', 'back', 'left', 'right'] as const;
      const out: Record<string, string> = {};

      // Capture wants the WHOLE building, crisp — temporarily remove the limits
      // that exist for nice interactive orbiting.
      const savedFog = scene.fog;
      const savedFar = camera.far;
      const savedMax = controls ? controls.maxDistance : null;
      scene.fog = null;
      camera.far = 5000;
      camera.updateProjectionMatrix();
      if (controls) controls.maxDistance = 100000;

      try {
        for (const v of views) {
          if (setView) setView(v);
          else goToView(v);
          await sleep(140); // a couple frames for R3F to render the new camera
          gl.render(scene, camera); // guarantee the freshest frame is in the buffer
          out[v] = gl.domElement.toDataURL('image/png');
        }
      } finally {
        scene.fog = savedFog;
        camera.far = savedFar;
        camera.updateProjectionMatrix();
        if (controls && savedMax != null) controls.maxDistance = savedMax;
        if (setView) setView('iso');
        else goToView('iso');
      }
      return out;
    };
    return () => {
      delete w.__ssCapture3D;
    };
  }, [gl, scene, camera, controls]);

  return null;
}
