import { describe, expect, it, vi } from 'vitest';
import { checkState, parseMessage, MAX_STATE_CHARS } from '../src/model/validate';
import { DEFAULT_ALLOWED_ORIGINS, originAllowed, parseAllowList, replyTarget } from '../src/model/origins';
import { handleMessage, referrerOrigin, type BridgeDeps } from '../src/bridge';
import { cloneDesign, DEFAULT_DESIGN, STATE_SCHEMA, type WebDesign } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';
import { parseCounty, parseImpact, parseParams, parseZip } from '../src/model/params';

const goodState = () => ({ schema: STATE_SCHEMA, v: 1, design: cloneDesign(DEFAULT_DESIGN) });

describe('parseMessage', () => {
  it('ignores anything that is not a customizer message', () => {
    for (const m of [null, undefined, 'ss-request-design', 42, [], {}, { type: 7 }, { type: 'resize', height: 900 }]) expect(parseMessage(m)).toBeNull();
  });
  it('reads a design request, its id and allViews', () => {
    expect(parseMessage({ type: 'ss-request-design' })).toEqual({ type: 'ss-request-design', allViews: false });
    expect(parseMessage({ type: 'ss-request-design', id: 'lead-1', allViews: true })).toEqual({ type: 'ss-request-design', id: 'lead-1', allViews: true });
    expect(parseMessage({ type: 'ss-request-design', id: 12 })).toMatchObject({ id: '12' });
    expect(parseMessage({ type: 'ss-request-design', allViews: 'yes' })).toMatchObject({ allViews: false });
  });
  it('drops an id that is not a short plain string', () => {
    expect(parseMessage({ type: 'ss-request-design', id: '<img onerror=x>' })).not.toHaveProperty('id');
    expect(parseMessage({ type: 'ss-request-design', id: 'x'.repeat(65) })).not.toHaveProperty('id');
    expect(parseMessage({ type: 'ss-request-design', id: { a: 1 } })).not.toHaveProperty('id');
  });
  it('reads a load request with its state', () => {
    const st = goodState();
    expect(parseMessage({ type: 'ss-load-design', id: 'r1', state: st })).toEqual({ type: 'ss-load-design', id: 'r1', state: st });
  });
});

describe('checkState — a saved design before it is reopened', () => {
  it('accepts a saved state', () => {
    const r = checkState(goodState());
    expect(r.ok).toBe(true);
  });
  it.each([
    [null, 'state must be an object'],
    [{ ...goodState(), schema: 'other' }, 'state.schema'],
    [{ ...goodState(), v: 2 }, 'unsupported state version'],
    [{ schema: STATE_SCHEMA, v: 1 }, 'state.design must be an object'],
    [{ ...goodState(), design: { ...goodState().design, type: 'barn' } }, 'design.type'],
    [{ ...goodState(), design: { ...goodState().design, width: '24' } }, 'design.width must be a number'],
    [{ ...goodState(), design: { ...goodState().design, openings: {} } }, 'design.openings must be an array'],
    [{ ...goodState(), design: { ...goodState().design, openings: Array.from({ length: 41 }, () => ({ kind: 'window', wall: 'left', pos: 2 })) } }, 'at most 40'],
    [{ ...goodState(), design: { ...goodState().design, openings: [{ kind: 'window', wall: 'left', pos: 'x' }] } }, 'numeric pos'],
    [{ ...goodState(), design: { ...goodState().design, leanTos: [1, 2, 3, 4, 5] } }, 'at most 4 lean-tos'],
    [{ ...goodState(), design: { ...goodState().design, leanTos: [{ side: 'Left Eave', width: 12 }] } }, 'side, width and length'],
    [{ ...goodState(), design: { ...goodState().design, wraps: 'FL' } }, 'design.wraps'],
    [{ ...goodState(), design: { ...goodState().design, colors: { roof: 5 } } }, 'design.colors.roof'],
    [{ ...goodState(), pad: 'x'.repeat(MAX_STATE_CHARS) }, 'too large'],
  ])('refuses %#', (state, msg) => {
    const r = checkState(state);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });
  it('normalizes what it accepts: unknown colors, sizes, ids, impossible walls', () => {
    const st = goodState();
    const d = st.design as WebDesign & Record<string, unknown>;
    d.colors.roof = 'neon-pink';
    d.width = 23.4;
    d.length = 999;
    d.openings = [
      { id: 'x', kind: 'rollup', wall: 'front', w: 11, h: 30, sill: 0, pos: 3, color: 'plaid' },
      { id: 'x', kind: 'window', wall: 'partition', w: 9, h: 9, sill: 0, pos: 2 },
      { id: 'y', kind: 'teleporter' as 'window', wall: 'left', w: 1, h: 1, sill: 0, pos: 2 },
    ];
    const r = checkState(st);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = normalizeDesign(r.design, false);
    expect(n.colors.roof).toBe('galvalume');
    expect(n.width).toBe(23);
    expect(n.length).toBe(200);
    expect(n.openings).toHaveLength(1); // partition without a carport, unknown kind: dropped
    expect(n.openings[0]).toMatchObject({ id: 'x', kind: 'rollup', w: 10, h: 10, color: 'white' }); // nearest size that fits a 10' gable
  });
  it('swaps walk doors and windows to impact-rated ones in an impact area', () => {
    const n = normalizeDesign(DEFAULT_DESIGN, true);
    expect(n.openings.find((o) => o.kind === 'walk')?.style).toBe('hiwind');
    expect(n.openings.find((o) => o.kind === 'window')?.style).toBe('hi');
    const d = cloneDesign(DEFAULT_DESIGN);
    d.openings[2].style = 'b3036';
    expect(normalizeDesign(d, true).openings[2]).toMatchObject({ style: 'hi3036', w: 2.5, h: 3 });
  });
});

describe('allowed origins', () => {
  const list = DEFAULT_ALLOWED_ORIGINS;
  it.each([
    'https://stormsafesteel.com',
    'https://www.stormsafesteel.com',
    'https://stormsafesteel.pages.dev',
    'https://staging.stormsafesteel.pages.dev',
    'https://a1b2c3.stormsafesteel.pages.dev',
    'https://www-stormsafesteel-com.filesusr.com',
    'http://localhost:5181',
    'http://127.0.0.1:5981',
  ])('allows %s', (o) => expect(originAllowed(o, list)).toBe(true));
  it.each([
    'https://evil.com',
    'https://stormsafesteel.com.evil.com',
    'https://evilstormsafesteel.pages.dev',
    'http://stormsafesteel.com',
    'https://other.pages.dev',
    'https://other-site.filesusr.com',
    'null',
    '',
    'https://*.stormsafesteel.pages.dev',
  ])('refuses %s', (o) => expect(originAllowed(o, list)).toBe(false));
  it('a configured list replaces the default; "null" only when listed; replies to null go to "*"', () => {
    const l = parseAllowList(' https://example.org , null ');
    expect(l).toEqual(['https://example.org', 'null']);
    expect(originAllowed('https://example.org', l)).toBe(true);
    expect(originAllowed('https://stormsafesteel.com', l)).toBe(false);
    expect(originAllowed('null', l)).toBe(true);
    expect(parseAllowList('')).toEqual(DEFAULT_ALLOWED_ORIGINS);
    expect(replyTarget('null')).toBe('*');
    expect(replyTarget('https://stormsafesteel.com')).toBe('https://stormsafesteel.com');
  });
  it('reads the embedding page origin from the referrer', () => {
    expect(referrerOrigin('https://www.stormsafesteel.com/customize?x=1')).toBe('https://www.stormsafesteel.com');
    expect(referrerOrigin('')).toBeNull();
    expect(referrerOrigin('not a url')).toBeNull();
  });
});

describe('handleMessage — the postMessage bridge', () => {
  function deps(over: Partial<BridgeDeps> = {}) {
    const parent = { postMessage: vi.fn() };
    const d: BridgeDeps = {
      allow: DEFAULT_ALLOWED_ORIGINS,
      parent,
      getState: () => ({ schema: STATE_SCHEMA, v: 1, design: cloneDesign(DEFAULT_DESIGN), ctx: { zip: null, county: null, impact: false } }),
      getSpec: () => 'SPEC',
      capture: vi.fn(async () => ({ image: 'data:image/jpeg;base64,AAA', source: 'capture' as const })),
      load: vi.fn(),
      setBusy: vi.fn(),
      warn: vi.fn(),
      ...over,
    };
    return { d, parent };
  }
  const ORIGIN = 'https://www.stormsafesteel.com';

  it('answers a design request with state, spec and the picture, to the parent origin, echoing the id', async () => {
    const { d, parent } = deps();
    expect(await handleMessage({ data: { type: 'ss-request-design', id: 'q1' }, origin: ORIGIN, source: d.parent }, d)).toBe('replied');
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    const [msg, target] = parent.postMessage.mock.calls[0];
    expect(target).toBe(ORIGIN);
    expect(msg).toMatchObject({ type: 'ss-design', v: 1, id: 'q1', spec: 'SPEC', image: 'data:image/jpeg;base64,AAA', imageSource: 'capture' });
    expect(msg.state.schema).toBe(STATE_SCHEMA);
    expect(d.setBusy).toHaveBeenNthCalledWith(1, 'Preparing your picture…');
    expect(d.setBusy).toHaveBeenLastCalledWith(null);
  });

  it('still sends state + spec when the picture fails', async () => {
    const { d, parent } = deps({ capture: vi.fn(async () => Promise.reject(new Error('gl lost'))) });
    await handleMessage({ data: { type: 'ss-request-design' }, origin: ORIGIN, source: d.parent }, d);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ type: 'ss-design', image: null, spec: 'SPEC', error: 'picture failed: gl lost' });
  });

  it('ignores messages from anything but its own parent, refuses other origins', async () => {
    const { d, parent } = deps();
    expect(await handleMessage({ data: { type: 'ss-request-design' }, origin: ORIGIN, source: {} }, d)).toBe('ignored');
    expect(await handleMessage({ data: { type: 'ss-request-design' }, origin: 'https://evil.com', source: d.parent }, d)).toBe('refused');
    expect(await handleMessage({ data: { type: 'chat' }, origin: ORIGIN, source: d.parent }, d)).toBe('ignored');
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(d.warn).toHaveBeenCalledTimes(1);
    const top = deps({ parent: null });
    expect(await handleMessage({ data: { type: 'ss-request-design' }, origin: ORIGIN, source: null }, top.d)).toBe('ignored');
  });

  it('loads a good state and acknowledges; refuses a bad one with the reason', async () => {
    const { d, parent } = deps();
    await handleMessage({ data: { type: 'ss-load-design', id: 'L1', state: goodState() }, origin: ORIGIN, source: d.parent }, d);
    expect(d.load).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'ss-design-loaded', v: 1, id: 'L1', ok: true }, ORIGIN);
    await handleMessage({ data: { type: 'ss-load-design', id: 'L2', state: { schema: 'x', v: 1 } }, origin: ORIGIN, source: d.parent }, d);
    expect(d.load).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[1][0]).toMatchObject({ type: 'ss-design-loaded', id: 'L2', ok: false });
    expect(parent.postMessage.mock.calls[1][0].error).toContain('state.schema');
  });

  it('replies to "*" only for an allowed null origin', async () => {
    const { d, parent } = deps({ allow: ['null'] });
    await handleMessage({ data: { type: 'ss-load-design', state: goodState() }, origin: 'null', source: d.parent }, d);
    expect(parent.postMessage.mock.calls[0][1]).toBe('*');
  });
});

describe('URL parameters', () => {
  it('reads ZIP, county and impact', () => {
    expect(parseParams('?zip=33401&county=Palm%20Beach&impact=1')).toEqual({ zip: '33401', county: 'Palm Beach', impactParam: true });
    expect(parseParams('')).toEqual({ zip: null, county: null, impactParam: null });
  });
  it.each([
    ['33401', '33401'],
    ['33401-1234', '33401'],
    ['3340', null],
    ['abcde', null],
    [' 34957 ', '34957'],
  ])('zip %s', (v, out) => expect(parseZip(v)).toBe(out));
  it.each([
    ['Palm Beach', 'Palm Beach'],
    ['palm beach county', 'Palm Beach'],
    ['St Lucie', 'St. Lucie'],
    ['Saint Lucie County', 'St. Lucie'],
    ['st. johns', 'St. Johns'],
    ['miami dade', 'Miami-Dade'],
    ['Dade', 'Miami-Dade'],
    ['DESOTO', 'DeSoto'],
    ['Cook', null],
    ['<script>', null],
  ])('county %s', (v, out) => expect(parseCounty(v)).toBe(out));
  it('impact', () => {
    expect(parseImpact('1')).toBe(true);
    expect(parseImpact('yes')).toBe(true);
    expect(parseImpact('0')).toBe(false);
    expect(parseImpact('maybe')).toBeNull();
    expect(parseImpact(null)).toBeNull();
  });
});
