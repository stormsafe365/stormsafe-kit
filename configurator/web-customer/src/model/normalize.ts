/**
 * Keep a design inside the build rules (rules.ts). Run after every customer
 * change and on every loaded design (ss-load-design), so the 3D, the spec and
 * the saved state always describe something the quote can build.
 *
 * Pure: returns a new design, never mutates its input.
 */
import {
  COLORS,
  IMPACT_WALK_DOOR,
  IMPACT_WINDOW_FOR,
  isPrintKey,
  colorByKey,
  LEANTO_LOW_LEGS,
  LEANTO_PITCHES,
  LEANTO_WIDTHS,
  ROLLUP_COLORS,
  ROLLUP_HEIGHTS,
  ROLLUP_WIDTHS,
  WALK_DOOR_H_FT,
  WALK_DOOR_W_FT,
  WALK_DOORS,
  WINDOW_SILL_FT,
  windowType,
  WINDOWS,
} from './catalog';
import {
  cloneDesign,
  DEFAULT_DESIGN,
  type EndWall,
  type LeanToEnd,
  type LeanToSide,
  type LeanToSideWall,
  type LeanToWall,
  type SideWall,
  type WebDesign,
  type WebLeanTo,
  type WebLeanToOpening,
  type WebOpening,
  type WebWall,
} from './design';
import {
  COMBO_MIN_PART,
  heightOptions,
  LENGTH_MAX,
  LENGTH_MIN,
  leanToConnH,
  leanToHost,
  leanToLowLegOptions,
  leanToRollupFits,
  leanToWallLength,
  panelsLocked,
  rollupFits,
  roofStyleLocked,
  WRAP_KEYS,
  WRAP_SIDES,
  wallLength,
  widthOptions,
  CORNER_CLEAR,
} from './rules';
import { q8 } from './positions';

export const MAX_OPENINGS = 40;
export const MAX_LEANTO_OPENINGS = 12;
export const MAX_LEANTOS = 4;

export const END_WALLS: EndWall[] = ['closed', 'open', 'gableOnly', 'halfClosed'];
export const SIDE_WALLS: SideWall[] = ['closed', 'open', '1panel', '2panel', '3panel', 'q1', 'q2', 'q3'];
export const LEANTO_ENDS: LeanToEnd[] = ['open', 'halfEnd', 'gable', 'q1', 'q2', 'q3', 'closed'];
export const LEANTO_SIDE_WALLS: LeanToSideWall[] = ['open', '1panel', '2panel', '3panel', 'q1', 'q2', 'q3', 'closed'];
export const LEANTO_SIDES: LeanToSide[] = ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable'];
export const MAIN_WALLS: WebWall[] = ['front', 'back', 'left', 'right', 'partition'];
export const LEANTO_WALLS: LeanToWall[] = ['outer', 'front', 'back'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const nearest = (v: number, list: readonly number[]) => list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0]);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Snap a roll-up to the largest catalog size that fits (keeps the customer's pick when it fits). */
function fitRollup(w: number, h: number, fits: (w: number, h: number) => boolean): { w: number; h: number } {
  const W = nearest(w, ROLLUP_WIDTHS);
  const H = nearest(h, ROLLUP_HEIGHTS);
  if (fits(W, H)) return { w: W, h: H };
  const ws = ROLLUP_WIDTHS.filter((x) => x <= W && fits(x, 6));
  const nw = ws.length ? ws[ws.length - 1] : ROLLUP_WIDTHS[0];
  const hs = ROLLUP_HEIGHTS.filter((x) => x <= H && fits(nw, x));
  return { w: nw, h: hs.length ? hs[hs.length - 1] : ROLLUP_HEIGHTS[0] };
}

/** Size + look of an opening from its kind (impact swaps walk doors / windows to the rated ones). */
function normalizeParts<T extends WebOpening | WebLeanToOpening>(o: T, impact: boolean, maxW: number, maxH: number, rollFits: (w: number, h: number) => boolean): T {
  const out = { ...o };
  delete out.style;
  delete out.color;
  delete out.frame;
  if (o.kind === 'rollup') {
    const s = fitRollup(num(o.w, 10), num(o.h, 8), rollFits);
    out.w = s.w;
    out.h = s.h;
    out.sill = 0;
    out.color = ROLLUP_COLORS.some((c) => c.key === o.color) ? o.color : 'white';
  } else if (o.kind === 'walk') {
    out.w = WALK_DOOR_W_FT;
    out.h = WALK_DOOR_H_FT;
    out.sill = 0;
    const style = WALK_DOORS.some((t) => t.key === o.style) ? (o.style as string) : 'std';
    out.style = impact ? IMPACT_WALK_DOOR : style;
  } else if (o.kind === 'window') {
    let style = WINDOWS.some((t) => t.key === o.style) ? (o.style as string) : 'std';
    if (impact && !windowType(style)?.impact) style = IMPACT_WINDOW_FOR(style);
    const t = windowType(style)!;
    out.style = style;
    out.w = t.wIn / 12;
    out.h = t.hIn / 12;
    out.sill = WINDOW_SILL_FT;
  } else {
    out.kind = 'frame';
    out.frame = o.frame === 'window' ? 'window' : 'door';
    out.sill = out.frame === 'window' ? WINDOW_SILL_FT : 0;
    out.w = q8(clamp(num(o.w, 4), 1, Math.max(1, maxW)));
    out.h = q8(clamp(num(o.h, 7), 1, Math.max(1, maxH - out.sill)));
  }
  return out;
}

/** Normalize a whole design against the rules. `impact` = impact-rated parts required. */
export function normalizeDesign(input: WebDesign, impact: boolean): WebDesign {
  const d = cloneDesign(input);
  const out: WebDesign = cloneDesign(DEFAULT_DESIGN);

  out.type = oneOf(d.type, ['garage', 'carport', 'combo'] as const, 'garage');
  const widths = widthOptions(out.type);
  out.width = nearest(Math.round(num(d.width, 24)), widths);
  out.length = clamp(Math.round(num(d.length, 30)), LENGTH_MIN, LENGTH_MAX);
  out.height = nearest(Math.round(num(d.height, 10)), heightOptions(out.width));
  out.enclosedLength = clamp(Math.round(num(d.enclosedLength, 20)), COMBO_MIN_PART, out.length - COMBO_MIN_PART);

  out.roofStyle = roofStyleLocked(out) ? 'Vertical' : oneOf(d.roofStyle, ['Vertical', 'Boxed Eave', 'Regular'] as const, 'Vertical');
  out.pitch = oneOf(d.pitch, ['standard', '4:12', '5:12'] as const, 'standard');
  out.panels = panelsLocked(out) ? 'Vertical' : oneOf(d.panels, ['Horizontal', 'Vertical'] as const, 'Horizontal');

  const w = d.walls ?? DEFAULT_DESIGN.walls;
  if (out.type === 'combo') {
    // Garage + Carport: open carport at the FRONT (open or gable-only), closed back.
    out.walls = {
      front: w.front === 'gableOnly' ? 'gableOnly' : 'open',
      back: 'closed',
      left: oneOf(w.left, SIDE_WALLS, 'open'),
      right: oneOf(w.right, SIDE_WALLS, 'open'),
    };
  } else {
    const dflt: EndWall = out.type === 'carport' ? 'open' : 'closed';
    const dfltS: SideWall = out.type === 'carport' ? 'open' : 'closed';
    out.walls = {
      front: oneOf(w.front, END_WALLS, dflt),
      back: oneOf(w.back, END_WALLS, dflt),
      left: oneOf(w.left, SIDE_WALLS, dfltS),
      right: oneOf(w.right, SIDE_WALLS, dfltS),
    };
  }

  const solid = (k: unknown, dk: string) => (typeof k === 'string' && COLORS.some((c) => c.key === k) ? k : dk);
  const c = d.colors ?? DEFAULT_DESIGN.colors;
  out.colors = {
    roof: solid(c.roof, DEFAULT_DESIGN.colors.roof),
    walls: solid(c.walls, DEFAULT_DESIGN.colors.walls),
    trim: solid(c.trim, DEFAULT_DESIGN.colors.trim),
    // Printed wainscot panels come on VERTICAL wall panels only.
    wainscot:
      typeof c.wainscot === 'string' && colorByKey(c.wainscot) && (!isPrintKey(c.wainscot) || out.panels === 'Vertical')
        ? c.wainscot
        : DEFAULT_DESIGN.colors.wainscot,
  };
  out.wainscot = d.wainscot === true;

  // Upgrades (a wish list; missing in older saved states = none). Insulation goes
  // on a vertical roof only (the program's rule); openers need a roll-up door.
  const u = (d.upgrades ?? {}) as Partial<WebDesign['upgrades']>;
  out.upgrades = {
    insulation: out.roofStyle === 'Vertical' ? oneOf(u.insulation, ['none', 'roof', 'roofWalls'] as const, 'none') : 'none',
    frame12: u.frame12 === true,
    oc4: u.oc4 === true,
    panels26: u.panels26 === true,
    colorScrews: u.colorScrews === true,
    openers: u.openers === true,
  };

  // ── Main openings ──
  const seen = new Set<string>();
  const mains: WebOpening[] = [];
  for (const raw of (Array.isArray(d.openings) ? d.openings : []).slice(0, MAX_OPENINGS)) {
    if (!raw || typeof raw !== 'object') continue;
    if (!['rollup', 'walk', 'window', 'frame'].includes(raw.kind)) continue;
    const wall = oneOf(raw.wall, MAIN_WALLS, 'front');
    if (raw.wall !== wall) continue;
    if (wall === 'partition' && out.type !== 'combo') continue; // no divider wall without the carport
    if (out.type === 'combo' && wall === 'front') continue; // the open carport end
    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw.id) ? raw.id : '';
    if (!id || seen.has(id)) id = nextFreeId('o', seen);
    seen.add(id);
    const face = wallLength(out, wall);
    const onWall = (Array.isArray(d.openings) ? d.openings : []).filter((o) => o && o.kind === 'rollup' && o.wall === wall).length;
    const H = out.height;
    const part = normalizeParts(
      { ...raw, id, wall },
      impact,
      face - 2,
      H,
      (rw, rh) => rollupFits(out, wall, rw, rh, Math.max(1, onWall)),
    );
    part.pos = q8(clamp(num(raw.pos, CORNER_CLEAR), 0, Math.max(0, face - part.w)));
    mains.push(part);
  }
  out.openings = mains;

  // ── Lean-tos (one per side) ──
  const sides = new Set<LeanToSide>();
  const lts: WebLeanTo[] = [];
  const ltIds = new Set<string>();
  const loIds = new Set<string>(seen);
  for (const raw of (Array.isArray(d.leanTos) ? d.leanTos : []).slice(0, MAX_LEANTOS * 2)) {
    if (!raw || typeof raw !== 'object') continue;
    const side = oneOf(raw.side, LEANTO_SIDES, 'Left Eave');
    if (raw.side !== side || sides.has(side) || lts.length >= MAX_LEANTOS) continue;
    sides.add(side);
    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw.id) ? raw.id : '';
    if (!id || ltIds.has(id)) id = nextFreeId('lt', ltIds);
    ltIds.add(id);
    const host = leanToHost(out, side);
    const width = nearest(num(raw.width, 12), LEANTO_WIDTHS);
    const length = clamp(Math.round(num(raw.length, host)), Math.min(10, host), host);
    const pitch = oneOf(raw.pitch, LEANTO_PITCHES, '2:12');
    const legs = leanToLowLegOptions(out, { width, pitch });
    const want = nearest(num(raw.lowLeg, 8), LEANTO_LOW_LEGS);
    const lowLeg = legs.includes(want) ? want : legs.length ? legs.filter((h) => h <= want).pop() ?? legs[0] : LEANTO_LOW_LEGS[0];
    const enclosure = oneOf(raw.enclosure, ['open', 'enclosed', 'custom'] as const, 'open');
    const rw = raw.walls ?? { front: 'open', back: 'open', side: 'open' };
    const lt: WebLeanTo = {
      id,
      side,
      width,
      length,
      start: clamp(Math.round(num(raw.start, 0)), 0, host - length),
      lowLeg,
      pitch,
      enclosure,
      walls: {
        front: oneOf(rw.front, LEANTO_ENDS, 'open'),
        back: oneOf(rw.back, LEANTO_ENDS, 'open'),
        side: oneOf(rw.side, LEANTO_SIDE_WALLS, 'open'),
      },
      openings: [],
    };
    for (const ro of (Array.isArray(raw.openings) ? raw.openings : []).slice(0, MAX_LEANTO_OPENINGS)) {
      if (!ro || typeof ro !== 'object') continue;
      if (!['rollup', 'walk', 'window', 'frame'].includes(ro.kind)) continue;
      const wall = oneOf(ro.wall, LEANTO_WALLS, 'outer');
      if (ro.wall !== wall) continue;
      let oid = typeof ro.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(ro.id) ? ro.id : '';
      if (!oid || loIds.has(oid)) oid = nextFreeId('lo', loIds);
      loIds.add(oid);
      const len = leanToWallLength(out, lt, wall);
      const part = normalizeParts({ ...ro, id: oid, wall }, impact, len - 2, lowLeg, (a, b) => leanToRollupFits(lt, wall, a, b));
      part.pos = q8(clamp(num(ro.pos, CORNER_CLEAR), 0, Math.max(0, len - part.w)));
      lt.openings.push(part);
    }
    lts.push(lt);
  }
  out.leanTos = lts;
  // A wrap request lives only while both of its lean-tos exist (re-adding one never revives an old request).
  out.wraps = WRAP_KEYS.filter((k) => Array.isArray(d.wraps) && d.wraps.includes(k) && WRAP_SIDES[k].every((s) => sides.has(s)));
  // Roll-up openers need a roll-up door to go on.
  if (out.upgrades.openers && !hasRollupDoor(out)) out.upgrades.openers = false;
  return out;
}

/** Any roll-up door on the building or a lean-to. */
export const hasRollupDoor = (d: Pick<WebDesign, 'openings' | 'leanTos'>) =>
  d.openings.some((o) => o.kind === 'rollup') || d.leanTos.some((lt) => lt.openings.some((o) => o.kind === 'rollup'));

export function nextFreeId(prefix: string, used: Set<string>): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!used.has(id)) return id;
  }
}

/** Lean-to roof meets the building above the main eave (no valid low leg at this width / pitch). */
export const leanToTooTall = (d: Pick<WebDesign, 'height'>, lt: WebLeanTo) => leanToConnH(lt) > d.height + 1e-9;
