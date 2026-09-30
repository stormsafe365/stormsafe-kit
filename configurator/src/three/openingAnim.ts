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
 * Fully-open walk-door swing of the ENHANCED look (HANDOFF Step 5: about 88
 * degrees). Its leaf sits flush in the wall with a proud jamb trim, so an
 * out-swinging leaf that went past 90 degrees would cut into that trim.
 */
export const WALK_DOOR_SWING_RAD_ENHANCED = (88 * Math.PI) / 180;

/**
 * Walk-door swing angle (rotation.y of the hinge group) at open amount t
 * (0 = shut, 1 = open). The door's local +Z always points OUTWARD, so:
 * - standard door: positive angle, swings IN;
 * - hi-impact / hi-wind door (opening.impact): negative angle, swings OUT.
 * `maxRad` is the fully-open magnitude only; the SIGN always comes from here.
 */
export function swingAngle(impact: boolean | undefined, t: number, maxRad: number = WALK_DOOR_SWING_RAD): number {
  return (impact ? -1 : 1) * t * maxRad;
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

// ── Open / close animation (click-to-open; view-only, never saved or priced) ──

/**
 * One frame of the CLASSIC open/close ease (the original inline Openings.tsx
 * code, unchanged): exponential approach at rate 4/s, snapped onto the target
 * once within 0.002. Returns the new open amount (== cur when at rest).
 */
export function stepOpenClassic(cur: number, target: number, dt: number): number {
  if (Math.abs(cur - target) < 0.001) return cur;
  let next = cur + (target - cur) * Math.min(1, dt * 4);
  if (Math.abs(next - target) < 0.002) next = target;
  return next;
}

/** Enhanced-look open/close durations in seconds (HANDOFF Step 5). */
export const OPEN_SECS = { rollUpDoor: 1.8, garageDoor: 1.8, walkDoor: 1.0, window: 0.8 } as const;

/** One frame of a TIMED open/close (linear progress over `secs`; ease it with easeInOut when applying). */
export function stepOpenTimed(cur: number, target: number, dt: number, secs: number): number {
  if (cur === target) return cur;
  const step = secs > 0 ? Math.max(0, dt) / secs : 1;
  return target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

/** Smooth ease in / out of a 0..1 progress (0 -> 0, 1 -> 1). */
export const easeInOut = (p: number): number => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

/** Enhanced roll-up: the bottom rail parks this far under the header when fully open (travel = h - this). */
export const ROLL_UP_PARK_FT = 0.22;
/** Enhanced roll-up curtain travel (ft) when fully open. */
export const rollUpTravel = (h: number): number => Math.max(0, h - ROLL_UP_PARK_FT);

/** Enhanced double-hung window: the lower sash stops this short of a full half-height slide. */
export const SASH_STOP_FT = 0.06;
/** Enhanced lower-sash travel (ft) when fully open: slides up behind the upper sash. */
export const sashTravel = (h: number): number => Math.max(0, h / 2 - SASH_STOP_FT);

let reducedMotionQuery: MediaQueryList | null | undefined;

/** The viewer asked the OS for reduced motion: open / close snaps instead of animating. */
export function prefersReducedMotion(): boolean {
  if (reducedMotionQuery === undefined) {
    try {
      reducedMotionQuery =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch {
      reducedMotionQuery = null;
    }
  }
  return !!reducedMotionQuery?.matches;
}
