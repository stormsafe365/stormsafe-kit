import type { FramingGauge, SheetingGauge } from '@/types/building';

/**
 * Real-world steel specs + the knobs the renderer and BOM read.
 *
 * NOTE on `visualSizeFt`: per the build brief, 12-gauge is the heavier
 * structural option, so we render it with a visibly chunkier cross-section
 * even though its nominal outer tube (2.25") is slightly smaller than the
 * 14-gauge (2.5"). The thicker wall + heavier feel is what reads to a buyer.
 */
export interface FrameProfile {
  outerInches: number;
  wallInches: number;
  /** Structural steel weight per linear foot (lb/ft) — drives BOM weight. */
  lbPerFt: number;
  /** Rendered box cross-section in feet (3D layer). */
  visualSizeFt: number;
}

export const FRAME_PROFILES: Record<FramingGauge, FrameProfile> = {
  '14-gauge': { outerInches: 2.5, wallInches: 0.075, lbPerFt: 2.42, visualSizeFt: 0.2 },
  '12-gauge': { outerInches: 2.25, wallInches: 0.105, lbPerFt: 2.94, visualSizeFt: 0.27 },
};

export interface SheetSpec {
  /** Panel weight per square foot (lb/sqft). */
  lbPerSqFt: number;
}

export const SHEET_SPECS: Record<SheetingGauge, SheetSpec> = {
  '29-gauge': { lbPerSqFt: 0.62 },
  '26-gauge': { lbPerSqFt: 0.91 },
};

/** Secondary-member profiles (rails, purlins, hat channels) — thinner than main frame. */
export const RAIL_VISUAL_FT = 0.16;
export const PURLIN_VISUAL_FT = 0.12;
export const HAT_CHANNEL_VISUAL_FT = 0.1;
