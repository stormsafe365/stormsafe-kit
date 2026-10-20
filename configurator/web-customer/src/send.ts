/**
 * Talks to the design page's own server functions (functions/api/*.js on the
 * same Cloudflare Pages site). The page itself holds no database key.
 *   GET  /api/link?t=<token>  -> { status: 'ok' | 'expired' | 'invalid', seed?: <the building the link opens on> }
 *   POST /api/submit          -> { ok: true } | { ok: false, error: <code> }
 */
import type { Contact, LinkStatus } from './model/link';
import type { WebState } from './model/design';

/** Same-origin API base ('' in production; the dev server proxies /api). */
const API = '';

/** A link check that has not answered after this long is given up (weak signal): the page opens as if the link had no building. */
export const LINK_TIMEOUT_MS = 15_000;

/** The link's status and, for a live link that carries one, the building it opens on (unchecked: see model/seed.ts). */
export async function fetchLink(token: string, f: typeof fetch = fetch, timeoutMs = LINK_TIMEOUT_MS): Promise<{ status: LinkStatus; seed: unknown | null }> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await f(`${API}/api/link?t=${encodeURIComponent(token)}`, { cache: 'no-store', signal: ctl?.signal });
    if (!r.ok) return { status: 'offline', seed: null };
    const j = (await r.json()) as { status?: string; seed?: unknown };
    if (j.status !== 'ok' && j.status !== 'expired' && j.status !== 'invalid') return { status: 'offline', seed: null };
    const seed = j.status === 'ok' && j.seed && typeof j.seed === 'object' && !Array.isArray(j.seed) ? j.seed : null;
    return { status: j.status, seed };
  } catch {
    return { status: 'offline', seed: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkLink(token: string, f: typeof fetch = fetch): Promise<LinkStatus> {
  return (await fetchLink(token, f)).status;
}

export interface SubmitPayload {
  token: string;
  contact: Contact;
  state: WebState;
  spec: string;
  image: string | null;
}

/** The JSON body the server function expects (trimmed contact fields). v: 2 = this build asks for phone, email AND ZIP (the server then insists too). */
export function submitBody(p: SubmitPayload) {
  const c = p.contact;
  return {
    v: 2,
    t: p.token,
    name: c.name.trim(),
    phone: c.phone.trim(),
    email: c.email.trim(),
    zip: c.zip.trim(),
    notes: c.notes.trim(),
    website: c.website,
    design: p.state,
    spec: p.spec,
    image: p.image,
  };
}

/** A send that has not finished after this long is given up (weak phone signal): the design stays on the page. */
export const SEND_TIMEOUT_MS = 45_000;

/** Resolves { ok: true } or { ok: false, error } (an error code — link.ts sendErrorText). */
export async function submitDesign(p: SubmitPayload, f: typeof fetch = fetch, timeoutMs = SEND_TIMEOUT_MS): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await f(`${API}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitBody(p)),
      signal: ctl?.signal,
    });
    let j: { ok?: boolean; error?: string } = {};
    try {
      j = await r.json();
    } catch {
      /* not JSON */
    }
    if (r.ok && j.ok) return { ok: true };
    return { ok: false, error: j.error || `http_${r.status}` };
  } catch {
    return { ok: false, error: 'offline' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
