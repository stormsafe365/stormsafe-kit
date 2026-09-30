import * as THREE from 'three';
import type { Footprint } from './look';

/**
 * Canvas textures for the ENHANCED site (slab + soft contact shading).
 * Ported from render-lab-v20.html (concreteTex L284-296, ringTex L307-321).
 * Both are COLOR data, so they are tagged SRGBColorSpace (the lab left them
 * untagged because r134 had no color management).
 */

/** Small deterministic PRNG (mulberry32) so enhanced captures are repeatable. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Faint mottled concrete grain, one 256 px tile. The lab painted a #c9c9c3
 * base with 1400 random soft discs (gray 170-230, alpha 0.14). Here the base
 * is WHITE and every disc slightly darker, so the texture only modulates the
 * slab material color (#d2d2cc) by a few percent instead of darkening it, and
 * the seeded PRNG makes the pattern identical on every load.
 */
export function createConcreteTexture(): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, N, N);
  const rnd = mulberry32(0x5eed51ab);
  for (let i = 0; i < 1400; i++) {
    const g = Math.round(205 + rnd() * 50);
    x.fillStyle = `rgba(${g},${g},${g - 4},0.14)`;
    const r = 2 + rnd() * 18;
    x.beginPath();
    x.arc(rnd() * N, rnd() * N, r, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Distance (ft) from (x, z) to the rectangle (0 inside). */
function rectDistance(r: Footprint, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/**
 * Soft contact shade for a flat decal plane covering `plane` (world ft, plan
 * view): alpha `A` inside the UNION of `rects` (the building + each lean-to,
 * so an L-shaped build doesn't shade the open notch), fading quadratically
 * — A * (1 - d/fade)^2, the lab ringTex profile, without its 16-step banding —
 * to clear `fade` ft outside it. Drawn in rgb(20,24,28) like the lab, so it
 * darkens without tinting. ~8 px/ft, capped at 1024 px per side.
 *
 * Mapping (for a PlaneGeometry rotated -PI/2 about X, flipY on): canvas
 * column -> world +X, canvas row -> world +Z.
 */
export function createContactTexture(plane: Footprint, rects: Footprint[], fade: number, A: number): THREE.CanvasTexture {
  const pw = Math.max(plane.x1 - plane.x0, 1e-3);
  const pl = Math.max(plane.z1 - plane.z0, 1e-3);
  const W2 = Math.max(32, Math.min(1024, Math.round(pw * 8)));
  const H2 = Math.max(32, Math.min(1024, Math.round(pl * 8)));
  const c = document.createElement('canvas');
  c.width = W2;
  c.height = H2;
  const x = c.getContext('2d')!;
  const img = x.createImageData(W2, H2);
  const px = img.data;
  for (let j = 0; j < H2; j++) {
    const wz = plane.z0 + ((j + 0.5) / H2) * pl;
    for (let i = 0; i < W2; i++) {
      const wx = plane.x0 + ((i + 0.5) / W2) * pw;
      let d = Infinity;
      for (const r of rects) d = Math.min(d, rectDistance(r, wx, wz));
      const f = d >= fade ? 0 : 1 - d / fade;
      const p = (j * W2 + i) * 4;
      px[p] = 20;
      px[p + 1] = 24;
      px[p + 2] = 28;
      px[p + 3] = Math.round(255 * A * f * f);
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
