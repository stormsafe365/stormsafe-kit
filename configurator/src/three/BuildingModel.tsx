import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useResolvedBuilding } from '@/engine/useResolvedBuilding';
import { swatchHex } from '@/config/colors';
import { useEditorStore, type ViewMode } from '@/store/useEditorStore';
import { Frame } from './Frame';
import { Siding } from './Siding';
import { LeanToSiding } from './LeanToSiding';
import { Openings } from './Openings';
import { Trim } from './Trim';

/** Shell opacity per view mode (exterior fully solid; structure/cutaway ghost). */
const SHELL_OPACITY: Record<ViewMode, number> = {
  exterior: 1,
  structure: 0.16,
  cutaway: 0.05,
};

/**
 * Wraps the finished shell (siding + trim + openings) and drives every
 * descendant material's opacity from the active view mode — so Structure /
 * Cutaway modes ghost the skin and reveal the frame, with no per-component
 * material plumbing. Runs after each commit so freshly-built meshes (size or
 * color changes, added openings) always pick up the current opacity.
 */
function ShellGroup({ opacity, children }: { opacity: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const grp = ref.current;
    if (!grp) return;
    const transparent = opacity < 1;
    grp.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mm = m as THREE.MeshStandardMaterial;
        if (!mm) continue;
        // Intrinsically-transparent panels (framed openings, window glass) own
        // their own opacity — never force them back to solid for the view mode,
        // or a see-through framed opening renders as a solid panel.
        if (mm.userData?.keepTransparent) continue;
        mm.transparent = transparent;
        mm.opacity = opacity;
        mm.depthWrite = !transparent; // ghost shell shouldn't occlude the frame
        mm.needsUpdate = true;
      }
    });
  });
  return <group ref={ref}>{children}</group>;
}

/**
 * Assembles the live building from the resolved pipeline. Frame (incl. hat
 * channels, girts, purlins) is laid down before the siding skin, mirroring real
 * assembly. In Structure/Cutaway modes the shell ghosts so the frame shows.
 */
export function BuildingModel() {
  const { resolved, structure } = useResolvedBuilding();
  const { config } = resolved;
  const trimHex = swatchHex(config.colors.trim);
  const viewMode = useEditorStore((s) => s.viewMode);
  const showFrameProminent = viewMode !== 'exterior';

  return (
    <group>
      <Frame members={structure.members} framingGauge={config.framingGauge} emphasize={showFrameProminent} />
      <ShellGroup opacity={SHELL_OPACITY[viewMode]}>
        <Siding
          structure={structure}
          openings={config.openings}
          wallOrientation={config.panelOrientation}
          roofOrientation={config.roofOrientation}
          colors={config.colors}
          wainscot={config.wainscot}
        />
        <LeanToSiding
          leanTos={structure.leanTos}
          wallOrientation={config.panelOrientation}
          roofOrientation={config.roofOrientation}
          colors={config.colors}
          wainscot={config.wainscot}
          overhangFt={structure.roofOverhangFt}
          trimColor={trimHex}
        />
        <Trim structure={structure} color={trimHex} wainscot={config.wainscot} />
        <Openings openings={config.openings} structure={structure} trimColor={trimHex} />
      </ShellGroup>
    </group>
  );
}
