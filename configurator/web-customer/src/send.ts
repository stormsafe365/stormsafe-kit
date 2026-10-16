/**
 * Talks to the design page's own server functions (functions/api/*.js on the
 * same Cloudflare Pages site). The page itself holds no database key.
 *   GET  /api/link?t=<token>  -> { status: 'ok' | 'expired' | 'invalid' }
 *   POST /api/submit          -> { ok: true } | { ok: false, error: <code> }
 */
import type { Contact, LinkStatus } from './model/link';
import type { WebState } from './model/design';

/** Same-origin API base ('' in production; the dev server proxies /api). */
const API = '';

export async function checkLink(token: string, f: typeof fetch = fetch): Promise<LinkStatus> {
  try {
    const r = await f(`${API}/api/link?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!r.ok) return 'offline';
    const j = (await r.json()) as { status?: string };
    return j.status === 'ok' || j.status === 'expired' || j.status === 'invalid' ? j.status : 'offline';
  } catch {
    return 'offline';
  }
}

export interface SubmitPayload {
  token: string;
  contact: Contact;
  state: WebState;
  spec: string;
  image: string | null;
}

/** The JSON body the server function expects (trimmed contact fields). */
export function submitBody(p: SubmitPayload) {
  const c = p.contact;
  return {
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

/** Resolves { ok: true } or { ok: false, error } (an error code — link.ts sendErrorText). */
export async function submitDesign(p: SubmitPayload, f: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await f(`${API}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitBody(p)),
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
  }
}
