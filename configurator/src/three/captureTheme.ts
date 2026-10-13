import * as THREE from 'three';

/** 'light' = the White (print-friendly) quote style; anything else = today's capture. */
export type CaptureTheme = 'dark' | 'light';
export interface CaptureOptions { theme?: CaptureTheme }

/**
 * Background of a light capture. The program's White quote style paints the
 * 3D page's image boxes the same colour (quote-builder.html QW_FILL '#08121d').
 */
export const LIGHT_CAPTURE_BG = '#f3f6f8';

/**
 * The thin outline drawn around the building's silhouette in a light capture.
 * A white or very light building (white is a common wall colour) is only about
 * 1.4:1 against the light background, so without it the printed quote shows a
 * faint grey ghost of the building. The line is ~4:1 on the background and
 * still reads against white walls; on a dark building it simply merges into
 * the edge. 4 px of the 3200 px capture is about half a point on the page.
 */
export const LIGHT_CAPTURE_OUTLINE = '#6b7785';
export const LIGHT_CAPTURE_OUTLINE_PX = 4;

/** Renderer calls the light capture needs (a THREE.WebGLRenderer has them). */
export interface ClearAlphaRenderer { getClearAlpha(): number; setClearAlpha(a: number): void }

/**
 * White quote style (owner 10/12/26: "they need to print the quote but its
 * background is too dark & taking up too much ink"): for a light capture the
 * scene is rendered on a TRANSPARENT background (scene.background null, clear
 * alpha 0) with the dark ground scenery tagged `userData.lightCaptureHide`
 * (the classic grid, the enhanced ground disc) hidden; composeLightCapture
 * then lays the picture on LIGHT_CAPTURE_BG with the silhouette outline. The
 * building, its slab and its soft contact shadows are untouched (the capture
 * fit never looks at visibility). Returns the restore; a dark (default)
 * capture changes nothing.
 *
 * CaptureHook applies it right before EACH picture and restores right after,
 * so scenery a view change brings back (leaving the walk-in Interior view
 * re-shows the classic grid) is hidden too.
 */
export function applyCaptureTheme(scene: THREE.Scene, theme?: CaptureTheme, gl?: ClearAlphaRenderer | null): () => void {
  if (theme !== 'light') return () => {};
  const bg = scene.background;
  scene.background = null;
  const clearAlpha = gl ? gl.getClearAlpha() : null;
  if (gl) gl.setClearAlpha(0);
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData?.lightCaptureHide && o.visible) { o.visible = false; hidden.push(o); }
  });
  return () => {
    scene.background = bg; // the same object R3F attached (<color attach="background">)
    if (gl && clearAlpha != null) gl.setClearAlpha(clearAlpha);
    for (const o of hidden) o.visible = true;
  };
}

/** '#rrggbb' -> [r, g, b] */
const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * In place: every pixel at least half covered (alpha >= 128) becomes the
 * opaque outline colour, every other pixel clear. The soft contact shadows
 * (classic opacity 0.45, enhanced ground shade 0.14) stay under the line, so
 * only the building, its trim and its slab get an outline.
 */
export function silhouetteMask(px: Uint8ClampedArray, rgb: readonly [number, number, number]): Uint8ClampedArray {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] >= 128) { px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255; }
    else { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; }
  }
  return px;
}

/** Offsets on a circle of radius r: the mask drawn at each = the silhouette grown by r. */
export function outlineOffsets(r: number, steps = 16): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    out.push([Math.round(Math.cos(a) * r * 100) / 100, Math.round(Math.sin(a) * r * 100) / 100]);
  }
  return out;
}

/**
 * The finished light picture from the transparent render in `src` (the WebGL
 * canvas; preserveDrawingBuffer keeps it readable): LIGHT_CAPTURE_BG, then the
 * silhouette grown by LIGHT_CAPTURE_OUTLINE_PX in LIGHT_CAPTURE_OUTLINE, then
 * the render itself on top — so the line shows only just outside the building.
 * Returns a PNG data URL the same size as the render.
 */
export function composeLightCapture(src: HTMLCanvasElement): string {
  const W = src.width, H = src.height;
  const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const shot = make();
  const sx = shot.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  sx.drawImage(src, 0, 0);
  const px = sx.getImageData(0, 0, W, H);
  silhouetteMask(px.data, rgbOf(LIGHT_CAPTURE_OUTLINE));
  const mask = make();
  (mask.getContext('2d') as CanvasRenderingContext2D).putImageData(px, 0, 0);
  const out = make();
  const ox = out.getContext('2d') as CanvasRenderingContext2D;
  ox.fillStyle = LIGHT_CAPTURE_BG;
  ox.fillRect(0, 0, W, H);
  for (const [dx, dy] of outlineOffsets(LIGHT_CAPTURE_OUTLINE_PX)) ox.drawImage(mask, dx, dy);
  ox.drawImage(shot, 0, 0);
  const url = out.toDataURL('image/png');
  shot.width = shot.height = mask.width = mask.height = out.width = out.height = 0; // free the three buffers now
  return url;
}
