import * as THREE from 'three';
import { ENHANCED_LOOK, linearColor } from './look';

/**
 * PMREM sky-dome environment for the ENHANCED look (port of the lab's
 * buildEnvironment, render-lab-v20.html L199-219): a vertex-colored sphere
 * graded ground -> horizon -> zenith, prefiltered with PMREMGenerator.
 *
 * Differences from the lab, both deliberate:
 *  - no sun disc: the dome is azimuth-symmetric, so the environment lights all
 *    four walls identically (owner: even, readable walls on quotes/PDFs);
 *  - the lab's hexes are fed as linear (r134 had no color management).
 *
 * Returns the texture to assign to scene.environment and a dispose() that
 * frees the GPU render target. Build it only while the look is enhanced.
 */
export function createSkyEnvironment(gl: THREE.WebGLRenderer): { texture: THREE.Texture; dispose: () => void } {
  const { zenith, horizon, nadir } = ENHANCED_LOOK.env;
  const R = 60;
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(R, 32, 16);
  const pos = geo.attributes.position;
  const top = linearColor(zenith);
  const mid = linearColor(horizon);
  const bot = linearColor(nadir);
  const cols: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / R;
    if (y > 0) c.copy(mid).lerp(top, Math.pow(y, 0.7));
    else c.copy(mid).lerp(bot, Math.pow(-y, 0.8));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  envScene.add(new THREE.Mesh(geo, mat));

  const pmrem = new THREE.PMREMGenerator(gl);
  const target = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  geo.dispose();
  mat.dispose();

  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}
