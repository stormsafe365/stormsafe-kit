import { useMemo } from 'react';
import * as THREE from 'three';
import { SHEET_OUTSET, type LeanToStructure } from '@/engine/geometry';
import type { BuildingColors, PanelOrientation, Wainscot } from '@/types/building';
import { swatchHex, isMetallic } from '@/config/colors';
import { createCorrugatedTexture, type RibDirection } from './textures';

interface LeanToSidingProps {
  leanTos: LeanToStructure[];
  wallOrientation: PanelOrientation;
  roofOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

const TILE = 3; // ft per texture module (matches main building)
const ROOF_LIFT = 0.11; // lift roof off the rafters
const ROOF_UNDER_GAP = 0.06; // galvalume underside sits just below the top skin
const OUT = SHEET_OUTSET; // sheeting sits this far outside the framing centerline

type Pt = [number, number, number];
type UV = [number, number];

/**
 * Lean-to sheet-metal skin. A lean-to is HALF a building: a single-slope roof,
 * ONE outer long wall (the inner side is the main building's own wall and is
 * never sheeted here), and two trapezoidal gable ends that follow the slope.
 *
 *   enclosure 'open'     → roof only
 *   enclosure 'enclosed' → roof + outer wall + both gable ends (all closed)
 *   enclosure 'custom'   → roof + per-wall (front / back gable, side wall)
 *
 * All surfaces are built as explicit polygons so the roof normal always faces
 * up (identical lighting on left and right lean-tos) and the gable ends are true
 * trapezoids, not averaged rectangles.
 */
export function LeanToSiding({ leanTos, wallOrientation, roofOrientation, colors, wainscot }: LeanToSidingProps) {
  const wallDir: RibDirection = wallOrientation === 'Vertical' ? 'vertical' : 'horizontal';
  const roofDir: RibDirection = roofOrientation === 'Vertical' ? 'vertical' : 'horizontal';

  const tex = useMemo(
    () => ({
      roof: createCorrugatedTexture(swatchHex(colors.roof), roofDir),
      underRoof: createCorrugatedTexture(swatchHex('GALVALUME'), roofDir),
      walls: createCorrugatedTexture(swatchHex(colors.walls), wallDir),
      wainscot: createCorrugatedTexture(swatchHex(colors.wainscot), wallDir),
    }),
    [colors.roof, colors.walls, colors.wainscot, wallDir, roofDir],
  );

  // Material factory. UVs are baked in FEET/TILE, so repeat = 1 and the rib grid
  // is world-anchored (adjacent panels line up; left and right read identically).
  const polyMat = useMemo(
    () =>
      (base: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }, metallic: boolean, bumped: boolean): THREE.MeshStandardMaterial => {
        const map = base.map.clone();
        map.needsUpdate = true;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(1, 1);
        const params: THREE.MeshStandardMaterialParameters = {
          map,
          metalness: metallic ? 0.25 : 0.0,
          roughness: metallic ? 0.6 : 0.9,
          envMapIntensity: metallic ? 0.12 : 0.0,
          side: THREE.DoubleSide,
        };
        if (bumped) {
          const bumpMap = base.bump.clone();
          bumpMap.needsUpdate = true;
          bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
          bumpMap.repeat.set(1, 1);
          params.bumpMap = bumpMap;
          params.bumpScale = 0.05;
        }
        return new THREE.MeshStandardMaterial(params);
      },
    [],
  );

  const roofMetal = isMetallic(colors.roof);
  const wallMetal = isMetallic(colors.walls);
  const wainMetal = isMetallic(colors.wainscot);
  const wH = wainscot.enabled ? wainscot.heightFt : 0;

  return (
    <group>
      {leanTos.map((lt) => {
        const { side, front, back } = resolveWalls(lt);
        const eave = lt.attachedSide.includes('Eave');
        const geo = eave ? eaveSurfaces(lt) : gableSurfaces(lt);

        return (
          <group key={lt.id}>
            {/* Roof — ALWAYS. Top skin (colored) + galvalume underside. */}
            <PolyPanel corners={geo.roofTop} uvs={geo.roofUV} material={polyMat(tex.roof, roofMetal, true)} />
            <PolyPanel corners={geo.roofUnder} uvs={geo.roofUV} material={polyMat(tex.underRoof, true, true)} />

            {/* Outer long wall (the only sheeted long wall) */}
            {side !== 'open' &&
              sideWallPolys(geo, side, lt.lowLegHeightFt).map((p, i) => (
                <PolyPanel key={`side-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.walls, wallMetal, false)} />
              ))}

            {/* Wainscot band on the outer wall (only when the wall is fully closed) */}
            {side === 'closed' && wH > 0 && (
              <PolyPanel corners={geo.wainscot(wH)} uvs={geo.wainscotUV(wH)} material={polyMat(tex.wainscot, wainMetal, false)} />
            )}

            {/* Front gable end (trapezoid / gable-only triangle) */}
            {front !== 'open' && (
              <PolyPanel
                corners={geo.frontGable(front)}
                uvs={geo.frontGableUV(front)}
                material={polyMat(tex.walls, wallMetal, false)}
              />
            )}

            {/* Back gable end */}
            {back !== 'open' && (
              <PolyPanel
                corners={geo.backGable(back)}
                uvs={geo.backGableUV(back)}
                material={polyMat(tex.walls, wallMetal, false)}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

// ── Wall-setting resolution ────────────────────────────────────────────────
type GableVal = 'open' | 'gable' | 'closed';
type SideVal = string; // open | closed | q1 | q2 | q3 | 1panel | 2panel | 3panel

function resolveWalls(lt: LeanToStructure): { side: SideVal; front: GableVal; back: GableVal } {
  if (lt.enclosure === 'enclosed') return { side: 'closed', front: 'closed', back: 'closed' };
  if (lt.enclosure === 'custom' && lt.customWalls) {
    return {
      side: lt.customWalls.side || 'open',
      front: (lt.customWalls.front as GableVal) || 'open',
      back: (lt.customWalls.back as GableVal) || 'open',
    };
  }
  return { side: 'open', front: 'open', back: 'open' };
}

// ── Geometry builders ──────────────────────────────────────────────────────
// Each returns the surfaces for one lean-to in a normalized shape so the JSX
// above stays orientation-agnostic.

interface SurfaceSet {
  roofTop: Pt[];
  roofUnder: Pt[];
  roofUV: UV[];
  wainscot: (wH: number) => Pt[];
  wainscotUV: (wH: number) => UV[];
  frontGable: (v: GableVal) => Pt[];
  frontGableUV: (v: GableVal) => UV[];
  backGable: (v: GableVal) => Pt[];
  backGableUV: (v: GableVal) => UV[];
  // outer wall plane info for sideWallPolys
  wall: { axis: 'z' | 'x'; plane: number; a: number; b: number };
}

/** EAVE-attached (Left/Right): walls vary in X, length runs along Z. */
function eaveSurfaces(lt: LeanToStructure): SurfaceSet {
  const innerX = lt.inner.x;
  const outerX = lt.outer.x;
  const lh = lt.lowLegHeightFt;
  const connH = lt.peakHeightFt;
  const z0 = lt.spanStart;
  const z1 = lt.spanEnd;
  const outwardX = Math.sign(outerX - innerX) || -1;
  const wallX = outerX + outwardX * OUT;
  const rafterLen = Math.hypot(outerX - innerX, connH - lh);

  // Roof corners (outer-low → inner-high), lifted along the up normal.
  const baseRoof: Pt[] = [
    [outerX, lh, z0],
    [outerX, lh, z1],
    [innerX, connH, z1],
    [innerX, connH, z0],
  ];
  const n = upNormal(baseRoof[0], baseRoof[1], baseRoof[2]);
  const roofTop = offsetPts(baseRoof, n, ROOF_LIFT);
  const roofUnder = offsetPts(baseRoof, n, ROOF_LIFT - ROOF_UNDER_GAP);
  const roofUV: UV[] = [
    [z0, 0],
    [z1, 0],
    [z1, rafterLen],
    [z0, rafterLen],
  ];

  return {
    roofTop,
    roofUnder,
    roofUV,
    wall: { axis: 'z', plane: wallX, a: z0, b: z1 },
    wainscot: (wH) => [
      [wallX + outwardX * 0.02, 0, z0],
      [wallX + outwardX * 0.02, 0, z1],
      [wallX + outwardX * 0.02, wH, z1],
      [wallX + outwardX * 0.02, wH, z0],
    ],
    wainscotUV: (wH) => [
      [z0, 0],
      [z1, 0],
      [z1, wH],
      [z0, wH],
    ],
    frontGable: (v) => gableXY(v, innerX, outerX, lh, connH, z0 - OUT),
    frontGableUV: (v) => gableXYUV(v, innerX, outerX, lh, connH),
    backGable: (v) => gableXY(v, innerX, outerX, lh, connH, z1 + OUT),
    backGableUV: (v) => gableXYUV(v, innerX, outerX, lh, connH),
  };
}

/** GABLE-attached (Front/Back): walls vary in Z, length runs along X. */
function gableSurfaces(lt: LeanToStructure): SurfaceSet {
  const innerZ = lt.inner.z;
  const outerZ = lt.outer.z;
  const lh = lt.lowLegHeightFt;
  const connH = lt.peakHeightFt;
  const x0 = lt.spanStart;
  const x1 = lt.spanEnd;
  const outwardZ = Math.sign(outerZ - innerZ) || -1;
  const wallZ = outerZ + outwardZ * OUT;
  const rafterLen = Math.hypot(outerZ - innerZ, connH - lh);

  const baseRoof: Pt[] = [
    [x0, lh, outerZ],
    [x1, lh, outerZ],
    [x1, connH, innerZ],
    [x0, connH, innerZ],
  ];
  const n = upNormal(baseRoof[0], baseRoof[1], baseRoof[2]);
  const roofTop = offsetPts(baseRoof, n, ROOF_LIFT);
  const roofUnder = offsetPts(baseRoof, n, ROOF_LIFT - ROOF_UNDER_GAP);
  const roofUV: UV[] = [
    [x0, 0],
    [x1, 0],
    [x1, rafterLen],
    [x0, rafterLen],
  ];

  return {
    roofTop,
    roofUnder,
    roofUV,
    wall: { axis: 'x', plane: wallZ, a: x0, b: x1 },
    wainscot: (wH) => [
      [x0, 0, wallZ + outwardZ * 0.02],
      [x1, 0, wallZ + outwardZ * 0.02],
      [x1, wH, wallZ + outwardZ * 0.02],
      [x0, wH, wallZ + outwardZ * 0.02],
    ],
    wainscotUV: (wH) => [
      [x0, 0],
      [x1, 0],
      [x1, wH],
      [x0, wH],
    ],
    frontGable: (v) => gableZY(v, innerZ, outerZ, lh, connH, x0 - OUT),
    frontGableUV: (v) => gableZYUV(v, innerZ, outerZ, lh, connH),
    backGable: (v) => gableZY(v, innerZ, outerZ, lh, connH, x1 + OUT),
    backGableUV: (v) => gableZYUV(v, innerZ, outerZ, lh, connH),
  };
}

// Outer long wall, honoring the side-wall setting (height fraction or panel count).
function sideWallPolys(geo: SurfaceSet, side: SideVal, lh: number): Array<{ corners: Pt[]; uvs: UV[] }> {
  const { axis, plane, a, b } = geo.wall;
  // Determine extent + height
  let h = lh;
  let lo = a;
  let hi = b;
  if (side === 'q1') h = lh * 0.25;
  else if (side === 'q2') h = lh * 0.5;
  else if (side === 'q3') h = lh * 0.75;
  else {
    const m = /^(\d)panel$/.exec(side);
    if (m) hi = Math.min(b, a + parseInt(m[1], 10) * 3); // N × 3' panels from the start
  }

  const corners: Pt[] =
    axis === 'z'
      ? [
          [plane, 0, lo],
          [plane, 0, hi],
          [plane, h, hi],
          [plane, h, lo],
        ]
      : [
          [lo, 0, plane],
          [hi, 0, plane],
          [hi, h, plane],
          [lo, h, plane],
        ];
  const uvs: UV[] = [
    [lo, 0],
    [hi, 0],
    [hi, h],
    [lo, h],
  ];
  return [{ corners, uvs }];
}

// Gable end in the X-Y plane at constant Z (eave-attached).
function gableXY(v: GableVal, innerX: number, outerX: number, lh: number, connH: number, z: number): Pt[] {
  if (v === 'gable') {
    // Triangle ABOVE the eave line only.
    return [
      [innerX, lh, z],
      [outerX, lh, z],
      [innerX, connH, z],
    ];
  }
  // Full trapezoid (closed).
  return [
    [innerX, 0, z],
    [outerX, 0, z],
    [outerX, lh, z],
    [innerX, connH, z],
  ];
}
function gableXYUV(v: GableVal, innerX: number, outerX: number, lh: number, connH: number): UV[] {
  if (v === 'gable')
    return [
      [innerX, lh],
      [outerX, lh],
      [innerX, connH],
    ];
  return [
    [innerX, 0],
    [outerX, 0],
    [outerX, lh],
    [innerX, connH],
  ];
}

// Gable end in the Z-Y plane at constant X (gable-attached).
function gableZY(v: GableVal, innerZ: number, outerZ: number, lh: number, connH: number, x: number): Pt[] {
  if (v === 'gable') {
    return [
      [x, lh, innerZ],
      [x, lh, outerZ],
      [x, connH, innerZ],
    ];
  }
  return [
    [x, 0, innerZ],
    [x, 0, outerZ],
    [x, lh, outerZ],
    [x, connH, innerZ],
  ];
}
function gableZYUV(v: GableVal, innerZ: number, outerZ: number, lh: number, connH: number): UV[] {
  if (v === 'gable')
    return [
      [innerZ, lh],
      [outerZ, lh],
      [innerZ, connH],
    ];
  return [
    [innerZ, 0],
    [outerZ, 0],
    [outerZ, lh],
    [innerZ, connH],
  ];
}

// ── Math helpers ───────────────────────────────────────────────────────────
function upNormal(a: Pt, b: Pt, c: Pt): Pt {
  const ab: Pt = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Pt = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n: Pt = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / L, n[1] / L, n[2] / L];
  if (n[1] < 0) n = [-n[0], -n[1], -n[2]]; // always point up
  return n;
}
function offsetPts(pts: Pt[], n: Pt, d: number): Pt[] {
  return pts.map((p) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d]);
}

// ── Polygon mesh (fan-triangulated, world-anchored UVs) ────────────────────
function PolyPanel({ corners, uvs, material }: { corners: Pt[]; uvs: UV[]; material: THREE.Material }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const uv: number[] = [];
    for (let i = 1; i < corners.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        pos.push(corners[k][0], corners[k][1], corners[k][2]);
        uv.push(uvs[k][0] / TILE, uvs[k][1] / TILE);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(corners), JSON.stringify(uvs)]);

  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}
