import { useMemo } from 'react';
import * as THREE from 'three';
import { ROOF_LIFT, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { BuildingColors, PanelOrientation, Wainscot } from '@/types/building';
import { swatchHex, isMetallic } from '@/config/colors';
import { createCorrugatedTexture, type RibDirection } from './textures';

interface SidingProps {
  structure: StructureModel;
  wallOrientation: PanelOrientation;
  roofOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

const TILE = 3; // feet per texture tile (≈2 ribs/ft)

/**
 * Sheet-metal skin. Panels sit OUTSIDE the framing (SHEET_OUTSET) so steel
 * never pokes through; rib direction is baked per orientation (walls follow
 * the chosen orientation, roof ribs always run up the slope).
 */
export function Siding({ structure, wallOrientation, roofOrientation, colors, wainscot }: SidingProps) {
  const { width: W, length: L, legHeight: H, peakHeight, rise, rafterLength, enclosure } = structure;
  const halfW = W / 2;
  const halfL = L / 2;

  const wallDir: RibDirection = wallOrientation === 'Vertical' ? 'vertical' : 'horizontal';
  const roofDir: RibDirection = roofOrientation === 'Vertical' ? 'vertical' : 'horizontal';

  const tex = useMemo(
    () => ({
      roof: createCorrugatedTexture(swatchHex(colors.roof), roofDir),
      walls: createCorrugatedTexture(swatchHex(colors.walls), wallDir),
      wainscot: createCorrugatedTexture(swatchHex(colors.wainscot), wallDir),
    }),
    [colors.roof, colors.walls, colors.wainscot, wallDir, roofDir],
  );

  // base: which texture set; rx/ry: repeat (caller computes by geometry UVs)
  const makeMat = useMemo(
    () =>
      (
        base: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture },
        rx: number,
        ry: number,
        metallic: boolean,
      ): THREE.MeshStandardMaterial => {
        const map = base.map.clone();
        const bump = base.bump.clone();
        map.needsUpdate = bump.needsUpdate = true;
        map.repeat.set(rx, ry);
        bump.repeat.set(rx, ry);
        // Powder-coated steel = painted DIELECTRIC, not bare mirror metal. Keep
        // metalness ~0 and roughness high so the true paint COLOR reads (a black
        // roof stays black) instead of mirroring the environment into a sheen.
        // NOTE: no roughnessMap — a mid-gray map would halve roughness → gloss.
        return new THREE.MeshStandardMaterial({
          map,
          bumpMap: bump,
          bumpScale: 0.03,
          metalness: metallic ? 0.25 : 0.0,
          roughness: metallic ? 0.6 : 0.9,
          envMapIntensity: 0.15,
          side: THREE.DoubleSide,
        });
      },
    [],
  );

  // Repeat = one 3' sheet module per tile, so 36" seams land correctly.
  const M = TILE; // 3 ft
  const roofMetal = isMetallic(colors.roof);
  const wallMetal = isMetallic(colors.walls);
  const wainMetal = isMetallic(colors.wainscot);

  const planeMat = (base: typeof tex.walls, w: number, h: number, dir: RibDirection, metallic: boolean) =>
    dir === 'horizontal'
      ? makeMat(base, 1, Math.max(1, h / M), metallic) // horizontal ribs only — no vertical grid
      : makeMat(base, Math.max(1, w / M), 1, metallic); // vertical ribs only — no horizontal grid
  const shapeMat = (base: typeof tex.walls, _dir: RibDirection, metallic: boolean) =>
    makeMat(base, 1 / M, 1 / M, metallic); // gable UVs are in feet → one module per 3 ft

  // Lift the roof just enough to clear the rafters (small → eave sits right on
  // the wall top so the eave trim closes the joint with no floating gap).
  const nL = new THREE.Vector3(-rise, halfW, 0).normalize().multiplyScalar(ROOF_LIFT);
  const nR = new THREE.Vector3(rise, halfW, 0).normalize().multiplyScalar(ROOF_LIFT);
  // Roof overhang `oh` ft horizontal past the wall on every side.
  const oh = structure.roofOverhangFt;
  const slopeExt = oh * (rafterLength / Math.max(halfW, 0.001)); // eave overhang along the slope
  const roofLen = L + 2 * oh; // gable-end overhang
  const vL = new THREE.Vector3(halfW, rise, 0).normalize(); // up-slope, left
  const vR = new THREE.Vector3(-halfW, rise, 0).normalize(); // up-slope, right
  const roofH = rafterLength + slopeExt;
  const roofCL: [number, number, number] = [-halfW / 2 + nL.x - (vL.x * slopeExt) / 2, (H + peakHeight) / 2 + nL.y - (vL.y * slopeExt) / 2, 0];
  const roofCR: [number, number, number] = [halfW / 2 + nR.x - (vR.x * slopeExt) / 2, (H + peakHeight) / 2 + nR.y - (vR.y * slopeExt) / 2, 0];

  const side = enclosure.sideZ;
  const sideSpan = side ? side.end - side.start : 0;
  const sideMidZ = side ? (side.start + side.end) / 2 : 0;
  const wH = wainscot.enabled ? Math.min(wainscot.heightFt, H - 0.5) : 0;
  const wOut = SHEET_OUTSET + 0.02;

  return (
    <group>
      {/* Roof slopes — overhang on eaves + gable ends */}
      <BasisPanel center={roofCL} uVec={[0, 0, 1]} vVec={[halfW, rise, 0]} w={roofLen} h={roofH} material={planeMat(tex.roof, roofLen, roofH, roofDir, roofMetal)} />
      <BasisPanel center={roofCR} uVec={[0, 0, 1]} vVec={[-halfW, rise, 0]} w={roofLen} h={roofH} material={planeMat(tex.roof, roofLen, roofH, roofDir, roofMetal)} />

      {/* Side walls + wainscot — pushed out in ±X */}
      {side && (
        <>
          <BasisPanel center={[-(halfW + SHEET_OUTSET), H / 2, sideMidZ]} uVec={[0, 0, 1]} vVec={[0, 1, 0]} w={sideSpan} h={H} material={planeMat(tex.walls, sideSpan, H, wallDir, wallMetal)} />
          <BasisPanel center={[halfW + SHEET_OUTSET, H / 2, sideMidZ]} uVec={[0, 0, 1]} vVec={[0, 1, 0]} w={sideSpan} h={H} material={planeMat(tex.walls, sideSpan, H, wallDir, wallMetal)} />
          {wH > 0 && (
            <>
              <BasisPanel center={[-(halfW + wOut), wH / 2, sideMidZ]} uVec={[0, 0, 1]} vVec={[0, 1, 0]} w={sideSpan} h={wH} material={planeMat(tex.wainscot, sideSpan, wH, wallDir, wainMetal)} />
              <BasisPanel center={[halfW + wOut, wH / 2, sideMidZ]} uVec={[0, 0, 1]} vVec={[0, 1, 0]} w={sideSpan} h={wH} material={planeMat(tex.wainscot, sideSpan, wH, wallDir, wainMetal)} />
            </>
          )}
        </>
      )}

      {/* Gable end walls (+ wainscot) — closed = full, gableOnly = triangle, open = none */}
      {enclosure.front !== 'open' && (
        <EndWall z={-(halfL + SHEET_OUTSET)} W={W} H={H} peak={peakHeight} mode={enclosure.front} wallMat={shapeMat(tex.walls, wallDir, wallMetal)} gableMat={shapeMat(tex.walls, wallDir, wallMetal)} wH={enclosure.front === 'closed' ? wH : 0} wainZ={-(halfL + wOut)} wainMat={planeMat(tex.wainscot, W, wH, wallDir, wainMetal)} />
      )}
      {enclosure.back !== 'open' && (
        <EndWall z={halfL + SHEET_OUTSET} W={W} H={H} peak={peakHeight} mode={enclosure.back} wallMat={shapeMat(tex.walls, wallDir, wallMetal)} gableMat={shapeMat(tex.walls, wallDir, wallMetal)} wH={enclosure.back === 'closed' ? wH : 0} wainZ={halfL + wOut} wainMat={planeMat(tex.wainscot, W, wH, wallDir, wainMetal)} />
      )}
      {enclosure.partitionZ !== null && (
        <EndWall z={enclosure.partitionZ} W={W} H={H} peak={peakHeight} mode="closed" wallMat={shapeMat(tex.walls, wallDir, wallMetal)} gableMat={shapeMat(tex.walls, wallDir, wallMetal)} wH={0} wainZ={0} wainMat={planeMat(tex.wainscot, W, wH, wallDir, wainMetal)} />
      )}
    </group>
  );
}

function EndWall({
  z,
  W,
  H,
  peak,
  mode,
  wallMat,
  gableMat,
  wH,
  wainZ,
  wainMat,
}: {
  z: number;
  W: number;
  H: number;
  peak: number;
  mode: 'closed' | 'gableOnly' | 'open';
  wallMat: THREE.Material;
  gableMat: THREE.Material;
  wH: number;
  wainZ: number;
  wainMat: THREE.Material;
}) {
  if (mode === 'open') return null;
  return (
    <group>
      {mode === 'closed' ? (
        <GablePanel z={z} halfW={W / 2} H={H} peak={peak} material={wallMat} />
      ) : (
        // gable-only: just the triangle above eave height
        <GableTriangle z={z} halfW={W / 2} H={H} peak={peak} material={gableMat} />
      )}
      {wH > 0 && (
        <mesh position={[0, wH / 2, wainZ]} material={wainMat}>
          <planeGeometry args={[W, wH]} />
        </mesh>
      )}
    </group>
  );
}

function GableTriangle({
  z,
  halfW,
  H,
  peak,
  material,
}: {
  z: number;
  halfW: number;
  H: number;
  peak: number;
  material: THREE.Material;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-halfW, H);
    shape.lineTo(halfW, H);
    shape.lineTo(0, peak);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [halfW, H, peak]);
  return <mesh position={[0, 0, z]} geometry={geometry} material={material} castShadow receiveShadow />;
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

function GablePanel({
  z,
  halfW,
  H,
  peak,
  material,
}: {
  z: number;
  halfW: number;
  H: number;
  peak: number;
  material: THREE.Material;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-halfW, 0);
    shape.lineTo(halfW, 0);
    shape.lineTo(halfW, H);
    shape.lineTo(0, peak);
    shape.lineTo(-halfW, H);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    return g;
  }, [halfW, H, peak]);

  return <mesh position={[0, 0, z]} geometry={geometry} material={material} castShadow receiveShadow />;
}
