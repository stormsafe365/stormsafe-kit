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
  /** Trim color applied to exposed edge members (base rails + ridge). */
  trimColor?: string;
  /** Structure/cutaway view — paint all members light steel so they read. */
  emphasize?: boolean;
}

const FRAME_COLOR = '#cfd6dd';
const HAT_COLOR = '#7c8794';
const STRUCTURE_PRIMARY = '#d6dde4'; // light galvanized steel
const STRUCTURE_SECONDARY = '#aab4bf'; // purlins/girts a touch darker for depth

/**
 * Renders the full steel skeleton. Primary members (legs, rafters, ridge,
 * base rails) scale their cross-section with the active gauge; secondary
 * members (purlins, girts, hat channels) use fixed thinner profiles. In
 * finished exterior the edge members take the trim color; in structure mode
 * everything switches to light galvanized steel so the frame is legible.
 */
export function Frame({ members, framingGauge, trimColor = '#aeb6bf', emphasize = false }: FrameProps) {
  const frameSize = FRAME_PROFILES[framingGauge].visualSizeFt;
  const PRIMARY_COLOR = emphasize ? STRUCTURE_PRIMARY : FRAME_COLOR;
  const SECONDARY_COLOR = emphasize ? STRUCTURE_SECONDARY : trimColor;

  return (
    <group>
      {members.map((m, i) => {
        let size = frameSize;
        let color = PRIMARY_COLOR;

        switch (m.kind) {
          case 'baseRail':
          case 'ridge':
            size = Math.max(RAIL_VISUAL_FT, frameSize * 0.85);
            color = SECONDARY_COLOR;
            break;
          case 'purlin':
          case 'girt':
            size = PURLIN_VISUAL_FT;
            color = SECONDARY_COLOR;
            break;
          case 'hatChannel':
            size = HAT_CHANNEL_VISUAL_FT;
            color = HAT_COLOR;
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
