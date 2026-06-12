import { useMemo } from 'react';
import * as THREE from 'three';
import { ROOF_LIFT, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { BuildingColors, Opening, PanelOrientation, Wainscot, WallSide } from '@/types/building';
import { swatchHex, isMetallic } from '@/config/colors';
import { createCorrugatedTexture, type RibDirection } from './textures';

interface SidingProps {
  structure: StructureModel;
  openings: Opening[];
  wallOrientation: PanelOrientation;
  roofOrientation: PanelOrientation;
  colors: BuildingColors;
  wainscot: Wainscot;
}

/** A solid rectangle (center + size) in a wall's local 2D coords. */
export interface LocalRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

/**
 * Partition a rectangular wall (centered, `width`×`height`) into the solid
 * strips left AFTER cutting out the hole rects — full-height columns in the
 * gaps, plus above/below strips at each hole. Assumes holes don't overlap along
 * the wall (u) axis (openings on a wall don't normally overlap).
 */
export function stripsAround(width: number, height: number, holes: LocalRect[]): LocalRect[] {
  const umin = -width / 2;
  const umax = width / 2;
  const vmin = -height / 2;
  const vmax = height / 2;
  const hs = holes
    .map((h) => ({ uMin: h.u - h.w / 2, uMax: h.u + h.w / 2, vMin: h.v - h.h / 2, vMax: h.v + h.h / 2 }))
    .filter((h) => h.uMax > umin + 0.01 && h.uMin < umax - 0.01)
    .sort((a, b) => a.uMin - b.uMin);

  const out: LocalRect[] = [];
  const add = (u0: number, u1: number, v0: number, v1: number) => {
    if (u1 - u0 > 0.02 && v1 - v0 > 0.02) out.push({ u: (u0 + u1) / 2, v: (v0 + v1) / 2, w: u1 - u0, h: v1 - v0 });
  };

  let cursor = umin;
  for (const h of hs) {
    const hu0 = Math.max(umin, h.uMin);
    const hu1 = Math.min(umax, h.uMax);
    const hv0 = Math.max(vmin, h.vMin);
    const hv1 = Math.min(vmax, h.vMax);
    if (hu0 > cursor) add(cursor, hu0, vmin, vmax); // full-height column before the hole
    add(hu0, hu1, hv1, vmax); // strip above the hole
    add(hu0, hu1, vmin, hv0); // strip below the hole
    cursor = Math.max(cursor, hu1);
  }
  if (cursor < umax) add(cursor, umax, vmin, vmax);
  return out;
}

/**
 * Vertical extent of an eave-down closure band of height `bh` on a wall of
 * height `H`. Sheeting ALWAYS starts at the eave and works downward, so the band
 * fills [H-h, H] and the lower wall stays open. `bh` is clamped to [0, H] so a
 * panel option taller than the wall never overshoots the eave.
 */
export function eaveDownBand(H: number, bh: number): { bottom: number; top: number; centerY: number; height: number } {
  const h = Math.max(0, Math.min(bh, H));
  return { bottom: H - h, top: H, centerY: H - h / 2, height: h };
}

const TILE = 3; // feet per texture tile (≈2 ribs/ft)
// Vertical gap between the colored top roof skin and the galvalume underside —
// just enough that each is nearest the camera from its own side (no z-fight).
const ROOF_UNDER_GAP = 0.06;

/**
 * Sheet-metal skin. Panels sit OUTSIDE the framing (SHEET_OUTSET) so steel
 * never pokes through; rib direction is baked per orientation (walls follow
 * the chosen orientation, roof ribs always run up the slope).
 */
export function Siding({ structure, openings, wallOrientation, roofOrientation, colors, wainscot }: SidingProps) {
  const { width: W, length: L, legHeight: H, peakHeight, rise, rafterLength, enclosure } = structure;
  const halfW = W / 2;
  const halfL = L / 2;

  const wallDir: RibDirection = wallOrientation === 'Vertical' ? 'vertical' : 'horizontal';
  const roofDir: RibDirection = roofOrientation === 'Vertical' ? 'vertical' : 'horizontal';

  const tex = useMemo(
    () => ({
      roof: createCorrugatedTexture(swatchHex(colors.roof), roofDir),
      // Underside of the roof is ALWAYS bare galvalume (unpainted panel back),
      // regardless of the chosen top-side roof color.
      underRoof: createCorrugatedTexture(swatchHex('GALVALUME'), roofDir),
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
        bumped = true,
        ox = 0,
        oy = 0,
      ): THREE.MeshStandardMaterial => {
        const map = base.map.clone();
        map.needsUpdate = true;
        map.repeat.set(rx, ry);
        // World-anchored phase: offset ties the rib grid to world position so
        // panels cut around an opening keep their ribs lined up with the strips
        // beside them (RepeatWrapping handles the wrap).
        map.offset.set(ox, oy);
        // WALLS use bumped=false: a bumpMap reacts to light direction, and on a
        // back-facing wall panel (e.g. the right eave) the tangent handedness
        // flips, so the relief catches the overhead light slightly differently
        // → that wall reads as a different shade. Walls keep their rib LOOK from
        // the baked color map instead, so every side renders identically (this
        // matters for client PDFs). The roof keeps its bump (no opposite-face).
        let bumpMap: THREE.CanvasTexture | undefined;
        if (bumped) {
          bumpMap = base.bump.clone();
          bumpMap.needsUpdate = true;
          bumpMap.repeat.set(rx, ry);
          bumpMap.offset.set(ox, oy);
        }
        // Powder-coated steel = painted DIELECTRIC, not bare mirror metal.
        // NOTE: no roughnessMap — a mid-gray map would halve roughness → gloss.
        return new THREE.MeshStandardMaterial({
          map,
          bumpMap,
          // Roof is the only bumped surface — stronger relief so the vertical
          // ribs read as pronounced ridges (like IdeaRoom), not faint lines.
          bumpScale: bumped ? 0.05 : 0,
          metalness: metallic ? 0.25 : 0.0,
          roughness: metallic ? 0.6 : 0.9,
          // ZERO env on matte walls: the HDRI is directional and would tint one
          // wall vs another. Walls must be uniform across all sides (PDFs).
          envMapIntensity: metallic ? 0.12 : 0.0,
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

  // anchorU / anchorV = the WORLD coordinate of the panel's U=0 / V=0 edge
  // (along-wall start / bottom). The texture phase is locked to that world grid
  // so a strip above/below an opening lines its ribs up with the strips beside
  // it. Repeat is the exact size/M (no clamp) so the tiling is truly world-scale.
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
      ? makeMat(base, 1, h / M, metallic, bumped, 0, anchorV / M) // horizontal ribs — phase by world Y
      : makeMat(base, w / M, 1, metallic, bumped, anchorU / M, 0); // vertical ribs — phase by world along-wall
  const shapeMat = (base: typeof tex.walls, _dir: RibDirection, metallic: boolean, bumped = false) =>
    makeMat(base, 1 / M, 1 / M, metallic, bumped); // gable UVs are in feet → one module per 3 ft

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
  // Partition wainscot faces the open carport bay — offset its band toward that
  // side so it sits in front of the divider's visible (open-bay) face.
  const partWainZ =
    enclosure.partitionZ !== null
      ? enclosure.partitionZ +
        (structure.openBayZ && (structure.openBayZ.start + structure.openBayZ.end) / 2 < enclosure.partitionZ ? -wOut : wOut)
      : 0;

  // Openings projected onto a gable end wall (front/back/partition), in the
  // wall's centered local coords (u = X across the wall, v = up from mid-height).
  // Back-gable offsets mirror (measured from the wall's own left edge).
  const gableHoles = (sd: WallSide, bandH: number, onlyBelow = false): LocalRect[] =>
    openings
      .filter((o) => o.side === sd && (!onlyBelow || o.sillHeight < bandH - 0.01))
      .map((o) => ({
        u: sd === 'back' ? halfW - o.offset : -halfW + o.offset,
        v: o.sillHeight + o.height / 2 - bandH / 2,
        w: o.width,
        h: o.height,
      }));

  return (
    <group>
      {/* Roof slopes — overhang on eaves + gable ends. Each slope is a colored
          TOP panel plus a bare-galvalume UNDER panel sitting a hair below it, so
          the top reads the chosen color and the underside is always galvalume
          (the offset means whichever face you view, the right panel is nearest).*/}
      <BasisPanel center={roofCL} uVec={[0, 0, 1]} vVec={[halfW, rise, 0]} w={roofLen} h={roofH} material={planeMat(tex.roof, roofLen, roofH, roofDir, roofMetal, true)} />
      <BasisPanel center={roofCR} uVec={[0, 0, 1]} vVec={[-halfW, rise, 0]} w={roofLen} h={roofH} material={planeMat(tex.roof, roofLen, roofH, roofDir, roofMetal, true)} />
      <BasisPanel center={[roofCL[0], roofCL[1] - ROOF_UNDER_GAP, roofCL[2]]} uVec={[0, 0, 1]} vVec={[halfW, rise, 0]} w={roofLen} h={roofH} material={planeMat(tex.underRoof, roofLen, roofH, roofDir, true, true)} />
      <BasisPanel center={[roofCR[0], roofCR[1] - ROOF_UNDER_GAP, roofCR[2]]} uVec={[0, 0, 1]} vVec={[-halfW, rise, 0]} w={roofLen} h={roofH} material={planeMat(tex.underRoof, roofLen, roofH, roofDir, true, true)} />

      {/* Side walls (cut around openings so frame-outs/doors are real holes) + wainscot */}
      {side &&
        ([
          { sx: -(halfW + SHEET_OUTSET), sd: 'left' as const },
          { sx: halfW + SHEET_OUTSET, sd: 'right' as const },
        ]).map(({ sx, sd }) => {
          if (enclosure.sideOpen[sd]) return null; // program "Eave Side: Open"
          // Partial closure ("1 Panel / 2 Panels / ¼ Closed…"): the band hangs
          // from the eave DOWN; the wall below stays open. Full closed = band
          // spanning the whole height.
          const band = enclosure.sideBandFt[sd];
          const bandH = band > 0 ? Math.min(band, H) : H;
          const yBot = H - bandH;
          const holes = openings
            .filter((o) => o.side === sd && (band <= 0 || o.sillHeight + o.height > yBot + 0.01))
            .map((o) => ({ u: -halfL + o.offset - sideMidZ, v: o.sillHeight + o.height / 2 - (yBot + bandH / 2), w: o.width, h: o.height }));
          return stripsAround(sideSpan, bandH, holes).map((st, i) => (
            <BasisPanel
              key={`${sd}-${i}`}
              center={[sx, yBot + bandH / 2 + st.v, sideMidZ + st.u]}
              uVec={[0, 0, 1]}
              vVec={[0, 1, 0]}
              w={st.w}
              h={st.h}
              material={planeMat(tex.walls, st.w, st.h, wallDir, wallMetal, false, sideMidZ + st.u - st.w / 2, yBot + bandH / 2 + st.v - st.h / 2)}
            />
          ));
        })}
      {side &&
        wH > 0 &&
        ([
          { sx: -(halfW + wOut), sd: 'left' as const },
          { sx: halfW + wOut, sd: 'right' as const },
        ]).map(({ sx, sd }) => {
          // No wainscot on an open OR partially-closed (eave-down band) side —
          // the slab-level wall area is open framing there.
          if (enclosure.sideOpen[sd] || enclosure.sideBandFt[sd] > 0) return null;
          // Cut the wainscot band the same way as the wall sheeting — a floor
          // door / base-sitting frame-out leaves NO base band across it. Only
          // openings that actually reach DOWN into the band (sill below wH) cut
          // it; a high window above the wainscot leaves it intact.
          const holes = openings
            .filter((o) => o.side === sd && o.sillHeight < wH - 0.01)
            .map((o) => ({ u: -halfL + o.offset - sideMidZ, v: o.sillHeight + o.height / 2 - wH / 2, w: o.width, h: o.height }));
          return stripsAround(sideSpan, wH, holes).map((st, i) => (
            <BasisPanel
              key={`wain-${sd}-${i}`}
              center={[sx, wH / 2 + st.v, sideMidZ + st.u]}
              uVec={[0, 0, 1]}
              vVec={[0, 1, 0]}
              w={st.w}
              h={st.h}
              material={planeMat(tex.wainscot, st.w, st.h, wallDir, wainMetal, false, sideMidZ + st.u - st.w / 2, wH / 2 + st.v - st.h / 2)}
            />
          ));
        })}

      {/* Open-bay partial side panels (carport / GCH open eaves): a sheeting
          band of `eavePanelFt` height from the slab on the OPEN portion — CUT
          around openings so a frame-out on the extended carport eave reads as a
          real see-through hole, not solid sheeting behind the framed opening. */}
      {structure.openBayZ &&
        (() => {
          const ob = structure.openBayZ!;
          const span = ob.end - ob.start;
          const midZ = (ob.start + ob.end) / 2;
          if (span <= 0) return null;
          return ([
            { sx: -(halfW + SHEET_OUTSET), sd: 'left' as const, bh: Math.min(structure.eavePanelFt.left, H) },
            { sx: halfW + SHEET_OUTSET, sd: 'right' as const, bh: Math.min(structure.eavePanelFt.right, H) },
          ]).map(({ sx, sd, bh }) => {
            if (bh <= 0) return null;
            // Sheeting hangs from the EAVE downward (band fills [H-bh, H]).
            // Openings only cut the band where they reach UP into it; anything in
            // the still-open lower portion is left as see-through framing.
            const band = eaveDownBand(H, bh);
            const holes = openings
              .filter((o) => o.side === sd && o.sillHeight + o.height > band.bottom + 0.01)
              .map((o) => ({ u: -halfL + o.offset - midZ, v: o.sillHeight + o.height / 2 - band.centerY, w: o.width, h: o.height }));
            return stripsAround(span, band.height, holes).map((st, i) => (
              <BasisPanel
                key={`obp-${sd}-${i}`}
                center={[sx, band.centerY + st.v, midZ + st.u]}
                uVec={[0, 0, 1]}
                vVec={[0, 1, 0]}
                w={st.w}
                h={st.h}
                material={planeMat(tex.walls, st.w, st.h, wallDir, wallMetal, false, midZ + st.u - st.w / 2, band.centerY + st.v - st.h / 2)}
              />
            ));
          });
        })()}

      {/* Wainscot band overlaid on the open-bay partial side panels — same band
          as the enclosed sides, but capped at the eave-panel height so it never
          floats above the open-bay sheeting. */}
      {structure.openBayZ &&
        wH > 0 &&
        (() => {
          const ob = structure.openBayZ!;
          const span = ob.end - ob.start;
          const midZ = (ob.start + ob.end) / 2;
          if (span <= 0) return null;
          return ([
            { sx: -(halfW + wOut), sd: 'left' as const, bh: Math.min(structure.eavePanelFt.left, H) },
            { sx: halfW + wOut, sd: 'right' as const, bh: Math.min(structure.eavePanelFt.right, H) },
          ]).map(({ sx, sd, bh }) => {
            // Wainscot only sits where the sheeting reaches the ground (fully
            // closed). On a partial closure the lower wall is open air, so the
            // base band would float in space — suppress it on that side.
            const bandH = bh >= H - 0.01 ? Math.min(wH, bh) : 0;
            if (bandH <= 0) return null;
            const holes = openings
              .filter((o) => o.side === sd && o.sillHeight < bandH - 0.01)
              .map((o) => ({ u: -halfL + o.offset - midZ, v: o.sillHeight + o.height / 2 - bandH / 2, w: o.width, h: o.height }));
            return stripsAround(span, bandH, holes).map((st, i) => (
              <BasisPanel
                key={`obw-${sd}-${i}`}
                center={[sx, bandH / 2 + st.v, midZ + st.u]}
                uVec={[0, 0, 1]}
                vVec={[0, 1, 0]}
                w={st.w}
                h={st.h}
                material={planeMat(tex.wainscot, st.w, st.h, wallDir, wainMetal, false, midZ + st.u - st.w / 2, bandH / 2 + st.v - st.h / 2)}
              />
            ));
          });
        })()}

      {/* Gable end walls (+ wainscot) — closed = full (cut around openings),
          gableOnly = triangle, open = none */}
      {enclosure.front !== 'open' && (
        <EndWall
          z={-(halfL + SHEET_OUTSET)}
          W={W}
          H={H}
          peak={peakHeight}
          mode={enclosure.front}
          holes={gableHoles('front', H)}
          wallStripMat={(w, h, au, av) => planeMat(tex.walls, w, h, wallDir, wallMetal, false, au, av)}
          gableMat={shapeMat(tex.walls, wallDir, wallMetal)}
          wH={enclosure.front === 'closed' ? wH : 0}
          wainZ={-(halfL + wOut)}
          wainHoles={gableHoles('front', wH, true)}
          wainStripMat={(w, h, au, av) => planeMat(tex.wainscot, w, h, wallDir, wainMetal, false, au, av)}
        />
      )}
      {enclosure.back !== 'open' && (
        <EndWall
          z={halfL + SHEET_OUTSET}
          W={W}
          H={H}
          peak={peakHeight}
          mode={enclosure.back}
          holes={gableHoles('back', H)}
          wallStripMat={(w, h, au, av) => planeMat(tex.walls, w, h, wallDir, wallMetal, false, au, av)}
          gableMat={shapeMat(tex.walls, wallDir, wallMetal)}
          wH={enclosure.back === 'closed' ? wH : 0}
          wainZ={halfL + wOut}
          wainHoles={gableHoles('back', wH, true)}
          wainStripMat={(w, h, au, av) => planeMat(tex.wainscot, w, h, wallDir, wainMetal, false, au, av)}
        />
      )}
      {enclosure.partitionZ !== null && (
        <EndWall
          z={enclosure.partitionZ}
          W={W}
          H={H}
          peak={peakHeight}
          mode="closed"
          holes={gableHoles('partition', H)}
          wallStripMat={(w, h, au, av) => planeMat(tex.walls, w, h, wallDir, wallMetal, false, au, av)}
          gableMat={shapeMat(tex.walls, wallDir, wallMetal)}
          wH={wH}
          wainZ={partWainZ}
          wainHoles={gableHoles('partition', wH, true)}
          wainStripMat={(w, h, au, av) => planeMat(tex.wainscot, w, h, wallDir, wainMetal, false, au, av)}
        />
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
  holes,
  wallStripMat,
  gableMat,
  wH,
  wainZ,
  wainHoles,
  wainStripMat,
}: {
  z: number;
  W: number;
  H: number;
  peak: number;
  mode: 'closed' | 'gableOnly' | 'open' | 'halfClosed';
  /** Openings on this wall (centered local coords) to cut from the rect 0..H. */
  holes: LocalRect[];
  /** Fresh material per cut strip; (w, h, anchorU, anchorV) world-anchors ribs. */
  wallStripMat: (w: number, h: number, anchorU: number, anchorV: number) => THREE.Material;
  gableMat: THREE.Material;
  wH: number;
  wainZ: number;
  wainHoles: LocalRect[];
  wainStripMat: (w: number, h: number, anchorU: number, anchorV: number) => THREE.Material;
}) {
  if (mode === 'open') return null;
  return (
    <group>
      {mode === 'closed' && (
        // Rectangular wall 0..H, cut into strips around openings so doors and
        // framed openings are REAL holes (you see through a frame-out, a door
        // sits in a void) instead of sheeting covering the opening.
        <>
          {stripsAround(W, H, holes).map((st, i) => (
            <mesh
              key={`r-${i}`}
              position={[st.u, H / 2 + st.v, z]}
              material={wallStripMat(st.w, st.h, st.u - st.w / 2, H / 2 + st.v - st.h / 2)}
              castShadow
              receiveShadow
            >
              <planeGeometry args={[st.w, st.h]} />
            </mesh>
          ))}
        </>
      )}
      {mode === 'halfClosed' &&
        // "Half Closed (6' Panel)": a 6-ft sheeting band hanging from the eave
        // DOWN, open below — cut around any opening that reaches up into it.
        (() => {
          const B = Math.min(6, H);
          const bandHoles = holes
            .filter((ho) => H / 2 + ho.v + ho.h / 2 > H - B + 0.01)
            .map((ho) => ({ ...ho, v: ho.v - (H - B) / 2 }));
          return stripsAround(W, B, bandHoles).map((st, i) => (
            <mesh
              key={`hc-${i}`}
              position={[st.u, H - B + B / 2 + st.v, z]}
              material={wallStripMat(st.w, st.h, st.u - st.w / 2, H - B + B / 2 + st.v - st.h / 2)}
              castShadow
              receiveShadow
            >
              <planeGeometry args={[st.w, st.h]} />
            </mesh>
          ));
        })()}
      {/* Gable triangle above the eave is never crossed by an opening → keep solid. */}
      <GableTriangle z={z} halfW={W / 2} H={H} peak={peak} material={gableMat} />
      {wH > 0 &&
        stripsAround(W, wH, wainHoles).map((st, i) => (
          <mesh
            key={`w-${i}`}
            position={[st.u, wH / 2 + st.v, wainZ]}
            material={wainStripMat(st.w, st.h, st.u - st.w / 2, wH / 2 + st.v - st.h / 2)}
            castShadow
            receiveShadow
          >
            <planeGeometry args={[st.w, st.h]} />
          </mesh>
        ))}
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

