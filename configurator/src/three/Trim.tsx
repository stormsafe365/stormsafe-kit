import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ROOF_LIFT, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { Opening, Wainscot, WallSide } from '@/types/building';
import { lappedBoxGeometry } from './lappedBox';
import { CAPTURE_IGNORE, storagePartitionWainscot } from './Siding';
import { SteelMember } from './SteelMember';

/**
 * A corner-flashing face lying ON a wall sheet: the classic trim box, but its
 * back face (local `axis`, `sign` side) sits TRIM_LIFT inside the plate
 * instead of in the sheet's plane, where it z-fought through the sheet seen
 * from inside (dark hatched band beside the corner leg). Every face seen from
 * outside is the plain box's.
 */
function LappedTrimBox({
  pos,
  size,
  axis,
  sign,
  material,
}: {
  pos: [number, number, number];
  size: [number, number, number];
  axis: 0 | 1 | 2;
  sign: -1 | 1;
  material: THREE.Material;
}) {
  const [sx, sy, sz] = size;
  const geometry = useMemo(() => lappedBoxGeometry([sx, sy, sz], axis, sign), [sx, sy, sz, axis, sign]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh position={pos} geometry={geometry} material={material} castShadow receiveShadow />;
}

interface TrimProps {
  structure: StructureModel;
  color: string;
  wainscot: Wainscot;
  openings: Opening[];
}

/**
 * Finish trim at realistic steel-building proportions (3"–4" faces):
 *  - ridge cap, eave fascia + drip, gable rake (follow the roof overhang)
 *  - folded-L corner flashing (two faces + a beveled fold) that wraps the
 *    corner and covers the panel edges
 *  - base trim + wainscot divider trim
 */
export function Trim({ structure, color, wainscot, openings }: TrimProps) {
  const { width: W, length: L, legHeight: H, peakHeight, rise, roofOverhangFt: oh, enclosure } = structure;
  const halfW = W / 2;
  const halfL = L / 2;
  const out = SHEET_OUTSET; // sheeting outer face
  // Free-standing single-slope: one roof plane, tall (−X) eave → low (+X) eave.
  const mono = structure.monoDropFt > 0.01;
  const runW = mono ? W : halfW; // horizontal run of one roof slope
  const eaveDrop = oh * (rise / Math.max(runW, 0.001)); // eave edge drops with overhang
  const eaveX = halfW + oh; // roof drip edge (horizontal)
  const eaveY = H - eaveDrop;
  const gz = halfL + oh; // gable roof edge
  // The roof is nudged out along its normal (ROOF_LIFT); its real drip-edge sits
  // this much HIGHER than eaveY. The eave trim top must reach it or a slot opens.
  const rafterLen = Math.sqrt(runW * runW + rise * rise);
  const roofLiftY = (runW / Math.max(rafterLen, 0.001)) * ROOF_LIFT;
  /** Roof drip-edge height per eave side (−1 = tall side on a mono-slope). */
  const eaveYFor = (sx: -1 | 1): number => (mono ? (sx < 0 ? peakHeight + eaveDrop : H - eaveDrop) : eaveY);
  /** Wall/corner height per eave side (tall −X side reaches the peak on mono). */
  const cornerHFor = (sx: -1 | 1): number => (mono && sx < 0 ? peakHeight : H);

  // Painted trim = dielectric. Low metalness + low env so it shows its true
  // (usually white) color brightly instead of mirroring the dark background.
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.52, envMapIntensity: 0.25 }),
    [color],
  );
  // Cut-edge of the roof panel (the rib-ends visible at the drip/rake).
  // Follows the selected trim color (the default trim swatch is Black, so it
  // still reads dark out of the box); keeps a more metallic finish than the
  // fascia so the folded edge reads as its own piece.
  const edgeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55 }),
    [color],
  );

  const Box = ({
    pos,
    size,
    rotY = 0,
    m = mat,
  }: {
    pos: [number, number, number];
    size: [number, number, number];
    rotY?: number;
    m?: THREE.Material;
  }) => (
    <mesh position={pos} rotation={[0, rotY, 0]} material={m} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );

  // --- Folded-L corner flashing: face on each wall + a 45° beveled fold that
  // covers the panel edges and hides the corner seam. ---
  const corners: JSX.Element[] = [];
  if (enclosure.sideZ) {
    const within = (z: number) => z >= enclosure.sideZ!.start - 0.01 && z <= enclosure.sideZ!.end + 0.01;
    const f = 0.25; // ~3" visible face per side
    const tt = 0.04; // ~0.5" metal thickness
    let k = 0;
    for (const sx of [-1, 1] as const) {
      // Program "Eave Side: Open" (or a partial eave-down band) → no full-
      // height sheeting on that side wall, so no side-wall corner face or fold
      // there (an end-wall face may remain).
      const sideIsOpen =
        sx < 0
          ? enclosure.sideOpen.left || enclosure.sideBandFt.left > 0
          : enclosure.sideOpen.right || enclosure.sideBandFt.right > 0;
      const cH = cornerHFor(sx); // mono-slope: tall −X corners run to the peak
      for (const z of [-halfL, halfL] as const) {
        if (!within(z)) continue;
        const sz = z < 0 ? -1 : 1;
        const endClosed =
          (z === -halfL && enclosure.front === 'closed') || (z === halfL && enclosure.back === 'closed');
        // face on the side wall (lies on the side sheet: back face -X side for sx = +1)
        if (!sideIsOpen)
          corners.push(
            <LappedTrimBox key={`cs${k++}`} pos={[sx * (halfW + out + tt / 2), cH / 2, sz * (halfL - f / 2)]} size={[tt, cH, f]} axis={0} sign={sx < 0 ? 1 : -1} material={mat} />,
          );
        // face on the end wall (lies on the end sheet)
        if (endClosed)
          corners.push(
            <LappedTrimBox key={`ce${k++}`} pos={[sx * (halfW - f / 2), cH / 2, sz * (halfL + out + tt / 2)]} size={[f, cH, tt]} axis={2} sign={sz < 0 ? 1 : -1} material={mat} />,
          );
        // beveled fold across the corner notch (caps the side sheeting edge)
        if (!sideIsOpen)
          corners.push(
            <Box
              key={`cb${k++}`}
              pos={[sx * (halfW + out / 2), cH / 2, sz * (halfL + out / 2)]}
              size={[out * 1.5, cH, tt]}
              rotY={Math.atan2(-sz, -sx)}
            />,
          );
      }
    }
  }

  // --- Partition corner flashing: seals the gap where the interior partition
  // wall (the "additional end wall" of a utility build) meets the side walls.
  // Same folded-L as the building corners, placed at the partition Z. Only
  // drawn where the trim separates an enclosed wall from an OPEN bay — when
  // the carport extension has side paneling on that side, the wall reads as
  // one continuous panel run and gets NO transition trim. An End Storage
  // partition is an INTERIOR wall of a closed garage — no exterior flashing. ---
  if (enclosure.partitionZ !== null && enclosure.sideZ && enclosure.partitionKind !== 'storage') {
    const pz = enclosure.partitionZ;
    const f = 0.25;
    const tt = 0.04;
    // Open bay sits on the side of the partition away from the enclosed span.
    const openSign = Math.abs(pz - enclosure.sideZ.end) < 0.01 ? 1 : -1;
    let pk = 0;
    for (const sx of [-1, 1] as const) {
      const panelFt = sx < 0 ? structure.eavePanelFt.left : structure.eavePanelFt.right;
      if (panelFt > 0.01) continue; // paneled extension → continuous wall, no trim
      corners.push(
        <LappedTrimBox key={`ps${pk++}`} pos={[sx * (halfW + out + tt / 2), H / 2, pz - (openSign * f) / 2]} size={[tt, H, f]} axis={0} sign={sx < 0 ? 1 : -1} material={mat} />,
      );
      corners.push(<Box key={`pe${pk++}`} pos={[sx * (halfW - f / 2), H / 2, pz + openSign * (out / 2 + tt / 2)]} size={[f, H, tt]} />);
      corners.push(<Box key={`pb${pk++}`} pos={[sx * (halfW + out / 2), H / 2, pz + openSign * (out / 2)]} size={[out * 1.5, H, tt]} rotY={Math.atan2(-openSign, -sx)} />);
    }
  }

  const fasciaH = 0.32; // ~3.8" clean fascia face
  return (
    <group>
      {/* Ridge cap — extends to the gable overhang (a mono-slope has no ridge;
          its tall edge gets an eave fascia like the low one) */}
      {!mono && (
        <SteelMember start={[0, peakHeight + 0.05, -gz]} end={[0, peakHeight + 0.05, gz]} size={0.16} color={color} metalness={0.1} roughness={0.5} />
      )}

      {/* Eave fascia — the white board is TUCKED UNDER the roof (recessed inboard
          by `tuck`) so the roof panel edge HANGS OVER it, with the dark folded
          drip/rib-end edge at the overhanging lip. Matches IdeaRoom's overhang. */}
      {([-1, 1] as const).map((sx) => {
        const tuck = 0.11; // roof overhangs the fascia by ~1.3"
        const dY = eaveYFor(sx) + roofLiftY; // per-side drip (mono tall vs low eave)
        return (
          <group key={`eave${sx}`}>
            <Box pos={[sx * (eaveX - tuck), dY - fasciaH / 2 + 0.02, 0]} size={[0.035, fasciaH, 2 * gz]} />
            <Box pos={[sx * eaveX, dY - 0.025, 0]} size={[0.028, 0.07, 2 * gz]} m={edgeMat} />
          </group>
        );
      })}

      {/* Gable rake — a clean FLAT fascia board following each roof slope to
          the overhung edge (not a chunky square tube), hanging just below the
          roof line like IdeaRoom/Sensei. */}
      {([-gz, gz] as const).map((z, i) => {
        const boards: JSX.Element[] = [];
        const tuck = 0.11; // rake tucked inboard so the roof gable edge overhangs it
        const zRake = z - Math.sign(z) * tuck;
        // Mono-slope: ONE rake board per end, tall drip edge → low drip edge.
        const segs: Array<{ ax: number; ay: number; bx: number; by: number; key: number }> = mono
          ? [{ ax: -eaveX, ay: eaveYFor(-1) + 0.02, bx: eaveX, by: eaveYFor(1) + 0.02, key: 0 }]
          : [
              { ax: -eaveX, ay: eaveY, bx: 0, by: peakHeight + 0.02, key: -1 },
              { ax: eaveX, ay: eaveY, bx: 0, by: peakHeight + 0.02, key: 1 },
            ];
        for (const seg of segs) {
          const { ax, ay, bx, by, key: sx } = seg;
          const dx = bx - ax;
          const dy = by - ay;
          const len = Math.hypot(dx, dy);
          const ang = Math.atan2(dy, dx);
          // perpendicular pointing DOWN so the board hangs below the roof edge
          let px = dy / len;
          let py = -dx / len;
          if (py > 0) {
            px = -px;
            py = -py;
          }
          const off = 0.09;
          boards.push(
            <mesh
              key={`rk${i}_${sx}`}
              position={[(ax + bx) / 2 + px * off, (ay + by) / 2 + py * off, zRake]}
              rotation={[0, 0, ang]}
              material={mat}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[len, 0.24, 0.045]} />
            </mesh>,
          );
          // drip/rib-edge along the roof's overhanging gable edge (trim color)
          boards.push(
            <mesh
              key={`rkd${i}_${sx}`}
              position={[(ax + bx) / 2 + px * 0.01, (ay + by) / 2 + py * 0.01, z]}
              rotation={[0, 0, ang]}
              material={edgeMat}
            >
              <boxGeometry args={[len, 0.06, 0.028]} />
            </mesh>,
          );
        }
        return <group key={`rake${i}`}>{boards}</group>;
      })}

      {corners}

      {/* No base trim — wall sheeting runs to the slab (matches IdeaRoom). */}

      {/* Wainscot divider trim (~2.5") */}
      {wainscot.enabled && <WainscotCap structure={structure} color={color} heightFt={wainscot.heightFt} openings={openings} />}
    </group>
  );
}

/**
 * The inside variant of a cap bar starts this far OUTSIDE its sheet (never in
 * the sheet's plane: within a few hundredths it bleeds through the sheet's
 * panel back as a dotted line at far distances).
 */
export const CAP_SHEET_GAP = 0.03;

/** Cap bar cross-section (the classic 0.16 SteelMember). */
const CAP_SIZE = 0.16;
const UP = new THREE.Vector3(0, 1, 0);

/** A cap bar's sheet: the axis across it (0 = x, 2 = z), the side its paint looks, the sheet coordinate. */
export type CapCut = { axis: 0 | 2; sign: 1 | -1; at: number };

/**
 * The inside variant of a cap bar: the LIVE bar box (0.16 square, centred on
 * s -> e) cut CAP_SHEET_GAP outside its sheet, so nothing of it is on the
 * inside of the wall.
 */
export function capBarBox(s: [number, number, number], e: [number, number, number], cut: CapCut): { center: [number, number, number]; size: [number, number, number] } {
  const h = CAP_SIZE / 2;
  const lo: [number, number, number] = [Math.min(s[0], e[0]) - h, Math.min(s[1], e[1]) - h, Math.min(s[2], e[2]) - h];
  const hi: [number, number, number] = [Math.max(s[0], e[0]) + h, Math.max(s[1], e[1]) + h, Math.max(s[2], e[2]) + h];
  // the bar runs along one horizontal axis: only its cross axes are 0.16 wide
  const along = Math.abs(e[0] - s[0]) > Math.abs(e[2] - s[2]) ? 0 : 2;
  lo[along] += h;
  hi[along] -= h;
  const k = cut.axis;
  const inner = cut.at + cut.sign * CAP_SHEET_GAP;
  if (cut.sign > 0) lo[k] = Math.max(lo[k], inner);
  else hi[k] = Math.min(hi[k], inner);
  return {
    center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
    size: [Math.max(0, hi[0] - lo[0]), Math.max(0, hi[1] - lo[1]), Math.max(0, hi[2] - lo[2])],
  };
}

/** Is the camera on the painted side of the bar's sheet? (decides which variant draws) */
export const capSeenFromPaintedSide = (cut: CapCut, cam: { x: number; z: number }) => cut.sign * ((cut.axis === 0 ? cam.x : cam.z) - cut.at) > 0;

const _cam = new THREE.Vector3();
/** Draw this variant's material only when `want` matches the camera side (shadow + capture are unaffected). */
function sideSwitch(cut: CapCut, want: boolean) {
  return function (this: THREE.Mesh, _r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera, _g: THREE.BufferGeometry, material: THREE.Material) {
    _cam.setFromMatrixPosition(camera.matrixWorld);
    const show = capSeenFromPaintedSide(cut, _cam) === want;
    material.colorWrite = show;
    // ShellGroup owns depthWrite for the ghosted Structure / Cutaway views.
    material.depthWrite = show && !material.transparent;
  };
}

/**
 * One wainscot cap bar (panelBack.ts: the wainscot is paint on the OUTSIDE of
 * the sheet). The classic bar is a 0.16 square tube centred just off its
 * sheet, so 0.06' of it pokes through the sheet: from inside the building it
 * showed as a trim-coloured line on the wall. Two variants, chosen per draw
 * by the side of the sheet the camera is on (onBeforeRender, so the PDF
 * capture's own renders switch too):
 *  - camera on the painted side (outside): the LIVE bar, unchanged (same
 *    transform as SteelMember) — the bar meets its sheet within depth
 *    precision, so any cut there would re-shade its outside edge;
 *  - camera on the other side (inside): the bar cut CAP_SHEET_GAP outside
 *    the sheet (capBarBox), nothing of it inside the wall.
 * Only the LIVE variant casts shadows and feeds the PDF capture framing, so
 * neither changes; the inside variant is capture-ignored and casts none.
 */
function CapBar({ s, e, cut, color }: { s: [number, number, number]; e: [number, number, number]; cut: CapCut; color: string }) {
  // SteelMember's transform, verbatim (the LIVE bar).
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...s);
    const b = new THREE.Vector3(...e);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    return { position: mid, quaternion: quat, length: len };
  }, [s, e]);
  const inside = capBarBox(s, e, cut);
  const [ca, cs, cat] = [cut.axis, cut.sign, cut.at];
  const outsideOnly = useMemo(() => sideSwitch({ axis: ca, sign: cs, at: cat }, true), [ca, cs, cat]);
  const insideOnly = useMemo(() => sideSwitch({ axis: ca, sign: cs, at: cat }, false), [ca, cs, cat]);
  return (
    <>
      <mesh position={position} quaternion={quaternion} castShadow receiveShadow onBeforeRender={outsideOnly}>
        <boxGeometry args={[CAP_SIZE, length, CAP_SIZE]} />
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.42} />
      </mesh>
      <mesh position={inside.center} receiveShadow userData={CAPTURE_IGNORE} onBeforeRender={insideOnly}>
        <boxGeometry args={inside.size} />
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.42} />
      </mesh>
    </>
  );
}

function WainscotCap({
  structure,
  color,
  heightFt,
  openings,
}: {
  structure: StructureModel;
  color: string;
  heightFt: number;
  openings: Opening[];
}) {
  const { width: W, length: L, legHeight: H, enclosure } = structure;
  const halfW = W / 2;
  const halfL = L / 2;
  const o2 = SHEET_OUTSET + 0.02;
  const wy = Math.min(heightFt, H - 0.5);

  // Openings that vertically CROSS the cap line on a wall leave a gap in the
  // bar (same rule as the band sheeting: a door/frame-out is a real hole, the
  // trim doesn't run across it). `center` maps an opening to its world coord
  // along the wall's axis.
  const cutsFor = (sd: WallSide, center: (o: Opening) => number) =>
    openings
      .filter((o) => o.side === sd && o.sillHeight < wy + 0.08 && o.sillHeight + o.height > wy - 0.08)
      .map((o) => ({ a: center(o) - o.width / 2, b: center(o) + o.width / 2 }));
  const splitBar = (start: number, end: number, cuts: { a: number; b: number }[]) => {
    let segs = [{ a: Math.min(start, end), b: Math.max(start, end) }];
    for (const c of cuts) {
      const next: typeof segs = [];
      for (const s of segs) {
        if (c.b <= s.a || c.a >= s.b) {
          next.push(s);
          continue;
        }
        if (c.a > s.a) next.push({ a: s.a, b: c.a });
        if (c.b < s.b) next.push({ a: c.b, b: s.b });
      }
      segs = next;
    }
    return segs.filter((s) => s.b - s.a > 0.05);
  };

  // Each bar is drawn on the PAINTED side of its sheet only (CapBar; `cut` =
  // the sheet, the side its paint looks).
  type Bar = { s: [number, number, number]; e: [number, number, number]; cut: CapCut };
  const bars: Bar[] = [];
  const cutOf = (axis: 'x' | 'z', sign: 1 | -1, at: number): CapCut => ({ axis: axis === 'x' ? 0 : 2, sign, at });
  // Eave-side bars run along Z at x = ±(halfW + o2); openings sit at z = -halfL + offset.
  const sideBar = (sd: 'left' | 'right', zStart: number, zEnd: number) => {
    const sgn: 1 | -1 = sd === 'left' ? -1 : 1;
    const sx = sgn * (halfW + o2);
    for (const s of splitBar(zStart, zEnd, cutsFor(sd, (o) => -halfL + o.offset)))
      bars.push({ s: [sx, wy, s.a], e: [sx, wy, s.b], cut: cutOf('x', sgn, sgn * (halfW + SHEET_OUTSET)) });
  };
  // End-wall bars run along X at a fixed z; back-gable offsets mirror. `paintZ`
  // = the side of the sheet (at `sheetZ`) the paint looks.
  const endBar = (sd: WallSide, z: number, mirror: boolean, paintZ: 1 | -1, sheetZ: number) => {
    for (const s of splitBar(-halfW, halfW, cutsFor(sd, (o) => (mirror ? halfW - o.offset : -halfW + o.offset))))
      bars.push({ s: [s.a, wy, z], e: [s.b, wy, z], cut: cutOf('z', paintZ, sheetZ) });
  };

  if (enclosure.sideZ) {
    if (!enclosure.sideOpen.left && enclosure.sideBandFt.left <= 0) sideBar('left', enclosure.sideZ.start, enclosure.sideZ.end);
    if (!enclosure.sideOpen.right && enclosure.sideBandFt.right <= 0) sideBar('right', enclosure.sideZ.start, enclosure.sideZ.end);
  }
  if (enclosure.front === 'closed') endBar('front', -(halfL + o2), false, -1, -(halfL + SHEET_OUTSET));
  if (enclosure.back === 'closed') endBar('back', halfL + o2, true, 1, halfL + SHEET_OUTSET);
  // Partition divider (utility split) — full-height wall, gets the full wainscot cap.
  // (A storage partition's cap is added last, below.) Painted toward the open
  // bay (Siding's partWainZ side): no bar inside the enclosed garage.
  if (enclosure.partitionZ !== null && enclosure.partitionKind !== 'storage') {
    const pz = enclosure.partitionZ;
    const toBay: 1 | -1 = structure.openBayZ && (structure.openBayZ.start + structure.openBayZ.end) / 2 < pz ? -1 : 1;
    endBar('partition', pz, false, toBay, pz);
  }
  // Open-bay side panels — a wainscot cap belongs ONLY on a side that is FULLY
  // closed (sheeting reaches the ground, so there's a real lower wall section).
  // A partial closure hangs from the eave and stops mid-wall; its bottom edge is
  // open framing, not a wainscot divider, so it gets NO cap.
  if (structure.openBayZ) {
    const ob = structure.openBayZ;
    if (structure.eavePanelFt.left >= H - 0.01) sideBar('left', ob.start, ob.end);
    if (structure.eavePanelFt.right >= H - 0.01) sideBar('right', ob.start, ob.end);
  }
  // Storage partition (End Storage cross wall / Left-Right lengthwise wall):
  // the same cap along the top of its band on the main-room face, broken at
  // the openings crossing the line (Siding's storagePartitionWainscot).
  // Kept apart from `bars` and tagged captureIgnore (Siding CAPTURE_IGNORE):
  // interior trim must not move the PDF capture framing.
  const sb = storagePartitionWainscot(structure, openings, { enabled: true, heightFt });
  const partBars: Bar[] = [];
  if (sb) {
    // Painted on the main-room face: its sheet is SHEET_OUTSET off the framing line toward the main room.
    const f: 1 | -1 = sb.plane === 'cross' ? (enclosure.partitionFaces ?? -1) : (enclosure.sidePartition?.faces ?? 1);
    const cut = cutOf(sb.plane === 'cross' ? 'z' : 'x', f, sb.at - f * 0.02);
    for (const c of sb.cap)
      partBars.push(sb.plane === 'cross' ? { s: [c.u0, wy, sb.at], e: [c.u1, wy, sb.at], cut } : { s: [sb.at, wy, c.u0], e: [sb.at, wy, c.u1], cut });
  }
  return (
    <group>
      {bars.map((b, i) => (
        <CapBar key={i} s={b.s} e={b.e} cut={b.cut} color={color} />
      ))}
      {partBars.length > 0 && (
        <group userData={CAPTURE_IGNORE}>
          {partBars.map((b, i) => (
            <CapBar key={i} s={b.s} e={b.e} cut={b.cut} color={color} />
          ))}
        </group>
      )}
    </group>
  );
}
