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
 * White quote style (owner 10/12/26: "they need to print the quote but its
 * background is too dark & taking up too much ink"): for a light capture the
 * scene background turns LIGHT_CAPTURE_BG and the dark ground scenery tagged
 * `userData.lightCaptureHide` (the classic grid, the enhanced ground disc) is
 * hidden, so the building, its slab and its soft contact shadows sit on a light
 * page. Lights, materials, framing and the building are untouched (the capture
 * fit never looks at visibility). Returns the restore; a dark (default)
 * capture changes nothing.
 */
export function applyCaptureTheme(scene: THREE.Scene, theme?: CaptureTheme): () => void {
  if (theme !== 'light') return () => {};
  const bg = scene.background;
  let restoreBg: () => void;
  if (bg instanceof THREE.Color) {
    // the Color R3F attached (<color attach="background">): recolour it in place
    const prev = bg.clone();
    bg.set(LIGHT_CAPTURE_BG);
    restoreBg = () => { bg.copy(prev); };
  } else {
    scene.background = new THREE.Color(LIGHT_CAPTURE_BG);
    restoreBg = () => { scene.background = bg; };
  }
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData?.lightCaptureHide && o.visible) { o.visible = false; hidden.push(o); }
  });
  return () => {
    restoreBg();
    for (const o of hidden) o.visible = true;
  };
}
