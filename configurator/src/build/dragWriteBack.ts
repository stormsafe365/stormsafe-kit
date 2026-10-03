import type { WallSide } from '@/types/building';

/**
 * 3D drag → the program's OWN position fields (BuildHost.writeBackDrag).
 * The reverse of readOpenings' mapping, so a drag round-trips exactly through
 * the program's getPosItems:
 *   program pos (ft from the wall's x=0 edge) = centerline − width/2, snapped
 *   to the nearest inch; the side toggle is 'right' on the Back gable (whose
 *   offsets are mirrored when read) and 'left' everywhere else — including
 *   the End Storage / GCH 'Partition Wall', which the program measures like
 *   the Front view ("From Left", faceW = building width; collectElevItems).
 */
export function dragWriteSide(side: WallSide): 'left' | 'right' {
  return side === 'back' ? 'right' : 'left';
}

/** Program position (ft) for a 3D centerline + width: nearest inch, never negative. */
export function dragWritePos(offsetFt: number, widthFt: number): number {
  return Math.max(0, Math.round((offsetFt - widthFt / 2) * 12) / 12);
}

/** The value typed into the entry's .pos-row input (tidy "4.333", not "4.33333333"). */
export function dragWritePosValue(offsetFt: number, widthFt: number): string {
  return String(Number(dragWritePos(offsetFt, widthFt).toFixed(3)));
}
