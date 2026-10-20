/**
 * V2 Doors & windows sheet: the pure rules behind it (tested in __tests__/sheet.test.ts).
 *
 *  - what a wall is ("Front end · 30′ end", "Left side · 40′ long side")
 *  - the size presets for each kind, taken ONLY from the sizes the page already offers
 *    (roll-ups: the catalog sizes that fit the wall; walk-in door: the one 3′ × 6′8″ door;
 *    windows: the catalog's 30″ × 30″ and 30″ × 36″; opening: today's 4′ × 7′ start size)
 *  - Left / Center / Right mapped onto the typed position (`pos`, near edge from the wall's
 *    reference end) and run through the SAME no-overlap fit as the drag and the cards
 *    (positions.fitMainPos: 1′ from each corner and every other opening)
 *
 * Left / Right are as seen standing OUTSIDE the wall, facing it (the 2-D wall picture is
 * drawn the same way). The reference end of each wall (positions.CUSTOMER_REF) is on the
 * viewer's left for every wall except the left side, whose front end is on the viewer's right.
 */
import { WALK_DOOR_H_FT, WALK_DOOR_W_FT, WINDOWS, ROLLUP_HEIGHTS, ROLLUP_WIDTHS } from './catalog';
import type { OpeningKind, WebDesign, WebOpening, WebWall } from './design';
import { fitMainPos, q8 } from './positions';
import { CORNER_CLEAR, comboBlockedFromFront, isEave, rollupFits, wallLength, windowFitsHeight } from './rules';

type D = Pick<WebDesign, 'type' | 'width' | 'length' | 'height' | 'enclosedLength' | 'openings'>;

/** The wall's own name, the plain words for what it is, and its length (ft). */
export interface WallInfo {
  name: string;
  /** "30′ end", "40′ long side", "30′ divider" */
  sizeLine: string;
  shape: 'gable' | 'side';
  lengthFt: number;
}

const WALL_NAME: Record<WebWall, string> = {
  front: 'Front end',
  back: 'Back end',
  left: 'Left side',
  right: 'Right side',
  partition: 'Divider wall',
};

export const fmtFt = (n: number) => `${Number.isInteger(n) ? n : +n.toFixed(2)}′`;

export function wallInfo(d: Pick<WebDesign, 'width' | 'length'>, wall: WebWall): WallInfo {
  const len = wallLength(d, wall);
  const shape = isEave(wall) ? 'side' : 'gable';
  const what = wall === 'partition' ? 'divider' : isEave(wall) ? 'long side' : 'end';
  return { name: WALL_NAME[wall], sizeLine: `${fmtFt(len)} ${what}`, shape, lengthFt: len };
}

/** "1 garage door, 2 windows" (the wall card line once something is on it). */
export function wallCountLine(openings: Pick<WebOpening, 'kind'>[]): string {
  const n: Record<OpeningKind, number> = { rollup: 0, walk: 0, window: 0, frame: 0 };
  for (const o of openings) n[o.kind]++;
  const words: Record<OpeningKind, [string, string]> = {
    rollup: ['garage door', 'garage doors'],
    walk: ['walk-in door', 'walk-in doors'],
    window: ['window', 'windows'],
    frame: ['opening', 'openings'],
  };
  return (['rollup', 'walk', 'window', 'frame'] as OpeningKind[])
    .filter((k) => n[k] > 0)
    .map((k) => `${n[k]} ${words[k][n[k] === 1 ? 0 : 1]}`)
    .join(', ');
}

// ─── Size presets ───────────────────────────────────────────────────────────

export interface SizePreset {
  key: string;
  w: number;
  h: number;
  label: string;
  /** 'Popular' / 'Standard' tag, or none. */
  tag?: 'Popular' | 'Standard';
  /** Window: the catalog height in inches (30 / 36). */
  hIn?: number;
}

/** Garage door preset pairs, most asked-for first in the row; only the ones that fit the wall are shown. */
const ROLLUP_PRESET_PAIRS: Array<[number, number]> = [
  [8, 7],
  [9, 8],
  [10, 8],
  [10, 10],
  [12, 12],
  [14, 14],
];
export const ROLLUP_POPULAR: [number, number] = [10, 10];

/** Every garage door size the page offers on that wall for `doorsOnWall` doors there (the catalog pairs that fit). */
export function rollupOptions(d: Pick<WebDesign, 'width' | 'length' | 'height'>, wall: WebWall, doorsOnWall: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const w of ROLLUP_WIDTHS) for (const h of ROLLUP_HEIGHTS) if (rollupFits(d, wall, w, h, doorsOnWall)) out.push([w, h]);
  return out;
}

/** The window sizes the catalog has (inches), white first: 30 × 30 and 30 × 36. */
export const WINDOW_SIZES_IN: Array<[number, number]> = [...new Map(WINDOWS.map((t) => [`${t.wIn}x${t.hIn}`, [t.wIn, t.hIn] as [number, number]])).values()];

/** The frame (opening) start size the page has always used. */
export const frameStartSize = (d: Pick<WebDesign, 'height'>) => ({ w: 4, h: Math.min(7, d.height - 1) });

/**
 * Preset buttons for a kind on a wall. `doorsOnWall` = garage doors there counting the new one(s).
 * `widthOk` filters roll-up widths that cannot sit on the wall next to what is there.
 */
export function sizePresets(
  d: Pick<WebDesign, 'width' | 'length' | 'height'>,
  kind: OpeningKind,
  wall: WebWall,
  doorsOnWall: number,
  widthOk: (w: number) => boolean = () => true,
): SizePreset[] {
  if (kind === 'rollup') {
    const all = rollupOptions(d, wall, doorsOnWall).filter(([w]) => widthOk(w));
    const has = (w: number, h: number) => all.some(([a, b]) => a === w && b === h);
    let picks = ROLLUP_PRESET_PAIRS.filter(([w, h]) => has(w, h));
    // a short or narrow wall: none of the usual pairs fits - offer the biggest of each width that does
    if (!picks.length) {
      const byW = new Map<number, number>();
      for (const [w, h] of all) byW.set(w, Math.max(byW.get(w) ?? 0, h));
      picks = [...byW.entries()].slice(-4).map(([w, h]) => [w, h] as [number, number]);
    }
    return picks.map(([w, h]) => ({
      key: `${w}x${h}`,
      w,
      h,
      label: `${fmtFt(w)} × ${fmtFt(h)}`,
      ...(w === ROLLUP_POPULAR[0] && h === ROLLUP_POPULAR[1] ? { tag: 'Popular' as const } : {}),
    }));
  }
  if (kind === 'walk') return [{ key: 'walk', w: WALK_DOOR_W_FT, h: WALK_DOOR_H_FT, label: '3′ × 6′8″', tag: 'Standard' }];
  if (kind === 'window') {
    return WINDOW_SIZES_IN.filter(([, hIn]) => windowFitsHeight(d.height, hIn / 12)).map(([wIn, hIn], i) => ({
      key: `${wIn}x${hIn}`,
      w: wIn / 12,
      h: hIn / 12,
      hIn,
      label: `${wIn}″ × ${hIn}″`,
      ...(i === 0 ? { tag: 'Standard' as const } : {}),
    }));
  }
  const s = frameStartSize(d);
  return [{ key: 'frame', w: s.w, h: s.h, label: `${fmtFt(s.w)} × ${fmtFt(s.h)}`, tag: 'Standard' }];
}

/** The preset a new part starts on: Popular (10′ × 10′) when offered, else what the page always started with. */
export function defaultPreset(kind: OpeningKind, presets: SizePreset[]): SizePreset | null {
  if (!presets.length) return null;
  if (kind === 'rollup') {
    const pop = presets.find((p) => p.tag === 'Popular');
    if (pop) return pop;
    // today's start: the widest up to 10′, the tallest up to 8′
    const under = presets.filter((p) => p.w <= 10 && p.h <= 8);
    return under[under.length - 1] ?? presets[0];
  }
  return presets[0];
}

/** Window style for a size, keeping the look (white / black / impact) the window had. */
export function windowStyleFor(style: string | undefined, hIn: number): string {
  const s = style ?? 'std';
  const tall = hIn === 36;
  if (s === 'b3030' || s === 'b3036') return tall ? 'b3036' : 'b3030';
  if (s === 'hi' || s === 'hi3036') return tall ? 'hi3036' : 'hi';
  if (s === 'hw') return tall ? 'w3036' : 'hw';
  return tall ? 'w3036' : 'std';
}

// ─── Position: Left / Center / Right ────────────────────────────────────────

export type PosChoice = 'left' | 'center' | 'right';

/** Is the wall's reference end (pos = 0) on the viewer's left, standing outside facing the wall? */
export const refOnViewerLeft = (wall: WebWall) => wall !== 'left';

/** Where the usable stretch of the wall starts (pos units): past the open carport bay on a Garage + Carport side. */
function usableStart(d: Pick<WebDesign, 'type' | 'length' | 'enclosedLength'>, wall: WebWall): number {
  const b = comboBlockedFromFront(d, wall);
  return b !== null && b > 0 ? b : 0;
}

/** The position asked for by Left / Center / Right (before the fit). */
export function choiceToWantPos(d: Pick<WebDesign, 'type' | 'width' | 'length' | 'enclosedLength'>, wall: WebWall, w: number, choice: PosChoice): number {
  const face = wallLength(d, wall);
  const start = usableStart(d, wall);
  const near = start + CORNER_CLEAR;
  const far = face - w - CORNER_CLEAR;
  const center = start + (face - start - w) / 2;
  if (choice === 'center') return q8(Math.max(0, center));
  const viewerLeftIsNear = refOnViewerLeft(wall);
  const wantNear = (choice === 'left') === viewerLeftIsNear;
  return q8(Math.max(0, wantNear ? near : far));
}

export interface Placement {
  pos: number;
  /** The spot asked for was taken: this is the nearest free one. */
  moved: boolean;
}

/**
 * Place a part `w` wide on the wall at a choice (or an exact typed position), keeping the
 * no-overlap rule exactly as the drag and the cards do. null = no room on that wall.
 */
export function placeOnWall(d: D, wall: WebWall, w: number, at: PosChoice | number, excludeId: string | null): Placement | null {
  const want = typeof at === 'number' ? at : choiceToWantPos(d, wall, w, at);
  const pos = fitMainPos(d, wall, w, want, excludeId);
  if (pos === null) return null;
  return { pos, moved: Math.abs(pos - want) > 0.05 };
}

/** Which button a typed position matches (for reopening a placed part), or null = a custom spot. */
export function posToChoice(d: Pick<WebDesign, 'type' | 'width' | 'length' | 'enclosedLength'>, wall: WebWall, w: number, pos: number): PosChoice | null {
  for (const c of ['center', 'left', 'right'] as PosChoice[]) if (Math.abs(choiceToWantPos(d, wall, w, c) - pos) < 0.05) return c;
  return null;
}

/** Near edge measured from the viewer's left end of the wall (the 2-D picture's x). */
export function viewerX(d: Pick<WebDesign, 'width' | 'length'>, wall: WebWall, pos: number, w: number): number {
  return refOnViewerLeft(wall) ? pos : wallLength(d, wall) - pos - w;
}

/** The names of the two ends of a wall as the viewer sees them: [left end, right end]. */
export function wallEnds(wall: WebWall): [string, string] {
  switch (wall) {
    case 'front':
      return ['left side', 'right side'];
    case 'back':
      return ['right side', 'left side'];
    case 'left':
      return ['back', 'front'];
    case 'right':
      return ['front', 'back'];
    default:
      return ['left side', 'right side'];
  }
}

/** A garage door of this size can go on the wall with `doorsOnWall` doors there, and every door already there still fits. */
export function rollupSizeOk(d: D, wall: WebWall, w: number, h: number, doorsOnWall: number, excludeId: string | null): boolean {
  if (!rollupFits(d, wall, w, h, doorsOnWall)) return false;
  return d.openings.filter((o) => o.wall === wall && o.kind === 'rollup' && o.id !== excludeId).every((o) => rollupFits(d, wall, o.w, o.h, doorsOnWall));
}
