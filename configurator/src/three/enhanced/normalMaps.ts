import * as THREE from 'three';
import type { PrintPanelKey } from '@/config/colors';
import { createDoorTexture, drawPrintPattern, type DoorStyle } from '../textures';

/**
 * ENHANCED look — panel NORMAL MAPS + the two small color maps (render-upgrade
 * Phase 4, HANDOFF Step 2). Ported from render-lab-v20.html (ribProfile /
 * makeNormalMap L352-405, makeLapShadeMap L412-428, slatColorTex L712-725).
 *
 * Nothing here is used by the classic look.
 *
 * Structure:
 *  - PURE math (no DOM, unit-tested): the sheet profile in inches, the lap and
 *    slat profiles, and the RGBA pixel buffers exactly as the lab computed them.
 *  - Lazy module-level TEXTURES: each map is built once, on first request, as
 *    a CanvasTexture and shared by every material (HANDOFF: "cache the
 *    textures once and reuse them" — nothing is re-generated or re-uploaded on
 *    a rebuild or a drag).
 *
 * Normal-map conventions (HANDOFF pitfall 1 — do not change one without the other):
 *  - CanvasTexture with flipY = true (three's default): canvas row 0 is the
 *    TOP of the tile (v = 1).
 *  - Green = +dy, where dy is the height difference DOWN the canvas rows.
 *    Because rows run top->down while v runs bottom->up, +dy = -dh/dv, the
 *    OpenGL (+Y up) convention three expects. Stored as -dy, horizontal ribs
 *    light from below and read as grooves / lap siding. A DataTexture
 *    (flipY = false) would need the opposite sign.
 *  - colorSpace = NoColorSpace (the CanvasTexture default): normal maps are
 *    data. Never pass these textures as JSX props — R3F 8 re-tags any RGBA8
 *    texture handed to a JSX prop as sRGB, which corrupts a normal map. Use the
 *    imperative factories in materials.ts.
 *
 * UV contract for the sheet + lap maps: mesh UVs in FEET. The textures repeat
 * every TILE_FT = 3 ft (repeat = 1/3), so the major rib pitch is exactly 9".
 *  - wall-vertical / roof-vertical: ribs vary along u. Walls: u runs along the
 *    wall. Roof: u runs along the eave/ridge, so the ribs run ridge -> eave.
 *  - wall-horizontal / roof-horizontal / lap: ribs vary along v. Walls: v =
 *    height. Roof: v must be the distance measured DOWN THE SLOPE (not plan
 *    distance) so the rib pitch stays 9" on the panel.
 */

// ── Sheet profile (HANDOFF Step 2, read off the owner's sample panel) ──────

/** One profile point: [distance from the rib centre, height], both in inches. */
export type ProfilePoint = readonly [number, number];

/** Major rib, every 9" on centre: 3/4" tall, ~3/4" flat top, stepped straight flanks, ~2-3/4" base. */
export const MAJOR_RIB: readonly ProfilePoint[] = [
  [0, 0.75],
  [0.38, 0.75],
  [0.78, 0.5],
  [0.95, 0.46],
  [1.38, 0],
];
/** Minor rib (two per pan, centred at 3" and 6"): ~1/8" tall with crisp shoulders. */
export const MINOR_RIB: readonly ProfilePoint[] = [
  [0, 0.13],
  [0.16, 0.13],
  [0.32, 0],
];
/** Major rib pitch (in). */
export const RIB_PERIOD_IN = 9;
/** Minor rib centres within one period (in). */
export const MINOR_RIB_CENTERS_IN = [3, 6] as const;
/** Rib periods per texture tile: 4 x 9" = one 36" tile. */
export const RIBS_PER_TILE = 4;
/** One texture tile, inches / feet. */
export const TILE_IN = RIB_PERIOD_IN * RIBS_PER_TILE;
export const TILE_FT = TILE_IN / 12;
/** Normal-map resolution (px per 36" tile, both axes). */
export const NORMAL_MAP_PX = 1024;

/** Lap siding: 12" reveal -> 3 courses per 36" tile. */
export const LAP_REVEAL_IN = 12;
export const LAP_COURSES_PER_TILE = TILE_IN / LAP_REVEAL_IN;
/** Roll-up curtain: 4 slats per foot; one slat tile = 1 ft of door height. */
export const SLATS_PER_FT = 4;
/** Slat color map resolution (px per 1 ft tile). */
export const SLAT_COLOR_PX = 256;
/** Lap shade map resolution (px per 36" tile). */
export const LAP_SHADE_PX = 1024;

/**
 * Slope gain for the SHEET maps: height is in inches and the 2-px central
 * difference spans 2 * (TILE_IN / N) = 72/N inches, so multiplying by N/72
 * turns it into the true rise/run (HANDOFF "use true slopes").
 */
export const sheetSlopeGain = (n: number) => n / (2 * TILE_IN);
/** The lab's (non-physical) gains for the lap and slat maps. */
export const LAP_SLOPE_GAIN = 16;
export const SLAT_SLOPE_GAIN = 20;

/** Piecewise-linear profile: height at distance `d` (in) from the rib centre, 0 past the last point. */
export function trap(d: number, pts: readonly ProfilePoint[]): number {
  if (d >= pts[pts.length - 1][0]) return 0;
  for (let k = 1; k < pts.length; k++) {
    if (d <= pts[k][0]) {
      const [x0, y0] = pts[k - 1];
      const [x1, y1] = pts[k];
      return y0 + (y1 - y0) * ((d - x0) / (x1 - x0));
    }
  }
  return 0;
}

/**
 * Sheet height (in) at `x` in [0, 1) across one 9" period. The major rib is
 * centred on the period edge (x = 0 / 1), the minor ribs at 3" and 6", flat
 * pan elsewhere.
 */
export function ribProfile(x: number): number {
  const xin = x * RIB_PERIOD_IN;
  const d = Math.min(xin, RIB_PERIOD_IN - xin);
  return Math.max(
    trap(d, MAJOR_RIB),
    trap(Math.abs(xin - MINOR_RIB_CENTERS_IN[0]), MINOR_RIB),
    trap(Math.abs(xin - MINOR_RIB_CENTERS_IN[1]), MINOR_RIB),
  );
}

/**
 * Lap board height at `t` in [0, 1) up one course (0 = the course's bottom
 * edge): a sharp overlap step over the bottom 6%, then a gentle taper to 0.7
 * at the top where the next board laps over it (lab lapBoard).
 */
export const lapBoard = (t: number) => (t < 0.06 ? t / 0.06 : 1 - 0.3 * ((t - 0.06) / 0.94));

/** Roll-up slat height at `y` (any real; one slat per unit, 0 = slat bottom) (lab courseProfile). */
export function courseProfile(y: number): number {
  const t = y % 1;
  if (t < 0.12) return t / 0.12;
  return 1 - 0.4 * ((t - 0.12) / 0.88);
}

// ── Map kinds ───────────────────────────────────────────────────────────────

/**
 * Every normal map the enhanced look uses. The roof maps are the SAME sheet as
 * the walls (HANDOFF Step 2), so roof-vertical shares wall-vertical's texture
 * and roof-horizontal shares wall-horizontal's; only the material's
 * normalScale (0.8 vs 0.9) and the UV contract differ.
 */
export type NormalMapKind = 'wall-vertical' | 'wall-horizontal' | 'roof-vertical' | 'roof-horizontal' | 'lap' | 'slat';

export const NORMAL_MAP_KINDS: readonly NormalMapKind[] = [
  'wall-vertical',
  'wall-horizontal',
  'roof-vertical',
  'roof-horizontal',
  'lap',
  'slat',
];

/** Distinct pixel sources behind the kinds (one texture each). */
type MapSource = 'sheet-u' | 'sheet-v' | 'lap' | 'slat';

const SOURCE_OF: Record<NormalMapKind, MapSource> = {
  'wall-vertical': 'sheet-u',
  'roof-vertical': 'sheet-u',
  'wall-horizontal': 'sheet-v',
  'roof-horizontal': 'sheet-v',
  lap: 'lap',
  slat: 'slat',
};

interface SourceSpec {
  /** Texture axis the height varies along (the other axis is constant). */
  axis: 'u' | 'v';
  /** Height at texture coordinate t in [0, 1) along `axis`, within one tile. */
  height: (t: number) => number;
  /** Multiplier from a 2-px height difference to the stored slope. */
  gain: (n: number) => number;
}

const SOURCES: Record<MapSource, SourceSpec> = {
  'sheet-u': { axis: 'u', height: (t) => ribProfile((t * RIBS_PER_TILE) % 1), gain: sheetSlopeGain },
  'sheet-v': { axis: 'v', height: (t) => ribProfile((t * RIBS_PER_TILE) % 1), gain: sheetSlopeGain },
  lap: { axis: 'v', height: (t) => lapBoard((t * LAP_COURSES_PER_TILE) % 1), gain: () => LAP_SLOPE_GAIN },
  // One slat tile = 1 ft of door height (see materials.ts slat repeat), 4 slats per tile.
  slat: { axis: 'v', height: (t) => courseProfile((t * SLATS_PER_FT) % 1), gain: () => SLAT_SLOPE_GAIN },
};

/** Which texture axis a kind's relief varies along ('u' = vertical ribs, 'v' = horizontal). */
export const normalMapAxis = (kind: NormalMapKind) => SOURCES[SOURCE_OF[kind]].axis;

/** True when two kinds are drawn from (and share) the same texture. */
export const sameNormalMapSource = (a: NormalMapKind, b: NormalMapKind) => SOURCE_OF[a] === SOURCE_OF[b];

/**
 * Stored slope along the varying axis for each texel index k (0..n-1) in
 * CANVAS order: k = column i (u = i/n) for u-maps, k = row j (v = 1 - j/n) for
 * v-maps. Value = (h[k+1] - h[k-1]) * gain with wrap, i.e. the lab's dx / dy.
 */
export function profileSlopes(kind: NormalMapKind, n = NORMAL_MAP_PX): Float64Array {
  const src = SOURCES[SOURCE_OF[kind]];
  const h = new Float64Array(n);
  for (let k = 0; k < n; k++) h[k] = src.height(src.axis === 'u' ? k / n : 1 - k / n);
  const gain = src.gain(n);
  const s = new Float64Array(n);
  for (let k = 0; k < n; k++) s[k] = (h[(k + 1) % n] - h[(k - 1 + n) % n]) * gain;
  return s;
}

/**
 * RGBA8 pixels (n x n, canvas row order) of a normal map, identical to the
 * lab's makeNormalMap: R = -dx, G = +dy (see the header), B = 1, each
 * normalized, then *0.5 + 0.5 and * 255 into a Uint8ClampedArray (round to
 * nearest). Every map is 1-D, so one line of texels is computed and copied.
 */
export function normalMapPixels(kind: NormalMapKind, n = NORMAL_MAP_PX): Uint8ClampedArray {
  const axis = SOURCES[SOURCE_OF[kind]].axis;
  const slopes = profileSlopes(kind, n);
  const px = new Uint8ClampedArray(n * n * 4);
  const texel = (dx: number, dy: number, out: Uint8ClampedArray, p: number) => {
    const inv = 1 / Math.hypot(dx, dy, 1);
    out[p] = (-dx * inv * 0.5 + 0.5) * 255;
    out[p + 1] = (dy * inv * 0.5 + 0.5) * 255;
    out[p + 2] = inv * 255;
    out[p + 3] = 255;
  };
  if (axis === 'u') {
    const row = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) texel(slopes[i], 0, row, i * 4);
    for (let j = 0; j < n; j++) px.set(row, j * n * 4);
  } else {
    const one = new Uint8ClampedArray(4);
    for (let j = 0; j < n; j++) {
      texel(0, slopes[j], one, 0);
      for (let i = 0; i < n; i++) px.set(one, (j * n + i) * 4);
    }
  }
  return px;
}

// ── Color maps (sRGB; multiplied by the material color) ─────────────────────

/** Fraction of canvas row [j, j+1) covered by the span [y0, y1) (canvas fillRect anti-aliasing). */
const rowCover = (j: number, y0: number, y1: number) => Math.max(0, Math.min(j + 1, y1) - Math.max(j, y0));

/** Source-over of an RGBA fill at alpha `a` onto an 8-bit row color (in place). */
function over(rgb: number[], fill: readonly [number, number, number], a: number) {
  for (let c = 0; c < 3; c++) rgb[c] = fill[c] * a + rgb[c] * (1 - a);
}

/**
 * A full-width fill over canvas rows [y0, y1) (fractional rows are partially
 * covered, like a canvas fillRect). With `gradient` the alpha fades linearly
 * from `alpha` at y0 to 0 at y1.
 */
type Band = { y0: number; y1: number; rgb: readonly [number, number, number]; alpha: number; gradient?: boolean };

/** Per-row RGB of a white tile with `bands` composited in order (every row is uniform across the tile). */
function bandRows(n: number, bands: Band[]): number[][] {
  const rows: number[][] = [];
  for (let j = 0; j < n; j++) {
    const rgb = [255, 255, 255];
    for (const b of bands) {
      const cov = rowCover(j, b.y0, b.y1);
      if (cov <= 0) continue;
      // gradient alpha at the centre of the covered part of the row
      const mid = (Math.max(j, b.y0) + Math.min(j + 1, b.y1)) / 2;
      const a = b.gradient ? b.alpha * (1 - (mid - b.y0) / (b.y1 - b.y0)) : b.alpha;
      over(rgb, b.rgb, a * cov);
    }
    rows.push(rgb);
  }
  return rows;
}

function rowsToPixels(rows: number[][], n: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * n * 4);
  const one = new Uint8ClampedArray(4);
  for (let j = 0; j < n; j++) {
    one[0] = rows[j][0];
    one[1] = rows[j][1];
    one[2] = rows[j][2];
    one[3] = 255;
    for (let i = 0; i < n; i++) px.set(one, (j * n + i) * 4);
  }
  return px;
}

/**
 * Canvas rows (top edge) where each lap course's shade band starts: the
 * bottom edge of each board, 12" apart. EXACTLY one per course.
 *
 * LAB BUG, FIXED HERE (owner FYI): the lab looped k = 0..3 over 3 courses, so
 * its row-0 band was drawn twice and every third course's under-board shadow
 * was ~1.8x darker (alpha ~0.36 instead of 0.20). This port loops k = 0..2.
 */
export function lapShadeBandRows(n = LAP_SHADE_PX): number[] {
  const course = n / LAP_COURSES_PER_TILE;
  const rows: number[] = [];
  for (let k = 0; k < LAP_COURSES_PER_TILE; k++) rows.push((n - k * course) % n);
  return rows;
}

/** Lap shade band: rgba(0,0,0,0.20) fading to clear over 16% of a course, just below each board. */
export const LAP_SHADE = { alpha: 0.2, heightFrac: 0.16 } as const;

/**
 * Lap siding shade map (lab makeLapShadeMap, double course fixed): white, with
 * the soft shadow each board casts on the board below it — a black gradient
 * starting at the board's bottom edge, fading to clear ~1.9" down.
 */
export function lapShadePixels(n = LAP_SHADE_PX): Uint8ClampedArray {
  const h = (n / LAP_COURSES_PER_TILE) * LAP_SHADE.heightFrac;
  const bands = lapShadeBandRows(n).map((y0) => ({ y0, y1: y0 + h, rgb: [0, 0, 0] as const, alpha: LAP_SHADE.alpha, gradient: true }));
  return rowsToPixels(bandRows(n, bands), n);
}

/**
 * Roll-up slat color map, one 1 ft tile with 4 slats (lab slatColorTex): on
 * white, per slat a thin gray seam at the lap (rgba(60,66,74,0.18)), a faint
 * catch-light just below it (rgba(255,255,255,0.10)) and a very light shade
 * over the slat's lower quarter (rgba(60,66,74,0.05)). As in the lab, the
 * catch-light is white over the white base, so it is a no-op in this map; the
 * visible catch-light on each slat comes from the slat NORMAL map (the sharp
 * rise at each slat's lower edge faces the sky).
 */
export function slatColorPixels(n = SLAT_COLOR_PX): Uint8ClampedArray {
  const band = n / SLATS_PER_FT;
  const gray = [60, 66, 74] as const;
  const bands: Band[] = [];
  for (let i = 0; i < SLATS_PER_FT; i++) {
    const y = i * band;
    bands.push({ y0: y, y1: y + Math.max(1, band * 0.06), rgb: gray, alpha: 0.18 });
    bands.push({ y0: y + band * 0.08, y1: y + band * 0.08 + Math.max(1, band * 0.08), rgb: [255, 255, 255], alpha: 0.1 });
    bands.push({ y0: y + band * 0.75, y1: y + band, rgb: gray, alpha: 0.05 });
  }
  return rowsToPixels(bandRows(n, bands), n);
}

// ── Lazy, shared textures ──────────────────────────────────────────────────

/**
 * Anisotropy for every enhanced texture. Until a renderer reports its maximum
 * (configureEnhancedTextures), 16 is requested; three clamps it to the GPU's
 * maximum at upload, so it is the max either way.
 */
let anisotropy = 16;
const textures = new Map<string, THREE.CanvasTexture>();
/** Clones handed out with a per-use repeat (e.g. roll-up slats) — kept in step with `anisotropy`. */
const clones = new Set<THREE.Texture>();

function canvasTexture(pixels: Uint8ClampedArray, n: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  img.data.set(pixels);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  // flipY stays true (CanvasTexture default) — the green-channel sign depends on it.
  return t;
}

function lazy(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = textures.get(key);
  if (!t) {
    t = make();
    textures.set(key, t);
  }
  return t;
}

/**
 * The shared normal map for `kind` (built on first use, NoColorSpace, repeat
 * 1/3 for the sheet + lap maps = UVs in feet, 1 for slats). Do not mutate it;
 * clone for a different repeat (clones share the GPU upload).
 */
export function normalMapTexture(kind: NormalMapKind): THREE.CanvasTexture {
  const src = SOURCE_OF[kind];
  return lazy('nm-' + src, () => {
    const t = canvasTexture(normalMapPixels(kind), NORMAL_MAP_PX);
    t.colorSpace = THREE.NoColorSpace;
    const r = src === 'slat' ? 1 : 1 / TILE_FT;
    t.repeat.set(r, r);
    t.name = 'enhanced-nm-' + src;
    return t;
  });
}

/** Shared lap-siding shade color map (sRGB, repeat 1/3 = UVs in feet). */
export function lapShadeTexture(): THREE.CanvasTexture {
  return lazy('lap-shade', () => {
    const t = canvasTexture(lapShadePixels(), LAP_SHADE_PX);
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / TILE_FT, 1 / TILE_FT);
    t.name = 'enhanced-lap-shade';
    return t;
  });
}

/** Print-panel color map resolution (px per 36" tile; the classic print module size). */
export const PRINT_PANEL_PX = 512;

/**
 * Shared CCI print-panel wainscot color map (wood / brick / stone printed
 * steel; sRGB, repeat 1/3 = UVs in feet, one 3 ft module per tile). Drawn by
 * the classic look's own pattern painter (textures.ts drawPrintPattern) so
 * both looks show the same print; the enhanced ribs come from the normal map,
 * so nothing is painted over the print here.
 */
export function printPanelTexture(print: PrintPanelKey): THREE.CanvasTexture {
  return lazy('print-' + print, () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PRINT_PANEL_PX;
    drawPrintPattern(canvas.getContext('2d')!, PRINT_PANEL_PX, print);
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / TILE_FT, 1 / TILE_FT);
    t.name = 'enhanced-print-' + print;
    return t;
  });
}

/** Shared roll-up slat color map (sRGB, one tile = 1 ft of door height). */
export function slatColorTexture(): THREE.CanvasTexture {
  return lazy('slat-color', () => {
    const t = canvasTexture(slatColorPixels(), SLAT_COLOR_PX);
    t.colorSpace = THREE.SRGBColorSpace;
    t.name = 'enhanced-slat-color';
    return t;
  });
}

/**
 * Shared walk-door face color map per style and white / black (sRGB, one
 * image over the whole slab). Drawn by the classic look's own door painter
 * (textures.ts createDoorTexture), so both looks show the same 6-panel /
 * 9-lite / diamond faces and black doors.
 */
export function doorFaceTexture(style: DoorStyle, dark: boolean): THREE.CanvasTexture {
  return lazy(`door-${style}-${dark ? 'blk' : 'wht'}`, () => {
    const t = createDoorTexture(style, dark);
    t.anisotropy = anisotropy;
    t.name = `enhanced-door-${style}-${dark ? 'blk' : 'wht'}`;
    return t;
  });
}

/**
 * A clone of a shared texture with its own repeat (the GPU upload is shared).
 * The caller owns it: dispose it when done (releaseTextureClone).
 */
export function textureClone(base: THREE.Texture, repeatX: number, repeatY: number): THREE.Texture {
  const t = base.clone();
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  clones.add(t);
  return t;
}

/** Dispose a texture made by textureClone (the shared source stays uploaded while others use it). */
export function releaseTextureClone(t: THREE.Texture): void {
  clones.delete(t);
  t.dispose();
}

/**
 * Use the renderer's real maximum anisotropy for every enhanced texture
 * (existing ones are re-uploaded once if the value changes). Call once when
 * the enhanced rig mounts; harmless to call again.
 */
export function configureEnhancedTextures(renderer: Pick<THREE.WebGLRenderer, 'capabilities'>): void {
  const max = renderer.capabilities.getMaxAnisotropy();
  if (!Number.isFinite(max) || max < 1 || max === anisotropy) return;
  anisotropy = max;
  for (const t of [...textures.values(), ...clones]) {
    t.anisotropy = max;
    t.needsUpdate = true;
  }
}

/** The anisotropy new enhanced textures get (diagnostics / tests). */
export const enhancedTextureAnisotropy = () => anisotropy;

/** Free every shared enhanced texture (tests, HMR). They are rebuilt on next use. */
export function disposeEnhancedTextures(): void {
  for (const t of textures.values()) t.dispose();
  textures.clear();
  for (const t of clones) t.dispose();
  clones.clear();
}
