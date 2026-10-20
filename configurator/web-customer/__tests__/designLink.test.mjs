// Design link (owner 10/16/26): token parsing, the contact checks (same rules as
// the database), the ZIP -> county table (must match the quote program), the
// send body, and the server functions (server/core.js) against a fake database.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToken, checkContact, sendErrorText, EMPTY_CONTACT, FIELD_ERRORS } from '../src/model/link';
import { countyForZip, FL_ZIP_COUNT } from '../src/model/flZips';
import { readProgramZips } from '../tools/gen-fl-zips.mjs';
import { submitBody, submitDesign, checkLink } from '../src/send';
import { handleLink, handleSubmit, MAX_BODY, readLimited } from '../server/core.js';
import { restoreDraft, keepDraft } from '../src/draft';
import { useWebStore } from '../src/store';
import { cloneDesign, DEFAULT_DESIGN } from '../src/model/design';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOK = 'Ab3_-xYz0123456789ABCD';

describe('link token', () => {
  it('reads ?t= only when it looks like a token', () => {
    expect(parseToken(`?t=${TOK}`)).toBe(TOK);
    expect(parseToken(`?zip=33401&t=${TOK}`)).toBe(TOK);
    expect(parseToken('?t=short')).toBe(null);
    expect(parseToken('?t=' + 'a'.repeat(65))).toBe(null);
    expect(parseToken("?t=abc'def0123456789012345")).toBe(null);
    expect(parseToken('')).toBe(null);
  });
});

describe('contact checks', () => {
  const c = (o) => ({ ...EMPTY_CONTACT, ...o });
  // owner 10/19/26: name, phone, email AND ZIP are all required
  const ok = { name: 'Jane', phone: '561-555-0100', email: 'jane@example.com', zip: '33401' };
  it('needs a name, a phone, an email and a ZIP', () => {
    expect(checkContact(c({}))).toMatchObject({ name: expect.any(String), phone: expect.any(String), email: expect.any(String), zip: expect.any(String) });
    expect(checkContact(c(ok))).toEqual({});
    expect(checkContact(c({ ...ok, email: '' }))).toEqual({ email: expect.stringMatching(/email/i) });
    expect(checkContact(c({ ...ok, phone: '' }))).toEqual({ phone: expect.stringMatching(/phone/i) });
    expect(checkContact(c({ ...ok, zip: '' }))).toEqual({ zip: expect.stringMatching(/ZIP/) });
    expect(checkContact(c({ ...ok, zip: '  ' }))).toEqual({ zip: expect.stringMatching(/ZIP/) });
  });
  it('rejects what the database rejects', () => {
    expect(checkContact(c({ ...ok, phone: '555-0100' })).phone).toBeTruthy();
    expect(checkContact(c({ ...ok, phone: '561<b>5550100' })).phone).toBeTruthy();
    expect(checkContact(c({ ...ok, email: 'nope' })).email).toBeTruthy();
    expect(checkContact(c({ ...ok, zip: '3340' })).zip).toBeTruthy();
    expect(checkContact(c({ ...ok, name: 'x'.repeat(121) })).name).toBeTruthy();
    expect(checkContact(c({ ...ok, notes: 'x'.repeat(2001) })).notes).toBeTruthy();
    // markup in a name, odd email shapes (the database refuses them too)
    expect(checkContact(c({ ...ok, name: '<img src=x>' })).name).toBeTruthy();
    expect(checkContact(c({ ...ok, name: 'Bob "Q" Smith' })).name).toBeTruthy();
    expect(checkContact(c({ ...ok, email: 'a@b.co?cc=x%40evil.tld' })).email).toBeTruthy();
    expect(checkContact(c({ ...ok, name: "Mary O'Brien & Tom", email: 'Mary.OBrien+steel@Sub.Example.co' }))).toEqual({});
    expect(checkContact(c({ ...ok, notes: 'gate code <1234>' })).notes).toBeTruthy();
    expect(FIELD_ERRORS.bad_notes.field).toBe('notes');
    expect(FIELD_ERRORS.need_zip.field).toBe('zip');
  });
  it('error texts never mention the CRM and always give the phone number', () => {
    for (const code of ['link_expired', 'link_invalid', 'too_many', 'server', 'offline', 'bad_name']) {
      const t = sendErrorText(code);
      expect(t).not.toMatch(/crm/i);
      if (code !== 'bad_name') expect(t).toContain('561-771-5555');
    }
  });
});

describe('ZIP -> county', () => {
  it('matches the quote program ZIP table exactly', () => {
    const html = readFileSync(path.resolve(here, '../../public/quote-builder.html'), 'utf8');
    const prog = readProgramZips(html);
    expect(Object.keys(prog).length).toBe(FL_ZIP_COUNT);
    for (const [zip, county] of Object.entries(prog)) expect(countyForZip(zip)).toBe(county);
  });
  it('known ZIPs, unknown ZIPs and junk', () => {
    expect(countyForZip('33401')).toBe('Palm Beach');
    expect(countyForZip('33901')).toBe('Lee');
    expect(countyForZip('99999')).toBe(null);
    expect(countyForZip('3340')).toBe(null);
    expect(countyForZip(null)).toBe(null);
  });
});

describe('send body', () => {
  it('trims the contact, carries the design, spec, picture and honeypot', () => {
    const state = { schema: 'ss-web-design', v: 1, design: {}, ctx: {} };
    const b = submitBody({ token: TOK, contact: { name: ' Jane ', phone: ' 5615550100 ', email: '', zip: '33401', notes: ' hi ', website: '' }, state, spec: 's', image: null });
    expect(b).toEqual({ v: 2, t: TOK, name: 'Jane', phone: '5615550100', email: '', zip: '33401', notes: 'hi', website: '', design: state, spec: 's', image: null });
  });
  it('submitDesign / checkLink read the server answers', async () => {
    const ok = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    const bad = async () => new Response(JSON.stringify({ ok: false, error: 'link_expired' }), { status: 403 });
    const down = async () => {
      throw new Error('net');
    };
    const p = { token: TOK, contact: { ...EMPTY_CONTACT, name: 'J', phone: '5615550100' }, state: {}, spec: '', image: null };
    expect(await submitDesign(p, ok)).toEqual({ ok: true });
    expect(await submitDesign(p, bad)).toEqual({ ok: false, error: 'link_expired' });
    expect(await submitDesign(p, down)).toEqual({ ok: false, error: 'offline' });
    expect(await checkLink(TOK, async () => new Response(JSON.stringify({ status: 'expired' })))).toBe('expired');
    expect(await checkLink(TOK, async () => new Response('x', { status: 502 }))).toBe('offline');
    expect(await checkLink(TOK, down)).toBe('offline');
  });
  it('a stalled send gives up (weak signal) instead of hanging', async () => {
    const stall = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    const p = { token: TOK, contact: { ...EMPTY_CONTACT, name: 'J', phone: '5615550100' }, state: {}, spec: '', image: null };
    expect(await submitDesign(p, stall, 30)).toEqual({ ok: false, error: 'offline' });
  });
  it('database refusals: field ones mark a box; the limits each have their own words', () => {
    expect(FIELD_ERRORS.bad_name.field).toBe('name');
    expect(FIELD_ERRORS.bad_email.field).toBe('email');
    expect(FIELD_ERRORS.bad_phone.field).toBe('phone');
    expect(FIELD_ERRORS.need_contact.field).toBe('phone');
    expect(sendErrorText('link_full')).toMatch(/new one/);
    expect(sendErrorText('busy')).toMatch(/later today/);
    for (const c of ['link_full', 'busy']) expect(sendErrorText(c)).not.toMatch(/crm/i);
  });
});

// ── server/core.js against a fake PostgREST ──────────────────────────────
const CFG = { url: 'https://db.example.supabase.co', key: 'sb_publishable_test' };
function fakeDb(answer) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return answer(url, JSON.parse(init.body));
  };
  return { f, calls };
}
const rpcOk = (v) => new Response(JSON.stringify(v), { status: 200 });
const rpcErr = (m) => new Response(JSON.stringify({ code: 'P0001', message: m, details: null, hint: null }), { status: 400 });
const SITE = 'https://stormsafe-design.pages.dev';
const post = (body, headers = {}) =>
  new Request(`${SITE}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const goodBody = () => ({ v: 2, t: TOK, name: 'Jane', phone: '5615550100', email: 'jane@example.com', zip: '33401', notes: '', website: '', design: { schema: 'ss-web-design', v: 1, design: {} }, spec: 'spec', image: 'data:image/jpeg;base64,QUJD' });

describe('server: /api/submit', () => {
  it('calls submit_design with the key and the fields, answers ok', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    const r = await handleSubmit(post(goodBody()), CFG, db.f);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    // first the link check (small), then the design
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].url).toBe('https://db.example.supabase.co/rest/v1/rpc/design_link_status');
    expect(db.calls[0].body).toEqual({ p_token: TOK });
    expect(db.calls[1].url).toBe('https://db.example.supabase.co/rest/v1/rpc/submit_design');
    expect(db.calls[1].init.headers.apikey).toBe(CFG.key);
    expect(db.calls[1].body).toMatchObject({ p_token: TOK, p_name: 'Jane', p_phone: '5615550100', p_zip: '33401', p_spec: 'spec', p_image: 'data:image/jpeg;base64,QUJD' });
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
  it('passes the database refusals through as codes', async () => {
    for (const [m, status] of [['link_expired', 403], ['link_invalid', 403], ['too_many', 429], ['link_full', 403], ['busy', 429], ['bad_phone', 400], ['bad_image', 400]]) {
      const r = await handleSubmit(post(goodBody()), CFG, fakeDb((u) => (u.endsWith('design_link_status') ? rpcOk('ok') : rpcErr(m))).f);
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ ok: false, error: m });
    }
    const r = await handleSubmit(post(goodBody()), CFG, fakeDb((u) => (u.endsWith('design_link_status') ? rpcOk('ok') : rpcErr('relation "x" does not exist'))).f);
    expect(await r.json()).toEqual({ ok: false, error: 'server' }); // database internals never reach the page
  });
  it('never calls the database for junk', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    const cases = [
      [post('not json'), 400],
      [post([1, 2]), 400],
      [post({ ...goodBody(), t: 'short' }), 403],
      [post({ ...goodBody(), design: { schema: 'other' } }), 400],
      [post({ ...goodBody(), design: null }), 400],
      [post(goodBody(), { Origin: 'https://evil.example' }), 403],
      [new Request(`${SITE}/api/submit`, { method: 'GET' }), 405],
      [post('x'.repeat(MAX_BODY + 1)), 413],
      // no Content-Length (a streamed body): still stopped at the limit
      [new Request(`${SITE}/api/submit`, { method: 'POST', headers: { Origin: SITE }, duplex: 'half', body: new ReadableStream({ start(ctl) { for (let i = 0; i < 4; i++) ctl.enqueue(new Uint8Array(500_000)); ctl.close(); } }) }), 413],
    ];
    for (const [req, status] of cases) expect((await handleSubmit(req, CFG, db.f)).status).toBe(status);
    expect(db.calls).toHaveLength(0);
  });
  it('an unknown / expired link never gets the design sent to the database', async () => {
    for (const [st, code] of [['invalid', 'link_invalid'], ['expired', 'link_expired']]) {
      const db = fakeDb(() => rpcOk(st));
      const r = await handleSubmit(post(goodBody()), CFG, db.f);
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ ok: false, error: code });
      expect(db.calls.map((c) => c.url.split('/').pop())).toEqual(['design_link_status']);
    }
  });
  it('oversized design / odd picture stopped before the database', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    const big = { ...goodBody(), design: { schema: 'ss-web-design', pad: 'x'.repeat(262200) } };
    expect((await handleSubmit(post(big), CFG, db.f)).status).toBe(400);
    expect((await handleSubmit(post({ ...goodBody(), image: 'data:text/html;base64,PGI+' }), CFG, db.f)).status).toBe(400);
    expect((await handleSubmit(post({ ...goodBody(), image: 'data:image/jpeg;base64,' + 'A'.repeat(900001) }), CFG, db.f)).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
  it('phone, email and ZIP are all required (owner 10/19/26): refused before the database', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    for (const [body, code] of [
      [{ ...goodBody(), email: '' }, 'need_contact'],
      [{ ...goodBody(), email: '   ' }, 'need_contact'],
      [{ ...goodBody(), phone: '' }, 'need_contact'],
      [{ ...goodBody(), zip: '' }, 'need_zip'],
      [{ ...goodBody(), zip: '3340' }, 'need_zip'],
      [{ ...goodBody(), zip: 33401 }, 'need_zip'],
    ]) {
      const r = await handleSubmit(post(body), CFG, db.f);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ ok: false, error: code });
    }
    expect(db.calls).toHaveLength(0);
    expect((await handleSubmit(post({ ...goodBody(), zip: ' 33401 ' }), CFG, db.f)).status).toBe(200); // the database trims it
  });
  it('a tab still on the previous page build (no v marker) keeps the database rule: phone OR email, ZIP optional', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    const old = { ...goodBody(), email: '', zip: '' };
    delete old.v;
    const r = await handleSubmit(post(old), CFG, db.f);
    expect(r.status).toBe(200);
    expect(db.calls.map((c) => c.url.split('/').pop())).toEqual(['design_link_status', 'submit_design']);
    // the same body from the website is held to the new rule regardless of the marker
    const web = await handleSubmit(post(old, { Origin: 'https://stormsafe365.github.io' }), CFG, db.f);
    expect(web.status).toBe(400);
    expect(await web.json()).toEqual({ ok: false, error: 'need_contact' });
  });
  it('the website (stormsafe365.github.io) may post a design: preflight + CORS headers; strangers still refused', async () => {
    const WEB = 'https://stormsafe365.github.io';
    const pre = (origin) => new Request(`${SITE}/api/submit`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    const db = fakeDb(() => rpcOk('ok'));
    // the browser asks first
    const p = await handleSubmit(pre(WEB), CFG, db.f);
    expect(p.status).toBe(204);
    expect(p.headers.get('Access-Control-Allow-Origin')).toBe(WEB);
    expect(p.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(p.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(p.headers.get('Vary')).toBe('Origin');
    expect((await handleSubmit(pre('https://evil.example'), CFG, db.f)).status).toBe(403);
    expect((await handleSubmit(pre('https://evil.example'), CFG, db.f)).headers.get('Access-Control-Allow-Origin')).toBe(null);
    expect(db.calls).toHaveLength(0);
    // then the design, with the answer readable by the website
    const r = await handleSubmit(post(goodBody(), { Origin: WEB }), CFG, db.f);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(WEB);
    expect(db.calls).toHaveLength(2);
    // a refusal is readable too (the website shows nothing to the customer, but can log it)
    const bad = await handleSubmit(post({ ...goodBody(), zip: '' }, { Origin: WEB }), CFG, db.f);
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBe(WEB);
    // the page itself: no CORS headers needed, none given; a stranger: refused, no headers
    const same = await handleSubmit(post(goodBody()), CFG, db.f);
    expect(same.headers.get('Access-Control-Allow-Origin')).toBe(null);
    const evil = await handleSubmit(post(goodBody(), { Origin: 'https://evil.example' }), CFG, db.f);
    expect(evil.status).toBe(403);
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBe(null);
  });
  it('honeypot: pretends to work, stores nothing', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    const r = await handleSubmit(post({ ...goodBody(), website: 'http://spam' }), CFG, db.f);
    expect(await r.json()).toEqual({ ok: true });
    expect(db.calls).toHaveLength(0);
  });
  it('database unreachable -> server error, not a crash', async () => {
    const r = await handleSubmit(post(goodBody()), CFG, async () => {
      throw new Error('down');
    });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ ok: false, error: 'server' });
  });
});

describe('server: /api/link', () => {
  const get = (q) => new Request(`${SITE}/api/link${q}`);
  it('asks design_link_status and returns only the status', async () => {
    for (const s of ['ok', 'expired', 'invalid']) {
      const db = fakeDb(() => rpcOk(s));
      const r = await handleLink(get(`?t=${TOK}`), CFG, db.f);
      expect(await r.json()).toEqual({ status: s });
      expect(db.calls[0].body).toEqual({ p_token: TOK });
    }
  });
  it('bad token -> invalid without asking the database', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    expect(await (await handleLink(get('?t=x'), CFG, db.f)).json()).toEqual({ status: 'invalid' });
    expect(await (await handleLink(get(''), CFG, db.f)).json()).toEqual({ status: 'invalid' });
    expect(db.calls).toHaveLength(0);
  });
  it('database trouble -> 502', async () => {
    expect((await handleLink(get(`?t=${TOK}`), CFG, fakeDb(() => new Response('x', { status: 500 })).f)).status).toBe(502);
  });
});

describe('server: readLimited', () => {
  it('reads a small body, stops a big one', async () => {
    expect(await readLimited(new Request('https://x/', { method: 'POST', body: 'hello' }), 10)).toBe('hello');
    expect(await readLimited(new Request('https://x/', { method: 'POST', body: 'x'.repeat(11) }), 10)).toBe(null);
    expect(await readLimited(new Request('https://x/'), 10)).toBe('');
  });
});

describe('draft (this browser only)', () => {
  it('saves the design + contact per link and puts them back', async () => {
    const mem = new Map();
    globalThis.window = { localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } };
    try {
      const stop = keepDraft(TOK);
      const st = useWebStore.getState();
      st.setContact({ name: 'Jane', phone: '5615550100', website: 'bot' });
      st.update((d) => { d.width = 30; d.upgrades.colorScrews = true; });
      st.setZip('33401');
      await new Promise((r) => setTimeout(r, 500));
      stop();
      const saved = JSON.parse(mem.get('ss-design-draft:' + TOK));
      expect(saved.contact).toEqual({ name: 'Jane', phone: '5615550100', email: '', zip: '33401', notes: '' }); // no honeypot
      // a fresh page: reset, then restore
      useWebStore.setState({ contact: { name: '', phone: '', email: '', zip: '', notes: '', website: '' } });
      st.replace(cloneDesign(DEFAULT_DESIGN));
      expect(restoreDraft(TOK)).toBe(true);
      const now = useWebStore.getState();
      expect(now.design.width).toBe(30);
      expect(now.design.upgrades.colorScrews).toBe(true);
      expect(now.contact.name).toBe('Jane');
      expect(now.ctx.county).toBe('Palm Beach');
      expect(restoreDraft('Other_link_0123456789')).toBe(false);
      expect(restoreDraft(TOK, Date.now() + 1000 * 60 * 60 * 24 * 61)).toBe(false); // too old
      mem.set('ss-design-draft:' + TOK, '{not json');
      expect(restoreDraft(TOK)).toBe(false);
    } finally {
      delete globalThis.window;
    }
  });
  it('blocked storage: nothing breaks', () => {
    globalThis.window = { get localStorage() { throw new Error('blocked'); } };
    try {
      expect(restoreDraft(TOK)).toBe(false);
    } finally {
      delete globalThis.window;
    }
  });
});
