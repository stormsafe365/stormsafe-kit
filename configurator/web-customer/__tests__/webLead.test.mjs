// Website leads (owner 11/4/26): server/lead.js reads the person out of a Wix Automations body and calls
// submit_web_lead() (CRM 026_web_leads.sql). Checked against a fake database.
import { describe, expect, it } from 'vitest';
import { handleLead, pickLead, LEAD_MAX_BODY } from '../server/lead.js';

const KEY = 'Kx_' + 'a'.repeat(40);
const CFG = { url: 'https://db.example.supabase.co/', key: 'sb_publishable_test' };
const req = (body, { k = KEY, kind = 'chat', method = 'POST', type = 'application/json', headers = {} } = {}) =>
  new Request(`https://stormsafe-design.pages.dev/api/lead?${k ? 'k=' + encodeURIComponent(k) + '&' : ''}${kind ? 'kind=' + kind : ''}`, {
    method,
    headers: { 'Content-Type': type, ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
function fakeDb(reply = 'new', status = 200) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, args: JSON.parse(init.body) });
    return new Response(JSON.stringify(status === 200 ? reply : { message: reply }), { status });
  };
  return { f, calls };
}
const quiet = () => {};

describe('pickLead: chosen fields (how the Wix automations are set up)', () => {
  it('reads name / email / phone / message', () => {
    expect(pickLead({ name: 'jackie guthart', email: 'jackie@example.com', phone: '5617192294', message: 'Hi' })).toEqual({
      name: 'jackie guthart', email: 'jackie@example.com', phone: '5617192294', zip: '', message: 'Hi',
    });
  });
  it('joins first + last name, any key spelling', () => {
    expect(pickLead({ 'First Name': 'Jackie', last_name: 'Guthart', Email: 'j@x.com' }).name).toBe('Jackie Guthart');
  });
  it('puts the other form fields in the message as Label: value', () => {
    const p = pickLead({ name: 'A B', email: 'a@b.com', phone: '(561) 555-0100', 'ZIP Code': '33401', 'Building type': 'Garage', Size: '30x40x12', Uses: ['RV', 'Shop'], Comments: 'ASAP' });
    expect(p.zip).toBe('33401');
    expect(p.message).toBe('ASAP\nBuilding type: Garage\nSize: 30x40x12\nUses: RV, Shop');
  });
  it('unwraps { data: {...} } ("Nest request body under data")', () => {
    expect(pickLead({ data: { name: 'N', email: 'n@x.com' } })).toMatchObject({ name: 'N', email: 'n@x.com' });
  });
  it('drops a bad email or a short phone instead of guessing', () => {
    const p = pickLead({ name: 'N', email: 'nope', phone: '12345', other: 'x' });
    expect(p.email).toBe('');
    expect(p.phone).toBe('');
  });
  it('never copies the key / kind into the message', () => {
    expect(pickLead({ name: 'N', email: 'n@x.com', kind: 'chat', k: KEY, key: KEY }).message).toBe('');
  });
  it('caps the message', () => {
    expect(pickLead({ email: 'n@x.com', message: 'm'.repeat(5000) }).message.length).toBe(1900);
  });
});

describe('pickLead: "All automation data" (nested, found by key name)', () => {
  const wix = {
    contactId: '1b2c-3d4e',
    contact: { name: { first: 'jackie', last: 'guthart' }, emails: [{ tag: 'MAIN', email: 'jackie@example.com' }], phones: [{ phone: '561-719-2294' }] },
    conversation: { id: 'abc', message: { text: 'Form Submitted via Chat', direction: 'BUSINESS_TO_PARTICIPANT' } },
    siteOwnerEmail: 'owner@stormsafesteel.com',
  };
  it('finds the person and the message, nothing else', () => {
    expect(pickLead(wix)).toEqual({ name: 'jackie guthart', email: 'jackie@example.com', phone: '561-719-2294', zip: '', message: 'Form Submitted via Chat' });
  });
  it('an anonymous chat has no contact', () => {
    const p = pickLead({ contactId: 'x', conversation: { message: { text: 'who is your manufacturer?' } } });
    expect(p.email + p.phone).toBe('');
    expect(p.message).toBe('who is your manufacturer?');
  });
});

describe('handleLead', () => {
  it('sends the person to submit_web_lead and answers ok', async () => {
    const db = fakeDb('new');
    const r = await handleLead(req({ name: 'Jackie', email: 'j@x.com', phone: '5617192294', message: 'Hi' }), CFG, db.f, quiet);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, result: 'new' });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].url).toBe('https://db.example.supabase.co/rest/v1/rpc/submit_web_lead');
    expect(db.calls[0].init.headers.apikey).toBe('sb_publishable_test');
    expect(db.calls[0].args).toEqual({ p_key: KEY, p_kind: 'chat', p_name: 'Jackie', p_email: 'j@x.com', p_phone: '5617192294', p_zip: '', p_message: 'Hi' });
  });
  it('takes the kind from the body too, and the form kind', async () => {
    const db = fakeDb('matched');
    const r = await handleLead(req({ kind: 'form', email: 'j@x.com' }, { kind: '' }), CFG, db.f, quiet);
    expect(await r.json()).toEqual({ ok: true, result: 'matched' });
    expect(db.calls[0].args.p_kind).toBe('form');
  });
  it('refuses without asking the database: no key, a malformed key, no kind, GET, junk, too big', async () => {
    const db = fakeDb();
    expect((await handleLead(req({ email: 'j@x.com' }, { k: '' }), CFG, db.f, quiet)).status).toBe(403);
    expect((await handleLead(req({ email: 'j@x.com' }, { k: 'short' }), CFG, db.f, quiet)).status).toBe(403);
    expect((await handleLead(req({ email: 'j@x.com' }, { k: KEY.slice(0, 20) + "'x" }), CFG, db.f, quiet)).status).toBe(403);
    expect((await handleLead(req({ email: 'j@x.com' }, { kind: 'sms' }), CFG, db.f, quiet)).status).toBe(400);
    expect((await handleLead(req({ email: 'j@x.com' }, { kind: '' }), CFG, db.f, quiet)).status).toBe(400);
    expect((await handleLead(req(null, { method: 'GET' }), CFG, db.f, quiet)).status).toBe(405);
    expect((await handleLead(req('not json{'), CFG, db.f, quiet)).status).toBe(400);
    expect((await handleLead(req({ message: 'x'.repeat(LEAD_MAX_BODY + 10) }), CFG, db.f, quiet)).status).toBe(413);
    expect(db.calls).toHaveLength(0);
  });
  it("passes the database's refusals on: wrong key 403, busy 429, anything else 502", async () => {
    expect((await handleLead(req({ email: 'j@x.com' }), CFG, fakeDb('bad_key', 400).f, quiet)).status).toBe(403);
    expect((await handleLead(req({ email: 'j@x.com' }), CFG, fakeDb('busy', 400).f, quiet)).status).toBe(429);
    const r = await handleLead(req({ email: 'j@x.com' }), CFG, fakeDb('relation "x" does not exist', 400).f, quiet);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ ok: false, error: 'server' });
    const down = async () => { throw new Error('network'); };
    expect((await handleLead(req({ email: 'j@x.com' }), CFG, down, quiet)).status).toBe(502);
  });
  it('accepts a form post too', async () => {
    const db = fakeDb('new');
    const r = await handleLead(req('name=Jo&email=jo%40x.com&phone=5615550100', { type: 'application/x-www-form-urlencoded' }), CFG, db.f, quiet);
    expect(r.status).toBe(200);
    expect(db.calls[0].args).toMatchObject({ p_name: 'Jo', p_email: 'jo@x.com', p_phone: '5615550100' });
  });
  it('logs field NAMES and the result, never the person', async () => {
    const lines = [];
    await handleLead(req({ name: 'Jackie Secret', email: 'secret@x.com', phone: '5617192294', message: 'private' }), CFG, fakeDb('new').f, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^lead chat: new; fields name,email,phone,message; found name,email,phone,message$/);
    expect(lines[0]).not.toMatch(/Secret|secret@|5617192294|private/);
  });
});
