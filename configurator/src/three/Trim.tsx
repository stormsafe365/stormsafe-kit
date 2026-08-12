import { useMemo } from 'react';
import * as THREE from 'three';
import { ROOF_LIFT, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { Opening, Wainscot, WallSide } from '@/types/building';
import { SteelMember } from './SteelMember';

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
  const eaveDrop = oh * (rise / Math.max(halfW, 0.001)); // eave edge drops with overhang
  const eaveX = halfW + oh; // roof drip edge (horizontal)
  const eaveY = H - eaveDrop;
  const gz = halfL + oh; // gable roof edge
  // The roof is nudged out along its normal (ROOF_LIFT); its real drip-edge sits
  // this much HIGHER than eaveY. The eave trim top must reach it or a slot opens.
  const rafterLen = Math.sqrt(halfW * halfW + rise * rise);
  const roofLiftY = (halfW / Math.max(rafterLen, 0.001)) * ROOF_LIFT;

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
      for (const z of [-halfL, halfL] as const) {
        if (!within(z)) continue;
        const sz = z < 0 ? -1 : 1;
        const endClosed =
          (z === -halfL && enclosure.front === 'closed') || (z === halfL && enclosure.back === 'closed');
        // face on the side wall
        if (!sideIsOpen)
          corners.push(<Box key={`cs${k++}`} pos={[sx * (halfW + out + tt / 2), H / 2, sz * (halfL - f / 2)]} size={[tt, H, f]} />);
        // face on the end wall
        if (endClosed)
          corners.push(<Box key={`ce${k++}`} pos={[sx * (halfW - f / 2), H / 2, sz * (halfL + out + tt / 2)]} size={[f, H, tt]} />);
        // beveled fold across the corner notch (caps the side sheeting edge)
        if (!sideIsOpen)
          corners.push(
            <Box
              key={`cb${k++}`}
              pos={[sx * (halfW + out / 2), H / 2, sz * (halfL + out / 2)]}
              size={[out * 1.5, H, tt]}
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
  // one continuous panel run and gets NO transition trim. ---
  if (enclosure.partitionZ !== null && enclosure.sideZ) {
    const pz = enclosure.partitionZ;
    const f = 0.25;
    const tt = 0.04;
    // Open bay sits on the side of the partition away from the enclosed span.
    const openSign = Math.abs(pz - enclosure.sideZ.end) < 0.01 ? 1 : -1;
    let pk = 0;
    for (const sx of [-1, 1] as const) {
      const panelFt = sx < 0 ? structure.eavePanelFt.left : structure.eavePanelFt.right;
      if (panelFt > 0.01) continue; // paneled extension → continuous wall, no trim
      corners.push(<Box key={`ps${pk++}`} pos={[sx * (halfW + out + tt / 2), H / 2, pz - (openSign * f) / 2]} size={[tt, H, f]} />);
      corners.push(<Box key={`pe${pk++}`} pos={[sx * (halfW - f / 2), H / 2, pz + openSign * (out / 2 + tt / 2)]} size={[f, H, tt]} />);
      corners.push(<Box key={`pb${pk++}`} pos={[sx * (halfW + out / 2), H / 2, pz + openSign * (out / 2)]} size={[out * 1.5, H, tt]} rotY={Math.atan2(-openSign, -sx)} />);
    }
  }

  const dripY = eaveY + roofLiftY; // roof lower (drip) edge
  const fasciaH = 0.32; // ~3.8" clean fascia face
  return (
    <group>
      {/* Ridge cap — extends to the gable overhang */}
      <SteelMember start={[0, peakHeight + 0.05, -gz]} end={[0, peakHeight + 0.05, gz]} size={0.16} color={color} metalness={0.1} roughness={0.5} />

      {/* Eave fascia — the white board is TUCKED UNDER the roof (recessed inboard
          by `tuck`) so the roof panel edge HANGS OVER it, with the dark folded
          drip/rib-end edge at the overhanging lip. Matches IdeaRoom's overhang. */}
      {([-1, 1] as const).map((sx) => {
        const tuck = 0.11; // roof overhangs the fascia by ~1.3"
        return (
          <group key={`eave${sx}`}>
            <Box pos={[sx * (eaveX - tuck), dripY - fasciaH / 2 + 0.02, 0]} size={[0.035, fasciaH, 2 * gz]} />
            <Box pos={[sx * eaveX, dripY - 0.025, 0]} size={[0.028, 0.07, 2 * gz]} m={edgeMat} />
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
        for (const sx of [-1, 1] as const) {
          const ax = sx * eaveX;
          const ay = eaveY;
          const bx = 0;
          const by = peakHeight + 0.02;
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

  const bars: { s: [number, number, number]; e: [number, number, number] }[] = [];
  // Eave-side bars run along Z at x = ±(halfW + o2); openings sit at z = -halfL + offset.
  const sideBar = (sd: 'left' | 'right', zStart: number, zEnd: number) => {
    const sx = (sd === 'left' ? -1 : 1) * (halfW + o2);
    for (const s of splitBar(zStart, zEnd, cutsFor(sd, (o) => -halfL + o.offset)))
      bars.push({ s: [sx, wy, s.a], e: [sx, wy, s.b] });
  };
  // End-wall bars run along X at a fixed z; back-gable offsets mirror.
  const endBar = (sd: WallSide, z: number, mirror: boolean) => {
    for (const s of splitBar(-halfW, halfW, cutsFor(sd, (o) => (mirror ? halfW - o.offset : -halfW + o.offset))))
      bars.push({ s: [s.a, wy, z], e: [s.b, wy, z] });
  };

  if (enclosure.sideZ) {
    if (!enclosure.sideOpen.left && enclosure.sideBandFt.left <= 0) sideBar('left', enclosure.sideZ.start, enclosure.sideZ.end);
    if (!enclosure.sideOpen.right && enclosure.sideBandFt.right <= 0) sideBar('right', enclosure.sideZ.start, enclosure.sideZ.end);
  }
  if (enclosure.front === 'closed') endBar('front', -(halfL + o2), false);
  if (enclosure.back === 'closed') endBar('back', halfL + o2, true);
  // Partition divider (utility split) — full-height wall, gets the full wainscot cap.
  if (enclosure.partitionZ !== null) endBar('partition', enclosure.partitionZ, false);
  // Open-bay side panels — a wainscot cap belongs ONLY on a side that is FULLY
  // closed (sheeting reaches the ground, so there's a real lower wall section).
  // A partial closure hangs from the eave and stops mid-wall; its bottom edge is
  // open framing, not a wainscot divider, so it gets NO cap.
  if (structure.openBayZ) {
    const ob = structure.openBayZ;
    if (structure.eavePanelFt.left >= H - 0.01) sideBar('left', ob.start, ob.end);
    if (structure.eavePanelFt.right >= H - 0.01) sideBar('right', ob.start, ob.end);
  }
  return (
    <group>
      {bars.map((b, i) => (
        <SteelMember key={i} start={b.s} end={b.e} size={0.16} color={color} metalness={0.4} roughness={0.42} />
      ))}
    </group>
  );
}
