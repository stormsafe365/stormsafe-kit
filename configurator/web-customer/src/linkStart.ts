/**
 * What the page does with the answer to its link check: open on the rep's building (the seed) when
 * the link carries one. Kept out of main.tsx (which runs on import) so it can be tested.
 */
import { isPlainStart, useWebStore } from './store';
import { DEFAULT_DESIGN, type WebDesign } from './model/design';
import { parseSeed, type Seed, type SeedContact } from './model/seed';
import { fetchLink } from './send';
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
  /** The page is holding (no draft saves) until the link answers. */
  hold: boolean;
}

const HOLD_MSG = 'Opening your design…';
/** The busy screen is shown this long at most; after that the first screen shows (the hold stays). */
export const HOLD_CAP_MS = 2500;

/** The start-up hold: a link with no saved draft waits for the rep's building. */
export function beginHold(capMs = HOLD_CAP_MS): void {
  const s = useWebStore.getState();
  s.setSeedHold(true);
  s.setBusy(HOLD_MSG);
  setTimeout(() => {
    const t = useWebStore.getState();
    if (t.seedHold && t.busy === HOLD_MSG) t.setBusy(null);
  }, capMs);
}

export type StartOverMode = 'seed' | 'blank';

/** What Start over does on this page: back to the rep's building (straight to the builder) or a brand-new design (the guided questions). */
export function startOverPlan(seed: { design: WebDesign } | null, mode: StartOverMode = 'seed'): { design: WebDesign; guide: 'welcome' | null; blank: boolean } {
  const useSeed = !!seed && mode === 'seed';
  return { design: startOverDesign(useSeed ? seed : null), guide: useSeed ? null : 'welcome', blank: !!seed && !useSeed };
}

/** What the rep already has goes into the EMPTY send-form boxes only (the customer can change it; never over what was typed). */
export function prefillContact(contact: SeedContact | null): void {
  if (!contact) return;
  const c = useWebStore.getState().contact;
  const patch: Partial<typeof c> = {};
  for (const k of ['name', 'phone', 'email'] as const) {
    const v = contact[k];
    if (v && !c[k].trim()) patch[k] = v;
  }
  if (Object.keys(patch).length) useWebStore.getState().setContact(patch);
}

/** The design "Start over" goes back to. */
export const startOverDesign = (seed: { design: WebDesign } | null): WebDesign => (seed ? seed.design : DEFAULT_DESIGN);

/** Nothing of the customer's own is on the page yet (no questions answered, nothing built). */
function untouched(): boolean {
  const s = useWebStore.getState();
  return s.guideStyle === null && s.guideBarn === null && isPlainStart(s.design, s.ctx);
}

/** The quote's impact choice (the URL's own wins), so the building is settled with the same rules. */
function applyImpact(seed: Seed): void {
  const ctx = useWebStore.getState().ctx;
  if (seed.impact !== null && ctx.impactParam === null) useWebStore.getState().setCtx({ ...ctx, impactParam: seed.impact });
}

export function applyLinkResult(token: string, r: LinkResult, info: StartInfo, fit: () => void = () => {}): void {
  const st = () => useWebStore.getState();
  const holding = info.hold && st().seedHold;
  let keepHold = false;
  try {
    st().setLink(token, r.status);
    // the customer already chose a blank design: a late answer changes nothing
    if (info.hold && !holding) return;
    const seed = info.own && r.status === 'ok' ? parseSeed(r.seed) : null;
    if (seed) {
      st().setSeed(seed);
      applyImpact(seed);
      // a saved draft keeps the customer's design; a late answer never replaces work already begun
      if (!info.restored && (!info.hold || untouched())) {
        if (seed.zip && !st().ctx.zip) st().setZip(seed.zip); // ctx before design
        st().replace(seed.design);
        st().setTab('size');
        st().setGuide(null);
        st().setSeedNote(true);
        // what the rep already has: into the empty boxes only (the customer can change it; never over what was typed)
        prefillContact(seed.contact);
        setTimeout(fit, 250);
      }
    } else if (holding && info.own && r.status === 'offline' && untouched()) {
      // could not reach the link: say so, never open a blank building the customer would mistake for theirs
      keepHold = true;
      st().setBusy(null);
      st().setGuide('offline');
    }
  } finally {
    if (holding && !keepHold) {
      st().setSeedHold(false);
      st().setBusy(null);
      if (st().guide === 'offline') st().setGuide('welcome');
    }
  }
}

let last: { token: string; info: StartInfo; fit: () => void; fetcher: typeof fetchLink } | null = null;

/** Check the link and apply the answer; one automatic retry a few seconds after a failed first check. */
export function runLinkCheck(token: string, info: StartInfo, fit: () => void = () => {}, fetcher: typeof fetchLink = fetchLink, autoRetryMs = 4000): Promise<void> {
  last = { token, info, fit, fetcher };
  return fetcher(token).then((r) => {
    applyLinkResult(token, r, info, fit);
    if (r.status === 'offline' && useWebStore.getState().guide === 'offline') {
      setTimeout(() => {
        const s = useWebStore.getState();
        if (s.guide === 'offline' && s.link === 'offline') void retryLinkCheck();
      }, autoRetryMs);
    }
  });
}

/** "Try again" on the could-not-open screen. */
export function retryLinkCheck(): Promise<void> {
  if (!last) return Promise.resolve();
  const { token, info, fit, fetcher } = last;
  useWebStore.getState().setLink(token, 'checking');
  return fetcher(token).then((r) => applyLinkResult(token, r, info, fit));
}
