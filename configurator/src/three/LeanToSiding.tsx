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
        const walls = resolveWalls(lt);
        const { side, front, back } = walls;
        const eave = lt.attachedSide.includes('Eave');
        const geo = eave ? eaveSurfaces(lt, overhangFt, walls) : gableSurfaces(lt, overhangFt, walls);

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

const TRIM_T = 0.045; // ~0.5" trim metal thickness
const CORNER_F = 0.26; // ~3" visible corner face per side

/**
 * All finish trim for one single-slope lean-to, built in a LOCAL frame and
 * mapped to world via `toPt(across, up, run)`:
 *   - across : inner (at building, high) → outer (free edge, low)
 *   - run    : along the eave length
 *   - up     : world Y
 * `eaveIsZ` is true when the eave runs along world Z (eave-attached) — it only
 * affects how axis-aligned box SIZES map to world axes.
 *
 * Produces: clean eave fascia + drip, two rake boards, and folded-L corner
 * posts (the white vertical caps IdeaRoom shows at every corner).
 */
function leanToTrim(
  outerAcrossOh: number, // drip lip across-position (with overhang)
  lipUp: number, // drip lip height (roof edge, lifted)
  innerAcross: number, // inner high edge across-position
  innerUp: number, // inner high edge height (lifted)
  outerAcross: number, // outer WALL across-position (post line, no overhang)
  lh: number, // low-leg (outer wall) height
  connH: number, // high (inner) height
  r0: number, // wall run start (post line)
  r1: number, // wall run end
  rf: number, // roof run start (with overhang)
  rb: number, // roof run end
  walls: { side: SideVal; front: GableVal; back: GableVal },
  toPt: (across: number, up: number, run: number) => Pt,
  eaveIsZ: boolean,
): BoxSpec[] {
  const specs: BoxSpec[] = [];
  const runMid = (rf + rb) / 2;
  const runLen = Math.abs(rb - rf);
  const outwardA = Math.sign(outerAcross - innerAcross) || -1;

  // Axis-aligned box sized in the local (across, up, run) frame → world.
  const box = (across: number, up: number, run: number, sAcross: number, sUp: number, sRun: number, dark = false): BoxSpec => ({
    pos: toPt(across, up, run),
    size: eaveIsZ ? [sAcross, sUp, sRun] : [sRun, sUp, sAcross],
    dark,
  });

  const TUCK = 0.12; // recess trim inboard so the roof panel OVERHANGS it

  // ── Eave fascia: a clean board TUCKED under the eave so the roof hangs over
  // it (recessed inboard + dropped below the drip lip), plus a thin dark drip. ──
  specs.push(box(outerAcrossOh - outwardA * TUCK, lipUp - FASCIA_H / 2 - 0.03, runMid, TRIM_T, FASCIA_H, runLen));
  specs.push(box(outerAcrossOh - outwardA * (TUCK * 0.4), lipUp - 0.07, runMid, 0.05, 0.04, runLen, true));

  // ── Rake boards: follow each gable-end roof slope, tucked UNDER the roof so
  // the gable edge overhangs them (recessed inboard along the run + dropped). ──
  const dA = innerAcross - outerAcrossOh;
  const dU = innerUp - lipUp;
  const rakeLen = Math.hypot(dA, dU);
  const ang = Math.atan2(dU, dA);
  const midA = (outerAcrossOh + innerAcross) / 2;
  const midU = (lipUp + innerUp) / 2;
  for (const end of [rf, rb] as const) {
    const tuckedRun = end + Math.sign(runMid - end) * TUCK;
    specs.push({
      pos: toPt(midA, midU - RAKE_H / 2 + 0.02, tuckedRun),
      size: eaveIsZ ? [rakeLen, RAKE_H, TRIM_T] : [TRIM_T, RAKE_H, rakeLen],
      rot: eaveIsZ ? [0, 0, ang] : [-ang, 0, 0],
    });
  }

  // ── Vertical corner posts (folded-L white flashing) ──
  // A post wraps a corner with a face on each adjacent wall + a 45° bevel.
  const post = (across: number, run: number, outA: number, outR: number, h: number, sideFace: boolean, gableFace: boolean) => {
    const f = CORNER_F;
    const t = TRIM_T;
    // face on the long SIDE wall (plane across=const, thin in across, extends in run)
    if (sideFace) specs.push(box(across + outA * (OUT + t / 2), h / 2, run - outR * (f / 2), t, h, f));
    // face on the GABLE end (plane run=const, thin in run, extends in across)
    if (gableFace) specs.push(box(across - outA * (f / 2), h / 2, run + outR * (OUT + t / 2), f, h, t));
    // 45° bevel across the corner notch (only meaningful when both faces meet)
    if (sideFace && gableFace) {
      const wOutX = eaveIsZ ? outA : outR;
      const wOutZ = eaveIsZ ? outR : outA;
      specs.push({
        pos: toPt(across + outA * (OUT / 2), h / 2, run + outR * (OUT / 2)),
        size: [OUT * 1.6, h, t],
        rot: [0, Math.atan2(-wOutZ, -wOutX), 0],
      });
    }
  };

  const sideClosed = walls.side === 'closed';
  const frontClosed = walls.front === 'closed';
  const backClosed = walls.back === 'closed';
  // outward run sign at each end (toward the free gable end)
  const outR0 = Math.sign(r0 - (r0 + r1) / 2) || -1;
  const outR1 = Math.sign(r1 - (r0 + r1) / 2) || 1;

  // Outer corners (cap the side-wall ends) — height = low leg.
  if (sideClosed || frontClosed) post(outerAcross, r0, outwardA, outR0, lh, sideClosed, frontClosed);
  if (sideClosed || backClosed) post(outerAcross, r1, outwardA, outR1, lh, sideClosed, backClosed);
  // Inner corners (gable meets building) — full height, just the gable-edge cap.
  if (frontClosed) post(innerAcross, r0, -outwardA, outR0, connH, false, true);
  if (backClosed) post(innerAcross, r1, -outwardA, outR1, connH, false, true);

  return specs;
}

/** EAVE-attached (Left/Right): walls vary in X, length runs along Z. */
function eaveSurfaces(lt: LeanToStructure, oh: number, walls: { side: SideVal; front: GableVal; back: GableVal }): SurfaceSet {
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

  const trim = leanToTrim(
    outerXoh, lhOh + roofLiftY, innerX, connH + roofLiftY,
    outerX, lh, connH, z0, z1, zf, zb,
    walls, (a, u, r) => [a, u, r], true,
  );

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
function gableSurfaces(lt: LeanToStructure, oh: number, walls: { side: SideVal; front: GableVal; back: GableVal }): SurfaceSet {
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
  const trim = leanToTrim(
    outerZoh, lhOh + roofLiftY, innerZ, connH + roofLiftY,
    outerZ, lh, connH, x0, x1, xf, xb,
    walls, (a, u, r) => [r, u, a], false,
  );

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
