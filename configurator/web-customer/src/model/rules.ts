/**
 * Build rules for the customer page — copied by hand from the quote program
 * (public/quote-builder.html) so a web design never asks for something the
 * quote will refuse. No prices. The rep re-enters the design in the program,
 * which checks everything again; these only keep the customer inside the
 * lines.
 *
 *   getTrussInfo            5′ OC up to 24′ wide, 4′ OC wider (Palm Beach: 4′ OC always)
 *   cciPBRule / HW list     12-gauge framing: Palm Beach any size; hi-wind counties over 24′ wide
 *   stdPitch                3:12, 2:12 over 31′ wide; 4:12 / 5:12 upgrades
 *   rules.ts (qtepro)       vertical roof over 35′ long; wide span (≥ 32′) = vertical roof + walls
 *   getMaxDoorHeight/Width  eave door h ≤ H − 2; gable h ≤ H (H − 1 with 2+ doors); w ≤ wall − 2
 *   getValidRDPSizes        lean-to roll-up: outer h ≤ low leg − 2; ends w ≤ width − 2, h ≤ low leg − 1
 *   updateLTNote            lean-to connection (low leg + width × pitch/12) ≤ main eave height
 *   _ltWrapReach / ltWraps  wrap-around corner rules
 *   permitting lock         impact counties (Okaloosa / Okeechobee over 720 sq ft)
 */
import type { LeanToWrapCorner } from '@/types/building';
import { OPENING_CORNER_CLEAR_FT, OPENING_GAP_FT } from '@/config/constants';
import {
  HIGH_WIND_COUNTIES,
  IMPACT_LOCK_COUNTIES,
  IMPACT_LOCK_MIN_SQFT,
  IMPACT_LOCK_SIZE_COUNTIES,
  LEANTO_LOW_LEGS,
  ROLLUP_HEIGHTS,
  ROLLUP_WIDTHS,
  WINDOW_SILL_FT,
  WALK_DOOR_H_FT,
} from './catalog';
import type { LeanToSide, WebContext, WebDesign, WebLeanTo, WebWall, LeanToWall, WebBuildingType } from './design';

export const LENGTH_MIN = 20;
export const LENGTH_MAX = 200;
export const WIDE_SPAN_MIN = 32;
export const WIDTH_MAX_STANDARD = 30;
export const WIDTH_MAX_WIDE = 60;
export const ROOF_VERTICAL_OVER_LENGTH = 35;
export const COMBO_MIN_PART = 5;

/**
 * Widths offered for a building type (ft). Wide span (32′+) is the quote's own
 * building type and takes any walls, so a garage AND a carport (open or partly
 * closed in) go to 60′ (owner 10/19/26: "why with partially enclosed can i
 * only go 30' wide"). A garage + carport is the quote's GCH, 12′–30′ only.
 */
export function widthOptions(type: WebBuildingType): number[] {
  const out: number[] = [];
  for (let w = 12; w <= WIDTH_MAX_STANDARD; w++) out.push(w);
  if (type !== 'combo') for (let w = WIDE_SPAN_MIN; w <= WIDTH_MAX_WIDE; w++) out.push(w);
  return out;
}

/** Wall heights the quote offers on a 12′–30′ building (no 19′). */
export const HEIGHTS_STANDARD = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20] as const;

/** Eave heights offered for a width (ft): the quote's 6–18 and 20 on 12′–30′; 8–18 and 20 on wide span (32′+ starts at 8′). */
export function heightOptions(width: number): number[] {
  if (width < WIDE_SPAN_MIN) return [...HEIGHTS_STANDARD];
  return HEIGHTS_STANDARD.filter((h) => h >= 8);
}

export const isWideSpan = (width: number) => width >= WIDE_SPAN_MIN;
/** Boxed-eave / regular roofs only up to 35′ long and below wide span. */
export const roofStyleLocked = (d: Pick<WebDesign, 'width' | 'length'>) => d.length > ROOF_VERTICAL_OVER_LENGTH || isWideSpan(d.width);
export const panelsLocked = (d: Pick<WebDesign, 'width'>) => isWideSpan(d.width);

/** Roof rise per 12 the program shows. */
export function pitchRise(d: Pick<WebDesign, 'width' | 'pitch'>): number {
  if (d.pitch === '4:12') return 4;
  if (d.pitch === '5:12') return 5;
  if (d.pitch === '6:12') return 6;
  return d.width > 31 ? 2 : 3;
}

/**
 * A roll-up door size that comes WITH a chain hoist (CCI's chart, the quote program's cciCertHoistIncluded): 14′ and 16′
 * wide at any height, 12′ wide 12′ tall and up, every other width 13′ tall and up. The other sizes take one as an add-on.
 */
export function hoistIncluded(w: number, h: number): boolean {
  if (w > 12) return true;
  if (w === 12) return h >= 12;
  return h >= 13;
}

/** Truss spacing (ft on center) the quote will use. */
export function trussSpacingFt(d: Pick<WebDesign, 'width'>, county: string | null): number {
  return d.width <= 24 && county !== 'Palm Beach' ? 5 : 4;
}
/** Spacing actually built: the rule, or 4′ when the customer asked for it (Upgrades) - as the 3D draws it (toConfig). */
export function builtSpacingFt(d: Pick<WebDesign, 'width'> & { upgrades?: Partial<WebDesign['upgrades']> }, county: string | null): number {
  return d.upgrades?.oc4 ? 4 : trussSpacingFt(d, county);
}

// ─── Partition wall (Add-ons; the program's End Storage) ────────────────────
// The same rules as the website's builder (stormsafe-site builder-src/web-customer/src/model/rules.ts, owner 10/29/26) and
// the program (aewDepthOptions / aewDefaultDepth / aewEaveConflicts in quote-builder.html).

/** Not on a Garage + Carport (its divider is already the split - the quote's rule). */
export const storageAllowed = (d: Pick<WebDesign, 'type'>) => d.type !== 'combo';
export const STORAGE_DEFAULT_FT = 10;
/** Depths the quote offers: frame lines `spacing` apart from the chosen end, leaving at least one bay (aewDepthOptions). */
export function storageDepthOptions(length: number, spacing: number, end: 'front' | 'back'): number[] {
  const out: number[] = [];
  if (!(length > 0) || !(spacing > 0)) return out;
  for (let t = spacing; t < length - 0.01; t += spacing) {
    const dd = Math.round((end === 'front' ? t : length - t) * 100) / 100;
    if (dd >= spacing - 0.001 && dd <= length - spacing + 0.001 && !out.includes(dd)) out.push(dd);
  }
  return out.sort((a, b) => a - b);
}
/** The option nearest `want`; a tie goes to the deeper one (the program's aewNearest). */
export function storageNearest(opts: number[], want: number): number | null {
  if (!opts.length) return null;
  let best = opts[0];
  let bd = Infinity;
  for (const o of opts) {
    const dd = Math.abs(o - want);
    if (dd < bd - 1e-9 || (Math.abs(dd - bd) < 1e-9 && o > best)) {
      bd = dd;
      best = o;
    }
  }
  return best;
}
/** The quote's default depth: nearest 10′ (or the middle option on a short building) - aewDefaultDepth. */
export function storageDefaultDepth(opts: number[]): number | null {
  if (!opts.length) return null;
  if (opts[opts.length - 1] < STORAGE_DEFAULT_FT) return opts[Math.floor(opts.length / 2)];
  return storageNearest(opts, STORAGE_DEFAULT_FT);
}
/** Where the partition wall stands, in feet from the front end. */
export const storageZ = (d: Pick<WebDesign, 'length'>, s: { end: 'front' | 'back'; depth: number }) => (s.end === 'front' ? s.depth : d.length - s.depth);
/**
 * Side-wall doors / windows the partition wall would run through (the program flags these: "the storage wall runs through
 * ... move the opening or pick another depth", aewEaveConflicts). A side part's pos is measured from the front end on both
 * sides (positions.ts), so it is the program's from-the-front span.
 */
export function storageCrossings(
  d: Pick<WebDesign, 'length' | 'openings'>,
  s: { end: 'front' | 'back'; depth: number },
): WebDesign['openings'] {
  const z = storageZ(d, s);
  return d.openings.filter((o) => (o.wall === 'left' || o.wall === 'right') && z > o.pos + 0.05 && z < o.pos + o.w - 0.05);
}

/** Framing gauge the quote will use (drawing only here). */
export function framingGauge(d: Pick<WebDesign, 'width'>, county: string | null): '14-gauge' | '12-gauge' {
  if (county === 'Palm Beach') return '12-gauge';
  if (d.width > 24 && county && HIGH_WIND_COUNTIES.includes(county)) return '12-gauge';
  return '14-gauge';
}

/**
 * Impact-rated windows + walk doors. impact=1 / impact=0 in the URL decide;
 * without it, the county lock the quote applies (so the design never shows a
 * door the quote will swap out).
 */
export function impactRequired(ctx: WebContext, d: Pick<WebDesign, 'width' | 'length'>): boolean {
  if (ctx.impactParam !== null) return ctx.impactParam;
  const c = ctx.county;
  if (!c) return false;
  if (IMPACT_LOCK_COUNTIES.includes(c)) return true;
  return IMPACT_LOCK_SIZE_COUNTIES.includes(c) && d.width * d.length > IMPACT_LOCK_MIN_SQFT;
}

// ─── Main-building walls ────────────────────────────────────────────────────

export const isEave = (wall: WebWall) => wall === 'left' || wall === 'right';

/** Length of a main wall (ft): sides run the building length, ends + divider the width. */
export const wallLength = (d: Pick<WebDesign, 'width' | 'length'>, wall: WebWall) => (isEave(wall) ? d.length : d.width);

/** Walls a door / window can go on right now (fully sheeted walls; the partition wall once it is added). */
export function openingWalls(d: Pick<WebDesign, 'type' | 'walls'> & { storage?: WebDesign['storage'] }): WebWall[] {
  if (d.type === 'combo') return ['back', 'left', 'right', 'partition'];
  const out: WebWall[] = [];
  if (d.walls.front === 'closed') out.push('front');
  if (d.walls.back === 'closed') out.push('back');
  if (d.walls.left === 'closed') out.push('left');
  if (d.walls.right === 'closed') out.push('right');
  if (d.storage?.on) out.push('partition'); // the partition wall takes doors too (quote: Partition Wall)
  return out;
}

export const wallTakesOpenings = (d: Pick<WebDesign, 'type' | 'walls'> & { storage?: WebDesign['storage'] }, wall: WebWall) => openingWalls(d).includes(wall);

/**
 * Garage + Carport side walls are sheeted only along the garage (the back
 * `enclosedLength`). Returns the blocked stretch [0, end) measured from the
 * FRONT, or null. Openings keep 1′ clear of the divider post, like a corner.
 */
export function comboBlockedFromFront(d: Pick<WebDesign, 'type' | 'length' | 'enclosedLength'>, wall: WebWall): number | null {
  if (d.type !== 'combo' || !isEave(wall)) return null;
  return Math.max(0, d.length - d.enclosedLength);
}

/** Roll-up sizes that fit a main wall (program getMaxDoorHeight / getMaxDoorWidth). */
export function rollupFits(d: Pick<WebDesign, 'width' | 'length' | 'height'>, wall: WebWall, w: number, h: number, doorsOnWall: number): boolean {
  const H = d.height;
  const maxH = isEave(wall) ? H - 2 : doorsOnWall > 1 ? H - 1 : H;
  const maxW = wallLength(d, wall) - 2;
  return h <= maxH + 1e-9 && w <= maxW + 1e-9;
}

export function rollupSizes(d: Pick<WebDesign, 'width' | 'length' | 'height'>, wall: WebWall, doorsOnWall: number): { widths: number[]; heights: number[] } {
  return {
    widths: ROLLUP_WIDTHS.filter((w) => rollupFits(d, wall, w, 6, doorsOnWall)),
    heights: ROLLUP_HEIGHTS.filter((h) => rollupFits(d, wall, 6, h, doorsOnWall)),
  };
}

/** A walk door (6′8″) or a window (sill 4′2″) needs at least this eave height. */
export const walkDoorFitsHeight = (wallH: number) => wallH >= Math.ceil(WALK_DOOR_H_FT + 0.3);
export const windowFitsHeight = (wallH: number, hFt: number) => wallH >= WINDOW_SILL_FT + hFt + 0.3;

// ─── Lean-tos ───────────────────────────────────────────────────────────────

export const leanToIsEave = (side: LeanToSide) => side === 'Left Eave' || side === 'Right Eave';
/** The main wall a lean-to runs along (ft). */
export const leanToHost = (d: Pick<WebDesign, 'width' | 'length'>, side: LeanToSide) => (leanToIsEave(side) ? d.length : d.width);
export const leanToPitchNum = (lt: Pick<WebLeanTo, 'pitch'>) => (lt.pitch === '3:12' ? 3 : 2);
/** Height where the lean-to roof meets the building. */
export const leanToConnH = (lt: Pick<WebLeanTo, 'lowLeg' | 'width' | 'pitch'>) => lt.lowLeg + (lt.width * leanToPitchNum(lt)) / 12;

/** Low-leg heights that keep the connection at or under the main eave. */
export function leanToLowLegOptions(d: Pick<WebDesign, 'height'>, lt: Pick<WebLeanTo, 'width' | 'pitch'>): number[] {
  return LEANTO_LOW_LEGS.filter((h) => leanToConnH({ lowLeg: h, width: lt.width, pitch: lt.pitch }) <= d.height + 1e-9);
}

/** Length of a lean-to wall (ft): outer = its run along the building, ends = its width. */
export function leanToWallLength(d: Pick<WebDesign, 'width' | 'length'>, lt: Pick<WebLeanTo, 'side' | 'length' | 'width'>, wall: LeanToWall): number {
  if (wall === 'outer') return Math.min(lt.length, leanToHost(d, lt.side));
  return lt.width;
}

/** Lean-to walls that take a door / window (fully closed walls). */
export function leanToOpeningWalls(lt: Pick<WebLeanTo, 'enclosure' | 'walls'>): LeanToWall[] {
  if (lt.enclosure === 'enclosed') return ['outer', 'front', 'back'];
  if (lt.enclosure !== 'custom') return [];
  const out: LeanToWall[] = [];
  if (lt.walls.side === 'closed') out.push('outer');
  if (lt.walls.front === 'closed') out.push('front');
  if (lt.walls.back === 'closed') out.push('back');
  return out;
}

export function leanToRollupFits(lt: Pick<WebLeanTo, 'width' | 'lowLeg'>, wall: LeanToWall, w: number, h: number): boolean {
  if (wall === 'outer') return h <= lt.lowLeg - 2 + 1e-9;
  return w <= lt.width - 2 + 1e-9 && h <= lt.lowLeg - 1 + 1e-9;
}

export function leanToRollupSizes(lt: Pick<WebLeanTo, 'width' | 'lowLeg'>, wall: LeanToWall, run: number): { widths: number[]; heights: number[] } {
  return {
    widths: ROLLUP_WIDTHS.filter((w) => leanToRollupFits(lt, wall, w, 6) && w <= run - 2 + 1e-9),
    heights: ROLLUP_HEIGHTS.filter((h) => leanToRollupFits(lt, wall, 6, h)),
  };
}

// ─── Wrap-around corners ────────────────────────────────────────────────────

export const WRAP_KEYS: LeanToWrapCorner[] = ['FL', 'FR', 'BL', 'BR'];
export const WRAP_SIDES: Record<LeanToWrapCorner, [LeanToSide, LeanToSide]> = {
  FL: ['Left Eave', 'Front Gable'],
  FR: ['Right Eave', 'Front Gable'],
  BL: ['Left Eave', 'Back Gable'],
  BR: ['Right Eave', 'Back Gable'],
};

/** Does lean-to `lt` run to corner k? (program _ltWrapReach, typed Starts At + length). */
export function leanToReaches(d: Pick<WebDesign, 'width' | 'length'>, lt: WebLeanTo, k: LeanToWrapCorner): boolean {
  const host = leanToHost(d, lt.side);
  if (!(host > 0) || lt.length > host) return false;
  const run = Math.min(lt.length, host);
  const start = Math.max(0, Math.min(lt.start, host - run));
  const front = k === 'FL' || k === 'FR';
  const left = k === 'FL' || k === 'BL';
  const atStart = start < 1e-6;
  const atEnd = Math.abs(start + run - host) < 1e-6;
  if (leanToIsEave(lt.side)) return front ? atStart : atEnd;
  if (lt.side === 'Front Gable') return left ? atStart : atEnd;
  return left ? atEnd : atStart; // back gable runs from the RIGHT eave corner
}

export interface WrapCornerStatus {
  /** Both lean-tos exist (the corner can be offered). */
  offered: boolean;
  /** Every rule holds. */
  ok: boolean;
  /** Why not, in customer words. */
  why?: string;
  eaveId?: string;
  gableId?: string;
}

/** Every corner's wrap status (program ltWraps, customer wording). */
export function wrapStatus(d: Pick<WebDesign, 'width' | 'length' | 'leanTos'>): Record<LeanToWrapCorner, WrapCornerStatus> {
  const out = {} as Record<LeanToWrapCorner, WrapCornerStatus>;
  for (const k of WRAP_KEYS) {
    const [sE, sG] = WRAP_SIDES[k];
    const e = d.leanTos.find((l) => l.side === sE);
    const g = d.leanTos.find((l) => l.side === sG);
    if (!e || !g) {
      out[k] = { offered: false, ok: false, why: 'needs a lean-to on both sides of this corner' };
      continue;
    }
    let why = '';
    if (!leanToReaches(d, e, k)) why = 'the side lean-to has to run all the way to this corner';
    else if (!leanToReaches(d, g, k)) why = 'the end lean-to has to run all the way to this corner';
    else if (e.width !== g.width || e.lowLeg !== g.lowLeg) why = 'both lean-tos must be the same width and low-leg height';
    else if (e.pitch !== g.pitch) why = 'both lean-tos must have the same roof pitch';
    out[k] = why ? { offered: true, ok: false, why, eaveId: e.id, gableId: g.id } : { offered: true, ok: true, eaveId: e.id, gableId: g.id };
  }
  return out;
}

/** The requested corners that are drawn (every rule holds). */
export function activeWraps(d: Pick<WebDesign, 'width' | 'length' | 'leanTos' | 'wraps'>): LeanToWrapCorner[] {
  const st = wrapStatus(d);
  return WRAP_KEYS.filter((k) => d.wraps.includes(k) && st[k].ok);
}

// ─── No-overlap (same numbers as engine/wallFit) ────────────────────────────

/** Near-edge positions must keep 1′ from each corner and 1′ between openings. */
export const CORNER_CLEAR = OPENING_CORNER_CLEAR_FT;
export const GAP = OPENING_GAP_FT;
