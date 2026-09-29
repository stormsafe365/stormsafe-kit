import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { swatchHex } from '@/config/colors';
import {
  ENHANCED_MATERIAL_PARAMS as P,
  disposeEnhancedMaterials,
  enhancedMaterialCount,
  getEnhancedMaterial,
  litFromRight,
  materialKey,
  pruneEnhancedMaterials,
  releaseEnhancedMaterial,
  resolvePaint,
  retainEnhancedMaterial,
  setEnhancedMaterialEnvironment,
  sheetOrientation,
  type V3,
} from '../enhanced/materials';
import { disposeEnhancedTextures, lapShadeTexture, normalMapTexture, slatColorTexture } from '../enhanced/normalMaps';
import { installFakeCanvas } from './fakeCanvas';

// Render-upgrade Phase 4: the enhanced material library (HANDOFF Step 3,
// params from the lab code). Not mounted by any component yet.

beforeAll(() => {
  installFakeCanvas();
});
afterAll(() => {
  disposeEnhancedMaterials();
  disposeEnhancedTextures();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  setEnhancedMaterialEnvironment(null);
  disposeEnhancedMaterials();
});

const wall = (color: string, flipX = false, orientation: 'vertical' | 'horizontal' | 'lap' = 'vertical') =>
  ({ surface: 'wall', color, orientation, flipX }) as const;

describe('material cache', () => {
  it('returns the SAME material for the same key', () => {
    const a = getEnhancedMaterial(wall('WXA0090L'));
    expect(getEnhancedMaterial(wall('WXA0090L'))).toBe(a);
    // a code and its own hex are the same paint
    expect(getEnhancedMaterial(wall(swatchHex('WXA0090L')))).toBe(a);
    expect(enhancedMaterialCount()).toBe(1);
  });

  it('a DIFFERENT material for a different flip, with normalScale.x negated', () => {
    const std = getEnhancedMaterial(wall('WXA0090L'));
    const flip = getEnhancedMaterial(wall('WXA0090L', true));
    expect(flip).not.toBe(std);
    expect(std.normalScale.x).toBeCloseTo(0.9, 12);
    expect(flip.normalScale.x).toBeCloseTo(-0.9, 12);
    expect(flip.normalScale.y).toBeCloseTo(0.9, 12);
    // same shared normal map (no per-material texture copies)
    expect(flip.normalMap).toBe(std.normalMap);
  });

  it('different color / orientation / surface -> different materials', () => {
    const keys = new Set([
      materialKey(wall('WXA0090L')),
      materialKey(wall('WXR0077L')),
      materialKey(wall('WXA0090L', false, 'horizontal')),
      materialKey(wall('WXA0090L', false, 'lap')),
      materialKey({ surface: 'roof', color: 'WXA0090L', orientation: 'vertical' }),
      materialKey({ surface: 'trim', color: 'WXA0090L' }),
    ]);
    expect(keys.size).toBe(6);
  });

  it('retain / release: disposed and evicted on the LAST release only', () => {
    const spec = wall('WXR0077L');
    const m = retainEnhancedMaterial(spec);
    retainEnhancedMaterial(spec);
    const disposed = vi.fn();
    m.addEventListener('dispose', disposed);
    releaseEnhancedMaterial(spec);
    expect(disposed).not.toHaveBeenCalled();
    expect(getEnhancedMaterial(spec)).toBe(m);
    releaseEnhancedMaterial(m); // by material works too
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(enhancedMaterialCount()).toBe(0);
    expect(getEnhancedMaterial(spec)).not.toBe(m); // rebuilt on next use
  });

  it('releasing a caller-owned clone never releases the cached original', () => {
    const spec = wall('WXA0107L');
    const m = retainEnhancedMaterial(spec);
    const own = m.clone(); // e.g. a roll-up with its own clipping planes
    expect(own.userData.enhancedKey).toBe(m.userData.enhancedKey); // clone() copies userData
    releaseEnhancedMaterial(own);
    expect(enhancedMaterialCount()).toBe(1);
    expect(getEnhancedMaterial(spec)).toBe(m);
    releaseEnhancedMaterial(m);
    expect(enhancedMaterialCount()).toBe(0);
    own.dispose();
  });

  it('prune drops only unretained materials; the shared maps survive material disposal', () => {
    const kept = retainEnhancedMaterial(wall('WXA0090L'));
    getEnhancedMaterial(wall('WXA0107L'));
    const nm = normalMapTexture('wall-vertical');
    const nmDisposed = vi.fn();
    nm.addEventListener('dispose', nmDisposed);
    pruneEnhancedMaterials();
    expect(enhancedMaterialCount()).toBe(1);
    expect(getEnhancedMaterial(wall('WXA0090L'))).toBe(kept);
    disposeEnhancedMaterials();
    expect(enhancedMaterialCount()).toBe(0);
    expect(nmDisposed).not.toHaveBeenCalled();
    nm.removeEventListener('dispose', nmDisposed);
  });
});

describe('imperative materials (never JSX texture props)', () => {
  it('normal maps stay NoColorSpace; lap gets the sRGB shade map, sheets get no color map', () => {
    const v = getEnhancedMaterial(wall('WXA0090L'));
    expect(v).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(v.normalMap).toBe(normalMapTexture('wall-vertical'));
    expect(v.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(v.map).toBeNull();
    expect(getEnhancedMaterial(wall('WXA0090L', false, 'horizontal')).normalMap).toBe(normalMapTexture('wall-horizontal'));
    const lap = getEnhancedMaterial(wall('WXA0090L', false, 'lap'));
    expect(lap.normalMap).toBe(normalMapTexture('lap'));
    expect(lap.normalScale.x).toBeCloseTo(0.7, 12);
    expect(lap.map).toBe(lapShadeTexture());
    expect(lap.map!.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('painted wall / roof / trim use the lab values; the roof is 0.8x the paint', () => {
    const w = getEnhancedMaterial(wall('WXR0077L'));
    expect([w.metalness, w.roughness, w.envMapIntensity]).toEqual([0.22, 0.55, 0.35]);
    expect(w.side).toBe(THREE.DoubleSide);
    const r = getEnhancedMaterial({ surface: 'roof', color: 'WXR0077L', orientation: 'vertical' });
    expect([r.metalness, r.roughness, r.envMapIntensity]).toEqual([0.04, 0.82, 0.08]);
    expect(r.normalScale.x).toBeCloseTo(0.8, 12);
    expect(r.normalMap).toBe(normalMapTexture('roof-vertical'));
    expect(r.color.r).toBeCloseTo(w.color.r * 0.8, 9);
    expect(r.color.g).toBeCloseTo(w.color.g * 0.8, 9);
    const t = getEnhancedMaterial({ surface: 'trim', color: 'WXR0077L' });
    expect([t.metalness, t.roughness, t.envMapIntensity]).toEqual([0.35, 0.42, 0.5]);
    const rh = getEnhancedMaterial({ surface: 'roof', color: 'WXR0077L', orientation: sheetOrientation('Horizontal') });
    expect(rh.normalMap).toBe(normalMapTexture('roof-horizontal'));
  });

  it('paint hexes are sRGB (decoded like the rest of the builder)', () => {
    const w = getEnhancedMaterial(wall('WXD0038L'));
    expect(w.color.getHexString()).toBe(swatchHex('WXD0038L').slice(1).toLowerCase());
  });
});

describe('Galvalume (code OR hex)', () => {
  it('is recognized from its palette code and from its hex (BuildingModel passes trim as a hex)', () => {
    expect(resolvePaint('GALVALUME').galvalume).toBe(true);
    expect(resolvePaint(swatchHex('GALVALUME')).galvalume).toBe(true);
    expect(resolvePaint(swatchHex('GALVALUME').toLowerCase()).galvalume).toBe(true);
    expect(resolvePaint('WXA0095L').galvalume).toBe(false);
    expect(resolvePaint('#9EA5A8').galvalume).toBe(false);
    expect(resolvePaint('WXA0095L', true).galvalume).toBe(true); // forced
    const byCode = getEnhancedMaterial({ surface: 'trim', color: 'GALVALUME' });
    const byHex = getEnhancedMaterial({ surface: 'trim', color: swatchHex('GALVALUME') });
    expect(byHex).toBe(byCode);
    expect([byCode.metalness, byCode.roughness, byCode.envMapIntensity]).toEqual([0.85, 0.32, 0.9]);
  });

  it('Galvalume panels are true metal; a Galvalume roof is NOT darkened', () => {
    const w = getEnhancedMaterial(wall('GALVALUME'));
    expect([w.metalness, w.roughness, w.envMapIntensity]).toEqual([0.8, 0.32, 0.9]);
    const r = getEnhancedMaterial({ surface: 'roof', color: 'GALVALUME', orientation: 'vertical' });
    expect([r.metalness, r.roughness, r.envMapIntensity]).toEqual([0.85, 0.3, 0.9]);
    expect(r.color.getHexString()).toBe(swatchHex('GALVALUME').slice(1).toLowerCase());
    const u = getEnhancedMaterial({ surface: 'roofUnder' });
    expect([u.metalness, u.roughness, u.envMapIntensity]).toEqual([0.85, 0.55, 0.4]);
    const f = getEnhancedMaterial({ surface: 'frame' });
    expect([f.metalness, f.roughness, f.envMapIntensity]).toEqual([0.85, 0.45, 0.6]);
  });
});

describe('glass, slats, environment', () => {
  it('glass: #aab4ba, 0.35 / 0.08 / 1.25, opacity 0.78, keepTransparent (ShellGroup)', () => {
    const g = getEnhancedMaterial({ surface: 'glass' });
    expect(g.color.getHexString()).toBe('aab4ba');
    expect([g.metalness, g.roughness, g.envMapIntensity]).toEqual([0.35, 0.08, 1.25]);
    expect(g.transparent).toBe(true);
    expect(g.opacity).toBeCloseTo(0.78, 12);
    expect(g.userData.keepTransparent).toBe(true);
  });

  it('roll-up slats: own clones with repeat.y = door height (1 tile = 1 ft); disposed with the material', () => {
    const spec = { surface: 'slat', color: '#F2F1EA', heightFt: 10 } as const;
    const m = retainEnhancedMaterial(spec);
    expect(m.map!.repeat.y).toBe(10);
    expect(m.normalMap!.repeat.y).toBe(10);
    expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(m.map).not.toBe(slatColorTexture());
    expect(m.map!.source).toBe(slatColorTexture().source); // one GPU upload
    expect(m.normalScale.x).toBeCloseTo(P.slat.normalScale, 12);
    expect(getEnhancedMaterial({ ...spec, heightFt: 8 })).not.toBe(m);
    const cloneDisposed = vi.fn();
    const baseDisposed = vi.fn();
    m.map!.addEventListener('dispose', cloneDisposed);
    slatColorTexture().addEventListener('dispose', baseDisposed);
    releaseEnhancedMaterial(spec);
    expect(cloneDisposed).toHaveBeenCalledTimes(1);
    expect(baseDisposed).not.toHaveBeenCalled();
  });

  it('the environment binds to cached and future materials (so their own envMapIntensity applies)', () => {
    const a = getEnhancedMaterial(wall('WXA0090L'));
    expect(a.envMap).toBeNull();
    const env = new THREE.Texture();
    setEnhancedMaterialEnvironment(env);
    expect(a.envMap).toBe(env);
    expect(getEnhancedMaterial({ surface: 'glass' }).envMap).toBe(env);
    setEnhancedMaterialEnvironment(null);
    expect(a.envMap).toBeNull();
  });
});

describe('per-wall rib flip (lab litFromRight)', () => {
  // The lab's wall frames: outward normal n, u runs left -> right seen from outside = [n.z, 0, -n.x].
  const walls: Record<string, V3> = { front: [0, 0, -1], back: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] };
  const uOf = (n: V3): V3 => [n[2], 0, -n[0]];

  it('enhanced key/fill: both eave walls flip, neither gable does', () => {
    const flips = Object.fromEntries(Object.entries(walls).map(([k, n]) => [k, litFromRight(n, uOf(n))]));
    expect(flips).toEqual({ front: false, back: false, left: true, right: true });
  });

  it("the lab's own sun/fill give the same answer", () => {
    const lab = [
      { position: [34, 50, -26] as V3, intensity: 0.66 },
      { position: [-36, 22, 24] as V3, intensity: 0.3 },
    ];
    const flips = Object.fromEntries(Object.entries(walls).map(([k, n]) => [k, litFromRight(n, uOf(n), lab)]));
    expect(flips).toEqual({ front: false, back: false, left: true, right: true });
  });

  it('follows the mesh: a wall whose u runs the other way gets the opposite answer', () => {
    for (const n of Object.values(walls)) {
      const u = uOf(n);
      expect(litFromRight(n, [-u[0], -u[1], -u[2]])).toBe(!litFromRight(n, u));
    }
  });

  it('uses the STRONGEST light on the wall (a light behind the wall does not count)', () => {
    // Front wall seen from outside (from -Z looking +Z): the viewer's right is -X = +u.
    const n: V3 = [0, 0, -1];
    const u: V3 = [-1, 0, 0];
    const fromLeft = { position: [10, 10, -10] as V3, intensity: 1 };
    const behindRight = { position: [-30, 10, 30] as V3, intensity: 5 }; // strong, but behind the wall
    expect(litFromRight(n, u, [behindRight, fromLeft])).toBe(false);
    const fromRight = { position: [-10, 10, -10] as V3, intensity: 2 };
    expect(litFromRight(n, u, [fromLeft, fromRight])).toBe(true);
  });
});
