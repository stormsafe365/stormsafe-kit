import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHT_CAPTURE_BG, applyCaptureTheme } from '../captureTheme';

/**
 * White quote style (owner 10/12/26 — "need to print the quote but its
 * background is too dark & taking up too much ink"): the quote's 3D pictures
 * are re-captured on a light background. __ssCapture3D({ theme: 'light' })
 * recolours the scene background and hides the dark ground scenery tagged
 * userData.lightCaptureHide for the pictures only; everything is put back.
 * A plain __ssCapture3D() (Dark quote, contract, approval sheet) changes nothing.
 */
const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

function scene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#08121d');
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  grid.userData = { lightCaptureHide: true };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 8));
  ground.userData = { lightCaptureHide: true };
  const site = new THREE.Group();
  site.userData = { captureIgnore: true };
  site.add(ground);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const hiddenTagged = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  hiddenTagged.userData = { lightCaptureHide: true };
  hiddenTagged.visible = false;
  s.add(grid, site, wall, hiddenTagged);
  return { s, grid, ground, wall, hiddenTagged };
}

describe('applyCaptureTheme', () => {
  it('Dark (no theme / "dark") changes nothing', () => {
    for (const t of [undefined, 'dark' as const]) {
      const { s, grid, ground, wall } = scene();
      const bg = s.background as THREE.Color;
      const restore = applyCaptureTheme(s, t);
      expect(s.background).toBe(bg);
      expect(bg.getHexString()).toBe('08121d');
      expect([grid.visible, ground.visible, wall.visible]).toEqual([true, true, true]);
      restore();
      expect(bg.getHexString()).toBe('08121d');
    }
  });

  it('light: light background, dark ground scenery hidden, the building untouched — then all put back', () => {
    const { s, grid, ground, wall, hiddenTagged } = scene();
    const bg = s.background as THREE.Color;
    const restore = applyCaptureTheme(s, 'light');
    // the SAME Color object R3F attached, recoloured in place
    expect(s.background).toBe(bg);
    expect('#' + bg.getHexString()).toBe(LIGHT_CAPTURE_BG);
    expect(grid.visible).toBe(false);
    expect(ground.visible).toBe(false);
    expect(wall.visible).toBe(true);
    restore();
    expect(bg.getHexString()).toBe('08121d');
    expect([grid.visible, ground.visible, wall.visible]).toEqual([true, true, true]);
    expect(hiddenTagged.visible).toBe(false); // was hidden before: stays hidden
  });

  it('light with no background Color: sets one, then restores the original', () => {
    const { s } = scene();
    s.background = null;
    const restore = applyCaptureTheme(s, 'light');
    expect((s.background as unknown as THREE.Color).isColor).toBe(true);
    expect('#' + (s.background as unknown as THREE.Color).getHexString()).toBe(LIGHT_CAPTURE_BG);
    restore();
    expect(s.background).toBeNull();
  });

  it("the light background is the program's White image-box colour (no seam around the pictures)", () => {
    const prog = src('../../../public/quote-builder.html');
    expect(prog).toContain(`'#08121d':'${LIGHT_CAPTURE_BG}'`);
    // LIGHT_CAPTURE_BG is lighter than #e5e7eb (the White pages' darkest allowed fill)
    const c = new THREE.Color(LIGHT_CAPTURE_BG);
    expect(c.r + c.g + c.b).toBeGreaterThan(new THREE.Color('#e5e7eb').r * 3);
  });
});

describe('wiring', () => {
  const capture = src('../CaptureHook.tsx');
  it('__ssCapture3D(opts) passes the theme through and restores it with everything else', () => {
    expect(capture).toMatch(/w\.__ssCapture3D = async \(opts\?: CaptureOptions\) =>/);
    expect(capture).toMatch(/return await captureViews\(opts\?\.theme\);/);
    expect(capture).toMatch(/const restoreTheme = applyCaptureTheme\(scene, theme\);\s*\n\s*try \{/);
    expect(capture).toMatch(/\} finally \{[\s\S]*?restoreTheme\(\);[\s\S]*?gl\.render\(scene, camera\); \/\/ repaint the live view/);
  });
  it('the classic grid and the enhanced ground disc are the tagged scenery', () => {
    expect(src('../../components/Viewport.tsx')).toMatch(/<Grid[\s\S]*?userData=\{\{ lightCaptureHide: true \}\}[\s\S]*?\/>/);
    expect(src('../enhanced/EnhancedSite.tsx')).toMatch(/material=\{statics\.groundMat\}[\s\S]*?userData=\{\{ lightCaptureHide: true \}\}/);
  });
});
