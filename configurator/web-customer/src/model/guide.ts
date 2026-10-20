/**
 * The guided start (owner 10/17/26): "What do you want to build?" (picture cards in the owner's own
 * categories) -> "How much room?" (the owner's common sizes) -> the same builder, filled in.
 * The sizes are the owner's common sizes, width x length x height in feet; they are starting points,
 * never a promise that a vehicle fits. Pure data + one pure function (tested).
 *
 * Not offered: a free-standing lean-to. The customer page does not offer that building (it only has
 * lean-tos attached to a building), so a card for it would promise something this page cannot show.
 */
import type { LeanToSide, WebBuildingType, WebDesign, WebLeanTo } from './design';
import { LEANTO_LOW_LEGS, LEANTO_WIDTHS } from './catalog';
import { leanToConnH, pitchRise } from './rules';
import { applyType } from '../panels/SizePanel';
import { newLeanTo } from '../panels/LeanTosPanel';

export type GuideStyle = 'carport' | 'partial' | 'garage' | 'utility' | 'ag';
/** The three barn styles (owner 10/17/26): where the lean-to roofs meet the center building. */
export type BarnStyle = 'standard' | 'raised' | 'straight';

export interface SizePreset {
  label: string;
  /** width x length x height, feet (an ag barn: the center building) */
  w: number;
  l: number;
  h: number;
}

const ONE: SizePreset = { label: '1 car', w: 12, l: 21, h: 9 };
const TWO: SizePreset = { label: '2 cars', w: 24, l: 26, h: 9 };
const THREE: SizePreset = { label: '3 cars', w: 30, l: 26, h: 9 };
const TWO_STORAGE: SizePreset = { label: '2 cars + storage', w: 24, l: 36, h: 10 };
const GARAGE_SHOP: SizePreset = { label: 'Garage + workshop', w: 30, l: 41, h: 12 };
const TRAVEL: SizePreset = { label: 'Travel trailer / Class C RV', w: 18, l: 36, h: 12 };
const CLASS_A: SizePreset = { label: 'Class A / fifth wheel', w: 18, l: 46, h: 14 };
const BOAT: SizePreset = { label: 'Boat on trailer', w: 18, l: 31, h: 12 };
const TRACTOR: SizePreset = { label: 'Tractor & equipment', w: 24, l: 31, h: 14 };
const AG: SizePreset = { label: 'Ag / barn', w: 30, l: 51, h: 12 };
const COMMERCIAL: SizePreset = { label: 'Commercial / clear span', w: 40, l: 53, h: 14 };

type Walls = WebDesign['walls'];
const CLOSED: Walls = { front: 'closed', back: 'closed', left: 'closed', right: 'closed' };
const OPEN: Walls = { front: 'open', back: 'open', left: 'open', right: 'open' };

export const STYLES: Array<{
  key: GuideStyle;
  title: string;
  blurb: string;
  type: WebBuildingType;
  walls: Walls;
  /** an ag barn: a lean-to on each side of the center building */
  leanTos: boolean;
  sizes: SizePreset[];
}> = [
  { key: 'carport', title: 'Carport', blurb: 'A roof on posts, open on all sides', type: 'carport', walls: OPEN, leanTos: false, sizes: [ONE, TWO, THREE, TRAVEL, CLASS_A, BOAT, TRACTOR] },
  {
    key: 'partial',
    title: 'Partially enclosed',
    blurb: 'Open front end (roof peak closed in); back and both sides closed in',
    type: 'carport',
    walls: { front: 'gableOnly', back: 'closed', left: 'closed', right: 'closed' },
    leanTos: false,
    sizes: [ONE, TWO, THREE, TRAVEL, CLASS_A, BOAT, TRACTOR],
  },
  { key: 'garage', title: 'Garage', blurb: 'Closed in on all four sides', type: 'garage', walls: CLOSED, leanTos: false, sizes: [ONE, TWO, THREE, TWO_STORAGE, GARAGE_SHOP, TRAVEL, CLASS_A, BOAT, TRACTOR, COMMERCIAL] },
  {
    key: 'utility',
    title: 'Utility carport',
    blurb: 'Garage + carport in one: a closed room in back, open carport in front',
    type: 'combo',
    walls: { front: 'open', back: 'closed', left: 'open', right: 'open' },
    leanTos: false,
    sizes: [TWO_STORAGE, GARAGE_SHOP, TRAVEL, CLASS_A, BOAT, TRACTOR],
  },
  { key: 'ag', title: 'Ag barn', blurb: 'A center building with a lean-to roof on each side', type: 'garage', walls: CLOSED, leanTos: true, sizes: [AG, TRACTOR] },
];

export const BARNS: Array<{ key: BarnStyle; title: string; blurb: string }> = [
  { key: 'standard', title: 'Standard barn', blurb: 'A lean-to on each side, starting 2′ below the roof edge: one closed in, one open' },
  { key: 'raised', title: 'Raised center barn', blurb: 'A taller center building; open lean-tos start 1–4′ below its roof edge, by wall height' },
  { key: 'straight', title: 'Straight roof barn', blurb: 'One continuous roof line: the lean-tos carry the roof down on both sides' },
];

/** Raised center barn: how far below the eave the lean-tos start, by wall height (owner 10/17/26; 17′ was not named: 3′). */
export const raisedDrop = (wallHeight: number): 1 | 2 | 3 | 4 => (wallHeight <= 10 ? 1 : wallHeight <= 14 ? 2 : wallHeight <= 17 ? 3 : 4);

/** Where a barn's lean-tos meet the center building: feet below its eave, and which slopes may be used. */
function barnJoin(d: WebDesign, barn: BarnStyle): { conn: number; pitches: Array<'2:12' | '3:12'> } {
  if (barn === 'standard') return { conn: d.height - 2, pitches: ['2:12', '3:12'] };
  if (barn === 'raised') return { conn: d.height - raisedDrop(d.height), pitches: ['2:12', '3:12'] };
  // straight roof: meets the eave exactly, on the center building's own slope
  return { conn: d.height, pitches: [pitchRise(d) === 3 ? '3:12' : '2:12'] };
}

/**
 * A barn lean-to on one side. The join the barn style wants is made exactly when the lean-to sizes
 * allow it (12′ wide first, then the nearest width; the 2:12 slope first); when no size gives it
 * exactly, the closest join below it is used, and never one above the eave.
 */
function barnLeanTo(d: WebDesign, side: LeanToSide, barn: BarnStyle, enclosed: boolean): WebLeanTo {
  const lt = newLeanTo(d, side);
  const { conn, pitches } = barnJoin(d, barn);
  type Pick = { w: number; leg: number; pitch: '2:12' | '3:12'; c: number };
  const all: Pick[] = [];
  for (const pitch of pitches) for (const w of LEANTO_WIDTHS) for (const leg of LEANTO_LOW_LEGS) {
    const c = leanToConnH({ lowLeg: leg, width: w, pitch });
    if (c <= d.height + 1e-9) all.push({ w, leg, pitch, c });
  }
  const order = (p: Pick) => [Math.abs(p.w - 12), pitches.indexOf(p.pitch)];
  const better = (p: Pick, q: Pick) => {
    const [pw, pp] = order(p);
    const [qw, qp] = order(q);
    return pw !== qw ? pw < qw : pp < qp;
  };
  const under = all.filter((p) => p.c <= conn + 1e-9);
  let best: Pick | null = null;
  if (under.length) {
    const top = Math.max(...under.map((p) => p.c));
    for (const p of under) if (Math.abs(p.c - top) < 1e-9 && (!best || better(p, best))) best = p;
  } else if (all.length) {
    const low = Math.min(...all.map((p) => p.c)); // nothing reaches that low: the lowest join that is allowed
    for (const p of all) if (Math.abs(p.c - low) < 1e-9 && (!best || better(p, best))) best = p;
  }
  if (!best) return { ...lt, enclosure: enclosed ? 'enclosed' : 'open' };
  return { ...lt, width: best.w, lowLeg: best.leg, pitch: best.pitch, enclosure: enclosed ? 'enclosed' : 'open' };
}

/** How far below the center building's eave a lean-to meets it (ft) - for tests and the screen text. */
export const joinDrop = (d: Pick<WebDesign, 'height'>, lt: Pick<WebLeanTo, 'lowLeg' | 'width' | 'pitch'>) => d.height - leanToConnH(lt);

/** Put a chosen style + starting size on a design (the caller normalizes it). Starts from no lean-tos. */
export function applyStyle(d: WebDesign, style: GuideStyle, p: SizePreset, barn: BarnStyle = 'standard'): void {
  const s = STYLES.find((x) => x.key === style)!;
  applyType(d, s.type);
  d.width = p.w;
  d.length = p.l;
  d.height = p.h;
  d.walls = { ...s.walls };
  d.pitch = 'standard'; // a fresh pick starts from the standard roof slope
  // a closed room in back takes about 60% of the length, like picking the type on the Size step
  if (s.type === 'combo') d.enclosedLength = Math.max(5, Math.min(p.l - 5, Math.round(p.l * 0.6)));
  d.leanTos = [];
  d.wraps = [];
  if (s.leanTos) {
    // standard barn: the left lean-to closed in, the right one open; the others: both open
    d.leanTos.push(barnLeanTo(d, 'Left Eave', barn, barn === 'standard'));
    d.leanTos.push(barnLeanTo(d, 'Right Eave', barn, false));
  }
}
