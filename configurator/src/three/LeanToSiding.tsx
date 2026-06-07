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
 * Render sheet-metal panels for lean-tos with support for multiple enclosure modes:
 * - 'open': roof only
 * - 'enclosed': roof + side walls + gable ends (all closed)
 * - 'custom': roof + per-wall settings
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

        // Determine which walls to render based on enclosure mode
        let renderFront = false, renderBack = false, renderSide = false;
        let frontType: 'open' | 'gable' | 'closed' = 'open';
        let backType: 'open' | 'gable' | 'closed' = 'open';
        let sideHeight: 'open' | 'full' | 'partial' = 'open';

        if (lt.enclosure === 'enclosed') {
          // Fully enclosed: all walls closed
          renderFront = true;
          renderBack = true;
          renderSide = true;
          frontType = 'closed';
          backType = 'closed';
          sideHeight = 'full';
        } else if (lt.enclosure === 'custom' && lt.customWalls) {
          // Custom: per-wall settings
          const cw = lt.customWalls;
          renderFront = cw.front !== 'open';
          renderBack = cw.back !== 'open';
          renderSide = cw.side !== 'open';
          frontType = (cw.front as 'open' | 'gable' | 'closed') || 'open';
          backType = (cw.back as 'open' | 'gable' | 'closed') || 'open';
          // For side, determine if full or partial
          sideHeight = cw.side === 'closed' ? 'full' : cw.side === 'open' ? 'open' : 'partial';
        }
        // else: 'open' mode, render nothing (only roof)

        return (
          <group key={lt.id}>
            {/* ROOF PANELS — Always rendered */}
            <LeanToRoofPanels
              lt={lt}
              roofDir={roofDir}
              planeMat={planeMat}
              tex={tex}
              roofMetal={roofMetal}
              isEaveAttached={isEaveAttached}
            />

            {/* SIDE WALLS & GABLE ENDS — Only if enclosure !== 'open' */}
            {renderSide || renderFront || renderBack ? (
              isEaveAttached ? (
                <>
                  {/* EAVE-ATTACHED: Left/Right side walls + Front/Back gables */}
                  {renderSide && (
                    <LeanToSideWallEave
                      lt={lt}
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                      wOut={wOut}
                      fullHeight={sideHeight === 'full'}
                    />
                  )}
                  {renderFront && (
                    <LeanToGableEndEave
                      lt={lt}
                      gableType={frontType}
                      which="front"
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                    />
                  )}
                  {renderBack && (
                    <LeanToGableEndEave
                      lt={lt}
                      gableType={backType}
                      which="back"
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                    />
                  )}
                  {wH > 0 && renderSide && sideHeight === 'full' && (
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
                  {/* GABLE-ATTACHED: Front/Back side walls + Left/Right gables */}
                  {renderSide && (
                    <LeanToSideWallGable
                      lt={lt}
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                      wOut={wOut}
                      fullHeight={sideHeight === 'full'}
                    />
                  )}
                  {renderFront && (
                    <LeanToGableEndGable
                      lt={lt}
                      gableType={frontType}
                      which="left"
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                    />
                  )}
                  {renderBack && (
                    <LeanToGableEndGable
                      lt={lt}
                      gableType={backType}
                      which="right"
                      wallDir={wallDir}
                      planeMat={planeMat}
                      tex={tex}
                      wallMetal={wallMetal}
                    />
                  )}
                  {wH > 0 && renderSide && sideHeight === 'full' && (
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
              )
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Render roof panels for a lean-to (ALWAYS rendered).
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
  const { inner, outer, spanStart, spanEnd, widthFt, lowLegHeightFt, peakHeightFt, rise } = lt;

  if (isEaveAttached) {
    const roofMidZ = (spanStart + spanEnd) / 2;
    const roofMidX = (inner.x + outer.x) / 2;
    const roofSpanZ = spanEnd - spanStart;
    const slopeX = outer.x - inner.x;
    const slopeY = lowLegHeightFt - peakHeightFt;
    const roofLen = Math.sqrt(slopeX * slopeX + slopeY * slopeY);
    const slopeNorm = roofLen;
    const uVecSlope = [slopeX / slopeNorm, slopeY / slopeNorm, 0] as [number, number, number];
    const vVecZ = [0, 0, 1] as [number, number, number];

    return (
      <>
        <BasisPanel
          center={[roofMidX + SHEET_OUTSET_ROOF * slopeY / slopeNorm, (peakHeightFt + lowLegHeightFt) / 2 + SHEET_OUTSET_ROOF * slopeX / slopeNorm, roofMidZ]}
          uVec={uVecSlope}
          vVec={vVecZ}
          w={roofLen}
          h={roofSpanZ}
          material={planeMat(tex.roof, roofLen, roofSpanZ, roofDir, roofMetal, true, roofMidX, (peakHeightFt + lowLegHeightFt) / 2)}
        />
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
    const roofMidX = (spanStart + spanEnd) / 2;
    const roofMidZ = (inner.z + outer.z) / 2;
    const roofSpanX = spanEnd - spanStart;
    const slopeZ = outer.z - inner.z;
    const slopeY = lowLegHeightFt - peakHeightFt;
    const roofLen = Math.sqrt(slopeZ * slopeZ + slopeY * slopeY);
    const slopeNorm = roofLen;
    const uVecSlope = [slopeZ / slopeNorm, slopeY / slopeNorm, 0] as [number, number, number];
    const vVecX = [1, 0, 0] as [number, number, number];

    return (
      <>
        <BasisPanel
          center={[roofMidX, (peakHeightFt + lowLegHeightFt) / 2 + SHEET_OUTSET_ROOF * slopeZ / slopeNorm, roofMidZ + SHEET_OUTSET_ROOF * slopeY / slopeNorm]}
          uVec={uVecSlope}
          vVec={vVecX}
          w={roofLen}
          h={roofSpanX}
          material={planeMat(tex.roof, roofLen, roofSpanX, roofDir, roofMetal, true, roofMidX, (peakHeightFt + lowLegHeightFt) / 2)}
        />
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

function LeanToSideWallEave({
  lt,
  wallDir,
  planeMat,
  tex,
  wallMetal,
  wOut,
  fullHeight,
}: {
  lt: LeanToStructure;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
  wOut: number;
  fullHeight: boolean;
}) {
  const { inner, outer, spanStart, spanEnd, lowLegHeightFt, peakHeightFt } = lt;
  const wallLength = spanEnd - spanStart;
  const wallMidZ = (spanStart + spanEnd) / 2;

  if (!fullHeight) return null; // Only render for full height (for now, defer partial/panel logic)

  return (
    <>
      <BasisPanel
        center={[inner.x, peakHeightFt / 2, wallMidZ]}
        uVec={[0, 0, 1]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={peakHeightFt}
        material={planeMat(tex.walls, wallLength, peakHeightFt, wallDir, wallMetal, false, wallMidZ - wallLength / 2, 0)}
      />
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

function LeanToGableEndEave({
  lt,
  gableType,
  which,
  wallDir,
  planeMat,
  tex,
  wallMetal,
}: {
  lt: LeanToStructure;
  gableType: 'open' | 'gable' | 'closed';
  which: 'front' | 'back';
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
}) {
  if (gableType === 'open') return null;

  const { inner, outer, spanStart, spanEnd, widthFt, lowLegHeightFt, peakHeightFt } = lt;
  const z = which === 'front' ? spanStart : spanEnd;
  const midX = (inner.x + outer.x) / 2;
  const avgHeight = (lowLegHeightFt + peakHeightFt) / 2;

  return (
    <BasisPanel
      center={[midX, avgHeight / 2, z]}
      uVec={[1, 0, 0]}
      vVec={[0, 1, 0]}
      w={widthFt}
      h={avgHeight}
      material={planeMat(tex.walls, widthFt, avgHeight, wallDir, wallMetal, false, midX - widthFt / 2, 0)}
    />
  );
}

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
      <BasisPanel
        center={[inner.x, wH / 2, wallMidZ]}
        uVec={[0, 0, 1]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wH}
        material={planeMat(tex.wainscot, wallLength, wH, wallDir, wainMetal, false, wallMidZ - wallLength / 2, 0)}
      />
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

function LeanToSideWallGable({
  lt,
  wallDir,
  planeMat,
  tex,
  wallMetal,
  wOut,
  fullHeight,
}: {
  lt: LeanToStructure;
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
  wOut: number;
  fullHeight: boolean;
}) {
  const { inner, outer, spanStart, spanEnd, lowLegHeightFt, peakHeightFt } = lt;
  const wallLength = spanEnd - spanStart;
  const wallMidX = (spanStart + spanEnd) / 2;

  if (!fullHeight) return null;

  return (
    <>
      <BasisPanel
        center={[wallMidX, peakHeightFt / 2, inner.z]}
        uVec={[1, 0, 0]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={peakHeightFt}
        material={planeMat(tex.walls, wallLength, peakHeightFt, wallDir, wallMetal, false, wallMidX - wallLength / 2, 0)}
      />
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

function LeanToGableEndGable({
  lt,
  gableType,
  which,
  wallDir,
  planeMat,
  tex,
  wallMetal,
}: {
  lt: LeanToStructure;
  gableType: 'open' | 'gable' | 'closed';
  which: 'left' | 'right';
  wallDir: RibDirection;
  planeMat: (base: any, w: number, h: number, dir: RibDirection, metallic: boolean, bumped?: boolean, anchorU?: number, anchorV?: number) => THREE.Material;
  tex: any;
  wallMetal: boolean;
}) {
  if (gableType === 'open') return null;

  const { inner, outer, spanStart, spanEnd, widthFt, lowLegHeightFt, peakHeightFt } = lt;
  const x = which === 'left' ? spanStart : spanEnd;
  const midZ = (inner.z + outer.z) / 2;
  const avgHeight = (lowLegHeightFt + peakHeightFt) / 2;

  return (
    <BasisPanel
      center={[x, avgHeight / 2, midZ]}
      uVec={[0, 0, 1]}
      vVec={[0, 1, 0]}
      w={widthFt}
      h={avgHeight}
      material={planeMat(tex.walls, widthFt, avgHeight, wallDir, wallMetal, false, midZ - widthFt / 2, 0)}
    />
  );
}

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
      <BasisPanel
        center={[wallMidX, wH / 2, inner.z]}
        uVec={[1, 0, 0]}
        vVec={[0, 1, 0]}
        w={wallLength}
        h={wH}
        material={planeMat(tex.wainscot, wallLength, wH, wallDir, wainMetal, false, wallMidX - wallLength / 2, 0)}
      />
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
