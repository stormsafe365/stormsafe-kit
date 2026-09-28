import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '@/engine/ruleEngine';
import { deriveStructure } from '@/engine/geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import { ENHANCED_LOOK, siteFootprint, siteRects, wallDirectLuminance, wallHemiIrradiance } from '../enhanced/look';

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

  it('all four walls get the same key + fill light (dark paints included)', () => {
    // ACES' toe roughly doubles a lighting difference on dark paints (the lab
    // azimuths gave 1.46x linear -> 23.6% luma spread on Barn Red), so the
    // direct light must be BALANCED, not just gentle. Luminance-weighted by the
    // light colors; hemisphere + environment are azimuth-symmetric.
    const direct = Object.values(walls).map((n) => wallDirectLuminance(n));
    expect(Math.min(...direct)).toBeGreaterThan(0); // every wall gets some rib-highlight light
    expect(Math.max(...direct) / Math.min(...direct)).toBeLessThan(1.01);
    const base = wallHemiIrradiance();
    const lit = direct.map((d) => base + d);
    expect(Math.max(...lit) / Math.min(...lit)).toBeLessThan(1.005);
  });

  it('key + fill stay gentle next to the even hemisphere base', () => {
    const base = wallHemiIrradiance();
    for (const n of Object.values(walls)) expect(wallDirectLuminance(n)).toBeLessThan(base);
  });

  it('the fill is weaker than the key; both on the 45-degree diagonals at the lab elevations', () => {
    const { key, fill } = ENHANCED_LOOK;
    expect(fill.intensity).toBeLessThan(key.intensity);
    const elev = (p: readonly number[]) => (Math.atan2(p[1], Math.hypot(p[0], p[2])) * 180) / Math.PI;
    // key front-right (+X, -Z), fill back-left (-X, +Z), each exactly diagonal.
    expect(key.position[0]).toBeGreaterThan(0);
    expect(key.position[0]).toBe(-key.position[2]);
    expect(fill.position[0]).toBeLessThan(0);
    expect(fill.position[0]).toBe(-fill.position[2]);
    expect(Math.abs(elev(key.position) - elev([34, 50, -26]))).toBeLessThan(1); // lab sun ~49 deg
    expect(Math.abs(elev(fill.position) - elev([-36, 22, 24]))).toBeLessThan(1); // lab fill ~27 deg
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

  it("classic ContactShadows stays mounted across Look switches (drei never frees its render targets)", () => {
    // Hidden + paused while enhanced, never conditionally mounted.
    expect(viewport).toMatch(/<ContactShadows[\s\S]*?visible=\{active\}[\s\S]*?frames=\{active \? Infinity : 0\}/);
    expect(viewport).not.toMatch(/&&\s*\(?\s*<ContactShadows/);
    expect(viewport).toMatch(/<ClassicGround active=\{!enhanced\} \/>/);
  });

  it('a Look round trip restores the exact classic camera pose unless the camera moved', () => {
    const rig3 = src('../CameraRig.tsx');
    expect(rig3).toMatch(/camera\.position\.copy\(back\.pos\)/);
    expect(rig3).toMatch(/controls\.target\.copy\(back\.target\)/);
    // orbit/zoom start, a preset command and an instant view set all drop it
    expect((rig3.match(/lookReturn\.current = null/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('the site is capture-ignored, mounted outside ShellGroup and only while enhanced', () => {
    expect(site).toMatch(/captureIgnore: true/);
    expect(site).toMatch(/keepTransparent = true/);
    expect(model).toMatch(/<\/ShellGroup>\s*\{\/\*[\s\S]*?\*\/\}\s*\{renderStyle === 'enhanced' && <EnhancedSite/);
  });
});
