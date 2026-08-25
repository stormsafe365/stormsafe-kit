import * as THREE from 'three';
import type { PrintPanelKey } from '@/config/colors';

export type RibDirection = 'vertical' | 'horizontal';

/** Walk-through door face styles (mirrors the pricing program's wtdTypes.style). */
export type DoorStyle = 'std' | '6panel' | '9lite' | 'diamond';

/**
 * Procedurally drawn walk-through DOOR FACE (one slab, no tiling) — the panel
 * layout per style + the slab color (white or black). Mirrors the 2D elevation
 * door drawing in quote-builder.html so the 3D matches the quote:
 *  - std     : smooth slab, two faint recessed panels
 *  - 6panel  : 3×2 grid of raised panels
 *  - 9lite   : top-half 3×3 glass lites + two lower panels
 *  - diamond : solid slab with a centered 10×10 diamond window (upper third)
 * Mapped 1:1 onto the door plane (canvas aspect ≈ the 36×80 door).
 */
export function createDoorTexture(style: DoorStyle, dark: boolean): THREE.CanvasTexture {
  const W = 256;
  const H = 568; // ≈ 36×80 door aspect (0.45)
  const base = dark ? '#1f1f1f' : '#f4f1ec';
  const panel = dark ? '#2c2c2c' : '#d8d4cc';
  const line = dark ? '#0a0a0a' : '#b8b3aa';
  const glass = dark ? '#9eb6c6' : '#c8dfe8';

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  const inset = W * 0.1;
  const ix = inset;
  const iy = inset;
  const iw = W - inset * 2;
  const ih = H - inset * 2;

  const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
  };

  if (style === '6panel') {
    const gap = iw * 0.06;
    const pw = (iw - gap) / 2;
    const ph = (ih - gap * 2) / 3;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 2; c++) rect(ix + c * (pw + gap), iy + r * (ph + gap), pw, ph, panel, line);
  } else if (style === '9lite') {
    const liteH = ih * 0.5;
    const gap = iw * 0.025;
    const lW = (iw - gap * 2) / 3;
    const lH = (liteH - gap * 2) / 3;
    rect(ix, iy, iw, liteH, glass);
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) ctx.strokeRect(ix + c * (lW + gap), iy + r * (lH + gap), lW, lH);
    const by = iy + liteH + ih * 0.04;
    const bh = ih - liteH - ih * 0.04;
    const bw = (iw - gap) / 2;
    for (let c = 0; c < 2; c++) rect(ix + c * (bw + gap), by, bw, bh, panel, line);
  } else if (style === 'diamond') {
    // Solid slab + a centered diamond (rotated square) glass window, upper third.
    const cx = ix + iw / 2;
    const cy = iy + ih * 0.26;
    const r = Math.min(iw, ih) * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = dark ? '#cfcfcf' : '#9aa0a7';
    ctx.lineWidth = 5; // proud window frame
    ctx.stroke();
  }
  // std — a completely SOLID slab (the real CCI standard door is flat, no
  // panels), so nothing is drawn over the base fill. The frame/casing is the
  // separate 3D trim, not part of the slab.

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Deterministic PRNG so print patterns render identically every frame/build. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Paint one tiling module of a CCI print-panel pattern (memo 3/9/26) onto the
 * sheet canvas — wood planks, running-bond brick, or ashlar stone. Drawn
 * world-upright (planks vertical, brick/stone courses horizontal) and built
 * from spans that sum to the module size, so RepeatWrapping tiles cleanly.
 * The rib pass draws OVER this, keeping the printed sheet reading as formed
 * steel — which is what the real product is.
 */
function drawPrintPattern(ctx: CanvasRenderingContext2D, size: number, print: PrintPanelKey): void {
  const rnd = seededRand({ blackwood: 11, richwood: 23, rusticbrick: 37, stonewall: 53 }[print]);

  if (print === 'blackwood' || print === 'richwood') {
    const dark = print === 'blackwood';
    const base = dark ? '#45433e' : '#b2a488';
    const tones = dark ? ['#4b4943', '#403e39', '#514f48', '#3a3834'] : ['#b8ab8e', '#a89a7c', '#c0b498', '#9e9075'];
    const grainDark = dark ? 'rgba(20,18,14,0.35)' : 'rgba(92,70,45,0.28)';
    const grainLight = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,250,235,0.14)';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const planks = 6;
    const pw = size / planks;
    for (let p = 0; p < planks; p++) {
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
      ctx.fillRect(p * pw, 0, pw, size);
      // Long wavy grain streaks, full height so the module tiles vertically.
      const streaks = 5 + Math.floor(rnd() * 4);
      for (let g = 0; g < streaks; g++) {
        const x = p * pw + 2 + rnd() * (pw - 4);
        const amp = 1 + rnd() * 2.5;
        const wob = 0.5 + rnd() * 1.2;
        ctx.strokeStyle = rnd() < 0.7 ? grainDark : grainLight;
        ctx.lineWidth = 0.6 + rnd() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + amp * wob, size * 0.33, x - amp * wob, size * 0.66, x, size);
        ctx.stroke();
      }
      // Plank joint shadow
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(p * pw, 0, 1.5, size);
    }
  } else if (print === 'rusticbrick') {
    ctx.fillStyle = '#c6bfae'; // mortar
    ctx.fillRect(0, 0, size, size);
    const rows = 8;
    const bh = size / rows;
    const bw = size / 4;
    const tones = ['#74553f', '#815f46', '#6b4e39', '#8a684c', '#79573b'];
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? -bw / 2 : 0;
      for (let c = -1; c < 5; c++) {
        const x = c * bw + off;
        ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
        ctx.fillRect(x + 2.5, r * bh + 2.5, bw - 5, bh - 5);
        // weathered speckle
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let d = 0; d < 4; d++) ctx.fillRect(x + 4 + rnd() * (bw - 12), r * bh + 4 + rnd() * (bh - 10), 2 + rnd() * 5, 1 + rnd() * 2);
      }
    }
  } else {
    // stonewall — ashlar courses of varied-width gray stones
    ctx.fillStyle = '#77776f'; // mortar
    ctx.fillRect(0, 0, size, size);
    const rows = 4;
    const rh = size / rows;
    const tones = ['#a3a49d', '#b1b2ab', '#8f918a', '#9a9c94', '#a9aaa2'];
    for (let r = 0; r < rows; r++) {
      // 3–4 stones whose widths sum to the module so the row tiles horizontally.
      const n = 3 + (Math.floor(rnd() * 2) % 2);
      const raw = Array.from({ length: n }, () => 0.6 + rnd());
      const total = raw.reduce((a, b) => a + b, 0);
      let x = 0;
      for (let i = 0; i < n; i++) {
        const w = (raw[i] / total) * size;
        ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
        ctx.fillRect(x + 3, r * rh + 3, w - 6, rh - 6);
        // top-edge light + bottom shadow give the block relief
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x + 3, r * rh + 3, w - 6, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(x + 3, (r + 1) * rh - 5, w - 6, 2);
        x += w;
      }
    }
  }
}

/**
 * Procedurally drawn AG/R-panel steel sheeting (one 3' module, tiled).
 *
 * A FORMED-STEEL profile — wide flats separated by crisp mechanical ribs
 * (bend → valley → rib top → bend), not a smooth sinusoidal wave. Flats are
 * the dominant area; ribs are small-amplitude but sharply defined so the wall
 * reads as formed steel paneling, not rippled plastic/vinyl. No seam.
 * `direction`: 'horizontal' = horizontal ribs; 'vertical' = vertical ribs/roof.
 *
 * `print` (CCI wainscot only): paint that print-panel pattern under the ribs
 * instead of the flat base color.
 *
 * Caller sets repeat so one tile = 3 ft (see Siding).
 */
export function createCorrugatedTexture(
  baseColor: string,
  direction: RibDirection,
  print?: PrintPanelKey,
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
    if (mode === 'color' && print) drawPrintPattern(ctx, size, print);

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
