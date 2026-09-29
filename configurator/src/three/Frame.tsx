import type { Member } from '@/engine/geometry';
import type { FramingGauge } from '@/types/building';
import type { RenderStyle } from '@/store/useEditorStore';
import {
  FRAME_PROFILES,
  HAT_CHANNEL_VISUAL_FT,
  PURLIN_VISUAL_FT,
  RAIL_VISUAL_FT,
} from '@/config/materials';
import { SteelMember } from './SteelMember';
import { useEnhancedMaterials } from './enhanced/ShellMeshes';

interface FrameProps {
  members: Member[];
  framingGauge: FramingGauge;
  /** Structure/cutaway view — paint all members a touch brighter so they read. */
  emphasize?: boolean;
  /**
   * View-only Look (render-upgrade). 'classic' (default) = today's per-member
   * materials, byte-identical. 'enhanced' = HANDOFF Step 8: the SAME members
   * (single / double / ladder legs untouched) in one shared bare-Galvalume
   * material (materials.ts 'frame': metalness 0.85, roughness 0.45, gentle env)
   * and no shadow casting (owner: even, bright, readable — no frame shadows on
   * the shell). The frame sits outside ShellGroup, so Structure / Cutaway still
   * ghost only the shell.
   */
  look?: RenderStyle;
}

// Every framing member is bare galvalume steel — columns, rafters, ridge, base
// rails, purlins, girts, hat channels, bracing all read as the same galvanized
// silver (a touch brighter in structure/cutaway so the frame pops). The colored
// EXTERIOR trim (eave/base/corner/ridge cap) is drawn separately in Trim.tsx.
const GALVALUME = '#c4cace';
const GALVALUME_EMPHASIZED = '#d6dde4';

/**
 * Renders the full steel skeleton. Primary members (legs, rafters, ridge,
 * base rails) scale their cross-section with the active gauge; secondary
 * members (purlins, girts, hat channels) use fixed thinner profiles. All
 * members are galvalume — the framing is bare galvanized steel.
 */
export function Frame({ members, framingGauge, emphasize = false, look = 'classic' }: FrameProps) {
  const frameSize = FRAME_PROFILES[framingGauge].visualSizeFt;
  const color = emphasize ? GALVALUME_EMPHASIZED : GALVALUME;
  // Enhanced: one cached material for every member (retained while mounted,
  // released when the Look flips back or the frame unmounts). The classic
  // path never asks for it, so it retains nothing.
  const enhancedMaterial = useEnhancedMaterials();
  const enhanced = look === 'enhanced';
  // Palette Galvalume; structure / cutaway use the classic emphasized tone so the frame still pops.
  const frameMat = enhanced ? enhancedMaterial({ surface: 'frame', color: emphasize ? GALVALUME_EMPHASIZED : undefined }) : undefined;

  return (
    <group>
      {members.map((m, i) => {
        let size = frameSize;

        switch (m.kind) {
          case 'baseRail':
          case 'ridge':
            size = Math.max(RAIL_VISUAL_FT, frameSize * 0.85);
            break;
          case 'purlin':
          case 'girt':
            size = PURLIN_VISUAL_FT;
            break;
          case 'hatChannel':
            size = HAT_CHANNEL_VISUAL_FT;
            break;
          case 'brace':
            size = frameSize * 0.8; // a touch lighter than the leg/rafter
            break;
          default:
            break; // legs + rafters use full gauge size
        }

        return frameMat ? (
          // Distinct keys per Look: flipping it remounts the members instead of
          // swapping a JSX material child for a material prop on the same mesh.
          <SteelMember
            key={`e-${m.kind}-${i}`}
            start={m.start}
            end={m.end}
            size={size}
            color={color}
            material={frameMat}
            castShadow={false}
            receiveShadow={false}
          />
        ) : (
          <SteelMember key={`${m.kind}-${i}`} start={m.start} end={m.end} size={size} color={color} />
        );
      })}
    </group>
  );
}
