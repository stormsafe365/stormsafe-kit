/**
 * Owner rules for how main-building openings behave when clicked, dragged and
 * opened. Pure numbers only, so vitest can lock them (see
 * __tests__/ownerRules.test.ts). Every look (classic and any newer render
 * style) must use these helpers instead of re-typing the numbers.
 */

/**
 * Pointer travel, in CSS px, below which a press is a CLICK (select, or
 * open/close a door) and not a DRAG. A click must never move a part or write a
 * position back to the quote. The render lab used 4px; the builder is 5px.
 */
export const CLICK_DRAG_THRESHOLD_PX = 5;

/** Fully-open walk-door swing, in radians (about 91.7 degrees). */
export const WALK_DOOR_SWING_RAD = 1.6;

/**
 * Walk-door swing angle (rotation.y of the hinge group) at open amount t
 * (0 = shut, 1 = open). The door's local +Z always points OUTWARD, so:
 * - standard door: positive angle, swings IN;
 * - hi-impact / hi-wind door (opening.impact): negative angle, swings OUT.
 */
export function swingAngle(impact: boolean | undefined, t: number): number {
  return (impact ? -1 : 1) * t * WALK_DOOR_SWING_RAD;
}

/**
 * Walk-door hinge pivot, along the door's local X (door centre = 0). Hinges sit
 * on the LEFT jamb. Seen from outside, local +X is the viewer's right on every
 * wall, so the hinges are on the viewer's left.
 */
export function walkDoorHingeX(w: number): number {
  return -w / 2;
}

/** Walk-door knob, along the door's local X: on the RIGHT, 0.2 ft in from the free edge. */
export function walkDoorKnobX(w: number): number {
  return w / 2 - 0.2;
}
