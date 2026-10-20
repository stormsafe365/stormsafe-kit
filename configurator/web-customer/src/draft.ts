/**
 * The customer's work in progress, kept in THIS browser only (one draft per
 * design link), so a reload or a closed tab on a phone does not lose the
 * design. Nothing here is sent anywhere; storage that is blocked or full is
 * simply skipped (the page works the same without it).
 */
import { currentState, isPlainStart, useWebStore, type TabKey } from './store';
import { checkState } from './model/validate';
import { withoutOldStarterParts } from './model/design';
import { BARNS, STYLES } from './model/guide';

const KEY = (token: string | null) => `ss-design-draft:${token || 'no-link'}`;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TABS: TabKey[] = ['size', 'walls', 'doors', 'leantos', 'upgrades', 'colors', 'send'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Put a saved draft back (true = one was found and applied). */
export function restoreDraft(token: string | null, now = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(KEY(token));
    if (!raw) return false;
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!j || typeof j.t !== 'number' || now - j.t > MAX_AGE_MS) return false;
    const chk = checkState(j.state);
    if (!chk.ok) return false;
    const st = useWebStore.getState();
    const c = (j.contact ?? {}) as Record<string, unknown>;
    st.setContact({ name: str(c.name, 120), phone: str(c.phone, 40), email: str(c.email, 160), notes: str(c.notes, 2000) });
    const zip = str(c.zip, 10);
    if (zip) st.setZip(zip); // the county + impact rule come back with it
    // a draft saved before the plain-building start (10/16/26) loses the old starter parts if untouched -
    // never one already sent (the rep has that design; the page must keep showing what was sent)
    st.replace(j.blankStart === 1 || typeof j.sentAt === 'number' ? chk.design : withoutOldStarterParts(chk.design));
    // the building style picked in the guided questions (so the Size step keeps showing it)
    if (STYLES.some((x) => x.key === j.gs)) st.setGuideStyle(j.gs as (typeof STYLES)[number]['key']);
    if (BARNS.some((x) => x.key === j.gb)) st.setGuideBarn(j.gb as (typeof BARNS)[number]['key']);
    if (j.gm === 'help' || j.gm === 'know') st.setGuideMode(j.gm);
    if (typeof j.sentAt === 'number') st.setSent(j.sentAt);
    if (typeof j.tab === 'string' && (TABS as string[]).includes(j.tab)) st.setTab(j.tab as TabKey);
    return true;
  } catch {
    return false;
  }
}

/** Save the draft right now (also before the page reloads itself for a newer version - freshness.ts). */
export function saveDraftNow(token: string | null): void {
  try {
    // waiting for the rep's building: the plain starter must not be stored as the customer's draft
    const now = useWebStore.getState();
    if (now.seedHold) return;
    // a link that has not answered yet: the untouched plain building is not the customer's work
    if (token && (now.link === 'checking' || now.link === 'offline') && isPlainStart(now.design, now.ctx)) return;
    const { contact, sentAt, tab, guideStyle, guideBarn, guideMode } = useWebStore.getState();
    // once the design is sent, the contact details are not kept on the device (only the ZIP for the county)
    const keep = sentAt ? { zip: contact.zip } : { name: contact.name, phone: contact.phone, email: contact.email, zip: contact.zip, notes: contact.notes };
    // blankStart: saved by a page that starts with a plain building (no old starter parts to take off)
    window.localStorage.setItem(KEY(token), JSON.stringify({ t: Date.now(), blankStart: 1, state: currentState(), contact: keep, sentAt, tab, gs: guideStyle, gb: guideBarn, gm: guideMode }));
  } catch {
    /* storage blocked or full: no draft */
  }
}

/** Save the draft shortly after every change. Returns the unsubscribe. */
export function keepDraft(token: string | null): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return useWebStore.subscribe((s, prev) => {
    if (s.design === prev.design && s.contact === prev.contact && s.sentAt === prev.sentAt && s.tab === prev.tab && s.guideStyle === prev.guideStyle && s.guideBarn === prev.guideBarn) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveDraftNow(token), 400);
  });
}
