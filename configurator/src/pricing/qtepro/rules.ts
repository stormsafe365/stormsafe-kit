/**
 * Automatic build rules — the structural defaults the program applies before
 * pricing (truss spacing, standard siding, wide-span defaults). Pure: returns a
 * normalized copy. The pricing engine prices exactly what it's given; UIs call
 * this first so locked/auto fields match the CA/CCI rules. Builder ref:
 * `getTrussInfo` line 3833 (spacing = w>24 ? 4 : 5) and the vertical-wall /
 * commercial conventions.
 */

import type { PricingConfig } from './config';

/**
 * Length above which the roof must be Vertical — the longest roof panel is ~36',
 * so any longer build (and every length-combination build) seams as vertical.
 * Set to 35 per StormSafe (CCI consumer brochure threshold + vertical is the
 * recommended roof in general). A 36'+ build forces vertical roof.
 */
export const ROOF_VERTICAL_MAX_NONVERTICAL_LENGTH = 35;

export function applyBuildingRules(c: PricingConfig): PricingConfig {
  const out: PricingConfig = { ...c };
  const w = c.width || 0;

  // Roof: over 36' long must be vertical (longest panel = 36'). Regular/Boxed
  // are only valid ≤ 36'. (Also keeps long builds off the PR/PB table bug.)
  if ((c.length || 0) > ROOF_VERTICAL_MAX_NONVERTICAL_LENGTH) out.roofStyle = 'Vertical';

  // Wide-span (≥ 32' wide) is commercial: vertical roof + vertical walls are
  // standard, and a plain "standard" building at that width is a wide-span build.
  if (w >= 32) {
    out.roofStyle = 'Vertical';
    out.wallStyle = 'Vertical';
    if (out.buildingType === 'standard') out.buildingType = 'widespan';
  }

  // Height limits: 12'–30' wide → 6'–16'; 32'–60' wide → 8'–20'.
  const hMin = w >= 32 ? 8 : 6;
  const hMax = w >= 32 ? 20 : 16;
  if (typeof out.height === 'number') out.height = Math.min(hMax, Math.max(hMin, out.height));

  // Truss spacing: > 24' wide is built on 4' centers as standard (no upcharge —
  // it's included in the base). ≤ 24' is 5' OC standard, upgradable to 4' OC
  // (we keep the caller's choice in that range).
  if (w > 24) out.ocSpacing = '4oc';

  return out;
}

/** True when truss spacing is forced to 4' OC (no upgrade choice). */
export const isAutoFourOC = (width: number): boolean => width > 24;

/** True when the build is wide-span (vertical roof/walls forced). */
export const isWideSpan = (width: number): boolean => width >= 32;
