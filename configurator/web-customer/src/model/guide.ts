/**
 * The guided start (owner 10/17/26, from the usability PDF): "What will you use it for?" ->
 * (how the sides are, for RV / boat and farm) -> "How much room?" -> the same builder, filled in.
 * The sizes are the owner's common sizes (10/17/26), width x length x height in feet; they are
 * starting points, never a promise that a vehicle fits. Pure data + one pure function (tested).
 */
import type { WebBuildingType, WebDesign } from './design';
import { applyType } from '../panels/SizePanel';

export type Purpose = 'garage' | 'parking' | 'workshop' | 'rv' | 'farm' | 'other';

export interface SizePreset {
  label: string;
  /** width x length x height, feet */
  w: number;
  l: number;
  h: number;
}

const ONE: SizePreset = { label: '1 car', w: 12, l: 21, h: 9 };
const TWO: SizePreset = { label: '2 cars', w: 24, l: 26, h: 9 };
const THREE: SizePreset = { label: '3 cars', w: 30, l: 26, h: 9 };
const TWO_STORAGE: SizePreset = { label: '2 cars + storage', w: 24, l: 36, h: 10 };
const GARAGE_SHOP: SizePreset = { label: 'Garage + workshop', w: 30, l: 41, h: 12 };

export const PURPOSES: Array<{
  key: Purpose;
  title: string;
  blurb: string;
  /** null = ask "how should the sides be?" first */
  type: WebBuildingType | null;
  sizes: SizePreset[];
}> = [
  { key: 'garage', title: 'Garage', blurb: 'Park vehicles inside', type: 'garage', sizes: [ONE, TWO, THREE, TWO_STORAGE, GARAGE_SHOP] },
  { key: 'parking', title: 'Covered parking', blurb: 'A roof over your vehicles, open sides', type: 'carport', sizes: [ONE, TWO, THREE] },
  { key: 'workshop', title: 'Workshop', blurb: 'Room for your projects and tools', type: 'garage', sizes: [TWO_STORAGE, GARAGE_SHOP] },
  {
    key: 'rv',
    title: 'RV or boat',
    blurb: 'Protect larger vehicles',
    type: null,
    sizes: [
      { label: 'Travel trailer / Class C RV', w: 18, l: 36, h: 12 },
      { label: 'Class A / fifth wheel', w: 18, l: 46, h: 14 },
      { label: 'Boat on trailer', w: 18, l: 31, h: 12 },
    ],
  },
  {
    key: 'farm',
    title: 'Barn / farm building',
    blurb: 'Tractors, equipment and storage',
    type: null,
    sizes: [
      { label: 'Tractor & equipment', w: 24, l: 31, h: 14 },
      { label: 'Ag / barn', w: 30, l: 51, h: 12 },
    ],
  },
  { key: 'other', title: 'Something else', blurb: 'A business, a large open space, or not listed', type: 'garage', sizes: [{ label: 'Commercial / clear span', w: 40, l: 53, h: 14 }] },
];

export const SIDE_CHOICES: Array<{ type: WebBuildingType; title: string; blurb: string }> = [
  { type: 'garage', title: 'Closed in', blurb: 'Walls on all four sides' },
  { type: 'carport', title: 'Open sides', blurb: 'A roof on posts, like a carport' },
  { type: 'combo', title: 'Closed room in back', blurb: 'Open carport in front, closed storage room in back' },
];

/** Put a chosen type + starting size on a design (the caller normalizes it). */
export function applyPreset(d: WebDesign, type: WebBuildingType, p: SizePreset): void {
  applyType(d, type);
  d.width = p.w;
  d.length = p.l;
  d.height = p.h;
  // a closed room in back takes about 60% of the length, like picking the type on the Size step
  if (type === 'combo') d.enclosedLength = Math.max(5, Math.min(p.l - 5, Math.round(p.l * 0.6)));
}
