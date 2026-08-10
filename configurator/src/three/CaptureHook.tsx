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

      // Render the snapshots at a FIXED landscape size (not the live pane's
      // shape) so the printed quote gets a full-width image with the building
      // filling the frame — the live pane is often a narrow column, which used
      // to produce a tall skinny capture with dead space on the page. The
      // camera aspect is overridden to match so the fit math frames the
      // building for the capture frame, then everything is restored.
      const canvas = gl.domElement;
      const cssW = canvas.clientWidth || canvas.width;
      const cssH = canvas.clientHeight || canvas.height;
      const savedPR = gl.getPixelRatio();
      const savedAspect = camera.aspect;
      const CAP_W = 1600; // 16:10 landscape, ×2 pixel ratio = 3200×2000 buffer
      const CAP_H = 1000;
      const CAPTURE_PR = 2;

      try {
        gl.setPixelRatio(CAPTURE_PR);
        gl.setSize(CAP_W, CAP_H, false); // false = don't touch CSS size; only the buffer changes
        camera.aspect = CAP_W / CAP_H;
        camera.updateProjectionMatrix();
        for (const v of views) {
          if (setView) setView(v);
          else goToView(v);
          // The 3/4 iso view sits closer than the straight-on elevations and its
          // near corner can graze the frame edge — dolly out a touch for print.
          if (v === 'iso') {
            const tgt = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
            if (tgt) {
              camera.position.sub(tgt).multiplyScalar(1.18).add(tgt);
              // Aim slightly lower so the building rides up off the bottom edge
              // (the iso fit leaves all its slack above the roofline otherwise).
              const dist = camera.position.distanceTo(tgt);
              const drop = 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * 0.06;
              camera.position.y -= drop;
              tgt.y -= drop; // restored by the final setView('iso') below
              camera.updateMatrixWorld();
            }
          }
          await sleep(140); // a couple frames for R3F to render the new camera
          gl.render(scene, camera); // guarantee the freshest frame is in the buffer
          out[v] = gl.domElement.toDataURL('image/png');
        }
      } finally {
        gl.setPixelRatio(savedPR);
        gl.setSize(cssW, cssH, false);
        scene.fog = savedFog;
        camera.far = savedFar;
        camera.aspect = savedAspect;
        camera.updateProjectionMatrix();
        if (controls && savedMax != null) controls.maxDistance = savedMax;
        if (setView) setView('iso');
        else goToView('iso');
        gl.render(scene, camera); // repaint the live view at the restored resolution
      }
      return out;
    };
    return () => {
      delete w.__ssCapture3D;
    };
  }, [gl, scene, camera, controls]);

  return null;
}
