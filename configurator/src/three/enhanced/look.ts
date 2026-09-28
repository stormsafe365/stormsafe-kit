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
 * legacy x PI), balanced so the four walls of one paint color render within
 * ~15% of each other. Measured in the PDF capture (A_CA, Light Stone walls,
 * mean sRGB luma of wall pixels): front 183.1 / back 173.2 / left 177.3 /
 * right 187.4 -> 7.6% spread (classic: 151.5 on all four).
 */

/** A lab hex taken as raw linear RGB (what three r134 did with `new Color(hex)`). */
export const linearColor = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

export const ENHANCED_LOOK = {
  /**
   * ACES filmic exposure (R3F's default tone mapping; classic runs at 1).
   * 1.3 lands painted walls near their swatch brightness (Light Stone ~177-187
   * luma vs swatch 186) without clipping Bright White / Galvalume roofs
   * (~216 / ~189) and keeps Charcoal (~87-93) and Burgundy (~25-28) readable.
   */
  exposure: 1.3,
  /** Vertical FOV (deg) — straight architectural lines. Classic keeps the Canvas' 38. */
  fovDeg: 30,
  /** Minimum camera far plane while enhanced (the ground reaches to the fog). */
  cameraFar: 1200,

  /** Clean light blue-gray page background; the fog fades the ground into it. */
  background: '#e9eef2',
  fog: { near: 480, far: 1150 },
  /** Unlit light gray-green ground (renders exactly this color). */
  ground: '#d9dcd6',
  groundRadius: 2500,

  /** Strong, even sky/ground base: azimuth-independent, so every wall reads bright. */
  hemi: { sky: 0xdfe9f4, ground: 0x9c9d95, intensity: 1.1 },
  /** ONE gentle key (lab sun direction), no shadows. */
  key: { color: 0xfff1dc, intensity: 1.3, position: [34, 50, -26] as [number, number, number] },
  /** Gentle opposite fill: a soft highlight for the rib normal maps, never a second sun. */
  fill: { color: 0xdfe8f2, intensity: 0.5, position: [-36, 22, 24] as [number, number, number] },

  /**
   * PMREM sky-dome environment (lab buildEnvironment, WITHOUT its sun disc so
   * it is azimuth-symmetric and can't shade one wall differently from another).
   * r169 applies scene.environmentIntensity to every standard material that
   * has no envMap of its own, so this stays low: a subtle sheen on trim and
   * Galvalume, a touch of sky fill elsewhere.
   */
  env: { zenith: 0x7fa9dc, horizon: 0xe6ecf2, nadir: 0xa3a59d, intensity: 0.25 },

  /** 4" slab, light concrete, 2 ft past the footprint (incl. lean-tos). Top at y = 0. */
  slab: { thickness: 0.33, margin: 2, color: '#d2d2cc', roughness: 0.92, tileFt: 6 },

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

/**
 * Direct (key + fill) irradiance on a vertical wall with outward normal `n`,
 * in the same units as the hemisphere term. Pure: used by the wall-balance
 * guard test to keep the key/fill gentle relative to the even base.
 */
export function wallDirectIrradiance(n: [number, number, number]): number {
  const dirTerm = (pos: readonly number[], intensity: number) => {
    const len = Math.hypot(pos[0], pos[1], pos[2]);
    const ndl = (n[0] * pos[0] + n[1] * pos[1] + n[2] * pos[2]) / len;
    return intensity * Math.max(0, ndl);
  };
  return dirTerm(ENHANCED_LOOK.key.position, ENHANCED_LOOK.key.intensity) + dirTerm(ENHANCED_LOOK.fill.position, ENHANCED_LOOK.fill.intensity);
}

/** Hemisphere irradiance on a vertical wall (dotNL = 0 -> 50/50 sky/ground mix), luminance-weighted. */
export function wallHemiIrradiance(): number {
  const { sky, ground, intensity } = ENHANCED_LOOK.hemi;
  const lum = (hex: number) => {
    const c = linearColor(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  return intensity * 0.5 * (lum(sky) + lum(ground));
}
