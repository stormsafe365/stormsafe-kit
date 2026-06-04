import { useMemo } from 'react';
import * as THREE from 'three';
import { ROOF_LIFT, SHEET_OUTSET, type StructureModel } from '@/engine/geometry';
import type { Wainscot } from '@/types/building';
import { SteelMember } from './SteelMember';

interface TrimProps {
  structure: StructureModel;
  color: string;
  wainscot: Wainscot;
}

/**
 * Finish trim at realistic steel-building proportions (3"–4" faces):
 *  - ridge cap, eave fascia + drip, gable rake (follow the roof overhang)
 *  - folded-L corner flashing (two faces + a beveled fold) that wraps the
 *    corner and covers the panel edges
 *  - base trim + wainscot divider trim
 */
export function Trim({ structure, color, wainscot }: TrimProps) {
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
  // Dark cut-edge of the roof panel (the rib-ends visible at the drip/rake).
  const darkMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2c3036', metalness: 0.35, roughness: 0.55 }),
    [],
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
      for (const z of [-halfL, halfL] as const) {
        if (!within(z)) continue;
        const sz = z < 0 ? -1 : 1;
        const endClosed =
          (z === -halfL && enclosure.front === 'closed') || (z === halfL && enclosure.back === 'closed');
        // face on the side wall
        corners.push(<Box key={`cs${k++}`} pos={[sx * (halfW + out + tt / 2), H / 2, sz * (halfL - f / 2)]} size={[tt, H, f]} />);
        // face on the end wall
        if (endClosed)
          corners.push(<Box key={`ce${k++}`} pos={[sx * (halfW - f / 2), H / 2, sz * (halfL + out + tt / 2)]} size={[f, H, tt]} />);
        // beveled fold across the corner notch
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

  const dripY = eaveY + roofLiftY; // roof lower (drip) edge
  const fasciaH = 0.32; // ~3.8" clean fascia face
  return (
    <group>
      {/* Ridge cap — extends to the gable overhang */}
      <SteelMember start={[0, peakHeight + 0.05, -gz]} end={[0, peakHeight + 0.05, gz]} size={0.16} color={color} metalness={0.1} roughness={0.5} />

      {/* Eave fascia — a CLEAN thin white board hanging straight off the roof
          drip edge (no chunky folded box / soffit), with a thin dark cut-edge
          line on top. Matches IdeaRoom's simple eave. */}
      {([-1, 1] as const).map((sx) => (
        <group key={`eave${sx}`}>
          <Box pos={[sx * eaveX, dripY - fasciaH / 2 + 0.02, 0]} size={[0.035, fasciaH, 2 * gz]} />
          <Box pos={[sx * (eaveX + 0.006), dripY + 0.012, 0]} size={[0.022, 0.03, 2 * gz]} m={darkMat} />
        </group>
      ))}

      {/* Gable rake — a clean FLAT fascia board following each roof slope to
          the overhung edge (not a chunky square tube), hanging just below the
          roof line like IdeaRoom/Sensei. */}
      {([-gz, gz] as const).map((z, i) => {
        const boards: JSX.Element[] = [];
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
              position={[(ax + bx) / 2 + px * off, (ay + by) / 2 + py * off, z]}
              rotation={[0, 0, ang]}
              material={mat}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[len, 0.26, 0.045]} />
            </mesh>,
          );
        }
        return <group key={`rake${i}`}>{boards}</group>;
      })}

      {corners}

      {/* No base trim — wall sheeting runs to the slab (matches IdeaRoom). */}

      {/* Wainscot divider trim (~2.5") */}
      {wainscot.enabled && <WainscotCap structure={structure} color={color} heightFt={wainscot.heightFt} />}
    </group>
  );
}

function WainscotCap({ structure, color, heightFt }: { structure: StructureModel; color: string; heightFt: number }) {
  const { width: W, length: L, legHeight: H, enclosure } = structure;
  const halfW = W / 2;
  const halfL = L / 2;
  const o2 = SHEET_OUTSET + 0.02;
  const wy = Math.min(heightFt, H - 0.5);
  const bars: { s: [number, number, number]; e: [number, number, number] }[] = [];
  if (enclosure.sideZ) {
    bars.push({ s: [-(halfW + o2), wy, enclosure.sideZ.start], e: [-(halfW + o2), wy, enclosure.sideZ.end] });
    bars.push({ s: [halfW + o2, wy, enclosure.sideZ.start], e: [halfW + o2, wy, enclosure.sideZ.end] });
  }
  if (enclosure.front === 'closed') bars.push({ s: [-halfW, wy, -(halfL + o2)], e: [halfW, wy, -(halfL + o2)] });
  if (enclosure.back === 'closed') bars.push({ s: [-halfW, wy, halfL + o2], e: [halfW, wy, halfL + o2] });
  return (
    <group>
      {bars.map((b, i) => (
        <SteelMember key={i} start={b.s} end={b.e} size={0.16} color={color} metalness={0.4} roughness={0.42} />
      ))}
    </group>
  );
}
