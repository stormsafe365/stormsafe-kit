import * as THREE from 'three';
import type { StructureModel } from '@/engine/geometry';

/**
 * ENHANCED look — scene constants (render-upgrade Phase 3, HANDOFF Steps 6-7).
 *
 * OWNER OVERRIDE (2026-09-28): "go easy on lighting & shadows" — the renders
 * go on quotes and PDFs, so the scene is bright, high-key and low-contrast:
 * every wall stays clearly readable, there are NO cast shadows, and the only
 * ground shading is a very soft contact decal under the footprint. Realism
 * comes from the corrugated panel normal maps (later phases), not from
 * dramatic light. This replaces HANDOFF Step 6's sun/shadow recipe.
 *
 * Light colors are the lab's hexes fed as LINEAR values (r134 had no color
 * management), so they keep the lab's mild tint instead of the stronger one an
 * sRGB->linear decode would give. Intensities are r169 physical units (no
 * legacy x PI).
 *
 * WALL BALANCE: every wall must read the same for the SAME paint, dark paints
 * included (ACES' toe roughly doubles a lighting difference on Black / Burgundy
 * / Barn Red, so "gentle" alone is not enough — the first Phase-3 key/fill,
 * lab azimuths, measured 7.6% on Light Stone but 23.6% on Barn Red). So the key
 * and fill sit on the two 45-degree diagonals (key front-right, fill back-left,
 * the lab's sun / fill ELEVATIONS kept): the key lights front + right equally,
 * the fill lights back + left equally, and the fill's intensity is set so its
 * luminance on back/left equals the key's on front/right (wallDirectLuminance;
 * guarded by enhancedLook.test.ts). Measured on the PDF capture of A_CA (mean
 * Rec.709 luma of the wall pixels, front / back / left / right, max/min):
 *   Light Stone 181.3 / 181.1 / 181.1 / 180.6  0.4%
 *   Light Gray  162.9 / 162.9 / 162.8 / 162.7  0.1%
 *   Barn Red     49.4 /  48.9 /  48.9 /  49.1  1.0%
 *   Black        16.4 /  16.1 /  16.1 /  16.3  2.0%
 *   Burgundy     27.0 /  26.7 /  26.6 /  26.9  1.4%
 * (classic, same method: Light Stone 151.5, Barn Red 27.1, Black 3.1.)
 * The roof still catches more of the key than the walls, which keeps the form.
 */

/** A lab hex taken as raw linear RGB (what three r134 did with `new Color(hex)`). */
export const linearColor = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

export const ENHANCED_LOOK = {
  /**
   * ACES filmic exposure (R3F's default tone mapping; classic runs at 1).
   * 1.3 lands painted walls near their swatch brightness (Light Stone ~181
   * luma vs swatch 186, Bright White ~203) without clipping light roofs, and
   * keeps Charcoal (~92) and Burgundy (~27) readable (classic: 63 / 10).
   */
  exposure: 1.3,
  /** Vertical FOV (deg) — straight architectural lines. Classic keeps the Canvas' 38. */
  fovDeg: 30,
  /** Minimum camera far plane while enhanced (the ground reaches to the fog). */
  cameraFar: 1200,

  /** Dark navy page background — owner 9/29/26 'make the background dark again'
   *  (same #08121d as the classic look / brand dark). The fog fades the ground into it.
   *  Building lighting is unchanged (still bright + even for PDFs). */
  background: '#08121d',
  fog: { near: 480, far: 1150 },
  /** Unlit dark ground, a touch lighter than the background so the light
   *  concrete slab (and the building on it) stands out (renders exactly this color). */
  ground: '#101c2a',
  groundRadius: 2500,

  /** Strong, even sky/ground base: azimuth-independent, so every wall reads bright. */
  hemi: { sky: 0xdfe9f4, ground: 0x9c9d95, intensity: 1.1 },
  /**
   * ONE gentle key, no shadows: the lab sun's color and elevation (~49 deg,
   * lab (34,50,-26)) on the front-right 45-degree diagonal, so the front and
   * right walls get exactly the same share.
   */
  key: { color: 0xfff1dc, intensity: 1.0, position: [30, 50, -30] as [number, number, number] },
  /**
   * Gentle opposite fill: the lab fill's color and elevation (~27 deg, lab
   * (-36,22,24)) on the back-left diagonal. Its job is a soft highlight for the
   * rib normal maps, and its intensity (weaker than the key) is the one that
   * gives the back / left walls the key's front / right wall luminance.
   */
  fill: { color: 0xdfe8f2, intensity: 0.766, position: [-30, 22, 30] as [number, number, number] },

  /**
   * PMREM sky-dome environment (lab buildEnvironment, WITHOUT its sun disc so
   * it is azimuth-symmetric and can't shade one wall differently from another).
   * r169 applies scene.environmentIntensity to every standard material that
   * has no envMap of its own, so this stays low: a subtle sheen on trim and
   * Galvalume, a touch of sky fill elsewhere.
   */
  env: { zenith: 0x7fa9dc, horizon: 0xe6ecf2, nadir: 0xa3a59d, intensity: 0.25 },

  /**
   * Light concrete (slab + footings). The slab itself follows the quote's
   * Foundation Type and the CCI details (foundationLayout.ts): 4" thick, top
   * at y = 0, 2" above the ground, its edge 6" past the base rails (incl.
   * lean-tos). Faint broom finish + saw-cut control joints.
   */
  slab: { color: '#d2d2cc', roughness: 0.92, tileFt: 6, joint: '#8d8d86' },
  /** Non-concrete surfaces under the building (subtle; 2 ft past the footprint). */
  pads: {
    gravel: { color: '#a29e95', roughness: 1, tileFt: 3 },
    asphalt: { color: '#3b3f45', roughness: 0.95, tileFt: 4 },
    dirt: { color: '#6d645a', roughness: 1, tileFt: 6 },
  },
  /**
   * Structure / Cutaway: the ground and slab / pad go see-through so the
   * footings, #5 bars and anchor embedment read like the CCI sections
   * (opacity per view; exterior = solid).
   */
  ghost: {
    structure: { ground: 0.3, surface: 0.26, footing: 0.6 },
    cutaway: { ground: 0.22, surface: 0.2, footing: 0.55 },
  },

  /**
   * Very soft contact shading (owner override: no cast shadows). Each decal
   * fills its shape at peak alpha `alpha` and fades to clear over `fade` ft
   * outward: `slab` = the building + lean-to rectangles on the slab top (also
   * a faint shade under the roof, e.g. inside an open carport), `ground` = the
   * slab edge on the ground.
   */
  contact: {
    slab: { fade: 1.6, alpha: 0.2 },
    ground: { fade: 1.4, alpha: 0.14 },
  },
} as const;

/** Plan-view rectangle (ft) that everything touching the ground sits in. */
export interface Footprint {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

type SiteInput = Pick<StructureModel, 'width' | 'length' | 'leanTos'>;

/**
 * Plan rectangles of everything standing on the slab: the main building,
 * then one per lean-to (wall/post lines; roof overhangs don't count). Eave
 * lean-tos run along Z (inner/outer are X); gable lean-tos run along X
 * (inner/outer are Z). A lean-to with any non-finite bound is skipped, so a
 * half-resolved lean-to can never produce a NaN slab.
 */
export function siteRects(s: SiteInput): Footprint[] {
  const rects: Footprint[] = [{ x0: -s.width / 2, x1: s.width / 2, z0: -s.length / 2, z1: s.length / 2 }];
  for (const lt of s.leanTos ?? []) {
    const eave = lt.attachedSide === 'Left Eave' || lt.attachedSide === 'Right Eave';
    const xs = eave ? [lt.inner.x, lt.outer.x] : [lt.spanStart, lt.spanEnd];
    const zs = eave ? [lt.spanStart, lt.spanEnd] : [lt.inner.z, lt.outer.z];
    if (![...xs, ...zs].every(Number.isFinite)) continue;
    rects.push({ x0: Math.min(xs[0], xs[1]), x1: Math.max(xs[0], xs[1]), z0: Math.min(zs[0], zs[1]), z1: Math.max(zs[0], zs[1]) });
  }
  return rects;
}

/** Bounding rectangle of siteRects(): the slab is this plus its 2 ft margin. */
export function siteFootprint(s: SiteInput): Footprint {
  const rects = siteRects(s);
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    z0: Math.min(...rects.map((r) => r.z0)),
    z1: Math.max(...rects.map((r) => r.z1)),
  };
}

/** Rec.709 luminance of a lab hex taken as linear RGB (how the rig feeds light colors). */
const lightLuminance = (hex: number) => {
  const c = linearColor(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/**
 * Direct (key + fill) diffuse irradiance on a surface with outward normal `n`,
 * luminance-weighted by each light's color, in the same units as the
 * hemisphere term. Pure: used by the wall-balance guard test (the four walls
 * must get the same value) and to keep the key/fill gentle vs the even base.
 */
export function wallDirectLuminance(n: readonly [number, number, number]): number {
  const dirTerm = (pos: readonly number[], intensity: number, color: number) => {
    const len = Math.hypot(pos[0], pos[1], pos[2]);
    const ndl = (n[0] * pos[0] + n[1] * pos[1] + n[2] * pos[2]) / len;
    return intensity * lightLuminance(color) * Math.max(0, ndl);
  };
  const { key, fill } = ENHANCED_LOOK;
  return dirTerm(key.position, key.intensity, key.color) + dirTerm(fill.position, fill.intensity, fill.color);
}

/** Hemisphere irradiance on a vertical wall (dotNL = 0 -> 50/50 sky/ground mix), luminance-weighted. */
export function wallHemiIrradiance(): number {
  const { sky, ground, intensity } = ENHANCED_LOOK.hemi;
  return intensity * 0.5 * (lightLuminance(sky) + lightLuminance(ground));
}
