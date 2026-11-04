// POST /api/lead?k=<key>&kind=chat|form — a website lead from Wix Automations (owner 11/4/26: the Wix
// chat form and the "Start Your Project" form go straight into the CRM).
//
// Wix's "Send HTTP request" action posts JSON. This reads the person out of it and calls
// submit_web_lead() (CRM db/migrations/026_web_leads.sql), which makes the New Lead or puts the message on
// the lead the person already is. The key in the address is checked by the database (only its SHA-256 is
// stored there); this server holds no lead key, only the same public database key as the design page.
//
// What the body may look like:
//   * "Choose fields" in Wix (what we set up): { name | first name + last name, email, phone, zip, message,
//     ...any other fields } — the other fields go into the message as "Label: value" lines.
//   * The same under { data: {...} } ("Nest request body under data").
//   * "All automation data": the person is found by key names anywhere in it (email, phone, first / last
//     name, ZIP, message text); nothing else is copied (it is full of ids).
// Plain JS (no build step), pure functions so the tests can run them in Node.

import { json, readLimited } from './core.js';

export const LEAD_MAX_BODY = 64000; // bytes
export const KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;
const KNOWN = new Set(['bad_key', 'bad_kind', 'busy']);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/;
const MAX_MESSAGE = 1900; // the database keeps 2000
const MAX_FIELD = 600;

/** a key name made comparable: "First Name" / "first_name" / "firstName" -> "firstname" */
const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const NAME_KEYS = new Set(['name', 'fullname', 'yourname', 'contactname', 'customername']);
const FIRST_KEYS = new Set(['firstname', 'first', 'fname', 'givenname']);
const LAST_KEYS = new Set(['lastname', 'last', 'lname', 'surname', 'familyname']);
const EMAIL_KEYS = new Set(['email', 'emailaddress', 'youremail', 'mail', 'primaryemail', 'contactemail']);
const PHONE_KEYS = new Set(['phone', 'phonenumber', 'yourphone', 'mobile', 'mobilephone', 'cell', 'cellphone', 'tel', 'telephone', 'primaryphone', 'contactphone']);
const ZIP_KEYS = new Set(['zip', 'zipcode', 'postalcode', 'postcode', 'zippostalcode']);
const MESSAGE_KEYS = new Set(['message', 'messagetext', 'text', 'body', 'content', 'comments', 'comment', 'notes', 'yourmessage', 'details', 'tellusaboutyourproject', 'projectdetails']);
const SKIP_KEYS = new Set(['kind', 'k', 'key', 'website']);

const scalar = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** a field's value: a string / number, or a list of them (Wix multi-choice) joined with commas */
function valueOf(v) {
  if (Array.isArray(v)) return v.map(scalar).filter(Boolean).join(', ');
  return scalar(v);
}

/** every [key, value] leaf in a nested body (depth- and count-capped) */
function leaves(o, out = [], depth = 0) {
  if (depth > 8 || out.length > 2000) return out;
  if (Array.isArray(o)) {
    for (const v of o) leaves(v, out, depth + 1);
    return out;
  }
  if (!isObj(o)) return out;
  for (const [k, v] of Object.entries(o)) {
    if (isObj(v) || (Array.isArray(v) && v.some(isObj))) leaves(v, out, depth + 1);
    else out.push([k, valueOf(v)]);
  }
  return out;
}

/** a name object such as { first: 'Jackie', last: 'Guthart' } anywhere under a "name" key */
function nameObject(o, depth = 0) {
  if (depth > 8 || !o || typeof o !== 'object') return '';
  for (const [k, v] of Object.entries(o)) {
    if (isObj(v) && NAME_KEYS.has(norm(k))) {
      let first = '', last = '';
      for (const [k2, v2] of Object.entries(v)) {
        if (FIRST_KEYS.has(norm(k2))) first = scalar(v2);
        if (LAST_KEYS.has(norm(k2))) last = scalar(v2);
      }
      if (first || last) return `${first} ${last}`.trim();
    }
    if (v && typeof v === 'object') {
      const n = nameObject(v, depth + 1);
      if (n) return n;
    }
  }
  return '';
}

/**
 * The person in a Wix body: { name, email, phone, zip, message }.
 * Top-level fields are "chosen fields"; anything else is looked up by key name.
 */
export function pickLead(raw) {
  let b = isObj(raw) ? raw : {};
  if (isObj(b.data) && Object.keys(b).every((k) => k === 'data' || SKIP_KEYS.has(norm(k)))) b = b.data;
  const top = Object.entries(b).filter(([, v]) => !isObj(v) && !(Array.isArray(v) && v.some(isObj)));
  const out = { name: '', email: '', phone: '', zip: '', message: '' };
  let first = '', last = '';
  const extra = [];
  const used = (k) => SKIP_KEYS.has(norm(k));
  for (const [k, v0] of top) {
    const n = norm(k), v = valueOf(v0);
    if (!v || used(k)) continue;
    if (NAME_KEYS.has(n) && !out.name) out.name = v;
    else if (FIRST_KEYS.has(n) && !first) first = v;
    else if (LAST_KEYS.has(n) && !last) last = v;
    else if (EMAIL_KEYS.has(n) && !out.email && EMAIL_RE.test(v)) out.email = v;
    else if (PHONE_KEYS.has(n) && !out.phone && v.replace(/\D/g, '').length >= 10) out.phone = v;
    else if (ZIP_KEYS.has(n) && !out.zip && /^\d{5}(-\d{4})?$/.test(v)) out.zip = v.slice(0, 5);
    else if (MESSAGE_KEYS.has(n) && !out.message) out.message = v;
    else extra.push(`${clip(String(k).trim(), 60)}: ${clip(v, MAX_FIELD)}`);
  }
  if (!out.name && (first || last)) out.name = `${first} ${last}`.trim();
  if (!out.name) out.name = nameObject(b);

  // Not a "chosen fields" body (no contact at the top): look everywhere, by key name only.
  const chosen = !!(out.email || out.phone);
  if (!chosen) {
    const all = leaves(raw);
    const find = (keys, test = () => true) => (all.find(([k, v]) => v && keys.has(norm(k)) && test(v)) || [])[1] || '';
    out.email = out.email || find(EMAIL_KEYS, (v) => EMAIL_RE.test(v));
    out.phone = out.phone || find(PHONE_KEYS, (v) => v.replace(/\D/g, '').length >= 10);
    out.zip = out.zip || (find(ZIP_KEYS, (v) => /^\d{5}(-\d{4})?$/.test(v)) || '').slice(0, 5);
    if (!out.name) {
      const f = find(FIRST_KEYS), l = find(LAST_KEYS);
      out.name = nameObject(raw) || `${f} ${l}`.trim() || find(NAME_KEYS);
    }
    if (!out.message) {
      // the longest message-like text (a chat message, a form's comments box)
      let best = '';
      for (const [k, v] of all) if (MESSAGE_KEYS.has(norm(k)) && v.length > best.length) best = v;
      out.message = best;
    }
  }
  const lines = [out.message, ...(chosen ? extra : [])].filter(Boolean);
  out.message = clip(lines.join('\n'), MAX_MESSAGE);
  out.name = clip(out.name, 200);
  out.email = clip(out.email, 200);
  out.phone = clip(out.phone, 60);
  return out;
}

function rpc(cfg, fn, args, f) {
  return f(`${cfg.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args),
  });
}

async function rpcError(res) {
  try {
    const j = await res.json();
    const m = String((j && (j.message || j.error)) || '').trim();
    return KNOWN.has(m) ? m : 'server';
  } catch {
    return 'server';
  }
}

/** the request body as an object: JSON, or a form post */
function parseBody(text, type) {
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    return isObj(j) ? j : {};
  } catch {
    if (/x-www-form-urlencoded/i.test(type || '')) return Object.fromEntries(new URLSearchParams(text));
    return null;
  }
}

export async function handleLead(request, cfg, f = fetch, log = console.log) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const url = new URL(request.url);
  const key = url.searchParams.get('k') || request.headers.get('X-Lead-Key') || '';
  if (!KEY_RE.test(key)) return json({ ok: false, error: 'bad_key' }, 403);
  if (Number(request.headers.get('Content-Length') || 0) > LEAD_MAX_BODY) return json({ ok: false, error: 'too_long' }, 413);
  const text = await readLimited(request, LEAD_MAX_BODY);
  if (text === null) return json({ ok: false, error: 'too_long' }, 413);
  const body = parseBody(text, request.headers.get('Content-Type'));
  if (body === null) return json({ ok: false, error: 'bad_body' }, 400);
  const kind = String(url.searchParams.get('kind') || (typeof body.kind === 'string' ? body.kind : '')).toLowerCase().trim();
  if (kind !== 'chat' && kind !== 'form') return json({ ok: false, error: 'bad_kind' }, 400);
  const p = pickLead(body);
  try {
    const res = await rpc(cfg, 'submit_web_lead', { p_key: key, p_kind: kind, p_name: p.name, p_email: p.email, p_phone: p.phone, p_zip: p.zip, p_message: p.message }, f);
    if (res.ok) {
      const result = String(await res.json());
      // never the person's details: what came in is in the CRM's web_leads log
      log(`lead ${kind}: ${result}; fields ${Object.keys(body).slice(0, 30).join(',')}; found ${['name', 'email', 'phone', 'zip', 'message'].filter((k) => p[k]).join(',') || 'nothing'}`);
      return json({ ok: true, result });
    }
    const code = await rpcError(res);
    log(`lead ${kind}: refused ${code}`);
    const status = code === 'bad_key' ? 403 : code === 'busy' ? 429 : code === 'server' ? 502 : 400;
    return json({ ok: false, error: code }, status);
  } catch {
    return json({ ok: false, error: 'server' }, 502);
  }
}
