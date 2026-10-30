/**
 * The CUSTOMER design — what a visitor picks on stormsafesteel.com/customize.
 *
 * This is the saved / sent shape (ss-design `state.design`). It holds only
 * customer choices in customer words; the 3D config (framing gauge, truss
 * spacing, sheeting, foundation …) is derived from it every time (toConfig.ts),
 * so none of the rep-only fields ever leave the page.
 *
 * Sides are named as seen standing in FRONT of the building, facing the front
 * end: 'left' = the program's Left Eave Side, 'right' = its Right Eave Side.
 * Dimensions are feet and always written W × L × H.
 */
import type { LeanToWrapCorner } from '@/types/building';

export type WebBuildingType = 'garage' | 'carport' | 'combo';
export type WebRoofStyle = 'Vertical' | 'Boxed Eave' | 'Regular';
export type WebPitch = 'standard' | '4:12' | '5:12' | '6:12';
export type WebPanels = 'Horizontal' | 'Vertical';

/** End wall (front / back gable). */
export type EndWall = 'closed' | 'open' | 'gableOnly' | 'halfClosed';
/** Side (eave) wall: closed, open, or panels hanging down from the eave. */
export type SideWall = 'closed' | 'open' | '1panel' | '2panel' | '3panel' | 'q1' | 'q2' | 'q3';

/** Main-building walls an opening can sit on. 'partition' = the wall between garage and carport (combo). */
export type WebWall = 'front' | 'back' | 'left' | 'right' | 'partition';
export type OpeningKind = 'rollup' | 'walk' | 'window' | 'frame';

/**
 * A door / window / framed opening on the main building.
 * `pos` = feet from the wall's reference end to the opening's NEAR edge — the
 * number a rep types in the program (front/back gable reference for the sides,
 * left-eave corner for the front end and partition, right-eave corner for the
 * back end). See positions.ts.
 */
export interface WebOpening {
  id: string;
  kind: OpeningKind;
  wall: WebWall;
  /** Width × height (ft). Walk doors 3 × 6′8″; windows from their type; roll-ups from the size list. */
  w: number;
  h: number;
  /** Bottom of the opening off the floor (ft). Windows / window framed openings 4′2″, doors 0. */
  sill: number;
  pos: number;
  /** Walk-door type key or window type key (catalog). */
  style?: string;
  /**
   * The customer's own walk-door / window pick while an impact area shows the
   * impact-rated one instead (normalize.ts). Leaving the impact area puts it back.
   */
  chosen?: string;
  /** Roll-up door color key. */
  color?: string;
  /**
   * Roll-up door: a chain hoist asked for (owner 10/30/26). Sizes that come with one (rules.hoistIncluded)
   * show "Included" whatever this says. Missing = not asked.
   */
  hoist?: boolean;
  /** Roll-up door: a brush seal (tops & sides) asked for. Missing = not asked. */
  seal?: boolean;
  /** Framed opening: a door-type (floor) or window-type (raised) opening. */
  frame?: 'door' | 'window';
}

export type LeanToSide = 'Left Eave' | 'Right Eave' | 'Front Gable' | 'Back Gable';
export type LeanToEnd = 'open' | 'halfEnd' | 'gable' | 'q1' | 'q2' | 'q3' | 'closed';
export type LeanToSideWall = 'open' | '1panel' | '2panel' | '3panel' | 'q1' | 'q2' | 'q3' | 'closed';
export type LeanToWall = 'outer' | 'front' | 'back';

/**
 * A door / window on a lean-to wall. `pos` = feet from the wall's left end to
 * the near edge — the program's lean-to "Custom offset (ft from left)".
 */
export interface WebLeanToOpening {
  id: string;
  kind: OpeningKind;
  wall: LeanToWall;
  w: number;
  h: number;
  sill: number;
  pos: number;
  style?: string;
  /** See WebOpening.chosen. */
  chosen?: string;
  color?: string;
  /** See WebOpening.hoist / seal. */
  hoist?: boolean;
  seal?: boolean;
  frame?: 'door' | 'window';
}

export interface WebLeanTo {
  id: string;
  side: LeanToSide;
  width: number;
  length: number;
  /** Starts At (ft): eave lean-to from the front corner, gable lean-to from the corner on your left facing that end. */
  start: number;
  lowLeg: number;
  pitch: '2:12' | '3:12';
  enclosure: 'open' | 'enclosed' | 'custom';
  walls: { front: LeanToEnd; back: LeanToEnd; side: LeanToSideWall };
  openings: WebLeanToOpening[];
}

/**
 * Upgrades the customer would like (owner 10/16/26: "add-ons/upgrades"). A wish
 * list the rep confirms in the quote: the page shows no prices. Options are the
 * quote program's own: insulation (vertical roof only), 12-gauge framing, 4' on
 * center, full 26-gauge wall panels, color-match fasteners, roll-up openers.
 * A frame gauge / spacing the area or width already needs is applied by the
 * rules (rules.ts) whether or not it is asked for here.
 */
export type Insulation = 'none' | 'roof' | 'roofWalls';
export interface WebUpgrades {
  insulation: Insulation;
  frame12: boolean;
  oc4: boolean;
  panels26: boolean;
  colorScrews: boolean;
  openers: boolean;
  /** 45° angle cut on the roll-up doors (every roll-up). Missing in older saved states = false. */
  angle45: boolean;
}

export interface WebDesign {
  type: WebBuildingType;
  width: number;
  length: number;
  height: number;
  /** Garage + Carport: length of the enclosed garage at the BACK (the carport is the front). */
  enclosedLength: number;
  roofStyle: WebRoofStyle;
  pitch: WebPitch;
  panels: WebPanels;
  walls: { front: EndWall; back: EndWall; left: SideWall; right: SideWall };
  colors: { roof: string; walls: string; trim: string; wainscot: string };
  wainscot: boolean;
  openings: WebOpening[];
  leanTos: WebLeanTo[];
  /** Requested wrap-around corners (drawn only while both lean-tos qualify — rules.ts). */
  wraps: LeanToWrapCorner[];
  /** Upgrades the customer would like (optional in saved states: missing = none). */
  upgrades: WebUpgrades;
}

/** Where the visitor is (URL params) — never part of the building. */
export interface WebContext {
  zip: string | null;
  county: string | null;
  /** impact=1 / impact=0 from the URL; null = not given (the county rule decides). */
  impactParam: boolean | null;
}

/** Saved-state envelope (ss-design `state`, ss-load-design `state`). */
export const STATE_SCHEMA = 'ss-web-design';
export const STATE_VERSION = 1;
export interface WebState {
  schema: typeof STATE_SCHEMA;
  v: typeof STATE_VERSION;
  design: WebDesign;
  ctx: { zip: string | null; county: string | null; impact: boolean };
}

export const DEFAULT_DESIGN: WebDesign = {
  type: 'garage',
  width: 24,
  length: 30,
  height: 10,
  enclosedLength: 20,
  roofStyle: 'Vertical',
  pitch: 'standard',
  panels: 'Horizontal',
  walls: { front: 'closed', back: 'closed', left: 'closed', right: 'closed' },
  colors: { roof: 'galvalume', walls: 'pewter-gray', trim: 'black', wainscot: 'quaker-gray' },
  wainscot: false,
  // A plain building: the customer adds every door and window (owner 10/16/26: "it shouldnt have
  // any doors windows nothing on it yet").
  openings: [],
  leanTos: [],
  wraps: [],
  upgrades: { insulation: 'none', frame12: false, oc4: false, panels26: false, colorScrews: false, openers: false, angle45: false },
};

/** The three parts every design started with before 10/16/26 (a 10×8 roll-up, a walk door, a window). */
export const OLD_STARTER_OPENINGS: readonly WebOpening[] = [
  { id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 8, sill: 0, pos: 7, color: 'white' },
  { id: 'o2', kind: 'walk', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 6, style: 'std' },
  { id: 'o3', kind: 'window', wall: 'left', w: 2.5, h: 2.5, sill: 50 / 12, pos: 14, style: 'std' },
];

/**
 * `o` is that starter part, untouched: same part, wall, place and the customer's same pick. In an
 * impact county the page shows the rated walk door / window instead (style = the rated one, chosen =
 * the customer's pick, the rated window's own size), so for those the pick is compared, not the shown
 * style or window size.
 */
const isUntouchedStarter = (o: WebOpening, s: WebOpening) => {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  if (o.id !== s.id || o.kind !== s.kind || o.wall !== s.wall || !near(o.pos, s.pos) || !near(o.sill, s.sill)) return false;
  if (s.kind === 'rollup') return near(o.w, s.w) && near(o.h, s.h) && o.color === s.color;
  return (o.chosen ?? o.style) === s.style;
};

/**
 * A saved draft from before 10/16/26 that still has ONLY the old starter parts, exactly as they came
 * (none moved, resized or changed, nothing added - no other door, window or lean-to door, no roll-up
 * openers asked for): take those three off, so a returning customer also starts with a plain
 * building. Any sign the customer worked on the doors and windows keeps them all as they are.
 */
export function withoutOldStarterParts(d: WebDesign): WebDesign {
  if (d.openings.length !== OLD_STARTER_OPENINGS.length) return d;
  if (d.leanTos.some((l) => l.openings.length > 0) || d.upgrades?.openers || d.upgrades?.angle45) return d;
  if (!d.openings.every((o) => OLD_STARTER_OPENINGS.some((s) => isUntouchedStarter(o, s)))) return d;
  return { ...d, openings: [] };
}

/** The design has a walk-in door or a window (main building or a lean-to) - the parts an impact county rates. */
export const hasWalkDoorOrWindow = (d: Pick<WebDesign, 'openings' | 'leanTos'>): boolean =>
  d.openings.some((o) => o.kind === 'walk' || o.kind === 'window') ||
  d.leanTos.some((l) => l.openings.some((o) => o.kind === 'walk' || o.kind === 'window'));

export const cloneDesign = (d: WebDesign): WebDesign => JSON.parse(JSON.stringify(d)) as WebDesign;

/** Customer names. */
export const TYPE_LABEL: Record<WebBuildingType, string> = { garage: 'Garage', carport: 'Carport', combo: 'Garage + Carport' };
export const WALL_LABEL: Record<WebWall, string> = {
  front: 'Front end',
  back: 'Back end',
  left: 'Left side',
  right: 'Right side',
  partition: 'Garage/carport divider wall',
};
export const LEANTO_SIDE_LABEL: Record<LeanToSide, string> = {
  'Left Eave': 'Left side',
  'Right Eave': 'Right side',
  'Front Gable': 'Front end',
  'Back Gable': 'Back end',
};
export const LEANTO_WALL_LABEL: Record<LeanToWall, string> = { outer: 'Outer wall', front: 'Front end', back: 'Back end' };
export const END_WALL_LABEL: Record<EndWall, string> = {
  closed: 'Closed',
  open: 'Open',
  gableOnly: 'Gable only (top triangle)',
  halfClosed: 'Half closed (6′ panel from the top)',
};
export const SIDE_WALL_LABEL: Record<SideWall, string> = {
  closed: 'Closed',
  open: 'Open',
  '1panel': '1 panel from the top (3′)',
  '2panel': '2 panels from the top (6′)',
  '3panel': '3 panels from the top (9′)',
  q1: '¼ closed from the top',
  q2: '½ closed from the top',
  q3: '¾ closed from the top',
};
export const LEANTO_END_LABEL: Record<LeanToEnd, string> = {
  open: 'Open',
  closed: 'Closed',
  gable: 'Gable only (top triangle)',
  halfEnd: 'Half end (tall half)',
  q1: '¼ closed from the top',
  q2: '½ closed from the top',
  q3: '¾ closed from the top',
};
export const LEANTO_SIDE_WALL_LABEL: Record<LeanToSideWall, string> = {
  open: 'Open',
  closed: 'Closed',
  '1panel': '1 panel from the top (3′)',
  '2panel': '2 panels from the top (6′)',
  '3panel': '3 panels from the top (9′)',
  q1: '¼ closed from the top',
  q2: '½ closed from the top',
  q3: '¾ closed from the top',
};
export const WRAP_LABEL: Record<LeanToWrapCorner, string> = {
  FL: 'front-left corner',
  FR: 'front-right corner',
  BL: 'back-left corner',
  BR: 'back-right corner',
};
