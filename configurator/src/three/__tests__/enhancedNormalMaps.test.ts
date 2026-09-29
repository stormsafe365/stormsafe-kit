import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  LAP_SHADE_PX,
  NORMAL_MAP_PX,
  RIB_PERIOD_IN,
  SLAT_COLOR_PX,
  TILE_IN,
  configureEnhancedTextures,
  disposeEnhancedTextures,
  enhancedTextureAnisotropy,
  lapBoard,
  lapShadeBandRows,
  lapShadePixels,
  lapShadeTexture,
  normalMapAxis,
  normalMapPixels,
  normalMapTexture,
  ribProfile,
  sameNormalMapSource,
  sheetSlopeGain,
  slatColorPixels,
  slatColorTexture,
} from '../enhanced/normalMaps';
import { installFakeCanvas } from './fakeCanvas';

// Render-upgrade Phase 4: panel normal maps (HANDOFF Step 2). The pure pixel
// math is tested directly; the texture wrappers through a minimal fake canvas
// (the test environment has no DOM).

const N = NORMAL_MAP_PX;
const px = (a: Uint8ClampedArray, i: number, j: number, n = N) => {
  const p = (j * n + i) * 4;
  return { r: a[p], g: a[p + 1], b: a[p + 2], a: a[p + 3] };
};
/** Decode a stored normal to [-1, 1] components. */
const dec = (v: number) => (v / 255) * 2 - 1;

describe('sheet profile (HANDOFF Step 2)', () => {
  it('major rib 3/4" at the rib centre, minor ribs 1/8" at 3" and 6", flat pan between', () => {
    expect(ribProfile(0)).toBeCloseTo(0.75, 9);
    expect(ribProfile(0.99999)).toBeCloseTo(0.75, 3);
    expect(ribProfile(3 / 9)).toBeCloseTo(0.13, 9);
    expect(ribProfile(6 / 9)).toBeCloseTo(0.13, 9);
    expect(ribProfile(4.5 / 9)).toBe(0);
    expect(ribProfile(2 / 9)).toBe(0);
    // stepped flank: 0.5" at 0.78" out, 0 past 1.38"
    expect(ribProfile(0.78 / 9)).toBeCloseTo(0.5, 9);
    expect(ribProfile(1.4 / 9)).toBe(0);
  });

  it('lap board: sharp overlap step over the bottom 6%, taper to 0.7 at the top', () => {
    expect(lapBoard(0)).toBe(0);
    expect(lapBoard(0.06)).toBeCloseTo(1, 9);
    expect(lapBoard(0.999999)).toBeCloseTo(0.7, 5);
  });

  it('one tile = 36" at 1024 px: a 9" rib period is exactly 256 px, slope gain N/72', () => {
    expect(TILE_IN).toBe(36);
    expect((RIB_PERIOD_IN * N) / TILE_IN).toBe(256);
    expect(sheetSlopeGain(N)).toBeCloseTo(N / 72, 12);
  });
});

describe('normal map pixels (lab makeNormalMap)', () => {
  const horiz = normalMapPixels('wall-horizontal');
  const vert = normalMapPixels('wall-vertical');

  it('vertical maps vary along u only, horizontal maps along v only', () => {
    expect(normalMapAxis('wall-vertical')).toBe('u');
    expect(normalMapAxis('roof-vertical')).toBe('u');
    expect(normalMapAxis('wall-horizontal')).toBe('v');
    expect(normalMapAxis('roof-horizontal')).toBe('v');
    expect(normalMapAxis('lap')).toBe('v');
    expect(normalMapAxis('slat')).toBe('v');
    for (const j of [0, 300, 777]) for (const i of [5, 16, 900]) {
      expect(px(vert, i, j)).toEqual(px(vert, i, 0)); // every row identical
      expect(px(horiz, i, j)).toEqual(px(horiz, 0, j)); // every column identical
      expect(px(horiz, i, j).r).toBe(128); // no x relief
      expect(px(vert, i, j).g).toBe(128); // no y relief
    }
  });

  it('HORIZONTAL rib is lit on TOP: green = +dy (HANDOFF pitfall 1)', () => {
    // Rib centres sit at v = 0, 1/4, 1/2, 3/4 -> canvas rows 0, 256, 512, 768
    // (row 0 = top of the tile, v = 1, because CanvasTexture flipY is true).
    // The flanks run 0.38" -> 1.38" from the centre = rows 11..39 either side
    // (the ~3/4" flat top in between is level).
    const centre = 512;
    expect(px(horiz, 0, centre).g).toBe(128);
    for (let d = 12; d <= 38; d++) {
      expect(px(horiz, 0, centre - d).g).toBeGreaterThan(128); // upper flank (higher v) tilts UP
      expect(px(horiz, 0, centre + d).g).toBeLessThan(128); // lower flank tilts DOWN
    }
    // Shaded with the tangent frame three builds (T = +u = along the wall, B =
    // +v = UP, N = out of the wall), a light from above-front reaches the upper
    // flank more than the flat pan, and the flat pan more than the lower flank.
    const L = new THREE.Vector3(0, 1, 1).normalize();
    const lit = (j: number) => {
      const t = px(horiz, 0, j);
      const n = new THREE.Vector3(dec(t.r) * 0.9, dec(t.g) * 0.9, dec(t.b)).normalize(); // (T, B, N) = (x, y, z)
      return n.dot(L);
    };
    const flat = centre + 64; // 2.25" from the major rib, clear of the minor ribs
    expect(px(horiz, 0, flat).g).toBe(128);
    expect(lit(centre - 16)).toBeGreaterThan(lit(flat) + 0.1);
    expect(lit(flat)).toBeGreaterThan(lit(centre + 16) + 0.1);
  });

  it('true slopes: a 0.625 in/in flank stores exactly that tilt', () => {
    // Column 16 = 0.5625" from a major rib centre: on the straight flank
    // 0.38" -> 0.78" (0.75 -> 0.50, slope -0.625), as are its neighbours.
    const t = px(vert, 16, 0);
    const inv = 1 / Math.hypot(0.625, 1);
    expect(t.r).toBe(Math.round((0.625 * inv * 0.5 + 0.5) * 255)); // 195: tilts toward +u, away from the rib
    expect(t.b).toBe(Math.round(inv * 255)); // 216
    expect(t.a).toBe(255);
  });

  it('rib period is 9" (256 px) and the tile holds exactly 4 periods', () => {
    for (let k = 0; k < N; k++) {
      expect(horiz[(((k + 256) % N) * N) * 4 + 1]).toBe(horiz[k * N * 4 + 1]);
      expect(vert[((k + 256) % N) * 4]).toBe(vert[k * 4]);
    }
    // ... and not a shorter period (the major rib only repeats every 9")
    let differs = false;
    for (let k = 0; k < N && !differs; k++) differs = vert[((k + 128) % N) * 4] !== vert[k * 4];
    expect(differs).toBe(true);
  });

  it('roof maps are the same sheet as the walls (same pixels, shared source)', () => {
    expect(sameNormalMapSource('roof-vertical', 'wall-vertical')).toBe(true);
    expect(sameNormalMapSource('roof-horizontal', 'wall-horizontal')).toBe(true);
    expect(sameNormalMapSource('wall-vertical', 'wall-horizontal')).toBe(false);
    expect(sameNormalMapSource('lap', 'wall-horizontal')).toBe(false);
    const roof = normalMapPixels('roof-vertical', 64);
    expect(roof).toEqual(normalMapPixels('wall-vertical', 64));
  });

  it("is byte-identical to the lab's per-pixel loop (render-lab-v20.html L376-405) for every map", () => {
    // Verbatim port of the lab's makeNormalMap body (hAt + central differences over the 2-D canvas).
    const courseProfile = (y: number) => {
      const t = y % 1;
      return t < 0.12 ? t / 0.12 : 1 - 0.4 * ((t - 0.12) / 0.88);
    };
    const labPixels = (kind: 'vertical' | 'horizontal' | 'lap' | 'slat') => {
      const n = N;
      const data = new Uint8ClampedArray(n * n * 4);
      const hAt = (i: number, j: number) => {
        const u = i / n;
        const v = 1 - j / n;
        if (kind === 'vertical') return ribProfile((u * 4) % 1);
        if (kind === 'horizontal') return ribProfile((v * 4) % 1);
        if (kind === 'lap') return lapBoard((v * 3) % 1);
        return courseProfile((v * 4) % 1);
      };
      const AMP = kind === 'lap' ? 16 : kind === 'slat' ? 20 : n / 72;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const dx = (hAt((i + 1) % n, j) - hAt((i - 1 + n) % n, j)) * AMP;
          const dy = (hAt(i, (j + 1) % n) - hAt(i, (j - 1 + n) % n)) * AMP;
          const inv = 1 / Math.hypot(dx, dy, 1);
          const p = (j * n + i) * 4;
          data[p] = (-dx * inv * 0.5 + 0.5) * 255;
          data[p + 1] = (dy * inv * 0.5 + 0.5) * 255;
          data[p + 2] = inv * 255;
          data[p + 3] = 255;
        }
      return data;
    };
    const pairs = [
      ['vertical', 'wall-vertical'],
      ['horizontal', 'wall-horizontal'],
      ['lap', 'lap'],
      ['slat', 'slat'],
    ] as const;
    for (const [lab, ours] of pairs) {
      const a = labPixels(lab);
      const b = normalMapPixels(ours);
      let diff = -1;
      for (let i = 0; i < a.length && diff < 0; i++) if (a[i] !== b[i]) diff = i;
      expect({ map: ours, firstDiff: diff }).toEqual({ map: ours, firstDiff: -1 });
    }
  });

  it('lap map: 12" courses, v relief only, the overlap step faces DOWN', () => {
    const lap = normalMapPixels('lap');
    // Course bottoms at v = 0, 1/3, 2/3 -> rows 1024, 682.7, 341.3. Just above
    // a bottom edge (the board's exposed lip) the height rises with v -> G < 128.
    expect(px(lap, 0, 336).g).toBeLessThan(100);
    expect(px(lap, 0, 336).r).toBe(128);
    // mid-board: gentle taper, tilts slightly up
    expect(px(lap, 0, 170).g).toBeGreaterThan(128);
  });
});

describe('lap shade + slat color maps', () => {
  it('lap shade: exactly one band per 12" course (lab double-course bug fixed)', () => {
    const rows = lapShadeBandRows();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.toFixed(3))).size).toBe(3);
    const C = LAP_SHADE_PX / 3;
    expect([...rows].sort((a, b) => a - b).map((r) => r.toFixed(3))).toEqual([0, C, 2 * C].map((r) => r.toFixed(3)));

    const shade = lapShadePixels();
    const col = (j: number) => shade[j * LAP_SHADE_PX * 4];
    const bandMin = (y0: number) => {
      let m = 255;
      for (let j = Math.floor(y0); j < y0 + 60; j++) m = Math.min(m, col(j));
      return m;
    };
    const mins = [bandMin(0), bandMin(C), bandMin(2 * C)];
    // every course gets the same 0.20-alpha shadow (the lab drew row 0 twice -> ~163)
    for (const m of mins) expect(m).toBeGreaterThanOrEqual(200);
    expect(Math.max(...mins) - Math.min(...mins)).toBeLessThanOrEqual(2);
    // and the board faces are clean white between the bands
    expect(col(200)).toBe(255);
    expect(col(600)).toBe(255);
  });

  it('slat color: 4 slats per 1 ft tile, a gray seam at each', () => {
    const s = slatColorPixels();
    const band = SLAT_COLOR_PX / 4;
    const runs: number[] = [];
    for (let j = 0; j < SLAT_COLOR_PX; j++) {
      const dark = s[j * SLAT_COLOR_PX * 4] < 230;
      const prev = j > 0 && s[(j - 1) * SLAT_COLOR_PX * 4] < 230;
      if (dark && !prev) runs.push(j);
    }
    expect(runs).toEqual([0, band, 2 * band, 3 * band]);
  });
});

describe('textures (lazy, shared, correct color spaces)', () => {
  let fake: ReturnType<typeof installFakeCanvas>;
  beforeAll(() => {
    fake = installFakeCanvas();
  });
  afterAll(() => {
    disposeEnhancedTextures();
    vi.unstubAllGlobals();
  });

  it('builds each map once and shares it (roof = wall sheet)', () => {
    const before = fake.created();
    const a = normalMapTexture('wall-vertical');
    expect(normalMapTexture('wall-vertical')).toBe(a);
    expect(normalMapTexture('roof-vertical')).toBe(a);
    expect(normalMapTexture('wall-horizontal')).not.toBe(a);
    expect(normalMapTexture('roof-horizontal')).toBe(normalMapTexture('wall-horizontal'));
    expect(fake.created() - before).toBe(2);
  });

  it('normal maps: CanvasTexture, flipY true, NoColorSpace, repeat wrap, 1 tile = 3 ft', () => {
    for (const k of ['wall-vertical', 'wall-horizontal', 'lap', 'slat'] as const) {
      const t = normalMapTexture(k);
      expect(t).toBeInstanceOf(THREE.CanvasTexture);
      expect(t.flipY).toBe(true);
      expect(t.colorSpace).toBe(THREE.NoColorSpace);
      expect(t.wrapS).toBe(THREE.RepeatWrapping);
      expect(t.wrapT).toBe(THREE.RepeatWrapping);
      expect(t.repeat.x).toBeCloseTo(k === 'slat' ? 1 : 1 / 3, 12);
      expect((t.image as { width: number }).width).toBe(1024);
    }
  });

  it('uploads exactly the tested pixels', () => {
    const t = normalMapTexture('wall-horizontal');
    const uploaded = fake.pixelsOf(t.image);
    const expected = normalMapPixels('wall-horizontal');
    expect(uploaded.length).toBe(expected.length);
    let firstDiff = -1;
    for (let i = 0; i < expected.length && firstDiff < 0; i++) if (uploaded[i] !== expected[i]) firstDiff = i;
    expect(firstDiff).toBe(-1);
  });

  it('lap shade and slat color maps are sRGB color data', () => {
    expect(lapShadeTexture().colorSpace).toBe(THREE.SRGBColorSpace);
    expect(lapShadeTexture().repeat.y).toBeCloseTo(1 / 3, 12);
    expect(slatColorTexture().colorSpace).toBe(THREE.SRGBColorSpace);
    expect(slatColorTexture().flipY).toBe(true);
  });

  it('anisotropy: max requested by default, then the renderer max', () => {
    const t = normalMapTexture('wall-vertical');
    expect(t.anisotropy).toBe(enhancedTextureAnisotropy());
    const v = t.version;
    configureEnhancedTextures({ capabilities: { getMaxAnisotropy: () => 8 } } as never);
    expect(t.anisotropy).toBe(8);
    expect(t.version).toBeGreaterThan(v); // re-uploaded with the new value
    expect(normalMapTexture('lap').anisotropy).toBe(8);
  });
});
