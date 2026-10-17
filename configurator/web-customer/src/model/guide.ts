/**
 * The guided start (owner 10/17/26): "What do you want to build?" (picture cards in the owner's own
 * categories) -> "How much room?" (the owner's common sizes) -> the same builder, filled in.
 * The sizes are the owner's common sizes, width x length x height in feet; they are starting points,
 * never a promise that a vehicle fits. Pure data + one pure function (tested).
 *
 * Not offered: a free-standing lean-to. The builder has no such building (it only has lean-tos
 * attached to a building), so a card for it would promise something the quote cannot build.
 */
import type { WebBuildingType, WebDesign } from './design';
import { applyType } from '../panels/SizePanel';
import { newLeanTo } from '../panels/LeanTosPanel';

export type GuideStyle = 'carport' | 'partial' | 'garage' | 'utility' | 'ag';

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

/** Put a chosen style + starting size on a design (the caller normalizes it). Starts from no lean-tos. */
export function applyStyle(d: WebDesign, style: GuideStyle, p: SizePreset): void {
  const s = STYLES.find((x) => x.key === style)!;
  applyType(d, s.type);
  d.width = p.w;
  d.length = p.l;
  d.height = p.h;
  d.walls = { ...s.walls };
  // a closed room in back takes about 60% of the length, like picking the type on the Size step
  if (s.type === 'combo') d.enclosedLength = Math.max(5, Math.min(p.l - 5, Math.round(p.l * 0.6)));
  d.leanTos = [];
  d.wraps = [];
  if (s.leanTos) for (const side of ['Left Eave', 'Right Eave'] as const) d.leanTos.push(newLeanTo(d, side));
}
