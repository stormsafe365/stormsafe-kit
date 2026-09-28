import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ENHANCED_LOOK, linearColor } from './look';
import { createSkyEnvironment } from './environment';

// Light colors: the lab's hexes as raw linear values (see look.ts).
const HEMI_SKY = linearColor(ENHANCED_LOOK.hemi.sky);
const HEMI_GROUND = linearColor(ENHANCED_LOOK.hemi.ground);
const KEY_COLOR = linearColor(ENHANCED_LOOK.key.color);
const FILL_COLOR = linearColor(ENHANCED_LOOK.fill.color);

/**
 * ENHANCED scene rig (render-upgrade Phase 3; HANDOFF Steps 6-7 with the
 * owner's 2026-09-28 override: go easy on lighting and shadows).
 *
 * - Background + far-only fog: one clean light blue-gray; the unlit ground
 *   (EnhancedSite, mounted by BuildingModel) fades into it at the horizon.
 * - Lights: a strong, azimuth-independent hemisphere base so every wall stays
 *   bright, ONE gentle key (lab sun direction) and a gentle opposite fill whose
 *   only job is a soft highlight on the rib normal maps. NO light casts
 *   shadows (the renderer's shadow map therefore never renders anything).
 * - Environment: a low-intensity PMREM sky dome (no sun disc) for a subtle
 *   metallic sheen.
 * - Renderer / camera: ACES filmic at ENHANCED_LOOK.exposure,
 *   localClippingEnabled (roll-up clipping later), FOV 30 and far >= 1200.
 *   The FOV is set in code (never the Canvas camera prop, which would swap in a
 *   new camera); CameraRig refits on the renderStyle change.
 *
 * Everything this rig changes on the SHARED renderer / scene / camera is saved
 * on mount and restored on unmount (the PMREM target is disposed), so switching
 * back to Classic renders exactly the classic state. JSX children (background,
 * fog, lights) are detached by R3F on unmount. Layout effects run before the
 * CameraRig's passive refit effect, so the refit always sees the right FOV.
 */
export function EnhancedSceneRig() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  // Renderer + camera state.
  useLayoutEffect(() => {
    const saved = {
      toneMapping: gl.toneMapping,
      exposure: gl.toneMappingExposure,
      localClipping: gl.localClippingEnabled,
      fov: camera.fov,
      far: camera.far,
    };
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = ENHANCED_LOOK.exposure;
    gl.localClippingEnabled = true;
    camera.fov = ENHANCED_LOOK.fovDeg;
    camera.far = Math.max(saved.far, ENHANCED_LOOK.cameraFar);
    camera.updateProjectionMatrix();
    return () => {
      gl.toneMapping = saved.toneMapping;
      gl.toneMappingExposure = saved.exposure;
      gl.localClippingEnabled = saved.localClipping;
      camera.fov = saved.fov;
      camera.far = saved.far;
      camera.updateProjectionMatrix();
    };
  }, [gl, camera]);

  // Environment (PMREM sky dome) — enhanced only; restored + disposed on exit.
  useLayoutEffect(() => {
    const savedEnv = scene.environment;
    const savedIntensity = scene.environmentIntensity;
    const env = createSkyEnvironment(gl);
    scene.environment = env.texture;
    scene.environmentIntensity = ENHANCED_LOOK.env.intensity;
    return () => {
      if (scene.environment === env.texture) scene.environment = savedEnv;
      scene.environmentIntensity = savedIntensity;
      env.dispose();
    };
  }, [gl, scene]);

  const { background, fog, hemi, key, fill } = ENHANCED_LOOK;
  return (
    <>
      <color attach="background" args={[background]} />
      <fog attach="fog" args={[background, fog.near, fog.far]} />
      <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, hemi.intensity]} />
      <directionalLight color={KEY_COLOR} intensity={key.intensity} position={key.position} />
      <directionalLight color={FILL_COLOR} intensity={fill.intensity} position={fill.position} />
    </>
  );
}
