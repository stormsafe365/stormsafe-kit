import { useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { SHEET_OUTSET, COMPONENT_OUTSET, type LeanToStructure, type StructureModel, type Vec3 } from '@/engine/geometry';
import { leanToWallSettings, rendersLeanToFixture, type LeanToStorageSpan } from '@/engine/leanToFixtures';
import { clampPartitionCenter, partitionGeom } from '@/engine/partitionFit';
import type { BuildingColors, LeanToOpening, OpeningType, PanelOrientation, Wainscot } from '@/types/building';
import { swatchHex, isMetallic, printPanelKey } from '@/config/colors';
import { TRUSS_CLEARANCE_FT } from '@/config/constants';
import { useBuildingStore } from '@/store/useBuildingStore';
import { useEditorStore } from '@/store/useEditorStore';
import { createCorrugatedTexture, type RibDirection } from './textures';
import { stripsAround, type LocalRect } from './Siding';
import { OpeningFixture } from './OpeningFixture';
import { GuideLine, Measure, Chip3D, ftIn, RED, RED_DIM } from './Openings';
import { CLICK_DRAG_THRESHOLD_PX } from './openingAnim';
import { interiorRoom, partTakesPress } from './interiorView';
import { EnhancedFixture } from './enhanced/fixtures';
import { fixtureFaceZ } from './enhanced/fixtureLayout';

const COMP_PROUD = COMPONENT_OUTSET - SHEET_OUTSET; // component standoff past the wall sheeting

interface LeanToSidingProps {
  /** The main building — its walk-in Interior room decides which parts take a press (partTakesPress). */
  structure: StructureModel;
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
/**
 * A trim board: position, size, optional Euler rotation, and whether it's the dark drip edge.
 * `hideInside`: the board sits inside the main building's wall line (hidden behind the
 * cladding from outside), so it is not drawn while the walk-in Interior view is on.
 */
type BoxSpec = { pos: Pt; size: [number, number, number]; rot?: [number, number, number]; dark?: boolean; hideInside?: boolean };

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
export function LeanToSiding({ structure, leanTos, wallOrientation, roofOrientation, colors, wainscot, overhangFt, trimColor }: LeanToSidingProps) {
  const wallDir: RibDirection = wallOrientation === 'Vertical' ? 'vertical' : 'horizontal';
  const roofDir: RibDirection = roofOrientation === 'Vertical' ? 'vertical' : 'horizontal';

  // Trim materials — painted dielectric face + cut-edge drip strip. The drip
  // edge follows the selected trim color too (default trim is Black, so it
  // still reads dark out of the box), with a more metallic finish so the
  // folded edge reads as its own piece.
  const trimMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.0, roughness: 0.52, envMapIntensity: 0.25 }),
    [trimColor],
  );
  const edgeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: trimColor, metalness: 0.35, roughness: 0.55 }),
    [trimColor],
  );

  const tex = useMemo(
    () => ({
      roof: createCorrugatedTexture(swatchHex(colors.roof), roofDir),
      underRoof: createCorrugatedTexture(swatchHex('GALVALUME'), roofDir),
      walls: createCorrugatedTexture(swatchHex(colors.walls), wallDir),
      wainscot: createCorrugatedTexture(swatchHex(colors.wainscot), wallDir, printPanelKey(colors.wainscot) ?? undefined),
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
  // Walk-in Interior view: hide trim that only sits inside the main wall line.
  const interiorOn = useEditorStore((s) => s.interiorView);

  return (
    <group>
      {leanTos.map((lt) => {
        const walls = resolveWalls(lt);
        const { side, front, back } = walls;
        const eave = lt.attachedSide.includes('Eave');
        const geo = eave ? eaveSurfaces(lt, overhangFt, walls) : gableSurfaces(lt, overhangFt, walls);
        // Storage section (VIEW-ONLY): the closed stretch of an open / partial
        // outer wall, the rest of that wall's band, and the partition's openings.
        const stor = storageRuns(geo);
        const shownOuter = lt.openings.filter((o) => o.wall === 'outer' && rendersLeanToFixture(o, walls));
        const partitionOps = lt.openings.filter((o) => o.wall === 'partition' && rendersLeanToFixture(o, walls));

        return (
          <group key={lt.id}>
            {/* Roof — ALWAYS. Top skin (colored) + galvalume underside. */}
            <PolyPanel corners={geo.roofTop} uvs={geo.roofUV} material={polyMat(tex.roof, roofMetal, true)} />
            <PolyPanel corners={geo.roofUnder} uvs={geo.roofUV} material={polyMat(tex.underRoof, true, true)} />

            {/* Eave fascia + rake trim following the roof overhang */}
            {geo.trim.map((b, i) => (
              <mesh key={`trim-${i}`} position={b.pos} rotation={b.rot ?? [0, 0, 0]} material={b.dark ? edgeMat : trimMat} visible={!(b.hideInside && interiorOn)} castShadow receiveShadow>
                <boxGeometry args={b.size} />
              </mesh>
            ))}

            {/* Outer long wall — when fully closed, cut around any outer-wall
                openings; otherwise render the partial/panel wall as before. */}
            {side === 'closed'
              ? cutOuterWall(geo, lt.lowLegHeightFt, lt.openings.filter((o) => o.wall === 'outer')).map((p, i) => (
                  <PolyPanel key={`side-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.walls, wallMetal, false)} />
                ))
              : side !== 'open' &&
                sideWallPolys(geo, side, lt.lowLegHeightFt, lt.openings.filter((o) => o.wall === 'outer'), stor?.band).map((p, i) => (
                  <PolyPanel key={`side-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.walls, wallMetal, false)} />
                ))}
            {/* Storage stretch of an open / partial outer wall: closed floor to
                eave, cut around the openings drawn on it. */}
            {side !== 'closed' &&
              stor &&
              wallBandStrips(geo, 0, lt.lowLegHeightFt, shownOuter, 0, stor.seg).map((p, i) => (
                <PolyPanel key={`stor-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.walls, wallMetal, false)} />
              ))}

            {/* Wainscot band on the outer wall (only when the wall is fully
                closed) — cut around openings reaching into it, like the main
                building's wainscot. */}
            {side === 'closed' &&
              wH > 0 &&
              wallBandStrips(geo, 0, wH, lt.openings.filter((o) => o.wall === 'outer'), 0.02).map((p, i) => (
                <PolyPanel key={`wain-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.wainscot, wainMetal, false)} />
              ))}
            {side !== 'closed' &&
              stor &&
              wH > 0 &&
              wallBandStrips(geo, 0, wH, shownOuter, 0.02, stor.seg).map((p, i) => (
                <PolyPanel key={`swain-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.wainscot, wainMetal, false)} />
              ))}

            {/* Gable ends — cut around their openings when closed */}
            <GableEnd geo={geo} which="front" val={front} openings={lt.openings.filter((o) => o.wall === 'front')} material={polyMat(tex.walls, wallMetal, false)} />
            <GableEnd geo={geo} which="back" val={back} openings={lt.openings.filter((o) => o.wall === 'back')} material={polyMat(tex.walls, wallMetal, false)} />

            {/* Wainscot band on a CLOSED gable end (matches the main building's
                gable-end wainscot — only when the end is fully sheeted), cut
                around that wall's openings. */}
            {front === 'closed' &&
              wH > 0 &&
              gableWainscotStrips(geo, 'front', wH, lt.openings.filter((o) => o.wall === 'front')).map((p, i) => (
                <PolyPanel key={`fgw-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.wainscot, wainMetal, false)} />
              ))}
            {back === 'closed' &&
              wH > 0 &&
              gableWainscotStrips(geo, 'back', wH, lt.openings.filter((o) => o.wall === 'back')).map((p, i) => (
                <PolyPanel key={`bgw-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.wainscot, wainMetal, false)} />
              ))}

            {/* Storage PARTITION: a closed end-wall trapezoid across the
                lean-to (low leg at the outer edge up to the connection at the
                main wall), its face toward the open part, cut around its
                openings; wainscot like a closed end. */}
            {geo.gable.partition && (
              <GableEnd geo={geo} which="partition" val="closed" openings={partitionOps} material={polyMat(tex.walls, wallMetal, false)} />
            )}
            {geo.gable.partition &&
              wH > 0 &&
              gableWainscotStrips(geo, 'partition', wH, partitionOps).map((p, i) => (
                <PolyPanel key={`pgw-${i}`} corners={p.corners} uvs={p.uvs} material={polyMat(tex.wainscot, wainMetal, false)} />
              ))}

            {/* Wainscot cap/divider trim — same ~2" bar the main building runs
                along the top of its wainscot, broken around openings. */}
            {wH > 0 &&
              leanToWainscotCaps(geo, wH, walls, lt.openings).map((bar, i) => (
                <mesh key={`wcap-${i}`} position={bar.pos} material={trimMat} castShadow receiveShadow>
                  <boxGeometry args={bar.size} />
                </mesh>
              ))}

            {/* Door / window / roll-up / frame-out fixtures (matches the
                main-building fixture exactly via the shared component). The
                visibility rule is `rendersLeanToFixture` — named and unit
                tested, because inlining it here is what let frame-outs on an
                OPEN wall vanish (the opening cut pulls the post either way, so
                suppressing the frame left an empty bay). */}
            {lt.openings
              .filter((o) => rendersLeanToFixture(o, walls))
              .map((o) => (
                <DraggableLeanToOpening key={`of-${o.id}`} geo={geo} lt={lt} building={structure} opening={o} trimColor={trimColor} />
              ))}
          </group>
        );
      })}
    </group>
  );
}

// ── Wall-setting resolution ────────────────────────────────────────────────
export type GableVal = 'open' | 'halfEnd' | 'gable' | 'q1' | 'q2' | 'q3' | 'closed';
/** Roof-down band coverage for the fractional end closures. */
const GABLE_BAND_FRAC: Partial<Record<GableVal, number>> = { q1: 0.25, q2: 0.5, q3: 0.75 };
export type SideVal = string; // open | closed | q1 | q2 | q3 | 1panel … 5panel (CCI: 4 / 5 panels at 13'+ / 16' lean heights)

/** Resolved lean-to walls (+ its storage section, when it has one). */
export interface LtWalls {
  side: SideVal;
  front: GableVal;
  back: GableVal;
  storage?: LeanToStorageSpan;
}

/**
 * The lean-to's wall closures — leanToWallSettings, the one rule (a storage
 * section closes its end wall and rides along as `storage`).
 */
export function resolveWalls(lt: LeanToStructure): LtWalls {
  return leanToWallSettings(lt) as LtWalls;
}

/** Height of the outer wall's eave-down sheeting band for a side setting (the whole low leg when closed / unknown). */
export function sideBandHeight(side: SideVal, lh: number): number {
  if (side === 'q1') return lh * 0.25;
  if (side === 'q2') return lh * 0.5;
  if (side === 'q3') return lh * 0.75;
  const m = /^(\d)panel$/.exec(side);
  if (m) return Math.min(lh, parseInt(m[1], 10) * 3); // N × 3' panels DOWN from the eave
  return lh;
}

/** A wall of end-wall type: the two run ends, or the storage partition. */
export type LtEndWall = 'front' | 'back' | 'partition';

/**
 * Sheet plane (world run coordinate) and outward run sign of an end-type
 * lean-to wall; null for a partition when there is no storage section. The
 * partition's sheeted face looks toward the OPEN part of the lean-to (away
 * from the storage end), like an end wall of the open part.
 */
export function endWallPlane(g: SurfaceSet['gable'], which: LtEndWall): { plane: number; outward: 1 | -1 } | null {
  if (which === 'front') return { plane: g.frontPlane, outward: -1 };
  if (which === 'back') return { plane: g.backPlane, outward: 1 };
  return g.partition ? { plane: g.partition.plane, outward: g.partition.faces } : null;
}

// ── Geometry builders ──────────────────────────────────────────────────────
// Each returns the surfaces for one lean-to in a normalized shape so the JSX
// above stays orientation-agnostic.

export interface SurfaceSet {
  roofTop: Pt[];
  roofUnder: Pt[];
  roofUV: UV[];
  trim: BoxSpec[];
  wainscot: (wH: number) => Pt[];
  wainscotUV: (wH: number) => UV[];
  // Wainscot band on a closed GABLE END (front/back), at the wall base.
  frontGableWainscot: (wH: number) => Pt[];
  frontGableWainscotUV: (wH: number) => UV[];
  backGableWainscot: (wH: number) => Pt[];
  backGableWainscotUV: (wH: number) => UV[];
  frontGable: (v: GableVal) => Pt[];
  frontGableUV: (v: GableVal) => UV[];
  backGable: (v: GableVal) => Pt[];
  backGableUV: (v: GableVal) => UV[];
  // outer wall plane info for sideWallPolys
  wall: { axis: 'z' | 'x'; plane: number; a: number; b: number };
  // gable-end geometry for cutting openings + placing fixtures
  gable: {
    kind: 'eave' | 'gable';
    innerAcross: number;
    outerAcross: number;
    lh: number;
    connH: number;
    frontPlane: number;
    backPlane: number;
    /**
     * Storage partition (only with a storage section): its sheet plane (run
     * coordinate: partition framing line + OUT toward the open part) and the
     * run direction its face looks (LeanToStorageSpan.faces).
     */
    partition?: { plane: number; faces: 1 | -1 };
  };
  /** Storage section of this lean-to (only when it has one). */
  storage?: LeanToStorageSpan;
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
  walls: LtWalls,
  toPt: (across: number, up: number, run: number) => Pt,
  eaveIsZ: boolean,
  storage?: LeanToStorageSpan,
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

  // ── Ridge/attachment flashing: caps the joint where the lean-to roof meets
  // the main building's wall (the lean-to's "ridge") — a flashing band along
  // the high edge, tight against the building face. ── It sits just INSIDE
  // the main wall's cladding (hidden by it from outside), so from the walk-in
  // Interior view it showed as a dark band along the wall: not drawn there.
  specs.push({ ...box(innerAcross - outwardA * 0.02, innerUp + 0.07, runMid, 0.12, 0.24, runLen), hideInside: true });

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

  // The storage stretch of the outer wall is closed right to its end corner.
  const sideAt0 = sideClosed || storage?.end === 'front';
  const sideAt1 = sideClosed || storage?.end === 'back';
  // Outer corners (cap the side-wall ends) — height = low leg.
  if (sideAt0 || frontClosed) post(outerAcross, r0, outwardA, outR0, lh, sideAt0, frontClosed);
  if (sideAt1 || backClosed) post(outerAcross, r1, outwardA, outR1, lh, sideAt1, backClosed);
  // Inner corners (gable meets building) — full height, just the gable-edge cap.
  if (frontClosed) post(innerAcross, r0, -outwardA, outR0, connH, false, true);
  if (backClosed) post(innerAcross, r1, -outwardA, outR1, connH, false, true);

  // Storage PARTITION (its face looks toward the open part of the lean-to):
  // where the closed storage stretch of an open / partial outer wall ends at
  // the partition it is an OUTSIDE corner — an L post like an end corner (on
  // a partial wall its outer-wall face only runs up to the eave-down band,
  // which carries on past the partition). A fully closed outer wall meets the
  // partition inside the building: no post there. Where the partition meets
  // the main building: the gable-edge cap, full height.
  if (storage) {
    const run = storage.runAt;
    const outRp = storage.faces;
    if (walls.side === 'open') post(outerAcross, run, outwardA, outRp, lh, true, true);
    else if (!sideClosed) {
      const below = lh - sideBandHeight(walls.side, lh);
      if (below > 0.05) post(outerAcross, run, outwardA, outRp, below, true, false);
      post(outerAcross, run, outwardA, outRp, lh, false, true);
    }
    post(innerAcross, run, -outwardA, outRp, connH, false, true);
  }

  return specs;
}

/** The storage partition's sheet plane (framing line + OUT toward the open part) — only with a storage section. */
function partitionOf(lt: LeanToStructure): { partition?: { plane: number; faces: 1 | -1 } } {
  const st = lt.storage;
  return st ? { partition: { plane: st.runAt + st.faces * OUT, faces: st.faces } } : {};
}

/** EAVE-attached (Left/Right): walls vary in X, length runs along Z. */
export function eaveSurfaces(lt: LeanToStructure, oh: number, walls: LtWalls): SurfaceSet {
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
    walls, (a, u, r) => [a, u, r], true, lt.storage,
  );

  return {
    roofTop,
    roofUnder,
    roofUV,
    trim,
    wall: { axis: 'z', plane: wallX, a: z0, b: z1 },
    gable: { kind: 'eave', innerAcross: innerX, outerAcross: outerX, lh, connH, frontPlane: z0 - OUT, backPlane: z1 + OUT, ...partitionOf(lt) },
    ...(lt.storage ? { storage: lt.storage } : {}),
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
    frontGableWainscot: (wH) => { const z = (z0 - OUT) - 0.02; return [[innerX, 0, z], [outerX, 0, z], [outerX, wH, z], [innerX, wH, z]]; },
    frontGableWainscotUV: (wH) => [[innerX, 0], [outerX, 0], [outerX, wH], [innerX, wH]],
    backGableWainscot: (wH) => { const z = (z1 + OUT) + 0.02; return [[innerX, 0, z], [outerX, 0, z], [outerX, wH, z], [innerX, wH, z]]; },
    backGableWainscotUV: (wH) => [[innerX, 0], [outerX, 0], [outerX, wH], [innerX, wH]],
    frontGable: (v) => gableXY(v, innerX, outerX, lh, connH, z0 - OUT),
    frontGableUV: (v) => gableXYUV(v, innerX, outerX, lh, connH),
    backGable: (v) => gableXY(v, innerX, outerX, lh, connH, z1 + OUT),
    backGableUV: (v) => gableXYUV(v, innerX, outerX, lh, connH),
  };
}

/** GABLE-attached (Front/Back): walls vary in Z, length runs along X. */
export function gableSurfaces(lt: LeanToStructure, oh: number, walls: LtWalls): SurfaceSet {
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
    walls, (a, u, r) => [r, u, a], false, lt.storage,
  );

  return {
    roofTop,
    roofUnder,
    roofUV,
    trim,
    wall: { axis: 'x', plane: wallZ, a: x0, b: x1 },
    gable: { kind: 'gable', innerAcross: innerZ, outerAcross: outerZ, lh, connH, frontPlane: x0 - OUT, backPlane: x1 + OUT, ...partitionOf(lt) },
    ...(lt.storage ? { storage: lt.storage } : {}),
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
    frontGableWainscot: (wH) => { const x = (x0 - OUT) - 0.02; return [[x, 0, innerZ], [x, 0, outerZ], [x, wH, outerZ], [x, wH, innerZ]]; },
    frontGableWainscotUV: (wH) => [[innerZ, 0], [outerZ, 0], [outerZ, wH], [innerZ, wH]],
    backGableWainscot: (wH) => { const x = (x1 + OUT) + 0.02; return [[x, 0, innerZ], [x, 0, outerZ], [x, wH, outerZ], [x, wH, innerZ]]; },
    backGableWainscotUV: (wH) => [[innerZ, 0], [outerZ, 0], [outerZ, wH], [innerZ, wH]],
    frontGable: (v) => gableZY(v, innerZ, outerZ, lh, connH, x0 - OUT),
    frontGableUV: (v) => gableZYUV(v, innerZ, outerZ, lh, connH),
    backGable: (v) => gableZY(v, innerZ, outerZ, lh, connH, x1 + OUT),
    backGableUV: (v) => gableZYUV(v, innerZ, outerZ, lh, connH),
  };
}

// Outer long wall, honoring the side-wall setting (height fraction or panel count).
// `range` (world run coordinates) limits it to part of the wall — the stretch
// OUTSIDE a storage section (storageRuns); unset = the whole wall.
export function sideWallPolys(geo: SurfaceSet, side: SideVal, lh: number, openings: LeanToOpening[] = [], range?: [number, number]): Array<{ corners: Pt[]; uvs: UV[] }> {
  // Sheeting hangs from the EAVE (low-leg top = lh) DOWNWARD. `h` is the height
  // of the sheeted band; it fills [lh-h, lh] and the lower wall stays open.
  const h = sideBandHeight(side, lh);
  // Cut the band around any opening that reaches up into it — sheeting never
  // crosses a framed opening (same rule as the fully-closed wall / the main
  // building's open-bay panels).
  return wallBandStrips(geo, lh - h, h, openings, 0, range);
}

/**
 * Storage section on the OUTER wall, in world run coordinates: `seg` = the
 * closed storage stretch, `band` = the rest of the wall (where an open /
 * partial side setting still applies). null without a storage section.
 */
export function storageRuns(geo: SurfaceSet): { seg: [number, number]; band: [number, number] } | null {
  const st = geo.storage;
  if (!st) return null;
  const { a, b } = geo.wall;
  const seg: [number, number] = [a + st.segStart, a + st.segEnd];
  const band: [number, number] = st.end === 'front' ? [seg[1], b] : [a, seg[0]];
  return { seg, band };
}

// Outer long wall (height lh, run a..b) cut around its openings via stripsAround.
function cutOuterWall(geo: SurfaceSet, lh: number, openings: LeanToOpening[]): Array<{ corners: Pt[]; uvs: UV[] }> {
  return wallBandStrips(geo, 0, lh, openings);
}

// A horizontal sheeting band on the outer wall plane spanning [yBot, yBot+bandH],
// cut into solid strips around the openings that intersect it. `proud` shifts
// the band outward off the wall plane (e.g. the wainscot overlay sits 0.02 out).
// `range` (world run coordinates) limits the band to part of the wall; opening
// offsets are still measured from the wall start (geo.wall.a).
function wallBandStrips(geo: SurfaceSet, yBot: number, bandH: number, openings: LeanToOpening[], proud = 0, range?: [number, number]): Array<{ corners: Pt[]; uvs: UV[] }> {
  const { axis } = geo.wall;
  const a0 = geo.wall.a; // opening offsets start here
  const [a, b] = range ?? [geo.wall.a, geo.wall.b];
  if (b - a < 0.02) return [];
  const outward = Math.sign(geo.wall.plane - (geo.gable?.innerAcross ?? 0)) || 1;
  const plane = geo.wall.plane + (proud ? outward * proud : 0);
  const wallLen = b - a;
  const midRun = (a + b) / 2;
  const yMid = yBot + bandH / 2;
  const holes: LocalRect[] = openings
    .filter((o) => o.sillFt + o.heightFt > yBot + 0.01 && o.sillFt < yBot + bandH - 0.01)
    .map((o) => ({
      u: a0 + o.offsetFt - midRun,
      v: o.sillFt + o.heightFt / 2 - yMid,
      w: o.widthFt,
      h: o.heightFt,
    }));
  return stripsAround(wallLen, bandH, holes).map((st) => {
    const runC = midRun + st.u;
    const yC = yMid + st.v;
    const r0 = runC - st.w / 2;
    const r1 = runC + st.w / 2;
    const y0 = yC - st.h / 2;
    const y1 = yC + st.h / 2;
    const corners: Pt[] =
      axis === 'z'
        ? [[plane, y0, r0], [plane, y0, r1], [plane, y1, r1], [plane, y1, r0]]
        : [[r0, y0, plane], [r1, y0, plane], [r1, y1, plane], [r0, y1, plane]];
    const uvs: UV[] = [[r0, y0], [r1, y0], [r1, y1], [r0, y1]];
    return { corners, uvs };
  });
}

// Wainscot band on a closed gable end, cut around that wall's openings —
// replaces the old single uncut polygon so a door / frame-out leaves a real
// gap in the band (same rule as the main building's gable wainscot).
function gableWainscotStrips(geo: SurfaceSet, which: LtEndWall, wH: number, openings: LeanToOpening[]): Array<{ corners: Pt[]; uvs: UV[] }> {
  const g = geo.gable;
  const ep = endWallPlane(g, which);
  if (!ep) return [];
  const plane = ep.plane + ep.outward * 0.02;
  const minA = Math.min(g.innerAcross, g.outerAcross);
  const maxA = Math.max(g.innerAcross, g.outerAcross);
  const width = maxA - minA;
  const midA = (minA + maxA) / 2;
  const holes: LocalRect[] = openings
    .filter((o) => o.sillFt < wH - 0.01)
    .map((o) => ({ u: minA + o.offsetFt - midA, v: o.sillFt + o.heightFt / 2 - wH / 2, w: o.widthFt, h: o.heightFt }));
  return stripsAround(width, wH, holes).map((st) => {
    const aC = midA + st.u;
    const yC = wH / 2 + st.v;
    const a0 = aC - st.w / 2;
    const a1 = aC + st.w / 2;
    const y0 = yC - st.h / 2;
    const y1 = yC + st.h / 2;
    const corners: Pt[] =
      g.kind === 'eave'
        ? [[a0, y0, plane], [a1, y0, plane], [a1, y1, plane], [a0, y1, plane]]
        : [[plane, y0, a0], [plane, y0, a1], [plane, y1, a1], [plane, y1, a0]];
    const uvs: UV[] = [[a0, y0], [a1, y0], [a1, y1], [a0, y1]];
    return { corners, uvs };
  });
}

/** Split [start,end] into segments avoiding the cut intervals. */
function splitSegs(start: number, end: number, cuts: Array<{ a: number; b: number }>): Array<{ a: number; b: number }> {
  let segs = [{ a: Math.min(start, end), b: Math.max(start, end) }];
  for (const c of cuts) {
    const next: typeof segs = [];
    for (const s of segs) {
      if (c.b <= s.a || c.a >= s.b) { next.push(s); continue; }
      if (c.a > s.a) next.push({ a: s.a, b: c.a });
      if (c.b < s.b) next.push({ a: c.b, b: s.b });
    }
    segs = next;
  }
  return segs.filter((s) => s.b - s.a > 0.05);
}

// Wainscot cap/divider trim bars (~2") at the top of the wainscot band —
// outer wall + closed gable ends, broken around any opening that crosses the
// wainscot line (mirrors the main building's WainscotCap rule).
function leanToWainscotCaps(
  geo: SurfaceSet,
  wH: number,
  walls: LtWalls,
  openings: LeanToOpening[],
): Array<{ pos: Pt; size: [number, number, number] }> {
  const bars: Array<{ pos: Pt; size: [number, number, number] }> = [];
  const crossing = (wall: LeanToOpening['wall'], origin: number) =>
    openings
      .filter((o) => o.wall === wall && o.sillFt < wH + 0.08 && o.sillFt + o.heightFt > wH - 0.08)
      .map((o) => ({ a: origin + o.offsetFt - o.widthFt / 2, b: origin + o.offsetFt + o.widthFt / 2 }));
  const SZ = 0.16;
  // Outer wall — bar along the run at the band's proud face (on an open /
  // partial outer wall: along its closed storage stretch only).
  const stor = walls.side === 'closed' ? null : storageRuns(geo);
  if (walls.side === 'closed' || stor) {
    const { axis, a } = geo.wall;
    const [ra, rb] = stor ? stor.seg : [geo.wall.a, geo.wall.b];
    const outward = Math.sign(geo.wall.plane - geo.gable.innerAcross) || 1;
    const plane = geo.wall.plane + outward * (0.02 + SZ / 2);
    for (const s of splitSegs(ra, rb, crossing('outer', a)))
      bars.push(
        axis === 'z'
          ? { pos: [plane, wH, (s.a + s.b) / 2], size: [SZ, SZ, s.b - s.a] }
          : { pos: [(s.a + s.b) / 2, wH, plane], size: [s.b - s.a, SZ, SZ] },
      );
  }
  // Closed gable ends (+ a storage partition, always closed) — bar along the across direction.
  const g = geo.gable;
  const minA = Math.min(g.innerAcross, g.outerAcross);
  const maxA = Math.max(g.innerAcross, g.outerAcross);
  for (const which of ['front', 'back', 'partition'] as const) {
    const ep = endWallPlane(g, which);
    if (!ep || (which !== 'partition' && walls[which] !== 'closed')) continue;
    const plane = ep.plane + ep.outward * (0.02 + SZ / 2);
    for (const s of splitSegs(minA, maxA, crossing(which, minA)))
      bars.push(
        g.kind === 'eave'
          ? { pos: [(s.a + s.b) / 2, wH, plane], size: [s.b - s.a, SZ, SZ] }
          : { pos: [plane, wH, (s.a + s.b) / 2], size: [SZ, SZ, s.b - s.a] },
      );
  }
  return bars;
}

// Gable end (front/back, or the storage partition). When fully closed AND it
// has openings, cut the lower rectangle around them and keep the gable triangle
// above; otherwise render the whole trapezoid/triangle as one panel.
function cutGable(
  geo: SurfaceSet,
  which: LtEndWall,
  openings: LeanToOpening[],
): { strips: Array<{ corners: Pt[]; uvs: UV[] }>; triangle: { corners: Pt[]; uvs: UV[] } } {
  const g = geo.gable;
  const plane = endWallPlane(g, which)?.plane ?? g.backPlane;
  const minA = Math.min(g.innerAcross, g.outerAcross);
  const maxA = Math.max(g.innerAcross, g.outerAcross);
  const width = maxA - minA;
  const midA = (minA + maxA) / 2;
  const holes: LocalRect[] = openings.map((o) => ({
    u: minA + o.offsetFt - midA,
    v: o.sillFt + o.heightFt / 2 - g.lh / 2,
    w: o.widthFt,
    h: o.heightFt,
  }));
  const toCorners = (a0: number, a1: number, y0: number, y1: number): Pt[] =>
    g.kind === 'eave'
      ? [[a0, y0, plane], [a1, y0, plane], [a1, y1, plane], [a0, y1, plane]]
      : [[plane, y0, a0], [plane, y0, a1], [plane, y1, a1], [plane, y1, a0]];
  const strips = stripsAround(width, g.lh, holes).map((st) => {
    const aC = midA + st.u;
    const yC = g.lh / 2 + st.v;
    const a0 = aC - st.w / 2;
    const a1 = aC + st.w / 2;
    const y0 = yC - st.h / 2;
    const y1 = yC + st.h / 2;
    return { corners: toCorners(a0, a1, y0, y1), uvs: [[a0, y0], [a1, y0], [a1, y1], [a0, y1]] as UV[] };
  });
  // Triangle above the eave line, on the tall (inner) side.
  const tri: Pt[] =
    g.kind === 'eave'
      ? [[g.outerAcross, g.lh, plane], [g.innerAcross, g.connH, plane], [g.innerAcross, g.lh, plane]]
      : [[plane, g.lh, g.outerAcross], [plane, g.connH, g.innerAcross], [plane, g.lh, g.innerAcross]];
  const triUv: UV[] = [[g.outerAcross, g.lh], [g.innerAcross, g.connH], [g.innerAcross, g.lh]];
  return { strips, triangle: { corners: tri, uvs: triUv } };
}

function GableEnd({
  geo,
  which,
  val,
  openings,
  material,
}: {
  geo: SurfaceSet;
  which: LtEndWall;
  val: GableVal;
  openings: LeanToOpening[];
  material: THREE.Material;
}) {
  if (val === 'open') return null;
  if (which === 'partition' && !geo.gable.partition) return null;
  if (!(val === 'closed' && openings.length > 0)) {
    const corners = which === 'front' ? geo.frontGable(val) : which === 'back' ? geo.backGable(val) : partitionGable(geo, val);
    const uvs = which === 'front' ? geo.frontGableUV(val) : which === 'back' ? geo.backGableUV(val) : gableOutline(val, geo.gable.innerAcross, geo.gable.outerAcross, geo.gable.lh, geo.gable.connH);
    return <PolyPanel corners={corners} uvs={uvs} material={material} />;
  }
  const { strips, triangle } = cutGable(geo, which, openings);
  return (
    <>
      {strips.map((p, i) => (
        <PolyPanel key={`gs-${i}`} corners={p.corners} uvs={p.uvs} material={material} />
      ))}
      <PolyPanel corners={triangle.corners} uvs={triangle.uvs} material={material} />
    </>
  );
}

/** The storage partition's outline at its sheet plane (the end-wall outline, world points). */
function partitionGable(geo: SurfaceSet, v: GableVal): Pt[] {
  const g = geo.gable;
  const plane = g.partition?.plane ?? 0;
  return gableOutline(v, g.innerAcross, g.outerAcross, g.lh, g.connH).map(([a, y]) => (g.kind === 'eave' ? [a, y, plane] : [plane, y, a]) as Pt);
}

// World position + Y-rotation to mount an OpeningFixture on a lean-to wall so
// its outward face points away from the building, matching the wall plane.
// A storage PARTITION opening mounts like an end-wall one, on the partition's
// face toward the open part of the lean-to (so a hi-impact door swings out
// into it, a standard one into the storage room).
function openingPlacement(geo: SurfaceSet, opening: LeanToOpening): { pos: [number, number, number]; rotY: number } {
  const yC = opening.sillFt + opening.heightFt / 2;
  if (opening.wall === 'outer') {
    const { axis, plane, a } = geo.wall;
    const runC = a + opening.offsetFt;
    const outward = Math.sign(plane) || 1;
    return axis === 'z'
      ? { pos: [plane + outward * COMP_PROUD, yC, runC], rotY: (outward * Math.PI) / 2 }
      : { pos: [runC, yC, plane + outward * COMP_PROUD], rotY: outward > 0 ? 0 : Math.PI };
  }
  // gable end / storage partition
  const g = geo.gable;
  const ep = endWallPlane(g, opening.wall) ?? { plane: g.backPlane, outward: 1 };
  const plane = ep.plane;
  const minA = Math.min(g.innerAcross, g.outerAcross);
  const aC = minA + opening.offsetFt;
  const outward = ep.outward; // front faces the lean-to's low/run-start end
  return g.kind === 'eave'
    ? { pos: [aC, yC, plane + outward * COMP_PROUD], rotY: outward > 0 ? 0 : Math.PI }
    : { pos: [plane + outward * COMP_PROUD, yC, aC], rotY: (outward * Math.PI) / 2 };
}

/** World end points of a lean-to opening's along-wall span (its two jambs, mid height, on its mounting face) — for partTakesPress. */
export function leanToOpeningSpan(geo: SurfaceSet, opening: LeanToOpening): [Vec3, Vec3] {
  const half = opening.widthFt / 2;
  return [openingPlacement(geo, { ...opening, offsetFt: opening.offsetFt - half }).pos, openingPlacement(geo, { ...opening, offsetFt: opening.offsetFt + half }).pos];
}

// The wall plane to raycast against while dragging + how to read the along-wall
// offset from a hit point. Mirrors openingPlacement's wall math.
interface DragInfo {
  plane: THREE.Plane;
  coord: (h: THREE.Vector3) => number; // along-wall world coordinate from a hit
  start: number; // wall's left/start coordinate (offset measured from here)
  wallLen: number;
  w: number;
}
function dragInfo(geo: SurfaceSet, opening: LeanToOpening): DragInfo {
  const w = opening.widthFt;
  if (opening.wall === 'outer') {
    const { axis, plane, a, b } = geo.wall;
    return axis === 'z'
      ? { plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), -plane), coord: (h) => h.z, start: a, wallLen: b - a, w }
      : { plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -plane), coord: (h) => h.x, start: a, wallLen: b - a, w };
  }
  const g = geo.gable;
  const plane = (endWallPlane(g, opening.wall) ?? { plane: g.backPlane }).plane;
  const minA = Math.min(g.innerAcross, g.outerAcross);
  const wallLen = Math.abs(g.innerAcross - g.outerAcross);
  return g.kind === 'eave'
    ? { plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -plane), coord: (h) => h.x, start: minA, wallLen, w }
    : { plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), -plane), coord: (h) => h.z, start: minA, wallLen, w };
}

// A lean-to OpeningFixture you can grab and slide along its wall. Updates the
// store live for smooth feedback; BuildHost writes the final spot back into the
// pricing program on release (drag-end), so price + 3D stay in sync. A plain
// CLICK (< 5px) opens / closes the door, roll-up or window (view-only, like the
// main building): it never moves the part and never writes back.
export function DraggableLeanToOpening({
  geo,
  lt,
  building,
  opening,
  trimColor,
  enhanced = false,
  wallColor,
  sheeted = false,
}: {
  geo: SurfaceSet;
  lt: LeanToStructure;
  /** The main building (its walk-in Interior room: partTakesPress). */
  building: StructureModel;
  opening: LeanToOpening;
  trimColor: string;
  /** Draw the enhanced fixture (same placement / drag / click handling). */
  enhanced?: boolean;
  /** Enhanced only: wall color (reveal). */
  wallColor?: string;
  /** Enhanced only: sheeting surrounds this opening (reveal). */
  sheeted?: boolean;
}) {
  const updateLeanToOpening = useBuildingStore((s) => s.updateLeanToOpening);
  const selectLeanToOpening = useEditorStore((s) => s.selectLeanToOpening);
  const setDragging = useEditorStore((s) => s.setDragging);
  const toggleOpen = useEditorStore((s) => s.toggleOpen);
  const showSpacing = useEditorStore((s) => s.showSpacing);
  const isOpen = useEditorStore((s) => !!s.openIds[opening.id]);
  const selected = useEditorStore((s) => s.selectedLeanToOpeningId === opening.id);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const dragRef = useRef(false);

  const info = useMemo(() => dragInfo(geo, opening), [geo, opening.wall, opening.widthFt]);
  const { pos, rotY } = openingPlacement(geo, opening);

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    // Same rule as the main building (Openings.tsx): inside the walk-in
    // Interior only a part on the walls of the room you stand in takes a press
    // (partTakesPress) — a lean-to wall never is one, so from inside a press
    // where a lean-to part projects looks around instead of grabbing it. Taken:
    // `dragging` keeps the look-around off.
    if (!partTakesPress({ inside: useEditorStore.getState().interiorView, room: interiorRoom(building), span: leanToOpeningSpan(geo, opening) })) return;
    e.stopPropagation();
    selectLeanToOpening(opening.id);
    setDragging(true);
    dragRef.current = true;
    if (controls) controls.enabled = false; // pause orbit during the drag

    const oid = opening.id;
    const sx = e.nativeEvent.clientX, sy = e.nativeEvent.clientY;
    let moved = 0;
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      // Same click-vs-drag rule as the main building: under 5px is a click, which
      // must NOT move the part or write a position back (that could reprice).
      moved = Math.max(moved, Math.hypot(ev.clientX - sx, ev.clientY - sy));
      if (moved < CLICK_DRAG_THRESHOLD_PX) return;
      // A partition opening counts as moved only once it really lands on a new
      // spot (below): one with no valid spot anywhere never writes back, so its
      // program position is never replaced by the 3D's on-wall display spot.
      if (opening.wall !== 'partition' && !useEditorStore.getState().dragMoved) useEditorStore.getState().setDragMoved(true);
      const rect = gl.domElement.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(info.plane, hit)) {
        const raw = info.coord(hit) - info.start; // offset from the wall's start edge
        let off: number;
        if (opening.wall === 'partition') {
          // Storage partition: the main gable end's fit rules (corner posts,
          // header at the low jamb, 1' between openings) — never into a spot
          // that breaks them (the program checks the same spots).
          // Main eave (the program's bh = store legHeight): a connection point above it
          // makes the partition flatter (partitionGeom), exactly as the program reads it.
          const bs = useBuildingStore.getState();
          const cur = bs.leanTos.flatMap((l) => l.openings ?? []).find((o) => o.id === oid);
          const curOff = cur?.offsetFt ?? opening.offsetFt;
          const sibs = lt.openings.filter((o) => o.wall === 'partition' && o.id !== oid);
          off = clampPartitionCenter(raw, opening, partitionGeom(lt, bs.legHeight), sibs, curOff);
          if (Math.abs(off - curOff) < 1e-9) return; // no new spot: nothing moves, nothing to write back
          if (!useEditorStore.getState().dragMoved) useEditorStore.getState().setDragMoved(true);
        } else off = Math.max(info.w / 2, Math.min(info.wallLen - info.w / 2, raw));
        updateLeanToOpening(oid, { offsetFt: off });
      }
    };
    const up = () => {
      dragRef.current = false;
      if (controls) controls.enabled = true;
      // A click opens / closes the part (never a frame-out). View-only: the
      // write-back below stays gated on a real drag (dragMoved), untouched.
      if (moved < CLICK_DRAG_THRESHOLD_PX && opening.type !== 'frameOut') toggleOpen(oid);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTimeout(() => {
        setDragging(false); // fires the writeback in BuildHost (still reads the selected id)
        selectLeanToOpening(null); // clear the highlight now the drag is done
      }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {enhanced ? (
        <group position={pos} rotation={[0, rotY, 0]}>
          <EnhancedFixture
            type={opening.type as OpeningType}
            w={opening.widthFt}
            h={opening.heightFt}
            sillHeight={opening.sillFt}
            faceZ={fixtureFaceZ('leanTo')}
            trimColor={trimColor}
            wallColor={wallColor ?? trimColor}
            color={opening.color}
            doorStyle={opening.doorStyle}
            impact={opening.impact}
            sheeted={sheeted}
            frameOutPane={false}
            isOpen={isOpen}
            onPointerDown={onDown}
          />
        </group>
      ) : (
        <OpeningFixture
          pos={pos}
          rotY={rotY}
          type={opening.type as OpeningType}
          w={opening.widthFt}
          h={opening.heightFt}
          sillHeight={opening.sillFt}
          trimColor={trimColor}
          panelColor={opening.color}
          doorStyle={opening.doorStyle}
          impact={opening.impact}
          openId={opening.id}
          onPanelPointerDown={onDown}
        />
      )}
      {selected && !showSpacing && <LeanToOpeningGuides geo={geo} lt={lt} opening={opening} />}
    </>
  );
}

/**
 * Drag-time placement guides for a lean-to OUTER-wall opening — the lean-to
 * analogue of OpeningDimensions: red spacing lines + ft-in chips to the nearest
 * neighbor and each corner, a height dimension, and vertical post/truss guides
 * that flag a collision (matching the main building's look exactly). Posts on the
 * gable ends are just the corner columns, so guides are scoped to the outer wall.
 */
function LeanToOpeningGuides({ geo, lt, opening }: { geo: SurfaceSet; lt: LeanToStructure; opening: LeanToOpening }) {
  if (opening.wall !== 'outer') return null;
  const { axis, plane, a, b } = geo.wall;
  const wallLen = b - a;
  const lh = lt.lowLegHeightFt;
  const { widthFt: w, heightFt: h, sillFt: sill, offsetFt: offset } = opening;
  const L = offset - w / 2;
  const R = offset + w / 2;
  const top = Math.min(lh - 0.2, sill + h);
  const baseY = 0.4;
  const clear = TRUSS_CLEARANCE_FT;
  const outward = Math.sign(plane) || 1;
  const PROUD = 0.25; // sit the guides just in front of the wall sheeting

  // Map an along-wall offset + height to a world point just proud of the wall.
  const pt = (off: number, y: number): Vec3 =>
    axis === 'z' ? [plane + outward * PROUD, y, a + off] : [a + off, y, plane + outward * PROUD];

  // Post positions (offsets from the wall start) near the opening + collision test.
  const trusses = lt.trussOffsets ?? [];
  const guideTrusses = trusses.filter((p) => p >= L - 1.5 && p <= R + 1.5);
  const hit = trusses.some((p) => p >= L - clear && p <= R + clear);

  // Nearest neighbor opening edge on each side of this one (same wall only).
  let leftN: number | null = null;
  let rightN: number | null = null;
  for (const o of lt.openings) {
    if (o.id === opening.id || o.wall !== 'outer') continue;
    const oL = o.offsetFt - o.widthFt / 2;
    const oR = o.offsetFt + o.widthFt / 2;
    if (oR <= L + 1e-6) leftN = Math.max(leftN ?? -Infinity, oR);
    if (oL >= R - 1e-6) rightN = Math.min(rightN ?? Infinity, oL);
  }

  return (
    <group>
      {/* Vertical post/truss guides — bright on a collision. */}
      {guideTrusses.map((p, i) => {
        const conflict = p >= L - clear && p <= R + clear;
        return (
          <GuideLine
            key={`tr-${i}`}
            a={pt(p, 0)}
            b={pt(p, lh)}
            color={conflict ? RED : RED_DIM}
            thick={conflict ? 0.07 : 0.04}
          />
        );
      })}

      {/* Distance to nearest neighbor (top). */}
      {leftN !== null && <Measure a={pt(leftN, top)} b={pt(L, top)} mid={pt((leftN + L) / 2, top)} label={ftIn(L - leftN)} />}
      {rightN !== null && <Measure a={pt(R, top)} b={pt(rightN, top)} mid={pt((R + rightN) / 2, top)} label={ftIn(rightN - R)} />}

      {/* Distance to each corner (bottom). */}
      <Measure a={pt(0, baseY)} b={pt(L, baseY)} mid={pt(L / 2, baseY)} label={ftIn(L)} />
      <Measure a={pt(R, baseY)} b={pt(wallLen, baseY)} mid={pt((R + wallLen) / 2, baseY)} label={ftIn(wallLen - R)} />

      {/* Height (red on a truss conflict). */}
      <Measure a={pt(L - 0.05, sill)} b={pt(L - 0.05, top)} mid={pt(L - 0.05, (sill + top) / 2)} label={ftIn(h)} vertical danger={hit} />

      {hit && <Chip3D at={pt(offset, Math.min(lh - 0.1, top + 0.9))} label="⚠ on truss" danger />}
    </group>
  );
}

// Gable end in the X-Y plane at constant Z (eave-attached).
// End-face outline in LOCAL (across, y) coords for a given closure value —
// shared by both attachment orientations, mapped to world by gableXY/gableZY.
//   closed  → full right trapezoid (tall inner side at the building)
//   gable   → triangle above the low-eave line
//   halfEnd → inner (tall) vertical half, floor to roof
//   q1/q2/q3 → band hanging from the roof, bottom edge at the matching
//              fraction of each side's height (sheeted area = exact fraction)
export function gableOutline(v: GableVal, inner: number, outer: number, lh: number, connH: number): UV[] {
  if (v === 'gable') {
    return [
      [inner, lh],
      [outer, lh],
      [inner, connH],
    ];
  }
  if (v === 'halfEnd') {
    const mid = (inner + outer) / 2;
    // Half End (per Sensei): the OUTER (low) half is sheeted floor-to-roof and
    // the tall inner half stays open as a drive-in next to the building, with
    // a header band above the opening (from the low-eave line to the roof).
    // Vertex order starts at the concave corner so PolyPanel's fan
    // triangulation stays inside the outline.
    return [
      [mid, lh],
      [mid, 0],
      [outer, 0],
      [outer, lh],
      [inner, connH],
      [inner, lh],
    ];
  }
  const f = GABLE_BAND_FRAC[v];
  if (f) {
    return [
      [inner, (1 - f) * connH],
      [outer, (1 - f) * lh],
      [outer, lh],
      [inner, connH],
    ];
  }
  // Full trapezoid (closed).
  return [
    [inner, 0],
    [outer, 0],
    [outer, lh],
    [inner, connH],
  ];
}

function gableXY(v: GableVal, innerX: number, outerX: number, lh: number, connH: number, z: number): Pt[] {
  return gableOutline(v, innerX, outerX, lh, connH).map(([a, y]) => [a, y, z] as Pt);
}
function gableXYUV(v: GableVal, innerX: number, outerX: number, lh: number, connH: number): UV[] {
  return gableOutline(v, innerX, outerX, lh, connH);
}

// Gable end in the Z-Y plane at constant X (gable-attached).
function gableZY(v: GableVal, innerZ: number, outerZ: number, lh: number, connH: number, x: number): Pt[] {
  return gableOutline(v, innerZ, outerZ, lh, connH).map(([a, y]) => [x, y, a] as Pt);
}
function gableZYUV(v: GableVal, innerZ: number, outerZ: number, lh: number, connH: number): UV[] {
  return gableOutline(v, innerZ, outerZ, lh, connH);
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
