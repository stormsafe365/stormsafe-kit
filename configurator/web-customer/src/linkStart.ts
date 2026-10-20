/**
 * What the page does with the answer to its link check: open on the rep's building (the seed) when
 * the link carries one. Kept out of main.tsx (which runs on import) so it can be tested.
 */
import { useWebStore } from './store';
import { DEFAULT_DESIGN, type WebDesign } from './model/design';
import { parseSeed } from './model/seed';
import type { LinkStatus } from './model/link';

export interface LinkResult {
  status: LinkStatus;
  seed: unknown | null;
}

export interface StartInfo {
  /** The page's own top-level window (never the website frame). */
  own: boolean;
  /** A saved draft was put back. */
  restored: boolean;
  /** The page is holding (busy overlay, no draft saves) until the link answers. */
  hold: boolean;
}

/** The start-up hold: a link with no saved draft waits briefly for the rep's building. */
export function beginHold(): void {
  const s = useWebStore.getState();
  s.setSeedHold(true);
  s.setBusy('Opening your design…');
}

/** The design "Start over" goes back to. */
export const startOverDesign = (seed: { design: WebDesign } | null): WebDesign => (seed ? seed.design : DEFAULT_DESIGN);

export function applyLinkResult(token: string, r: LinkResult, info: StartInfo, fit: () => void = () => {}): void {
  useWebStore.getState().setLink(token, r.status);
  const seed = info.own && r.status === 'ok' ? parseSeed(r.seed) : null;
  if (seed) {
    useWebStore.getState().setSeed(seed);
    if (!info.restored) {
      // the quote's impact choice and ZIP first, so the design is settled with the same rules (the URL wins)
      const ctx = useWebStore.getState().ctx;
      if (seed.impact !== null && ctx.impactParam === null) useWebStore.getState().setCtx({ ...ctx, impactParam: seed.impact });
      if (seed.zip && !useWebStore.getState().ctx.zip) useWebStore.getState().setZip(seed.zip);
      useWebStore.getState().replace(seed.design);
      useWebStore.getState().setTab('size');
      useWebStore.getState().setGuide(null);
      useWebStore.getState().setSeedNote(true);
      setTimeout(fit, 250);
    }
  }
  if (info.hold) {
    useWebStore.getState().setSeedHold(false);
    useWebStore.getState().setBusy(null);
  }
}
