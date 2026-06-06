import type { Member } from '@/engine/geometry';
import type { FramingGauge } from '@/types/building';
import {
  FRAME_PROFILES,
  HAT_CHANNEL_VISUAL_FT,
  PURLIN_VISUAL_FT,
  RAIL_VISUAL_FT,
} from '@/config/materials';
import { SteelMember } from './SteelMember';

interface FrameProps {
  members: Member[];
  framingGauge: FramingGauge;
  /** Structure/cutaway view — paint all members a touch brighter so they read. */
  emphasize?: boolean;
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
export function Frame({ members, framingGauge, emphasize = false }: FrameProps) {
  const frameSize = FRAME_PROFILES[framingGauge].visualSizeFt;
  const color = emphasize ? GALVALUME_EMPHASIZED : GALVALUME;

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

        return (
          <SteelMember key={`${m.kind}-${i}`} start={m.start} end={m.end} size={size} color={color} />
        );
      })}
    </group>
  );
}
