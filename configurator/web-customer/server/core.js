// Design-link server functions (Cloudflare Pages Functions, functions/api/*.js).
// The design page never holds a database key: it posts here, and this calls the
// two database functions from CRM db/migrations/020_design_links.sql:
//   GET  /api/link?t=<token>  -> design_link_status(token) -> { status } (+ seed: design_link_seed(token), live links that carry one)
//   POST /api/submit          -> submit_design(...)         -> { ok } | { ok:false, error }
// Plain JS (no build step), pure functions so the tests can run them in Node.

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const MAX_BODY = 1_500_000; // bytes: picture (<= 900 KB) + design (<= 256 KB) + spec (<= 12 KB) + contact
const KNOWN = new Set(['link_invalid', 'link_expired', 'too_many', 'link_full', 'busy', 'bad_name', 'need_contact', 'bad_phone', 'bad_email', 'bad_notes', 'too_long', 'bad_design', 'bad_image']);
const IMAGE_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_DESIGN_CHARS = 262144;
const MAX_IMAGE_CHARS = 900000;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * Other sites allowed to post a design here, besides the design page itself: the
 * website's Customize page (it runs at stormsafe365.github.io inside the Wix site)
 * sends every website design to the CRM too (owner 10/19/26). A browser on one of
 * these sites asks first (OPTIONS) and then reads the answer, so both carry the
 * CORS headers; any other site is refused as before.
 */
export const PARTNER_ORIGINS = new Set(['https://stormsafe365.github.io', 'https://www.stormsafesteel.com', 'https://stormsafesteel.com']);

/** The CORS headers for a partner site's request ({} for the page itself and for strangers). */
export function corsHeaders(origin) {
  return origin && PARTNER_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function rpc(cfg, fn, args, f) {
  return f(`${cfg.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args),
  });
}

/** The error code a failed submit_design call raised ('server' if it is not one of ours). */
export async function rpcError(res) {
  try {
    const j = await res.json();
    const m = String((j && (j.message || j.error)) || '').trim();
    return KNOWN.has(m) ? m : 'server';
  } catch {
    return 'server';
  }
}

/** The request body as text, or null once it passes `max` bytes (stops reading there — no Content-Length needed). */
export async function readLimited(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

const statusFor = (code) =>
  code === 'too_many' || code === 'busy' ? 429 : code === 'link_invalid' || code === 'link_expired' || code === 'link_full' ? 403 : code === 'server' ? 502 : 400;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The most seed text passed on (the database allows 64 KB; the page's own limit is larger). */
export const MAX_SEED_CHARS = 70000;

/** The building a live link opens on, or null (no building, an old database without it, a bad answer: all the same). */
async function fetchSeed(cfg, t, f) {
  try {
    const r = await rpc(cfg, 'design_link_seed', { p_token: t }, f);
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > MAX_SEED_CHARS) return null;
    const j = JSON.parse(text);
    return j && typeof j === 'object' && !Array.isArray(j) && j.schema === 'ss-web-design' ? j : null;
  } catch {
    return null;
  }
}

export async function handleLink(request, cfg, f = fetch) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!TOKEN_RE.test(t)) return json({ status: 'invalid' });
  try {
    const res = await rpc(cfg, 'design_link_status', { p_token: t }, f);
    if (!res.ok) return json({ error: 'server' }, 502);
    const s = await res.json();
    const status = s === 'ok' || s === 'expired' ? s : 'invalid';
    const seed = status === 'ok' ? await fetchSeed(cfg, t, f) : null;
    return json(seed ? { status, seed } : { status });
  } catch {
    return json({ error: 'server' }, 502);
  }
}

export async function handleSubmit(request, cfg, f = fetch) {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin);
  const out = (body, status) => json(body, status, cors);
  if (request.method === 'OPTIONS') {
    // a partner site's browser asking whether it may post: yes (for a day); anyone else: no
    if (!cors['Access-Control-Allow-Origin']) return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') return out({ ok: false, error: 'method' }, 405);
  // Only the design page itself (same site) and the partner sites may post.
  if (origin && origin !== new URL(request.url).origin && !PARTNER_ORIGINS.has(origin)) return out({ ok: false, error: 'origin' }, 403);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return out({ ok: false, error: 'too_long' }, 413);
  const text = await readLimited(request, MAX_BODY);
  if (text === null) return out({ ok: false, error: 'too_long' }, 413);
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return out({ ok: false, error: 'bad_design' }, 400);
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return out({ ok: false, error: 'bad_design' }, 400);
  // Honeypot: a person never sees the "website" box. Pretend it worked; store nothing.
  if (typeof b.website === 'string' && b.website.trim()) return out({ ok: true });
  if (typeof b.t !== 'string' || !TOKEN_RE.test(b.t)) return out({ ok: false, error: 'link_invalid' }, 403);
  const d = b.design;
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.schema !== 'ss-web-design') return out({ ok: false, error: 'bad_design' }, 400);
  const image = typeof b.image === 'string' && b.image ? b.image : null;
  // Owner 10/19/26: phone, email and ZIP are all required (the database alone takes a phone OR an email).
  // Enforced for this page build (it sends v: 2) and for the partner sites; a tab still holding the previous
  // page build (no marker, phone-or-email form) keeps the database's rule so it is not dead-ended mid-send.
  const strict = (typeof b.v === 'number' && b.v >= 2) || PARTNER_ORIGINS.has(origin || '');
  if (strict && (!str(b.phone, 60).trim() || !str(b.email, 200).trim())) return out({ ok: false, error: 'need_contact' }, 400);
  if (strict && !/^\d{5}$/.test(str(b.zip, 12).trim())) return out({ ok: false, error: 'need_zip' }, 400);
  // The database checks these too; checking here keeps big junk away from it.
  if (JSON.stringify(d).length > MAX_DESIGN_CHARS) return out({ ok: false, error: 'bad_design' }, 400);
  if (image && (image.length > MAX_IMAGE_CHARS || !IMAGE_RE.test(image))) return out({ ok: false, error: 'bad_image' }, 400);
  try {
    // A link that does not exist / has expired never gets the design sent to the database.
    const st = await rpc(cfg, 'design_link_status', { p_token: b.t }, f);
    if (!st.ok) return out({ ok: false, error: 'server' }, 502);
    const status = await st.json();
    if (status !== 'ok') {
      const code = status === 'expired' ? 'link_expired' : 'link_invalid';
      return out({ ok: false, error: code }, 403);
    }
    const res = await rpc(
      cfg,
      'submit_design',
      {
        p_token: b.t,
        p_name: str(b.name, 200),
        p_phone: str(b.phone, 60),
        p_email: str(b.email, 200),
        p_zip: str(b.zip, 12),
        p_notes: str(b.notes, 2100),
        p_design: d,
        p_spec: str(b.spec, 12000),
        p_image: image,
      },
      f,
    );
    if (res.ok) return out({ ok: true });
    const code = await rpcError(res);
    return out({ ok: false, error: code }, statusFor(code));
  } catch {
    return out({ ok: false, error: 'server' }, 502);
  }
}
