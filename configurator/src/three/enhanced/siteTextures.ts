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
export function createConcreteTexture(opts: { broom?: boolean } = {}): THREE.CanvasTexture {
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
  if (opts.broom) {
    // Faint broom / float finish: fine, slightly wavy streaks along canvas X
    // (world X on the slab top), a few percent darker, seamless in X. Very
    // subtle — the renders stay clean for PDFs.
    const rb = mulberry32(0xb2004f);
    for (let i = 0; i < 520; i++) {
      const y0 = rb() * N;
      const len = 30 + rb() * 120;
      const x0 = rb() * N;
      const g = Math.round(150 + rb() * 60);
      x.strokeStyle = `rgba(${g},${g},${g - 3},${(0.035 + rb() * 0.045).toFixed(3)})`;
      x.lineWidth = 0.6 + rb() * 0.8;
      const wob = (rb() - 0.5) * 1.6;
      for (const dx of [0, -N, N]) {
        x.beginPath();
        x.moveTo(x0 + dx, y0);
        x.quadraticCurveTo(x0 + dx + len / 2, y0 + wob, x0 + dx + len, y0 + wob * 0.4);
        x.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Gravel / asphalt / compacted-dirt surface, one seamless 256 px tile of
 * WHITE-based speckle that modulates the pad material's color (like the
 * concrete tile), seeded so captures repeat:
 *  - gravel: crushed aggregate — angular chips over darker gaps;
 *  - asphalt: fine aggregate glints on a near-uniform base;
 *  - dirt: soft blotches + a few pebbles.
 */
export function createGroundSurfaceTexture(kind: 'gravel' | 'asphalt' | 'dirt'): THREE.CanvasTexture {
  const N = kind === 'gravel' ? 512 : 256; // gravel: crisper stones close up
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, N, N);
  const rnd = mulberry32(kind === 'gravel' ? 0x6a7e1 : kind === 'asphalt' ? 0xa5f417 : 0xd127);
  /** An irregular stone / speckle (ellipse), repeated across the tile edges it overlaps so the tile stays seamless. */
  const dot = (px: number, py: number, r: number, style: string) => {
    x.fillStyle = style;
    const rx = r * (0.75 + rnd() * 0.5);
    const ry = r * (0.75 + rnd() * 0.5);
    const rot = rnd() * Math.PI;
    const xs = [0, ...(px - r < 0 ? [N] : []), ...(px + r > N ? [-N] : [])];
    const ys = [0, ...(py - r < 0 ? [N] : []), ...(py + r > N ? [-N] : [])];
    for (const dx of xs) for (const dy of ys) {
      x.beginPath();
      x.ellipse(px + dx, py + dy, rx, ry, rot, 0, Math.PI * 2);
      x.fill();
    }
  };
  if (kind === 'dirt') {
    for (let i = 0; i < 320; i++) {
      const g = Math.round(200 + rnd() * 55);
      dot(rnd() * N, rnd() * N, 6 + rnd() * 24, `rgba(${g},${g - 5},${g - 12},0.1)`);
    }
    for (let i = 0; i < 900; i++) {
      const g = Math.round(165 + rnd() * 90);
      dot(rnd() * N, rnd() * N, 0.4 + rnd() * 0.9, `rgba(${g},${g - 3},${g - 8},0.3)`);
    }
  } else if (kind === 'gravel') {
    // CRUSHED aggregate (not round pebbles): angular 4-7 sided chips packed
    // over darker interstices, each with a faint lit facet.
    x.fillStyle = 'rgb(168,166,161)';
    x.fillRect(0, 0, N, N);
    const chip = (px: number, py: number, r: number, g: number) => {
      const n = 4 + Math.floor(rnd() * 4);
      const a0 = rnd() * Math.PI * 2;
      const pts = Array.from({ length: n }, (_, i) => {
        const a = a0 + ((i + (rnd() - 0.5) * 0.6) * Math.PI * 2) / n;
        const rr = r * (0.6 + rnd() * 0.55);
        return [Math.cos(a) * rr, Math.sin(a) * rr] as const;
      });
      const hi = Math.min(255, g + 22);
      const xs = [0, ...(px - r < 0 ? [N] : []), ...(px + r > N ? [-N] : [])];
      const ys = [0, ...(py - r < 0 ? [N] : []), ...(py + r > N ? [-N] : [])];
      for (const dx of xs) for (const dy of ys) {
        x.beginPath();
        pts.forEach(([u, v], i) => (i ? x.lineTo(px + dx + u, py + dy + v) : x.moveTo(px + dx + u, py + dy + v)));
        x.closePath();
        x.fillStyle = `rgba(${g},${g - 2},${g - 6},0.92)`;
        x.fill();
        // lit facet: the chip's first two edges, a touch lighter
        x.beginPath();
        x.moveTo(px + dx, py + dy);
        x.lineTo(px + dx + pts[0][0], py + dy + pts[0][1]);
        x.lineTo(px + dx + pts[1][0], py + dy + pts[1][1]);
        x.lineTo(px + dx + pts[2][0], py + dy + pts[2][1]);
        x.closePath();
        x.fillStyle = `rgba(${hi},${hi - 2},${hi - 5},0.35)`;
        x.fill();
      }
    };
    for (let i = 0; i < 9000; i++) chip(rnd() * N, rnd() * N, 2.2 + rnd() * 4.2, Math.round(160 + rnd() * 95));
  } else {
    for (let i = 0; i < 3000; i++) {
      const g = Math.round(175 + rnd() * 80);
      dot(rnd() * N, rnd() * N, 0.5 + rnd() * 1.1, `rgba(${g},${g},${g},0.35)`);
    }
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
export function createContactTexture(
  plane: Footprint,
  rects: Footprint[],
  fade: number,
  A: number,
  /** Optional mask: pixels outside every clip rectangle stay clear (a decal on a slab never overhangs its edge). */
  clip?: Footprint[],
): THREE.CanvasTexture {
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
      let f = d >= fade ? 0 : 1 - d / fade;
      if (clip && !clip.some((r) => wx >= r.x0 && wx <= r.x1 && wz >= r.z0 && wz <= r.z1)) f = 0;
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
