import * as THREE from 'three';

export type RibDirection = 'vertical' | 'horizontal';

/**
 * Procedurally drawn AG/R-panel steel sheeting (one 3' module, tiled).
 *
 * A FORMED-STEEL profile — wide flats separated by crisp mechanical ribs
 * (bend → valley → rib top → bend), not a smooth sinusoidal wave. Flats are
 * the dominant area; ribs are small-amplitude but sharply defined so the wall
 * reads as formed steel paneling, not rippled plastic/vinyl. No seam.
 * `direction`: 'horizontal' = horizontal ribs; 'vertical' = vertical ribs/roof.
 *
 * Caller sets repeat so one tile = 3 ft (see Siding).
 */
export function createCorrugatedTexture(
  baseColor: string,
  direction: RibDirection,
): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const size = 512; // 3 ft module
  const horizontal = direction === 'horizontal';
  const ribs = 8; // ribs per module ≈ 4.5" pitch (tunable)

  const draw = (mode: 'color' | 'bump'): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = mode === 'color' ? baseColor : '#808080';
    ctx.fillRect(0, 0, size, size);

    // Crisp lines drawn across the sheet (perpendicular to the rib axis).
    const line = (pos: number, thick: number, style: string) => {
      ctx.fillStyle = style;
      if (horizontal) ctx.fillRect(0, pos, size, thick);
      else ctx.fillRect(pos, 0, thick, size);
    };

    const band = size / ribs;
    for (let i = 0; i < ribs; i++) {
      const a = i * band;
      // Flats dominate; each rib = a crisp bend (valley shadow) + a raised rib
      // top (catch-light) + the far bend. Small amplitude, sharp transitions.
      if (mode === 'color') {
        line(a + band * 0.6, 2, 'rgba(0,0,0,0.16)'); // bend into valley
        line(a + band * 0.66, 4, 'rgba(255,255,255,0.13)'); // rib top
        line(a + band * 0.78, 2, 'rgba(0,0,0,0.16)'); // bend back to flat
      } else {
        line(a + band * 0.6, 2, '#5a5a5a');
        line(a + band * 0.66, 4, '#b8b8b8');
        line(a + band * 0.78, 2, '#5a5a5a');
      }
    }

    return canvas;
  };

  const map = new THREE.CanvasTexture(draw('color'));
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bump = new THREE.CanvasTexture(draw('bump'));
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;

  return { map, bump };
}

/**
 * Roll-up door curtain — tight, evenly-stacked horizontal slats with an
 * overlap shadow per slat. One tile = 1 ft; `slatsPerFoot` sets the pitch
 * (roll-up ≈ 4/ft ≈ 3"). Distinct from wall ribs (wider) and garage panels.
 */
export function createSlatTexture(
  baseColor: string,
  slatsPerFoot: number,
): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const size = 256;
  const n = Math.max(1, Math.round(slatsPerFoot));

  const draw = (mode: 'color' | 'bump'): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = mode === 'color' ? baseColor : '#9a9a9a';
    ctx.fillRect(0, 0, size, size);
    const band = size / n;
    for (let i = 0; i < n; i++) {
      const y = i * band;
      if (mode === 'color') {
        // soft groove where the next slat laps — a thin grey seam, not black
        ctx.fillStyle = 'rgba(60,66,74,0.16)';
        ctx.fillRect(0, y, size, Math.max(1, band * 0.05));
        // faint catch-light on the slat face just below the seam
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(0, y + band * 0.08, size, Math.max(1, band * 0.07));
      } else {
        ctx.fillStyle = '#666';
        ctx.fillRect(0, y, size, Math.max(1, band * 0.05));
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(0, y + band * 0.08, size, Math.max(1, band * 0.07));
      }
    }
    return canvas;
  };

  const map = new THREE.CanvasTexture(draw('color'));
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(draw('bump'));
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;
  return { map, bump };
}
