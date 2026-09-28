import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore, type RenderStyle } from '@/store/useEditorStore';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * True when this object or any ancestor is tagged `userData.captureIgnore` —
 * scenery (slab, sky, ground decals) that must not widen the capture framing.
 * Nothing in the classic look sets it, so the classic fit is unchanged.
 */
const isCaptureIgnored = (ob: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = ob; o; o = o.parent) if (o.userData?.captureIgnore) return true;
  return false;
};

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
 *
 * While it runs, the editor store's `captureMode` is true (animations may use
 * it to snap closed). The view-only renderStyle in effect is read once via
 * getState() and exposed afterwards as window.__ssLastCapture = { renderStyle,
 * at }; the returned image record itself is unchanged.
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
      __ssLastCapture?: { renderStyle: RenderStyle; at: string };
    };
    const captureViews = async () => {
      const setView = w.__ssSetViewInstant;
      const goToView = useEditorStore.getState().goToView;
      const views = ['iso', 'front', 'back', 'left', 'right'] as const;
      const out: Record<string, string> = {};

      // Capture wants the WHOLE building, crisp — temporarily remove the limits
      // that exist for nice interactive orbiting.
      // Quote/contract renderings must show the building CLOSED and clean: hide
      // the Spacing overlay and shut any doors/windows the rep clicked open,
      // then let the close animations settle before the first snapshot.
      const ed = useEditorStore.getState();
      const savedSpacing = ed.showSpacing;
      const savedOpen = ed.openIds;
      const hadOpen = Object.values(savedOpen).some(Boolean);
      if (savedSpacing) ed.setShowSpacing(false);
      if (hadOpen) { ed.closeAllOpenings(); await sleep(900); }
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

        // Exact-fit framing: collect the building's world-space geometry corners
        // (skipping the ground grid / flat shadow planes), then after each preset
        // is applied, project them and recenter + re-distance the camera until the
        // whole building fills the frame with a safe margin. Guarantees no view is
        // ever clipped, for any building size or proportion.
        const pts: THREE.Vector3[] = [];
        scene.traverse((ob) => {
          const m = ob as THREE.Mesh;
          if (!m.isMesh || !m.geometry) return;
          if (isCaptureIgnored(m)) return; // tagged scenery never drives the framing
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const b = m.geometry.boundingBox;
          if (!b || !isFinite(b.min.x) || !isFinite(b.max.x)) return;
          m.updateWorldMatrix(true, false);
          const corners: THREE.Vector3[] = [];
          for (const X of [b.min.x, b.max.x])
            for (const Y of [b.min.y, b.max.y])
              for (const Z of [b.min.z, b.max.z])
                corners.push(new THREE.Vector3(X, Y, Z).applyMatrix4(m.matrixWorld));
          let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
          for (const p of corners) {
            mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x);
            mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y);
            mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z);
          }
          if (mxx - mnx > 150 || mxz - mnz > 150) return; // ground grid / env
          if (mxy - mny < 0.2 && Math.abs(mny) < 0.5) return; // flat ground shadow planes
          pts.push(...corners);
        });
        const ctlTarget = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
        const fitExact = () => {
          if (!pts.length || !ctlTarget) return;
          for (let k = 0; k < 4; k++) {
            camera.updateMatrixWorld();
            let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
            for (const p of pts) {
              const q = p.clone().project(camera);
              mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x);
              mny = Math.min(mny, q.y); mxy = Math.max(mxy, q.y);
            }
            // recenter: pan camera + target so the building is centered in frame
            const dist = camera.position.distanceTo(ctlTarget);
            const vh = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
            const vw = vh * camera.aspect;
            const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(((mnx + mxx) / 2) * (vw / 2));
            const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(((mny + mxy) / 2) * (vh / 2));
            camera.position.add(right).add(up);
            ctlTarget.add(right).add(up);
            // re-distance: scale so the larger NDC extent lands on the margin
            const need = Math.max((mxx - mnx) / 2 / 0.86, (mxy - mny) / 2 / 0.84);
            const dir = camera.position.clone().sub(ctlTarget).normalize();
            camera.position.copy(ctlTarget.clone().add(dir.multiplyScalar(Math.max(dist * need, 3))));
            camera.lookAt(ctlTarget);
            camera.updateMatrixWorld();
          }
        };

        for (const v of views) {
          if (setView) setView(v);
          else goToView(v);
          // Start from a guaranteed-OUTSIDE distance before fitting: with a
          // lean-to (or any attached structure) the preset can leave corner
          // points BEHIND the camera, and points behind a camera project to
          // garbage NDC values that corrupt fitExact's recenter/re-distance —
          // gable views came out shifted and cut off. Backing the camera to
          // 2.5× the content's bounding radius keeps every point in front, so
          // the iterative fit always converges.
          if (pts.length && ctlTarget) {
            const c = new THREE.Vector3();
            for (const p of pts) c.add(p);
            c.divideScalar(pts.length);
            let r = 0;
            for (const p of pts) r = Math.max(r, p.distanceTo(c));
            const dir = camera.position.clone().sub(ctlTarget).normalize();
            ctlTarget.copy(c);
            camera.position.copy(c.clone().add(dir.multiplyScalar(Math.max(r * 2.5, 10))));
            camera.lookAt(ctlTarget);
            camera.updateMatrixWorld();
          }
          fitExact();
          // Adapt the frame to the view's actual content shape (clamped per view
          // type) so a long eave gets a wide frame and a gable a squarer one —
          // the PNG is then mostly building, not background. The PDF layout reads
          // the frame aspect from out[view+'Ar'] to size its box to match.
          if (pts.length) {
            camera.updateMatrixWorld();
            let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
            for (const p of pts) {
              const q = p.clone().project(camera);
              mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x);
              mny = Math.min(mny, q.y); mxy = Math.max(mxy, q.y);
            }
            const cvs = gl.domElement;
            const contentAr = ((mxx - mnx) * cvs.width) / (Math.max(mxy - mny, 1e-6) * cvs.height);
            const lo = v === 'iso' ? 1.45 : v === 'front' || v === 'back' ? 1.0 : 1.4;
            const hi = v === 'iso' ? 1.9 : v === 'front' || v === 'back' ? 2.4 : 3.0;
            const ar = Math.min(hi, Math.max(lo, contentAr));
            gl.setSize(CAP_W, Math.round(CAP_W / ar), false);
            camera.aspect = ar;
            camera.updateProjectionMatrix();
            fitExact();
            out[v + 'Ar'] = String(Math.round(ar * 1000) / 1000);
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
        if (savedSpacing) useEditorStore.getState().setShowSpacing(true);
      }
      return out;
    };
    w.__ssCapture3D = async () => {
      const ed = useEditorStore.getState();
      // Look in effect for this capture (view-only flag; read once, never written).
      const renderStyle = ed.renderStyle;
      // captureMode brackets the WHOLE capture (incl. the close-openings wait).
      // It only flags state; capture timing and output are unchanged.
      ed.setCaptureMode(true);
      try {
        return await captureViews();
      } finally {
        useEditorStore.getState().setCaptureMode(false);
        w.__ssLastCapture = { renderStyle, at: new Date().toISOString() };
      }
    };
    return () => {
      delete w.__ssCapture3D;
    };
  }, [gl, scene, camera, controls]);

  return null;
}
