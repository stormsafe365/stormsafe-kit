import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '@/engine/ruleEngine';
import { deriveStructure } from '@/engine/geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import { ENHANCED_LOOK, siteFootprint, siteRects, wallDirectIrradiance, wallHemiIrradiance } from '../enhanced/look';

// Render-upgrade Phase 3: the ENHANCED scene rig + site. Owner override
// (2026-09-28): go easy on lighting & shadows — even, readable walls, no cast
// shadows, only a very soft ground contact shade.

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const build = (leanTos: unknown[]) =>
  deriveStructure(
    resolveBuilding({
      ...DEFAULT_CONFIG,
      buildingType: 'garage',
      width: 24,
      length: 30,
      legHeight: 10,
      openings: [],
      leanTos,
    } as never),
  );

const leanTo = (id: string, attachedSide: string, widthFt: number, lengthFt: number) => ({
  id,
  type: 'attached',
  attachedSide,
  widthFt,
  lengthFt,
  lowLegHeightFt: 7,
  roofPitch: '2:12',
  openings: [],
});

describe('enhanced site footprint (slab = footprint + 2 ft, incl. lean-tos)', () => {
  it('is the main building rectangle with no lean-tos', () => {
    expect(siteFootprint(build([]))).toEqual({ x0: -12, x1: 12, z0: -15, z1: 15 });
  });

  it("grows by an eave lean-to's width on its side", () => {
    // Program 'Left Eave' attaches to the 3D +X wall.
    const fp = siteFootprint(build([leanTo('a', 'Left Eave', 10, 30)]));
    expect(fp.x0).toBeCloseTo(-12);
    expect(fp.x1).toBeCloseTo(22);
    expect(fp.z0).toBeCloseTo(-15);
    expect(fp.z1).toBeCloseTo(15);
  });

  it('covers a wrap-around corner (eave + gable lean-tos)', () => {
    const s = build([leanTo('a', 'Left Eave', 10, 30), leanTo('b', 'Front Gable', 10, 24)]);
    expect(s.leanTos.length).toBe(2);
    const fp = siteFootprint(s);
    const gable = s.leanTos.find((l) => l.attachedSide === 'Front Gable')!;
    expect(fp.x1).toBeCloseTo(22);
    expect(fp.z0).toBeCloseTo(Math.min(gable.inner.z, gable.outer.z));
    expect(fp.z0).toBeLessThan(-15 - 9.9);
  });

  it('keeps one contact rectangle per lean-to (an L-shaped build shades no open notch)', () => {
    const s = build([leanTo('a', 'Left Eave', 10, 30), leanTo('b', 'Front Gable', 10, 24)]);
    const rects = siteRects(s);
    expect(rects.length).toBe(3);
    expect(rects[0]).toEqual({ x0: -12, x1: 12, z0: -15, z1: 15 });
    const eave = rects[1];
    expect(eave.x0).toBeCloseTo(12);
    expect(eave.x1).toBeCloseTo(22);
    // The front-left corner past both lean-tos (x > 12, z < -15) is in the
    // bounding slab but in no contact rectangle.
    const inAny = (x: number, z: number) => rects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
    expect(inAny(17, -20)).toBe(false);
    expect(inAny(0, -20)).toBe(true);
    expect(inAny(17, 0)).toBe(true);
  });

  it('ignores non-finite lean-to bounds (never a NaN slab)', () => {
    const fp = siteFootprint({
      width: 20,
      length: 20,
      leanTos: [{ attachedSide: 'Right Eave', inner: { x: NaN, z: 0 }, outer: { x: Infinity, z: 0 }, spanStart: -10, spanEnd: 10 } as never],
    });
    expect(fp).toEqual({ x0: -10, x1: 10, z0: -10, z1: 10 });
  });
});

describe('enhanced lighting stays gentle and even (owner override)', () => {
  const walls: Record<string, [number, number, number]> = {
    front: [0, 0, -1],
    back: [0, 0, 1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
  };

  it('every wall gets the same strong hemisphere base; key + fill never dominate it', () => {
    const base = wallHemiIrradiance();
    const direct = Object.values(walls).map((n) => wallDirectIrradiance(n));
    // Linear irradiance, environment excluded (it is azimuth-symmetric and only
    // narrows the spread). Measured rendered-luma spread at these values: 7.6%
    // (A_CA, Light Stone walls, PDF capture). A harsh sun would blow this.
    const lit = direct.map((d) => base + d);
    expect(Math.max(...lit) / Math.min(...lit)).toBeLessThan(1.45);
    expect(Math.max(...direct)).toBeLessThan(base);
  });

  it('the fill is weaker than the key, and both keep the lab directions', () => {
    expect(ENHANCED_LOOK.fill.intensity).toBeLessThan(ENHANCED_LOOK.key.intensity);
    expect(ENHANCED_LOOK.key.position).toEqual([34, 50, -26]);
    expect(ENHANCED_LOOK.fill.position).toEqual([-36, 22, 24]);
  });

  it('contact shading stays very soft (alpha <= 0.25)', () => {
    expect(ENHANCED_LOOK.contact.slab.alpha).toBeLessThanOrEqual(0.25);
    expect(ENHANCED_LOOK.contact.ground.alpha).toBeLessThanOrEqual(0.25);
  });
});

describe('enhanced rig wiring', () => {
  const rig = src('../enhanced/EnhancedSceneRig.tsx');
  const site = src('../enhanced/EnhancedSite.tsx');
  const viewport = src('../../components/Viewport.tsx');
  const model = src('../BuildingModel.tsx');

  it('no light or site mesh casts shadows', () => {
    expect(rig).not.toMatch(/castShadow/);
    expect(site).not.toMatch(/castShadow/);
  });

  it('restores every shared renderer / scene / camera setting it changes', () => {
    for (const k of ['toneMappingExposure', 'toneMapping', 'localClippingEnabled', 'camera.fov', 'camera.far', 'scene.environment', 'scene.environmentIntensity']) {
      expect(rig).toContain(`${k} = saved`);
    }
    expect(rig).toMatch(/env\.dispose\(\)/);
    expect(rig).toMatch(/updateProjectionMatrix\(\)/);
  });

  it('never sets the FOV through the Canvas camera prop', () => {
    expect(viewport).toMatch(/fov: 38/);
    expect(viewport).toMatch(/import \{ EnhancedSceneRig \}/);
    expect(viewport).not.toMatch(/const EnhancedSceneRig = ClassicSceneRig/);
  });

  it('the site is capture-ignored, mounted outside ShellGroup and only while enhanced', () => {
    expect(site).toMatch(/captureIgnore: true/);
    expect(site).toMatch(/keepTransparent = true/);
    expect(model).toMatch(/<\/ShellGroup>\s*\{\/\*[\s\S]*?\*\/\}\s*\{renderStyle === 'enhanced' && <EnhancedSite/);
  });
});
