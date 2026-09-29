import * as THREE from 'three';
import { isMetallic, swatchHex } from '@/config/colors';
import type { PanelOrientation } from '@/types/building';
import { ENHANCED_LOOK } from './look';
import {
  lapShadeTexture,
  normalMapTexture,
  releaseTextureClone,
  slatColorTexture,
  textureClone,
  type NormalMapKind,
} from './normalMaps';

/**
 * ENHANCED look — MATERIAL LIBRARY (render-upgrade Phase 4, HANDOFF Step 3).
 * Not used by the classic look, and not yet mounted by any component.
 *
 * Every material is an imperative THREE.MeshStandardMaterial, cached by key
 * (surface, color, galvalume, orientation, flipX, ...). Never hand these
 * textures to a JSX material prop: R3F 8 re-tags any RGBA8 texture passed as
 * a JSX prop as sRGB, which corrupts a normal map. Attach the material object
 * itself: <mesh material={mat}>.
 *
 * Parameters come from the lab CODE (render-lab-v20.html panelMat / roofMat /
 * flatMat / build() M L443-469, L850, L877-885, L1053-1067), which differs from
 * the HANDOFF table in a few places (Galvalume roughness per part, lap
 * normalScale 0.7). They are all in ENHANCED_MATERIAL_PARAMS.
 *
 * COLOR: a palette code ('WXA0090L', 'GALVALUME', 'PRINT-...') or a raw hex
 * ('#6B6360'); both resolve through config/colors.ts (unchanged). Galvalume is
 * recognized from its code AND from its palette hex (#B8BDC2), because
 * BuildingModel hands the trim over as a hex only; `galvalume` in a spec
 * forces it either way. Paint hexes are sRGB and are decoded to linear like
 * every other color in the builder (ColorManagement on) — the Phase-3
 * exposure was calibrated on exactly that.
 *
 * ENVIRONMENT: in three r169 a MeshStandardMaterial WITHOUT its own envMap
 * takes scene.environmentIntensity (0.25 in the enhanced rig) and IGNORES its
 * envMapIntensity. The per-surface values below (roof 0.08, Galvalume 0.9,
 * glass 1.25, ...) only apply once setEnhancedMaterialEnvironment(tex) binds
 * the rig's PMREM texture to them. Bind it where the rig creates the
 * environment, and bind null before that texture is disposed.
 *
 * LIFETIME: getEnhancedMaterial(spec) returns the cached material (building it
 * on first use). A component that shows a material retains it
 * (retainEnhancedMaterial) and releases it when its key changes or it
 * unmounts (releaseEnhancedMaterial); the last release disposes the material
 * and any texture clone it owns. The shared normal / color maps are never
 * disposed by a material (normalMaps.ts owns them).
 *
 * SHARING: cached materials are shared by every mesh with the same key.
 * ShellGroup (BuildingModel) sets opacity / transparent / depthWrite on shell
 * materials, so a key must only be used by shell meshes or only by
 * non-shell meshes: 'frame' is the one surface meant for outside the shell.
 * Anything a single mesh needs to change (e.g. roll-up clipping planes) goes
 * on a material.clone() owned by that mesh: the clone shares the textures,
 * the owner disposes it, and it is NOT in the cache (releasing it is a no-op
 * and setEnhancedMaterialEnvironment does not reach it).
 */

// ── Parameters (lab code) ──────────────────────────────────────────────────

interface MetalParams {
  metalness: number;
  roughness: number;
  envMapIntensity: number;
}

export const ENHANCED_MATERIAL_PARAMS = {
  /** Wall / wainscot sheet (lab panelMat). DoubleSide like the classic panels. */
  wall: {
    painted: { metalness: 0.22, roughness: 0.55, envMapIntensity: 0.35 },
    galvalume: { metalness: 0.8, roughness: 0.32, envMapIntensity: 0.9 },
    normalScale: 0.9,
    lapNormalScale: 0.7,
  },
  /**
   * Roof top skin (lab roofMat): satin, almost no sky mirror (HANDOFF pitfall
   * 5). Painted base color x 0.8 because a roof faces the whole sky. FrontSide:
   * the Galvalume underside skin is what shows from below.
   */
  roof: {
    painted: { metalness: 0.04, roughness: 0.82, envMapIntensity: 0.08 },
    galvalume: { metalness: 0.85, roughness: 0.3, envMapIntensity: 0.9 },
    normalScale: 0.8,
    paintedColorScale: 0.8,
  },
  /** Bare Galvalume roof underside, seen under the overhang (lab M.roofUnder). */
  roofUnder: { metalness: 0.85, roughness: 0.55, envMapIntensity: 0.4 },
  /** Trim, ridge cap, corner / base / Z trim, opening trim (lab flatMat). */
  trim: {
    painted: { metalness: 0.35, roughness: 0.42, envMapIntensity: 0.5 },
    galvalume: { metalness: 0.85, roughness: 0.32, envMapIntensity: 0.9 },
  },
  /** Opening reveal, in the WALL color (lab M.reveal = flatMat(wall, {roughness 0.7, env 0.2})). */
  reveal: {
    painted: { metalness: 0.35, roughness: 0.7, envMapIntensity: 0.2 },
    galvalume: { metalness: 0.85, roughness: 0.7, envMapIntensity: 0.2 },
  },
  /** Door leaf / roll-up bottom rail + drum, in the opening color (lab L850; same for Galvalume). */
  opening: {
    painted: { metalness: 0.18, roughness: 0.55, envMapIntensity: 0.35 },
    galvalume: { metalness: 0.18, roughness: 0.55, envMapIntensity: 0.35 },
  },
  /** Roll-up curtain (lab slatMat): slat color map + slat normal map, 1 tile = 1 ft of door height. */
  slat: {
    painted: { metalness: 0.12, roughness: 0.5, envMapIntensity: 0.4 },
    galvalume: { metalness: 0.8, roughness: 0.5, envMapIntensity: 0.4 },
    normalScale: 0.35,
  },
  /** Window glass (lab M.glass; same values as the builder's classic glass). */
  glass: { color: '#aab4ba', metalness: 0.35, roughness: 0.08, envMapIntensity: 1.25, opacity: 0.78 },
  /** Structural frame, bare Galvalume (HANDOFF Step 8; lab M.frame). */
  frame: { metalness: 0.85, roughness: 0.45, envMapIntensity: 0.6 },
  /**
   * Door hardware (lab L877-885 + the roll-up lift handle). The lab left these
   * at envMapIntensity 1 (its applyMode gave every material the env map).
   */
  hardware: {
    knobRose: { color: '#6b7077', metalness: 0.85, roughness: 0.28, envMapIntensity: 1 },
    knob: { color: '#8b9097', metalness: 0.9, roughness: 0.22, envMapIntensity: 1 },
    hinge: { color: '#9aa0a7', metalness: 0.7, roughness: 0.4, envMapIntensity: 1 },
    /** flatMat('Light Gray', {metalness 0.6, roughness 0.4}) — painted trim env. */
    handle: { color: 'WXA0095L', metalness: 0.6, roughness: 0.4, envMapIntensity: 0.5 },
  },
} as const;

// ── Specs + keys ───────────────────────────────────────────────────────────

/** Rib direction of a sheet: 'vertical' = ribs run up the wall / ridge -> eave on a roof. */
export type SheetOrientation = 'vertical' | 'horizontal';
/** Wall sheeting adds lap siding (a separate profile, not the sheet run sideways). */
export type WallOrientation = SheetOrientation | 'lap';
export type HardwarePart = keyof typeof ENHANCED_MATERIAL_PARAMS.hardware;

/** The builder's 'Vertical' | 'Horizontal' (types/building.ts) -> a sheet orientation. */
export const sheetOrientation = (o: PanelOrientation): SheetOrientation => (o === 'Horizontal' ? 'horizontal' : 'vertical');

interface Paintable {
  /** Palette code or '#hex'. */
  color: string;
  /** Force Galvalume (metal) on / off; default = recognized from the color. */
  galvalume?: boolean;
}

export type EnhancedMaterialSpec =
  | (Paintable & { surface: 'wall'; orientation: WallOrientation; flipX?: boolean })
  | (Paintable & { surface: 'roof'; orientation: SheetOrientation; flipX?: boolean })
  | { surface: 'roofUnder' }
  | (Paintable & { surface: 'trim' | 'reveal' | 'opening' })
  | (Paintable & { surface: 'slat'; heightFt: number })
  | { surface: 'glass' }
  | { surface: 'frame'; color?: string }
  | { surface: 'hardware'; part: HardwarePart };

const GALVALUME_CODE = 'GALVALUME';

/** '#abc' / '#aabbcc' / '#aabbccdd' (alpha dropped) -> 'aabbcc'; null when not a hex. */
function normHex(s: string): string | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(s.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).replace(/(.)/g, '$1$1');
  else if (h.length === 6 || h.length === 8) h = h.slice(0, 6);
  else return null;
  return h;
}

const GALVALUME_HEX = normHex(swatchHex(GALVALUME_CODE))!;

/**
 * Resolve a palette code or hex to the paint to render: its sRGB hex
 * ('rrggbb') and whether it is Galvalume. Unknown codes fall back the same way
 * classic does (swatchHex -> Charcoal).
 */
export function resolvePaint(color: string, galvalume?: boolean): { hex: string; galvalume: boolean } {
  const hex = normHex(swatchHex(color)) ?? normHex(swatchHex('')) ?? '6b6360';
  const galv = galvalume ?? (isMetallic(color) || hex === GALVALUME_HEX);
  return { hex, galvalume: galv };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The cache key of a spec. Specs that render identically share a key (e.g. 'GALVALUME' and '#B8BDC2'). */
export function materialKey(spec: EnhancedMaterialSpec): string {
  switch (spec.surface) {
    case 'wall':
    case 'roof': {
      const p = resolvePaint(spec.color, spec.galvalume);
      return `${spec.surface}|${p.hex}|${p.galvalume ? 'galv' : 'paint'}|${spec.orientation}|${spec.flipX ? 'flipX' : 'std'}`;
    }
    case 'trim':
    case 'reveal':
    case 'opening': {
      const p = resolvePaint(spec.color, spec.galvalume);
      return `${spec.surface}|${p.hex}|${p.galvalume ? 'galv' : 'paint'}`;
    }
    case 'slat': {
      const p = resolvePaint(spec.color, spec.galvalume);
      return `slat|${p.hex}|${p.galvalume ? 'galv' : 'paint'}|h${r3(slatHeight(spec.heightFt))}`;
    }
    case 'frame':
      return `frame|${resolvePaint(spec.color ?? GALVALUME_CODE).hex}`;
    case 'hardware':
      return `hardware|${spec.part}`;
    default:
      return spec.surface;
  }
}

/** Roll-up curtain height used for the slat repeat (guards 0 / NaN). */
const slatHeight = (h: number) => (Number.isFinite(h) && h > 0.25 ? h : 1);

// ── Factory ────────────────────────────────────────────────────────────────

/** sRGB hex -> THREE.Color in the working (linear) color space. */
const paintColor = (hex: string) => new THREE.Color('#' + hex);

let environment: THREE.Texture | null = null;

interface Entry {
  material: THREE.MeshStandardMaterial;
  /** Textures this material owns (per-material repeat clones) — disposed with it. */
  owned: THREE.Texture[];
  refs: number;
}
const cache = new Map<string, Entry>();

function std(params: MetalParams & { color: THREE.Color; side?: THREE.Side }): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: params.color,
    metalness: params.metalness,
    roughness: params.roughness,
    envMapIntensity: params.envMapIntensity,
    side: params.side ?? THREE.FrontSide,
  });
}

function build(spec: EnhancedMaterialSpec): { material: THREE.MeshStandardMaterial; owned: THREE.Texture[] } {
  const P = ENHANCED_MATERIAL_PARAMS;
  const owned: THREE.Texture[] = [];
  let m: THREE.MeshStandardMaterial;
  switch (spec.surface) {
    case 'wall': {
      const p = resolvePaint(spec.color, spec.galvalume);
      const lap = spec.orientation === 'lap';
      m = std({ ...(p.galvalume ? P.wall.galvalume : P.wall.painted), color: paintColor(p.hex), side: THREE.DoubleSide });
      const kind: NormalMapKind = lap ? 'lap' : spec.orientation === 'horizontal' ? 'wall-horizontal' : 'wall-vertical';
      m.normalMap = normalMapTexture(kind);
      const ns = lap ? P.wall.lapNormalScale : P.wall.normalScale;
      m.normalScale.set(spec.flipX ? -ns : ns, ns);
      // Lap siding only: the under-board shadow band. Sheet panels carry NO color detail (HANDOFF pitfall 4).
      m.map = lap ? lapShadeTexture() : null;
      break;
    }
    case 'roof': {
      const p = resolvePaint(spec.color, spec.galvalume);
      const color = paintColor(p.hex);
      if (!p.galvalume) color.multiplyScalar(P.roof.paintedColorScale);
      m = std({ ...(p.galvalume ? P.roof.galvalume : P.roof.painted), color });
      m.normalMap = normalMapTexture(spec.orientation === 'horizontal' ? 'roof-horizontal' : 'roof-vertical');
      const ns = P.roof.normalScale;
      m.normalScale.set(spec.flipX ? -ns : ns, ns);
      break;
    }
    case 'roofUnder':
      m = std({ ...P.roofUnder, color: paintColor(GALVALUME_HEX) });
      break;
    case 'trim':
    case 'reveal':
    case 'opening': {
      const p = resolvePaint(spec.color, spec.galvalume);
      const t = P[spec.surface];
      m = std({ ...(p.galvalume ? t.galvalume : t.painted), color: paintColor(p.hex) });
      break;
    }
    case 'slat': {
      const p = resolvePaint(spec.color, spec.galvalume);
      m = std({ ...(p.galvalume ? P.slat.galvalume : P.slat.painted), color: paintColor(p.hex) });
      // The curtain face has 0..1 UVs, so repeat.y = door height gives 1 tile (4 slats) per foot.
      const h = slatHeight(spec.heightFt);
      const map = textureClone(slatColorTexture(), 1, h);
      const nm = textureClone(normalMapTexture('slat'), 1, h);
      owned.push(map, nm);
      m.map = map;
      m.normalMap = nm;
      m.normalScale.set(P.slat.normalScale, P.slat.normalScale);
      break;
    }
    case 'glass': {
      const g = P.glass;
      m = std({ ...g, color: new THREE.Color(g.color) });
      m.transparent = true;
      m.opacity = g.opacity;
      // ShellGroup must never force glass opaque.
      m.userData.keepTransparent = true;
      break;
    }
    case 'frame':
      m = std({ ...P.frame, color: paintColor(resolvePaint(spec.color ?? GALVALUME_CODE).hex) });
      break;
    case 'hardware': {
      const h = P.hardware[spec.part];
      m = std({ ...h, color: paintColor(resolvePaint(h.color).hex) });
      break;
    }
  }
  m.envMap = environment;
  return { material: m, owned };
}

/** The cached material for `spec` (built on first use). Does not change its reference count. */
export function getEnhancedMaterial(spec: EnhancedMaterialSpec): THREE.MeshStandardMaterial {
  const key = materialKey(spec);
  let e = cache.get(key);
  if (!e) {
    const { material, owned } = build(spec);
    material.name = 'enhanced:' + key;
    material.userData.enhancedKey = key;
    e = { material, owned, refs: 0 };
    cache.set(key, e);
  }
  return e.material;
}

/** getEnhancedMaterial + one reference (pair every retain with a release). */
export function retainEnhancedMaterial(spec: EnhancedMaterialSpec): THREE.MeshStandardMaterial {
  const m = getEnhancedMaterial(spec);
  cache.get(materialKey(spec))!.refs++;
  return m;
}

function evict(key: string, e: Entry) {
  cache.delete(key);
  e.material.dispose();
  for (const t of e.owned) releaseTextureClone(t);
}

/**
 * Drop one reference (by spec, key or the material itself). The last release
 * evicts the key and disposes the material and its owned texture clones.
 */
export function releaseEnhancedMaterial(ref: EnhancedMaterialSpec | string | THREE.Material): void {
  const byMaterial = ref instanceof THREE.Material;
  const key = typeof ref === 'string' ? ref : byMaterial ? (ref.userData.enhancedKey as string | undefined) : materialKey(ref);
  if (!key) return;
  const e = cache.get(key);
  // material.clone() copies userData (incl. the key): a caller-owned clone never releases the cached original.
  if (!e || (byMaterial && e.material !== ref)) return;
  e.refs--;
  if (e.refs <= 0) evict(key, e);
}

/** Dispose cached materials nobody retains (e.g. built by a render that never committed). */
export function pruneEnhancedMaterials(): void {
  for (const [key, e] of [...cache]) if (e.refs <= 0) evict(key, e);
}

/** Dispose EVERY cached material (the enhanced look unmounting, tests, HMR). */
export function disposeEnhancedMaterials(): void {
  for (const [key, e] of [...cache]) evict(key, e);
}

/** Number of cached materials (diagnostics / tests). */
export const enhancedMaterialCount = () => cache.size;

/**
 * Bind the enhanced environment map (the rig's PMREM texture) to every cached
 * and future material so their own envMapIntensity applies (see header).
 * Pass null before that texture is disposed.
 */
export function setEnhancedMaterialEnvironment(tex: THREE.Texture | null): void {
  if (environment === tex) return;
  environment = tex;
  for (const e of cache.values()) {
    e.material.envMap = tex;
    e.material.needsUpdate = true;
  }
}

// ── Per-wall rib flip (HANDOFF Step 3; lab litFromRight / wallMats L613-635) ──

export type V3 = readonly [number, number, number];

/** A directional light as the rib flip sees it: position (target at the origin) + intensity. */
export interface RibLight {
  position: V3;
  intensity: number;
}

/** The enhanced rig's direct lights (key + fill, look.ts). */
export const ENHANCED_RIB_LIGHTS: readonly RibLight[] = [ENHANCED_LOOK.key, ENHANCED_LOOK.fill];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Should this wall use the flipX material (normalScale.x negated)?
 *
 * One light hits the two walls at a corner from opposite sides, and ribs lit
 * from the viewer's right read as grooves. For the wall's strongest direct
 * light (weight = intensity * max(0, L.n)), if that light points along the
 * wall's +u direction, the rib x-shading is negated so every wall shows its
 * ribs lit from the viewer's left. Shadows are unaffected.
 *
 * - outwardNormal: the wall's OUTWARD normal (world).
 * - uDir: the world direction in which the wall's texture u INCREASES — take
 *   it from the actual mesh, not from assumptions (the lab's u always ran
 *   left -> right seen from outside; builder panels may run the other way,
 *   which correctly inverts the answer).
 * - The panel must be seen from its FRONT face from outside. A back face (an
 *   inward-facing DoubleSide panel) inverts the whole relief; build outward
 *   faces instead.
 *
 * Only u-varying maps (vertical ribs) change; horizontal / lap maps have no x
 * relief. With the enhanced key (front-right) and fill (back-left) both eave
 * walls flip and neither gable does, as in the lab.
 */
export function litFromRight(outwardNormal: V3, uDir: V3, lights: readonly RibLight[] = ENHANCED_RIB_LIGHTS): boolean {
  const n = unit(outwardNormal);
  let best: V3 | null = null;
  let bestW = -1;
  for (const l of lights) {
    const L = unit(l.position);
    const w = l.intensity * Math.max(0, dot(L, n));
    if (w > bestW) {
      bestW = w;
      best = L;
    }
  }
  return best !== null && dot(best, uDir) > 0;
}
