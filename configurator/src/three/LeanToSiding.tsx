import { useMemo } from 'react';
import * as THREE from 'three';
import { SHEET_OUTSET, type LeanToStructure } from '@/engine/geometry';
import type { BuildingColors, PanelOrientation, Wainscot } from '@/types/building';
import { swatchHex, isMetallic } from '@/config/colors';
import { createCorrugatedTexture, type RibDirection } from './textures';
import { stripsAround, type LocalRect } from './Siding';

interface LeanToSidingProps {
  leanTos: LeanToStructure[];
  wallOrientation: PanelOrientation;
  roofOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

const TILE = 3; // feet per texture tile (matching Siding.tsx)
const ROOF_UNDER_GAP = 0.06;
const SHEET_OUTSET_ROOF = 0.11; // Same as ROOF_LIFT in geometry.ts

/**
 * Render roof panels for a lean-to.
 * The roof slopes from the inner post (connection to building) down to the outer post.
 * Always rendered, regardless of enclosure mode — roof is essential structural covering.
 */
function LeanToRoofPanels({
  lt,
  roofDir,
  planeMat,
  tex,
  roofMetal,
  isEaveAttached,
}: {
  lt: LeanToStructure;
  roofDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  roofMetal: boolean;
  isEaveAttached: boolean;
}) {
  const { inner, outer, spanStart, spanEnd, widthFt, lowLegHeightFt, peakHeightFt, rise, lengthFt } = lt;

  if (isEaveAttached) {
    // EAVE-ATTACHED: Roof slopes from inner.x (inner post) to outer.x (outer post)
    // Roof runs along the Z axis (front-to-back), spans from spanStart to spanEnd
    const roofMidZ = (spanStart + spanEnd) / 2;
    const roofMidX = (inner.x + outer.x) / 2;
    const roofSpanZ = spanEnd - spanStart; // roof length along Z

    // Calculate slope vector and roof normal
    const slopeX = outer.x - inner.x; // how far out the roof extends
    const slopeY = lowLegHeightFt - peakHeightFt; // height difference (negative because outer is lower)
    const roofLen = Math.sqrt(slopeX * slopeX + slopeY * slopeY); // actual diagonal roof length

    // Normalize slope vectors for panel orientation
    const slopeNorm = Math.sqrt(slopeX * slopeX + slopeY * slopeY);
    const uVecSlope = [slopeX / slopeNorm, slopeY / slopeNorm, 0] as [number, number, number];
    const vVecZ = [0, 0, 1] as [number, number, number]; // along the length

    return (
      <>
        {/* Top roof panel (colored) */}
        <BasisPanel
          center={[roofMidX + SHEET_OUTSET_ROOF * slopeY / slopeNorm, (peakHeightFt + lowLegHeightFt) / 2 + SHEET_OUTSET_ROOF * slopeX / slopeNorm, roofMidZ]}
          uVec={uVecSlope}
          vVec={vVecZ}
          w={roofLen}
          h={roofSpanZ}
          material={planeMat(tex.roof, roofLen, roofSpanZ, roofDir, roofMetal, true, roofMidX, (peakHeightFt + lowLegHeightFt) / 2)}
        />
        {/* Underside roof panel (always galvalume) */}
        <BasisPanel
          center={[roofMidX + (SHEET_OUTSET_ROOF - ROOF_UNDER_GAP) * slopeY / slopeNorm, (peakHeightFt + lowLegHeightFt) / 2 + (SHEET_OUTSET_ROOF - ROOF_UNDER_GAP) * slopeX / slopeNorm, roofMidZ]}
          uVec={uVecSlope}
          vVec={vVecZ}
          w={roofLen}
          h={roofSpanZ}
          material={planeMat(tex.underRoof, roofLen, roofSpanZ, roofDir, true, true, roofMidX, (peakHeightFt + lowLegHeightFt) / 2)}
        />
      </>
    );
  } else {
    // GABLE-ATTACHED: Roof slopes from inner.z (inner post) to outer.z (outer post)
    // Roof runs along the X axis (left-to-right), spans from spanStart to spanEnd
    const roofMidX = (spanStart + spanEnd) / 2;
    const roofMidZ = (inner.z + outer.z) / 2;
    const roofSpanX = spanEnd - spanStart; // roof length along X

    const slopeZ = outer.z - inner.z;
    const slopeY = lowLegHeightFt - peakHeightFt;
    const roofLen = Math.sqrt(slopeZ * slopeZ + slopeY * slopeY);

    const slopeNorm = Math.sqrt(slopeZ * slopeZ + slopeY * slopeY);
    const uVecSlope = [slopeZ / slopeNorm, slopeY / slopeNorm, 0] as [number, number, number];
    const vVecX = [1, 0, 0] as [number, number, number]; // along X width

    return (
      <>
        {/* Top roof panel (colored) */}
        <BasisPanel
          center={[roofMidX, (peakHeightFt + lowLegHeightFt) / 2 + SHEET_OUTSET_ROOF * slopeZ / slopeNorm, roofMidZ + SHEET_OUTSET_ROOF * slopeY / slopeNorm]}
          uVec={uVecSlope}
          vVec={vVecX}
          w={roofLen}
          h={roofSpanX}
          material={planeMat(tex.roof, roofLen, roofSpanX, roofDir, roofMetal, true, roofMidX, (peakHeightFt + lowLegHeightFt) / 2)}
        />
        {/* Underside roof panel (always galvalume) */}
        <BasisPanel
          center={[roofMidX, (peakHeightFt + lowLegHeightFt) / 2 + (SHEET_OUTSET_ROOF - ROOF_UNDER_GAP) * slopeZ / slopeNorm, roofMidZ + (SHEET_OUTSET_ROOF - ROOF_UNDER_GAP) * slopeY / slopeNorm]}
          uVec={uVecSlope}
          vVec={vVecX}
          w={roofLen}
          h={roofSpanX}
          material={planeMat(tex.underRoof, roofLen, roofSpanX, roofDir, true, true, roofMidX, (peakHeightFt + lowLegHeightFt) / 2)}
        />
      </>
    );
  }
}

/**
 * Render sheet-metal panels for lean-to side walls and gable ends.
 * Each lean-to can be 'open' (roof only, no walls) or 'enclosed' (full walls).
 *
 * A lean-to is essentially half a building: it has side walls running the length
 * (or width for gable-attached) and gable end walls at the front/back (or left/right).
 * Paneling uses the same corrugated texture, rib direction, and world-anchored
 * phase offset as the main building.
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

  const makeMat = useMemo(
    () =>
      (
        base: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture },
        rx: number,
        ry: number,
        metallic: boolean,
        bumped = true,
        ox = 0,
        oy = 0,
      ): THREE.MeshStandardMaterial => {
        const map = base.map.clone();
        map.needsUpdate = true;
        map.repeat.set(rx, ry);
        map.offset.set(ox, oy);
        let bumpMap: THREE.CanvasTexture | undefined;
        if (bumped) {
          bumpMap = base.bump.clone();
          bumpMap.needsUpdate = true;
          bumpMap.repeat.set(rx, ry);
          bumpMap.offset.set(ox, oy);
        }
        return new THREE.MeshStandardMaterial({
          map,
          bumpMap,
          bumpScale: bumped ? 0.05 : 0,
          metalness: metallic ? 0.25 : 0.0,
          roughness: metallic ? 0.6 : 0.9,
          envMapIntensity: metallic ? 0.12 : 0.0,
          side: THREE.DoubleSide,
        });
      },
    [],
  );

  const M = TILE;
  const roofMetal = isMetallic(colors.roof);
  const wallMetal = isMetallic(colors.walls);
  const wainMetal = isMetallic(colors.wainscot);

  const planeMat = (
    base: typeof tex.walls,
    w: number,
    h: number,
    dir: RibDirection,
    metallic: boolean,
    bumped = false,
    anchorU = 0,
    anchorV = 0,
  ) =>
    dir === 'horizontal'
      ? makeMat(base, 1, h / M, metallic, bumped, 0, anchorV / M)
      : makeMat(base, w / M, 1, metallic, bumped, anchorU / M, 0);

  const wH = wainscot.enabled ? wainscot.heightFt : 0;
  const wOut = SHEET_OUTSET + 0.02;

  return (
    <group>
      {leanTos.map((lt) => {
        const isEaveAttached = lt.attachedSide.includes('Eave');

        return (
          <group key={lt.id}>
            {/* ROOF PANELS — Always rendered, regardless of enclosure mode */}
            <LeanToRoofPanels
              lt={lt}
              roofDir={roofDir}
              planeMat={planeMat}
              tex={tex}
              roofMetal={roofMetal}
              isEaveAttached={isEaveAttached}
            />

            {/* SIDE & GABLE WALLS — Only for 'enclosed' mode */}
            {lt.enclosure === 'enclosed' && (
              <>
                {isEaveAttached ? (
                  <>
                    {/* EAVE-ATTACHED (Left or Right) */}
                    <LeanToSideWallEave
                      lt={lt}
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                      wOut={wOut}
                    />
                    <LeanToGableEndEave lt={lt} wallDir={wallDir} planeMat={planeMat} tex={tex} wallMetal={wallMetal} />
                    {wH > 0 && (
                      <LeanToWainscotEave
                        lt={lt}
                        wH={wH}
                        wallDir={wallDir}
                        planeMat={planeMat}
                        tex={tex}
                        wainMetal={wainMetal}
                        wOut={wOut}
                      />
                    )}
                  </>
                ) : (
                  <>
                    {/* GABLE-ATTACHED (Front or Back) */}
                    <LeanToSideWallGable
                      lt={lt}
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                      wOut={wOut}
                    />
                    <LeanToGableEndGable lt={lt} wallDir={wallDir} planeMat={planeMat} tex={tex} wallMetal={wallMetal} />
                    {wH > 0 && (
                      <LeanToWainscotGable
                        lt={lt}
                        wH={wH}
                        wallDir={wallDir}
                        planeMat={planeMat}
                        tex={tex}
                        wainMetal={wainMetal}
                        wOut={wOut}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Render side wall panels for eave-attached lean-tos.
 * The side walls are vertical rectangles running along Z (front-to-back).
 */
function LeanToSideWallEave({
  lt,
  wallDir,
  planeMat,
  tex,
  wallMetal,
  wOut,
}: {
  lt: LeanToStructure;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
  wOut: number;
}) {
  const { inner, outer, spanStart, spanEnd, lowLegHeightFt, peakHeightFt } = lt;
  const wallLength = spanEnd - spanStart;
  const wallHeight = peakHeightFt;
  const wallMidZ = (spanStart + spanEnd) / 2;

  return (
    <>
      {/* Inner side (at the attachment to the building) */}
      <BasisPanel
        center={[inner.x, wallHeight / 2, wallMidZ]}
        uVec={[0, 0, 1]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wallHeight}
        material={planeMat(tex.walls, wallLength, wallHeight, wallDir, wallMetal, false, wallMidZ - wallLength / 2, 0)}
      />

      {/* Outer side (at the free end of the lean-to) */}
      <BasisPanel
        center={[outer.x, lowLegHeightFt / 2, wallMidZ]}
        uVec={[0, 0, 1]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={lowLegHeightFt}
        material={planeMat(tex.walls, wallLength, lowLegHeightFt, wallDir, wallMetal, false, wallMidZ - wallLength / 2, 0)}
      />
    </>
  );
}

/**
 * Render gable end walls for eave-attached lean-tos (trapezoid at front and back).
 * The gable ends are trapezoids: wide at the inner post (peakHeight), narrow at the outer post (lowLegHeight).
 */
function LeanToGableEndEave({
  lt,
  wallDir,
  planeMat,
  tex,
  wallMetal,
}: {
  lt: LeanToStructure;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
}) {
  const { inner, outer, spanStart, spanEnd, widthFt, lowLegHeightFt, peakHeightFt } = lt;

  // Render a trapezoid for each end (front and back)
  const avgHeight = (lowLegHeightFt + peakHeightFt) / 2;
  const midX = (inner.x + outer.x) / 2;

  return (
    <>
      {[spanStart, spanEnd].map((z) => (
        <BasisPanel
          key={`gable-eave-${z}`}
          center={[midX, avgHeight / 2, z]}
          uVec={[1, 0, 0]}
          vVec={[0, 1, 0]}
          w={widthFt}
          h={avgHeight}
          material={planeMat(tex.walls, widthFt, avgHeight, wallDir, wallMetal, false, midX - widthFt / 2, 0)}
        />
      ))}
    </>
  );
}

/**
 * Render wainscot band on eave-attached lean-to side walls.
 */
function LeanToWainscotEave({
  lt,
  wH,
  wallDir,
  planeMat,
  tex,
  wainMetal,
  wOut,
}: {
  lt: LeanToStructure;
  wH: number;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wainMetal: boolean;
  wOut: number;
}) {
  const { inner, outer, spanStart, spanEnd } = lt;
  const wallLength = spanEnd - spanStart;
  const wallMidZ = (spanStart + spanEnd) / 2;

  return (
    <>
      {/* Inner side wainscot */}
      <BasisPanel
        center={[inner.x, wH / 2, wallMidZ]}
        uVec={[0, 0, 1]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wH}
        material={planeMat(tex.wainscot, wallLength, wH, wallDir, wainMetal, false, wallMidZ - wallLength / 2, 0)}
      />

      {/* Outer side wainscot */}
      <BasisPanel
        center={[outer.x, wH / 2, wallMidZ]}
        uVec={[0, 0, 1]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wH}
        material={planeMat(tex.wainscot, wallLength, wH, wallDir, wainMetal, false, wallMidZ - wallLength / 2, 0)}
      />
    </>
  );
}

/**
 * Render side wall panels for gable-attached lean-tos.
 * The side walls are vertical rectangles running along X (left-to-right).
 */
function LeanToSideWallGable({
  lt,
  wallDir,
  planeMat,
  tex,
  wallMetal,
  wOut,
}: {
  lt: LeanToStructure;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
  wOut: number;
}) {
  const { inner, outer, spanStart, spanEnd, lowLegHeightFt, peakHeightFt } = lt;
  const wallLength = spanEnd - spanStart;
  const wallHeight = peakHeightFt;
  const wallMidX = (spanStart + spanEnd) / 2;

  return (
    <>
      {/* Inner side (at the attachment to the building) */}
      <BasisPanel
        center={[wallMidX, wallHeight / 2, inner.z]}
        uVec={[1, 0, 0]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wallHeight}
        material={planeMat(tex.walls, wallLength, wallHeight, wallDir, wallMetal, false, wallMidX - wallLength / 2, 0)}
      />

      {/* Outer side (at the free end of the lean-to) */}
      <BasisPanel
        center={[wallMidX, lowLegHeightFt / 2, outer.z]}
        uVec={[1, 0, 0]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={lowLegHeightFt}
        material={planeMat(tex.walls, wallLength, lowLegHeightFt, wallDir, wallMetal, false, wallMidX - wallLength / 2, 0)}
      />
    </>
  );
}

/**
 * Render gable end walls for gable-attached lean-tos (trapezoid at left and right).
 */
function LeanToGableEndGable({
  lt,
  wallDir,
  planeMat,
  tex,
  wallMetal,
}: {
  lt: LeanToStructure;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
}) {
  const { inner, outer, spanStart, spanEnd, widthFt, lowLegHeightFt, peakHeightFt } = lt;

  // Render a trapezoid for each end (left and right)
  const avgHeight = (lowLegHeightFt + peakHeightFt) / 2;
  const midZ = (inner.z + outer.z) / 2;

  return (
    <>
      {[spanStart, spanEnd].map((x) => (
        <BasisPanel
          key={`gable-gable-${x}`}
          center={[x, avgHeight / 2, midZ]}
          uVec={[0, 0, 1]}
          vVec={[0, 1, 0]}
          w={widthFt}
          h={avgHeight}
          material={planeMat(tex.walls, widthFt, avgHeight, wallDir, wallMetal, false, midZ - widthFt / 2, 0)}
        />
      ))}
    </>
  );
}

/**
 * Render wainscot band on gable-attached lean-to side walls.
 */
function LeanToWainscotGable({
  lt,
  wH,
  wallDir,
  planeMat,
  tex,
  wainMetal,
  wOut,
}: {
  lt: LeanToStructure;
  wH: number;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wainMetal: boolean;
  wOut: number;
}) {
  const { inner, outer, spanStart, spanEnd } = lt;
  const wallLength = spanEnd - spanStart;
  const wallMidX = (spanStart + spanEnd) / 2;

  return (
    <>
      {/* Inner side wainscot */}
      <BasisPanel
        center={[wallMidX, wH / 2, inner.z]}
        uVec={[1, 0, 0]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wH}
        material={planeMat(tex.wainscot, wallLength, wH, wallDir, wainMetal, false, wallMidX - wallLength / 2, 0)}
      />

      {/* Outer side wainscot */}
      <BasisPanel
        center={[wallMidX, wH / 2, outer.z]}
        uVec={[1, 0, 0]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wH}
        material={planeMat(tex.wainscot, wallLength, wH, wallDir, wainMetal, false, wallMidX - wallLength / 2, 0)}
      />
    </>
  );
}

/**
 * A simple basis-vector panel. Similar to the one in Siding.tsx but extracted here for reuse.
 */
function BasisPanel({
  center,
  uVec,
  vVec,
  w,
  h,
  material,
}: {
  center: [number, number, number];
  uVec: [number, number, number];
  vVec: [number, number, number];
  w: number;
  h: number;
  material: THREE.Material;
}) {
  const quaternion = useMemo(() => {
    const u = new THREE.Vector3(...uVec).normalize();
    const v = new THREE.Vector3(...vVec).normalize();
    const n = new THREE.Vector3().crossVectors(u, v).normalize();
    const m = new THREE.Matrix4().makeBasis(u, v, n);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [uVec, vVec]);

  return (
    <mesh position={center} quaternion={quaternion} material={material} receiveShadow castShadow>
      <planeGeometry args={[w, h]} />
    </mesh>
  );
}
