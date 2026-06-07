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
  overhangFt: number;
  trimColor: string;
}

const TILE = 3; // ft per texture module (matches main building)
const ROOF_LIFT = 0.11; // lift roof off the rafters
const ROOF_UNDER_GAP = 0.06; // galvalume underside sits just below the top skin
const OUT = SHEET_OUTSET; // sheeting sits this far outside the framing centerline
const FASCIA_H = 0.32; // ~3.8" eave fascia face
const RAKE_H = 0.24; // rake board face

type Pt = [number, number, number];
type UV = [number, number];
/** A trim board: position, size, optional Euler rotation, and whether it's the dark drip edge. */
type BoxSpec = { pos: Pt; size: [number, number, number]; rot?: [number, number, number]; dark?: boolean };

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
export function LeanToSiding({ leanTos, wallOrientation, roofOrientation, colors, wainscot, overhangFt, trimColor }: LeanToSidingProps) {
  const wallDir: RibDirection = wallOrientation === 'Vertical' ? 'vertical' : 'horizontal';
  const roofDir: RibDirection = roofOrientation === 'Vertical' ? 'vertical' : 'horizontal';

  // Trim materials — painted dielectric (white) + dark cut-edge drip strip.
  const trimMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.0, roughness: 0.52, envMapIntensity: 0.25 }),
    [trimColor],
  );
  const darkMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2c3036', metalness: 0.35, roughness: 0.55 }),
    [],
  );

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
        const geo = eave ? eaveSurfaces(lt, overhangFt) : gableSurfaces(lt, overhangFt);

        return (
          <group key={lt.id}>
            {/* Roof — ALWAYS. Top skin (colored) + galvalume underside. */}
            <PolyPanel corners={geo.roofTop} uvs={geo.roofUV} material={polyMat(tex.roof, roofMetal, true)} />
            <PolyPanel corners={geo.roofUnder} uvs={geo.roofUV} material={polyMat(tex.underRoof, true, true)} />

            {/* Eave fascia + rake trim following the roof overhang */}
            {geo.trim.map((b, i) => (
              <mesh key={`trim-${i}`} position={b.pos} rotation={b.rot ?? [0, 0, 0]} material={b.dark ? darkMat : trimMat} castShadow receiveShadow>
                <boxGeometry args={b.size} />
              </mesh>
            ))}

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
  trim: BoxSpec[];
  wainscot: (wH: number) => Pt[];
  wainscotUV: (wH: number) => UV[];
  frontGable: (v: GableVal) => Pt[];
  frontGableUV: (v: GableVal) => UV[];
  backGable: (v: GableVal) => Pt[];
  backGableUV: (v: GableVal) => UV[];
  // outer wall plane info for sideWallPolys
  wall: { axis: 'z' | 'x'; plane: number; a: number; b: number };
}

/** Build the eave fascia (drip board + dark lip) and two rake boards for a
 *  single-slope roof, given the outer drip lip + inner high edge in a plane.
 *  `coord(along, up)` maps the 2D rake plane back to a 3D point at the given
 *  perpendicular position; `lenAxis` is the trim's long direction along the eave. */
function slopeTrim(
  // outer lip + inner top in 2D (across, height)
  lipAcross: number,
  lipUp: number,
  innerAcross: number,
  innerUp: number,
  end0: number, // eave run start (with overhang)
  end1: number, // eave run end
  toPt: (across: number, up: number, run: number) => Pt,
  eaveIsZ: boolean, // true: eave runs along Z (eave-attached); false: along X
): BoxSpec[] {
  const specs: BoxSpec[] = [];
  const runMid = (end0 + end1) / 2;
  const runLen = Math.abs(end1 - end0);

  // Eave fascia: a thin vertical board hanging at the drip lip, full run length.
  if (eaveIsZ) {
    specs.push({ pos: toPt(lipAcross, lipUp - FASCIA_H / 2, runMid), size: [0.05, FASCIA_H, runLen] });
    specs.push({ pos: toPt(lipAcross, lipUp - 0.02, runMid), size: [0.07, 0.07, runLen], dark: true });
  } else {
    specs.push({ pos: toPt(lipAcross, lipUp - FASCIA_H / 2, runMid), size: [runLen, FASCIA_H, 0.05] });
    specs.push({ pos: toPt(lipAcross, lipUp - 0.02, runMid), size: [runLen, 0.07, 0.07], dark: true });
  }

  // Rake boards at each end, sloping from the lip up to the inner high edge.
  const dAcross = innerAcross - lipAcross;
  const dUp = innerUp - lipUp;
  const len = Math.hypot(dAcross, dUp);
  const ang = Math.atan2(dUp, dAcross); // angle in the (across, up) plane
  for (const end of [end0, end1] as const) {
    const midAcross = (lipAcross + innerAcross) / 2;
    const midUp = (lipUp + innerUp) / 2;
    if (eaveIsZ) {
      // rake lies in the X-Y plane at constant Z → rotate about Z
      specs.push({ pos: toPt(midAcross, midUp + 0.06, end), size: [len, RAKE_H, 0.05], rot: [0, 0, ang] });
    } else {
      // rake lies in the Z-Y plane at constant X → rotate about X.
      // box length along Z; tilt z into y by the slope angle.
      specs.push({ pos: toPt(midAcross, midUp + 0.06, end), size: [0.05, RAKE_H, len], rot: [-ang, 0, 0] });
    }
  }
  return specs;
}

/** EAVE-attached (Left/Right): walls vary in X, length runs along Z. */
function eaveSurfaces(lt: LeanToStructure, oh: number): SurfaceSet {
  const innerX = lt.inner.x;
  const outerX = lt.outer.x;
  const lh = lt.lowLegHeightFt;
  const connH = lt.peakHeightFt;
  const z0 = lt.spanStart;
  const z1 = lt.spanEnd;
  const outwardX = Math.sign(outerX - innerX) || -1;
  const wallX = outerX + outwardX * OUT;
  const awidth = Math.abs(outerX - innerX) || 1;
  const rise = connH - lh;
  const rafterLen = Math.hypot(awidth, rise);
  const roofLiftY = (awidth / rafterLen) * ROOF_LIFT;

  // Overhang: roof projects past the outer eave (drops as it goes) and past
  // both gable ends by `oh`.
  const eaveDrop = (oh * rise) / awidth;
  const outerXoh = outerX + outwardX * oh;
  const lhOh = lh - eaveDrop;
  const zf = z0 - oh;
  const zb = z1 + oh;

  // Roof corners (outer-low lip → inner-high), lifted along the up normal.
  const baseRoof: Pt[] = [
    [outerXoh, lhOh, zf],
    [outerXoh, lhOh, zb],
    [innerX, connH, zb],
    [innerX, connH, zf],
  ];
  const n = upNormal(baseRoof[0], baseRoof[1], baseRoof[2]);
  const roofTop = offsetPts(baseRoof, n, ROOF_LIFT);
  const roofUnder = offsetPts(baseRoof, n, ROOF_LIFT - ROOF_UNDER_GAP);
  const rl = Math.hypot(innerX - outerXoh, connH - lhOh);
  const roofUV: UV[] = [
    [zf, 0],
    [zb, 0],
    [zb, rl],
    [zf, rl],
  ];

  const trim = slopeTrim(outerXoh, lhOh + roofLiftY, innerX, connH + roofLiftY, zf, zb, (a, u, r) => [a, u, r], true);

  return {
    roofTop,
    roofUnder,
    roofUV,
    trim,
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
function gableSurfaces(lt: LeanToStructure, oh: number): SurfaceSet {
  const innerZ = lt.inner.z;
  const outerZ = lt.outer.z;
  const lh = lt.lowLegHeightFt;
  const connH = lt.peakHeightFt;
  const x0 = lt.spanStart;
  const x1 = lt.spanEnd;
  const outwardZ = Math.sign(outerZ - innerZ) || -1;
  const wallZ = outerZ + outwardZ * OUT;
  const awidth = Math.abs(outerZ - innerZ) || 1;
  const rise = connH - lh;
  const rafterLen = Math.hypot(awidth, rise);
  const roofLiftY = (awidth / rafterLen) * ROOF_LIFT;

  const eaveDrop = (oh * rise) / awidth;
  const outerZoh = outerZ + outwardZ * oh;
  const lhOh = lh - eaveDrop;
  const xf = x0 - oh;
  const xb = x1 + oh;

  const baseRoof: Pt[] = [
    [xf, lhOh, outerZoh],
    [xb, lhOh, outerZoh],
    [xb, connH, innerZ],
    [xf, connH, innerZ],
  ];
  const n = upNormal(baseRoof[0], baseRoof[1], baseRoof[2]);
  const roofTop = offsetPts(baseRoof, n, ROOF_LIFT);
  const roofUnder = offsetPts(baseRoof, n, ROOF_LIFT - ROOF_UNDER_GAP);
  const rl = Math.hypot(innerZ - outerZoh, connH - lhOh);
  const roofUV: UV[] = [
    [xf, 0],
    [xb, 0],
    [xb, rl],
    [xf, rl],
  ];

  // across = Z, up = Y, run = X → toPt maps back as [run, up, across].
  const trim = slopeTrim(outerZoh, lhOh + roofLiftY, innerZ, connH + roofLiftY, xf, xb, (a, u, r) => [r, u, a], false);

  return {
    roofTop,
    roofUnder,
    roofUV,
    trim,
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
