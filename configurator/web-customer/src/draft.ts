/**
 * The customer's work in progress, kept in THIS browser only (one draft per
 * design link), so a reload or a closed tab on a phone does not lose the
 * design. Nothing here is sent anywhere; storage that is blocked or full is
 * simply skipped (the page works the same without it).
 */
import { currentState, useWebStore, type TabKey } from './store';
import { checkState } from './model/validate';

const KEY = (token: string | null) => `ss-design-draft:${token || 'no-link'}`;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 60; // 60 days
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
    st.replace(chk.design);
    if (typeof j.sentAt === 'number') st.setSent(j.sentAt);
    if (typeof j.tab === 'string' && (TABS as string[]).includes(j.tab)) st.setTab(j.tab as TabKey);
    return true;
  } catch {
    return false;
  }
}

/** Save the draft shortly after every change. Returns the unsubscribe. */
export function keepDraft(token: string | null): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return useWebStore.subscribe((s, prev) => {
    if (s.design === prev.design && s.contact === prev.contact && s.sentAt === prev.sentAt && s.tab === prev.tab) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const { contact, sentAt, tab } = useWebStore.getState();
        const keep = { name: contact.name, phone: contact.phone, email: contact.email, zip: contact.zip, notes: contact.notes };
        window.localStorage.setItem(KEY(token), JSON.stringify({ t: Date.now(), state: currentState(), contact: keep, sentAt, tab }));
      } catch {
        /* storage blocked or full: no draft */
      }
    }, 400);
  });
}
