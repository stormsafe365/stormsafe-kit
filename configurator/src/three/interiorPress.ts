import { useEditorStore } from '@/store/useEditorStore';
import { CLICK_DRAG_THRESHOLD_PX } from './openingAnim';

/**
 * Press on a door / window / frame-out while the walk-in Interior view is on.
 *
 * Inside, a DRAG anywhere looks around (InteriorWalk), so a press on a part
 * must never slide it along its wall (that would also write a new position
 * back to the quote). A plain CLICK (pointer travel under
 * CLICK_DRAG_THRESHOLD_PX) still does what a click does outside: `onClick`
 * (select + open / close).
 *
 * Returns false (doing nothing) outside Interior, so the caller's normal
 * drag / click handling runs exactly as before.
 */
export function interiorPress(e: PointerEvent, onClick: () => void): boolean {
  if (!useEditorStore.getState().interiorView) return false;
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = 0;
  const move = (ev: PointerEvent) => {
    moved = Math.max(moved, Math.hypot(ev.clientX - sx, ev.clientY - sy));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved < CLICK_DRAG_THRESHOLD_PX) onClick();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  return true;
}
