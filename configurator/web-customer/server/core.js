// Design-link server functions (Cloudflare Pages Functions, functions/api/*.js).
// The design page never holds a database key: it posts here, and this calls the
// two database functions from CRM db/migrations/020_design_links.sql:
//   GET  /api/link?t=<token>  -> design_link_status(token) -> { status }
//   POST /api/submit          -> submit_design(...)         -> { ok } | { ok:false, error }
// Plain JS (no build step), pure functions so the tests can run them in Node.

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const MAX_BODY = 1_500_000; // bytes: picture (<= 900 KB) + design (<= 256 KB) + spec (<= 12 KB) + contact
const KNOWN = new Set(['link_invalid', 'link_expired', 'too_many', 'link_full', 'busy', 'bad_name', 'need_contact', 'bad_phone', 'bad_email', 'too_long', 'bad_design', 'bad_image']);

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
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

export async function handleLink(request, cfg, f = fetch) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!TOKEN_RE.test(t)) return json({ status: 'invalid' });
  try {
    const res = await rpc(cfg, 'design_link_status', { p_token: t }, f);
    if (!res.ok) return json({ error: 'server' }, 502);
    const s = await res.json();
    return json({ status: s === 'ok' || s === 'expired' ? s : 'invalid' });
  } catch {
    return json({ error: 'server' }, 502);
  }
}

export async function handleSubmit(request, cfg, f = fetch) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  // Only the design page itself (same site) may post.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: 'origin' }, 403);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json({ ok: false, error: 'too_long' }, 413);
  const text = await readLimited(request, MAX_BODY);
  if (text === null) return json({ ok: false, error: 'too_long' }, 413);
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'bad_design' }, 400);
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ ok: false, error: 'bad_design' }, 400);
  // Honeypot: a person never sees the "website" box. Pretend it worked; store nothing.
  if (typeof b.website === 'string' && b.website.trim()) return json({ ok: true });
  if (typeof b.t !== 'string' || !TOKEN_RE.test(b.t)) return json({ ok: false, error: 'link_invalid' }, 403);
  const d = b.design;
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.schema !== 'ss-web-design') return json({ ok: false, error: 'bad_design' }, 400);
  const image = typeof b.image === 'string' && b.image ? b.image : null;
  try {
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
    if (res.ok) return json({ ok: true });
    const code = await rpcError(res);
    return json({ ok: false, error: code }, statusFor(code));
  } catch {
    return json({ ok: false, error: 'server' }, 502);
  }
}
