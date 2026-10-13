import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIGHT_CAPTURE_BG,
  LIGHT_CAPTURE_OUTLINE,
  LIGHT_CAPTURE_OUTLINE_PX,
  applyCaptureTheme,
  composeLightCapture,
  outlineOffsets,
  silhouetteMask,
} from '../captureTheme';

/**
 * White quote style (owner 10/12/26 — "need to print the quote but its
 * background is too dark & taking up too much ink"): the quote's 3D pictures
 * are re-captured on a light background. __ssCapture3D({ theme: 'light' })
 * renders each picture on a transparent background with the dark ground
 * scenery tagged userData.lightCaptureHide hidden, then lays it on the White
 * page's colour with a thin outline around the building's silhouette (a white
 * building was a faint ghost on the light background — 10/12 verification
 * W1). Everything is put back after each picture. A plain __ssCapture3D()
 * (Dark quote, contract, approval sheet) changes nothing.
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
const renderer = (alpha = 0) => {
  const r = { a: alpha, getClearAlpha: () => r.a, setClearAlpha: (v: number) => { r.a = v; } };
  return r;
};

describe('applyCaptureTheme', () => {
  it('Dark (no theme / "dark") changes nothing', () => {
    for (const t of [undefined, 'dark' as const]) {
      const { s, grid, ground, wall } = scene();
      const bg = s.background as THREE.Color;
      const gl = renderer(1);
      const restore = applyCaptureTheme(s, t, gl);
      expect(s.background).toBe(bg);
      expect(bg.getHexString()).toBe('08121d');
      expect(gl.a).toBe(1);
      expect([grid.visible, ground.visible, wall.visible]).toEqual([true, true, true]);
      restore();
      expect(bg.getHexString()).toBe('08121d');
    }
  });

  it('light: transparent background, dark ground scenery hidden, the building untouched — then all put back', () => {
    const { s, grid, ground, wall, hiddenTagged } = scene();
    const bg = s.background as THREE.Color;
    const gl = renderer(1);
    const restore = applyCaptureTheme(s, 'light', gl);
    expect(s.background).toBeNull();
    expect(gl.a).toBe(0); // cleared transparent: composeLightCapture lays the picture on the White page colour
    expect(grid.visible).toBe(false);
    expect(ground.visible).toBe(false);
    expect(wall.visible).toBe(true);
    restore();
    expect(s.background).toBe(bg); // the SAME Color object R3F attached
    expect(bg.getHexString()).toBe('08121d');
    expect(gl.a).toBe(1);
    expect([grid.visible, ground.visible, wall.visible]).toEqual([true, true, true]);
    expect(hiddenTagged.visible).toBe(false); // was hidden before: stays hidden
  });

  it('scenery a view change shows again (leaving Interior re-shows the classic grid) is hidden for the next picture', () => {
    const { s, grid } = scene();
    grid.visible = false; // Interior: the classic grid is hidden
    const first = applyCaptureTheme(s, 'light', renderer());
    first();
    expect(grid.visible).toBe(false);
    grid.visible = true; // __ssSetViewInstant('iso') left Interior: React shows it again
    const second = applyCaptureTheme(s, 'light', renderer());
    expect(grid.visible).toBe(false);
    second();
    expect(grid.visible).toBe(true);
  });
});

describe('the light picture: White page colour + silhouette outline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mask: pixels at least half covered become the opaque outline colour, the rest clear (soft shadows stay under it)', () => {
    // building (opaque), anti-aliased edge (60%), contact shadow (classic 45%, enhanced 14%), background (0)
    const px = new Uint8ClampedArray([200, 200, 200, 255, 90, 90, 90, 153, 0, 0, 0, 115, 20, 24, 28, 36, 0, 0, 0, 0]);
    silhouetteMask(px, [1, 2, 3]);
    expect([...px]).toEqual([1, 2, 3, 255, 1, 2, 3, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('outline offsets: 16 points on a circle of the outline width', () => {
    const o = outlineOffsets(4);
    expect(o).toHaveLength(16);
    for (const [x, y] of o) expect(Math.hypot(x, y)).toBeCloseTo(4, 1);
    expect(o[0]).toEqual([4, 0]);
    expect(LIGHT_CAPTURE_OUTLINE_PX).toBe(4);
  });

  it('the outline reads on the background (>= 4:1) and against a white wall render (#d1d1cf, >= 2.5:1)', () => {
    const lum = (h: string) => { const c = new THREE.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }; // THREE.Color is linear
    const cr = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    expect(cr(LIGHT_CAPTURE_OUTLINE, LIGHT_CAPTURE_BG)).toBeGreaterThan(4);
    expect(cr(LIGHT_CAPTURE_OUTLINE, '#d1d1cf')).toBeGreaterThan(2.5);
    expect(cr('#d1d1cf', LIGHT_CAPTURE_BG)).toBeLessThan(1.5); // why the outline is needed
  });

  it('composes: background, then the mask grown by the outline width, then the render on top', () => {
    const ops: string[] = [];
    let n = 0;
    const createElement = (tag: string) => {
      if (tag !== 'canvas') throw new Error(tag);
      const id = 'c' + n++;
      const canvas: Record<string, unknown> = { id, width: 0, height: 0 };
      const ctx = {
        set fillStyle(v: string) { ops.push(`${id}.fillStyle=${v}`); },
        fillRect: (x: number, y: number, w: number, h: number) => ops.push(`${id}.fillRect(${x},${y},${w},${h})`),
        drawImage: (img: { id: string }, x: number, y: number) => ops.push(`${id}.drawImage(${img.id},${x},${y})`),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          ops.push(`${id}.getImageData`);
          const data = new Uint8ClampedArray(w * h * 4);
          data[3] = 255; // one building pixel, one background pixel
          return { width: w, height: h, data };
        },
        putImageData: (img: { data: Uint8ClampedArray }) => ops.push(`${id}.putImageData(${[...img.data].join(',')})`),
      };
      canvas.getContext = () => ctx;
      canvas.toDataURL = (t: string) => { ops.push(`${id}.toDataURL(${t})`); return 'data:image/png;base64,LIGHT'; };
      return canvas;
    };
    vi.stubGlobal('document', { createElement });
    const gl = { id: 'gl', width: 2, height: 1 } as unknown as HTMLCanvasElement;
    expect(composeLightCapture(gl)).toBe('data:image/png;base64,LIGHT');
    const [r, g, b] = [0x6b, 0x77, 0x85];
    expect(LIGHT_CAPTURE_OUTLINE).toBe('#6b7785');
    expect(ops.slice(0, 4)).toEqual(['c0.drawImage(gl,0,0)', 'c0.getImageData', `c1.putImageData(${r},${g},${b},255,0,0,0,0)`, `c2.fillStyle=${LIGHT_CAPTURE_BG}`]);
    expect(ops[4]).toBe('c2.fillRect(0,0,2,1)');
    const grown = ops.slice(5, 21);
    expect(grown).toEqual(outlineOffsets(4).map(([x, y]) => `c2.drawImage(c1,${x},${y})`));
    expect(ops.slice(21)).toEqual(['c2.drawImage(c0,0,0)', 'c2.toDataURL(image/png)']);
  });

  it("the light background is the program's White image-box colour (no seam around the pictures)", () => {
    const prog = src('../../../public/quote-builder.html');
    expect(prog).toContain(`['#08121d','${LIGHT_CAPTURE_BG}']`);
    // LIGHT_CAPTURE_BG is lighter than #e5e7eb (the White pages' darkest allowed fill)
    const c = new THREE.Color(LIGHT_CAPTURE_BG);
    expect(c.r + c.g + c.b).toBeGreaterThan(new THREE.Color('#e5e7eb').r * 3);
  });
});

describe('wiring', () => {
  const capture = src('../CaptureHook.tsx');
  it('__ssCapture3D(opts) passes the theme through', () => {
    expect(capture).toMatch(/w\.__ssCapture3D = async \(opts\?: CaptureOptions\) =>/);
    expect(capture).toMatch(/return await captureViews\(opts\?\.theme\);/);
  });
  it('the theme is applied right before EACH picture (inside the view loop) and put back right after', () => {
    const loop = capture.slice(capture.indexOf('for (const v of views) {'), capture.indexOf('} finally {\n        gl.setPixelRatio(savedPR);'));
    expect(loop).toMatch(/await sleep\(140\);[^\n]*\n(\s*\/\/[^\n]*\n)*\s*const undoTheme = applyCaptureTheme\(scene, theme, gl\);\s*\n\s*try \{\s*\n\s*gl\.render\(scene, camera\);[^\n]*\n(\s*\/\/[^\n]*\n)*\s*out\[v\] = theme === 'light' \? composeLightCapture\(gl\.domElement\) : gl\.domElement\.toDataURL\('image\/png'\);\s*\n\s*\} finally \{\s*\n\s*undoTheme\(\);/);
    expect(capture.match(/applyCaptureTheme\(/g)).toHaveLength(1); // nothing applied once for the whole run any more
  });
  it("a light run marks its record theme: 'light' (the program falls back to 2D without it); Dark records are unchanged", () => {
    expect(capture).toMatch(/\n\s*\}\n\s*\/\/[^\n]*\n\s*if \(theme === 'light'\) out\.theme = 'light';\n\s*\} finally \{/);
    expect(capture.match(/out\.theme/g)).toHaveLength(1);
  });
  it('the classic grid and the enhanced ground disc are the tagged scenery', () => {
    expect(src('../../components/Viewport.tsx')).toMatch(/<Grid[\s\S]*?userData=\{\{ lightCaptureHide: true \}\}[\s\S]*?\/>/);
    expect(src('../enhanced/EnhancedSite.tsx')).toMatch(/material=\{statics\.groundMat\}[\s\S]*?userData=\{\{ lightCaptureHide: true \}\}/);
  });
});
