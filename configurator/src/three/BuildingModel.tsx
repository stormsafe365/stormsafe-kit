import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useResolvedBuilding } from '@/engine/useResolvedBuilding';
import { swatchHex } from '@/config/colors';
import { useEditorStore, type ViewMode } from '@/store/useEditorStore';
import type { StructureModel } from '@/engine/geometry';
import type { BuildingConfig } from '@/types/building';
import { Frame } from './Frame';
import { Siding } from './Siding';
import { LeanToSiding } from './LeanToSiding';
import { Openings } from './Openings';
import { Trim } from './Trim';
import { EnhancedSite } from './enhanced/EnhancedSite';
import { EnhancedSiding } from './enhanced/EnhancedSiding';
import { EnhancedRoof } from './enhanced/EnhancedRoof';
import { EnhancedTrim } from './enhanced/EnhancedTrim';
import { EnhancedLeanTos } from './enhanced/EnhancedLeanTos';
import { LeanToSpacingOverlay } from './LeanToSpacing';

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

interface ShellProps {
  structure: StructureModel;
  config: BuildingConfig;
  trimHex: string;
}

/** CLASSIC shell (today's look, the default): siding, lean-tos, trim, openings. */
function ClassicShell({ structure, config, trimHex }: ShellProps) {
  return (
    <>
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
      <Trim structure={structure} color={trimHex} wainscot={config.wainscot} openings={config.openings} />
      <Openings openings={config.openings} structure={structure} trimColor={trimHex} wallColor={swatchHex(config.colors.walls)} />
    </>
  );
}

/**
 * ENHANCED shell (render-upgrade). Phase 5: the main building's walls, roof and
 * trim are the enhanced components (src/three/enhanced: outward-facing,
 * world-UV corrugated sheeting from the cached rib normal-map materials, bent
 * plate trims). Phase 6: the lean-to sheeting / roof / trim are enhanced too
 * (EnhancedLeanTos; the main roof and corner trims make room for them). Phase
 * 7: the door / window / roll-up / frame-out fixtures are the enhanced look
 * (enhanced/fixtures.tsx) drawn by the SAME Openings / DraggableLeanToOpening
 * components (look="enhanced"), so their placement, drag, click threshold,
 * write-back, guides and Spacing are untouched. Everything here sits inside ShellGroup,
 * so decals / shade bands that must keep their own opacity need
 * material.userData.keepTransparent. (Flipping the Look remounts the shell;
 * three sorts opaque draws by material.id, so a classic build viewed right
 * after a flip differs by ~800 equal-depth edge pixels until it is rebuilt.)
 */
function EnhancedShell({ structure, config, trimHex }: ShellProps) {
  return (
    <>
      <EnhancedSiding
        structure={structure}
        openings={config.openings}
        wallOrientation={config.panelOrientation}
        colors={config.colors}
        wainscot={config.wainscot}
      />
      <EnhancedRoof
        structure={structure}
        roofOrientation={config.roofOrientation}
        roofColor={config.colors.roof}
        trimColor={config.colors.trim}
      />
      <EnhancedLeanTos
        structure={structure}
        mainOpenings={config.openings}
        wallOrientation={config.panelOrientation}
        roofOrientation={config.roofOrientation}
        colors={config.colors}
        wainscot={config.wainscot}
        trimHex={trimHex}
      />
      <EnhancedTrim
        structure={structure}
        openings={config.openings}
        wallOrientation={config.panelOrientation}
        colors={config.colors}
        wainscot={config.wainscot}
      />
      <Openings openings={config.openings} structure={structure} trimColor={trimHex} wallColor={swatchHex(config.colors.walls)} look="enhanced" />
    </>
  );
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
  const renderStyle = useEditorStore((s) => s.renderStyle);
  const showFrameProminent = viewMode !== 'exterior';

  return (
    <group>
      <Frame members={structure.members} framingGauge={config.framingGauge} emphasize={showFrameProminent} />
      <ShellGroup opacity={SHELL_OPACITY[viewMode]}>
        {/* The single renderStyle branch point for the building shell. */}
        {renderStyle === 'enhanced' ? (
          <EnhancedShell structure={structure} config={config} trimHex={trimHex} />
        ) : (
          <ClassicShell structure={structure} config={config} trimHex={trimHex} />
        )}
        {/* Spacing button: lean-to walls too (both looks; renders nothing while Spacing is off). */}
        <LeanToSpacingOverlay leanTos={structure.leanTos} overhangFt={structure.roofOverhangFt} />
      </ShellGroup>
      {/* ENHANCED ground + slab + soft contact decals: outside ShellGroup (never
          ghosted), capture-ignored, and absent in classic. Last child, so the
          classic Frame / ShellGroup keep their slots and never remount. */}
      {renderStyle === 'enhanced' && <EnhancedSite structure={structure} />}
    </group>
  );
}
