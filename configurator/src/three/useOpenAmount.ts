import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useEditorStore } from '@/store/useEditorStore';
import { easeInOut, prefersReducedMotion, stepOpenClassic, stepOpenTimed } from './openingAnim';

/** How an opening eases between shut (0) and open (1). */
export type OpenEase = { kind: 'classic' } | { kind: 'timed'; secs: number };

/** The classic look's ease (the original Openings.tsx motion). */
export const CLASSIC_EASE: OpenEase = { kind: 'classic' };

/**
 * Click-to-open driver for ONE opening (view-only: nothing here is saved,
 * priced or written back to the quote).
 *
 * - The target is open while `isOpen` (the editor store's openIds entry) and
 *   no PDF capture is running (editor store captureMode).
 * - When a capture starts (captureMode false -> true) the part SNAPS shut at
 *   once, synchronously inside the store update, so __ssCapture3D's first
 *   frame already shows it closed (no reliance on the close-animation wait,
 *   and it works even when no animation frame runs, e.g. a hidden pane).
 * - prefers-reduced-motion snaps instead of animating.
 * - `apply(t)` moves the existing meshes (never rebuilds geometry). It runs
 *   whenever the amount changes AND after every commit, so meshes rebuilt by
 *   a re-render (drag, resize, color) pick up the current open amount.
 */
export function useOpenAmount(isOpen: boolean, apply: (t: number) => void, ease: OpenEase = CLASSIC_EASE): void {
  const progress = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const timed = ease.kind === 'timed';
  const shape = (p: number) => (timed ? easeInOut(p) : p);
  const shapeRef = useRef(shape);
  shapeRef.current = shape;

  // Re-apply the current amount to whatever meshes this commit produced.
  useLayoutEffect(() => {
    applyRef.current(shapeRef.current(progress.current));
  });

  // Capture starts -> shut now (the store update is synchronous).
  useEffect(
    () =>
      useEditorStore.subscribe((s, prev) => {
        if (s.captureMode && !prev.captureMode && progress.current !== 0) {
          progress.current = 0;
          applyRef.current(0);
        }
      }),
    [],
  );

  useFrame((_, dt) => {
    const target = isOpen && !useEditorStore.getState().captureMode ? 1 : 0;
    const cur = progress.current;
    if (cur === target) return;
    const next = prefersReducedMotion()
      ? target
      : ease.kind === 'timed'
        ? stepOpenTimed(cur, target, dt, ease.secs)
        : stepOpenClassic(cur, target, dt);
    if (next === cur) return;
    progress.current = next;
    applyRef.current(shapeRef.current(next));
  });
}
