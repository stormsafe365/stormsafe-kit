// Design link (owner 10/16/26): token parsing, the contact checks (same rules as
// the database), the ZIP -> county table (must match the quote program), the
// send body, and the server functions (server/core.js) against a fake database.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToken, checkContact, sendErrorText, EMPTY_CONTACT } from '../src/model/link';
import { countyForZip, FL_ZIP_COUNT } from '../src/model/flZips';
import { readProgramZips } from '../tools/gen-fl-zips.mjs';
import { submitBody, submitDesign, checkLink } from '../src/send';
import { handleLink, handleSubmit, MAX_BODY } from '../server/core.js';

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
  it('needs a name and a phone or an email', () => {
    expect(checkContact(c({}))).toMatchObject({ name: expect.any(String), phone: expect.any(String) });
    expect(checkContact(c({ name: 'Jane', phone: '561-555-0100' }))).toEqual({});
    expect(checkContact(c({ name: 'Jane', email: 'jane@example.com' }))).toEqual({});
  });
  it('rejects what the database rejects', () => {
    expect(checkContact(c({ name: 'Jane', phone: '555-0100' })).phone).toBeTruthy();
    expect(checkContact(c({ name: 'Jane', phone: '561<b>5550100' })).phone).toBeTruthy();
    expect(checkContact(c({ name: 'Jane', email: 'nope' })).email).toBeTruthy();
    expect(checkContact(c({ name: 'Jane', phone: '5615550100', zip: '3340' })).zip).toBeTruthy();
    expect(checkContact(c({ name: 'x'.repeat(121), phone: '5615550100' })).name).toBeTruthy();
    expect(checkContact(c({ name: 'Jane', phone: '5615550100', notes: 'x'.repeat(2001) })).notes).toBeTruthy();
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
    expect(b).toEqual({ t: TOK, name: 'Jane', phone: '5615550100', email: '', zip: '33401', notes: 'hi', website: '', design: state, spec: 's', image: null });
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
const goodBody = () => ({ t: TOK, name: 'Jane', phone: '5615550100', email: '', zip: '33401', notes: '', website: '', design: { schema: 'ss-web-design', v: 1, design: {} }, spec: 'spec', image: 'data:image/jpeg;base64,QUJD' });

describe('server: /api/submit', () => {
  it('calls submit_design with the key and the fields, answers ok', async () => {
    const db = fakeDb(() => rpcOk('ok'));
    const r = await handleSubmit(post(goodBody()), CFG, db.f);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].url).toBe('https://db.example.supabase.co/rest/v1/rpc/submit_design');
    expect(db.calls[0].init.headers.apikey).toBe(CFG.key);
    expect(db.calls[0].body).toMatchObject({ p_token: TOK, p_name: 'Jane', p_phone: '5615550100', p_zip: '33401', p_spec: 'spec', p_image: 'data:image/jpeg;base64,QUJD' });
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
  it('passes the database refusals through as codes', async () => {
    for (const [m, status] of [['link_expired', 403], ['link_invalid', 403], ['too_many', 429], ['bad_phone', 400], ['bad_image', 400]]) {
      const r = await handleSubmit(post(goodBody()), CFG, fakeDb(() => rpcErr(m)).f);
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ ok: false, error: m });
    }
    const r = await handleSubmit(post(goodBody()), CFG, fakeDb(() => rpcErr('relation "x" does not exist')).f);
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
    ];
    for (const [req, status] of cases) expect((await handleSubmit(req, CFG, db.f)).status).toBe(status);
    expect(db.calls).toHaveLength(0);
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
