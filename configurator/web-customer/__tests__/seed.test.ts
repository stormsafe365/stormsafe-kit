// A design link that opens on the lead's own building (the "seed"): parsing the untrusted seed,
// the link check on the page side (fetchLink), the start-up rules (applyLinkResult) and the draft hold.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSeed, cleanSeedContact } from '../src/model/seed';
import { fetchLink, checkLink } from '../src/send';
import { applyLinkResult, beginHold, prefillContact, startOverPlan, retryLinkCheck, runLinkCheck, startOverDesign } from '../src/linkStart';
import { restoreDraft, saveDraftNow } from '../src/draft';
import { useWebStore } from '../src/store';
import { cloneDesign, DEFAULT_DESIGN, OLD_STARTER_OPENINGS, type WebDesign } from '../src/model/design';

const TOK = 'Ab3_-xYz0123456789ABCF';

const leanTo = (id: string, side: string) => ({
  id,
  side,
  width: 12,
  length: 30,
  start: 0,
  lowLeg: 8,
  pitch: '2:12',
  enclosure: 'open',
  walls: { front: 'open', back: 'open', side: 'open' },
  openings: [],
});
function seedDesign(): WebDesign {
  const d = cloneDesign(DEFAULT_DESIGN);
  d.width = 24;
  d.length = 40;
  d.height = 12;
  d.openings = OLD_STARTER_OPENINGS.map((o) => ({ ...o }));
  d.leanTos = [leanTo('lt1', 'Left Eave') as never];
  return d;
}
const env = (design: unknown = seedDesign(), ctx: unknown = { zip: '33401', county: 'Palm Beach', impact: true }) => ({ schema: 'ss-web-design', v: 1, design, ctx });

describe('parseSeed', () => {
  it('accepts a valid envelope and keeps only a 5-digit ZIP and a boolean impact', () => {
    const s = parseSeed(env())!;
    expect(s.design.width).toBe(24);
    expect(s.design.openings).toHaveLength(3);
    expect(s.design.leanTos).toHaveLength(1);
    expect(s.zip).toBe('33401');
    expect(s.impact).toBe(true);
    const odd = parseSeed(env(seedDesign(), { zip: '<b>1</b>', county: 'x', impact: 'yes' }))!;
    expect(odd.zip).toBe(null);
    expect(odd.impact).toBe(null);
    expect(parseSeed(env(seedDesign(), { zip: 33401, impact: false }))!.zip).toBe(null);
    expect(parseSeed(env(seedDesign(), { zip: '33401-1234' }))!.zip).toBe('33401');
    expect(parseSeed({ ...env(), ctx: undefined })!.zip).toBe(null);
  });
  it('rejects everything that is not a valid building', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: unknown[] = [
      null,
      undefined,
      [],
      'ok',
      42,
      { schema: 'x' },
      { ...env(), schema: 'other' },
      { ...env(), v: 2 },
      env({ ...seedDesign(), type: 'fslean' }),
      env({ ...seedDesign(), width: NaN }),
      env({ ...seedDesign(), width: null }),
      env({ ...seedDesign(), openings: Array.from({ length: 41 }, (_, i) => ({ id: `o${i}`, kind: 'window', wall: 'left', pos: 1 })) }),
      env({ ...seedDesign(), leanTos: ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable', 'Left Eave'].map((s, i) => leanTo(`lt${i}`, s)) }),
      env({ ...seedDesign(), notes: 'x'.repeat(300000) }),
    ];
    for (const b of bad) expect(parseSeed(b)).toBe(null);
    warn.mockRestore();
  });
});

describe('seed contact (what the rep already has)', () => {
  const withC = (contact: unknown) => ({ ...env(), contact });
  it('is accepted and cleaned with the send form rules', () => {
    expect(parseSeed(withC({ name: 'Jane Doe', phone: '(561) 555-0100', email: 'Jane@Example.com' }))!.contact).toEqual({ name: 'Jane Doe', phone: '(561) 555-0100', email: 'Jane@Example.com' });
    expect(cleanSeedContact({ name: '  Jo <b>' + String.fromCharCode(34, 96) + 'Smith</b> ' })).toEqual({ name: 'Jo bSmith/b' });
    expect(cleanSeedContact({ phone: '12345', email: 'nope', name: '<>"' })).toBe(null);
    expect(cleanSeedContact({ phone: '561-555-0100 ext 5' })).toBe(null);
    expect(cleanSeedContact({ name: 'x'.repeat(121) })).toBe(null);
    expect(cleanSeedContact({ email: 'a@b.co'.padStart(200, 'x') })).toBe(null);
    expect(cleanSeedContact({ name: 5, phone: ['5615550100'], email: {} })).toBe(null);
    expect(cleanSeedContact([])).toBe(null);
    expect(cleanSeedContact('x')).toBe(null);
    expect(cleanSeedContact({ name: 'Jane', phone: 'bad' })).toEqual({ name: 'Jane' });
    expect(parseSeed(env())!.contact).toBe(null);
  });
});

describe('seed contact prefill on open', () => {
  beforeEach(() => {
    const st = useWebStore.getState();
    st.setCtx({ zip: null, county: null, impactParam: null });
    st.replace(DEFAULT_DESIGN);
    st.setSeed(null);
    st.setSeedHold(false);
    st.setContact({ name: '', phone: '', email: '', zip: '', notes: '' });
    st.setGuide(null);
  });
  const C = { name: 'Jane Doe', phone: '5615550100', email: 'jane@example.com' };
  it('no draft: the boxes are filled (zip stays empty: the page still asks for it)', () => {
    applyLinkResult(TOK, { status: 'ok', seed: { ...env(), contact: C } }, { own: true, restored: false, hold: false });
    const c = useWebStore.getState().contact;
    expect([c.name, c.phone, c.email]).toEqual(['Jane Doe', '5615550100', 'jane@example.com']);
  });
  it('never over what the customer typed; a restored draft is not prefilled', () => {
    useWebStore.getState().setContact({ name: 'Mine' });
    applyLinkResult(TOK, { status: 'ok', seed: { ...env(), contact: C } }, { own: true, restored: false, hold: false });
    expect(useWebStore.getState().contact.name).toBe('Mine');
    expect(useWebStore.getState().contact.phone).toBe('5615550100');
    useWebStore.getState().setContact({ name: '', phone: '', email: '' });
    applyLinkResult(TOK, { status: 'ok', seed: { ...env(), contact: C } }, { own: true, restored: true, hold: false });
    expect(useWebStore.getState().contact.name).toBe('');
  });
  it('prefillContact is what Start over uses to put them back', () => {
    prefillContact(null);
    prefillContact({ email: 'a@b.co' });
    expect(useWebStore.getState().contact.email).toBe('a@b.co');
  });
});


describe('brand-new design on a link with the rep building', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) },
    };
    useWebStore.getState().setSeedHold(false);
    useWebStore.getState().setLink(null, 'none');
    useWebStore.getState().setBlankFromSeed(false);
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });
  const seed = parseSeed(env())!;
  it('the plan: the rep design goes straight to the builder; a brand-new one starts the questions', () => {
    expect(startOverPlan(seed)).toEqual({ design: seed.design, guide: null, blank: false });
    expect(startOverPlan(seed, 'seed').guide).toBe(null);
    const b = startOverPlan(seed, 'blank');
    expect(b.design).toBe(DEFAULT_DESIGN);
    expect(b.guide).toBe('welcome');
    expect(b.blank).toBe(true);
    expect(startOverPlan(null)).toEqual({ design: DEFAULT_DESIGN, guide: 'welcome', blank: false });
    expect(startOverPlan(null, 'blank').blank).toBe(false);
  });
  it('the blank choice is kept in the draft, so the next visit is the plain-link one and the draft wins', () => {
    const st = useWebStore.getState();
    st.setBlankFromSeed(true);
    st.update((d) => {
      d.length = 44;
    });
    saveDraftNow(TOK);
    st.setBlankFromSeed(false);
    expect(restoreDraft(TOK)).toBe(true);
    expect(useWebStore.getState().blankFromSeed).toBe(true);
    expect(useWebStore.getState().design.length).toBe(44);
    // the rep building arriving after a restored draft changes nothing on the page
    applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: true, hold: false });
    expect(useWebStore.getState().design.length).toBe(44);
    expect(useWebStore.getState().seed).not.toBe(null);
    useWebStore.getState().setBlankFromSeed(false);
    saveDraftNow(TOK);
    useWebStore.getState().setBlankFromSeed(true);
    restoreDraft(TOK);
    expect(useWebStore.getState().blankFromSeed).toBe(false);
  });
});


describe('fetchLink / checkLink', () => {
  const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  it('returns the status and the building of a live link', async () => {
    const r = await fetchLink(TOK, answer({ status: 'ok', seed: env() }) as never);
    expect(r.status).toBe('ok');
    expect((r.seed as { schema: string }).schema).toBe('ss-web-design');
  });
  it('no building: null; never one for an expired / invalid link; arrays and strings dropped', async () => {
    expect(await fetchLink(TOK, answer({ status: 'ok' }) as never)).toEqual({ status: 'ok', seed: null });
    expect(await fetchLink(TOK, answer({ status: 'expired', seed: env() }) as never)).toEqual({ status: 'expired', seed: null });
    expect(await fetchLink(TOK, answer({ status: 'invalid', seed: env() }) as never)).toEqual({ status: 'invalid', seed: null });
    expect((await fetchLink(TOK, answer({ status: 'ok', seed: [] }) as never)).seed).toBe(null);
    expect((await fetchLink(TOK, answer({ status: 'ok', seed: 'x' }) as never)).seed).toBe(null);
  });
  it('trouble -> offline; a stalled check gives up', async () => {
    expect(await fetchLink(TOK, answer({}, 502) as never)).toEqual({ status: 'offline', seed: null });
    expect(await fetchLink(TOK, answer({ status: 'weird' }) as never)).toEqual({ status: 'offline', seed: null });
    expect(await fetchLink(TOK, (async () => { throw new Error('down'); }) as never)).toEqual({ status: 'offline', seed: null });
    const stall = ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as never;
    expect(await fetchLink(TOK, stall, 30)).toEqual({ status: 'offline', seed: null });
  });
  it('checkLink still answers with the status string', async () => {
    expect(await checkLink(TOK, answer({ status: 'ok', seed: env() }) as never)).toBe('ok');
    expect(await checkLink(TOK, answer({ status: 'expired' }) as never)).toBe('expired');
    expect(await checkLink(TOK, answer({}, 500) as never)).toBe('offline');
  });
});

describe('start-up with a link building', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  const mem = new Map<string, string>();
  let fresh: ReturnType<typeof useWebStore.getState>;
  beforeEach(() => {
    vi.useFakeTimers();
    mem.clear();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) },
    };
    const st = useWebStore.getState();
    st.setCtx({ zip: null, county: null, impactParam: null });
    st.replace(DEFAULT_DESIGN);
    st.setSeed(null);
    st.setSeedHold(false);
    st.setSeedNote(false);
    st.setGuideStyle(null);
    st.setGuideBarn(null);
    st.setBusy(null);
    st.setGuide(null);
    st.setLink(null, 'none');
    st.setContact({ name: '', phone: '', email: '', zip: '', notes: '' });
    st.setSent(null);
    fresh = useWebStore.getState();
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { window?: unknown }).window = realWindow;
  });

  it('no draft + building: the building opens, no questions, hold released', () => {
    beginHold();
    expect(useWebStore.getState().busy).toBeTruthy();
    useWebStore.getState().setGuide('welcome');
    let fitted = 0;
    applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: false, hold: true }, () => fitted++);
    const s = useWebStore.getState();
    expect(s.link).toBe('ok');
    expect(s.design.length).toBe(40);
    expect(s.design.leanTos).toHaveLength(1);
    expect(s.design.openings.length).toBeGreaterThanOrEqual(3);
    expect(s.guide).toBe(null);
    expect(s.seedHold).toBe(false);
    expect(s.busy).toBe(null);
    expect(s.seed).not.toBe(null);
    expect(s.seedNote).toBe(true);
    expect(s.ctx.zip).toBe('33401');
    expect(s.ctx.impactParam).toBe(true);
    expect(s.impact).toBe(true);
    expect(s.tab).toBe('size');
    vi.advanceTimersByTime(300);
    expect(fitted).toBe(1);
  });
  it('the quote\'s impact choice applies before the design: impact door / window styles match', () => {
    applyLinkResult(TOK, { status: 'ok', seed: env(seedDesign(), { zip: null, impact: true }) }, { own: true, restored: false, hold: false });
    const withImpact = useWebStore.getState().design.openings.find((o) => o.kind === 'walk')!;
    useWebStore.getState().setSeed(null);
    useWebStore.getState().setCtx({ zip: null, county: null, impactParam: null });
    applyLinkResult(TOK, { status: 'ok', seed: env(seedDesign(), { zip: null, impact: false }) }, { own: true, restored: false, hold: false });
    const without = useWebStore.getState().design.openings.find((o) => o.kind === 'walk')!;
    expect(withImpact.style).not.toBe(without.style);
  });
  it('draft + building: the draft is untouched, Welcome back stays, the building is remembered', () => {
    const mine = cloneDesign(DEFAULT_DESIGN);
    mine.length = 60;
    useWebStore.getState().replace(mine);
    useWebStore.getState().setGuide('resume');
    const before = useWebStore.getState().design;
    applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: true, hold: false });
    const s = useWebStore.getState();
    expect(s.design).toEqual(before);
    expect(s.guide).toBe('resume');
    expect(s.seed?.design.length).toBe(40);
    expect(s.seedNote).toBe(false);
  });
  it('no building / expired / framed / unusable: the page is unchanged', () => {
    for (const [r, own] of [
      [{ status: 'ok', seed: null }, true],
      [{ status: 'expired', seed: null }, true],
      [{ status: 'ok', seed: { schema: 'nope' } }, true],
      [{ status: 'ok', seed: env() }, false],
    ] as const) {
      const st = useWebStore.getState();
      st.replace(DEFAULT_DESIGN);
      st.setGuide('welcome');
      st.setSeedHold(true);
      st.setBusy('x');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      applyLinkResult(TOK, { status: r.status, seed: r.seed } as never, { own, restored: false, hold: true });
      warn.mockRestore();
      const s = useWebStore.getState();
      expect(s.design).toEqual(fresh.design);
      expect(s.guide).toBe('welcome');
      expect(s.seed).toBe(null);
      expect(s.seedHold).toBe(false);
      expect(s.busy).toBe(null);
    }
  });
  it('a saved draft + the quote saying no impact: the county rule no longer flips the doors / windows', () => {
    useWebStore.getState().setZip('33401'); // Palm Beach: impact by the county rule
    useWebStore.getState().replace(seedDesign());
    const walk = () => useWebStore.getState().design.openings.find((o) => o.kind === 'walk')!;
    const rated = walk().style;
    const before = JSON.stringify(useWebStore.getState().design.length);
    applyLinkResult(TOK, { status: 'ok', seed: env(seedDesign(), { zip: '33401', impact: false }) }, { own: true, restored: true, hold: false });
    expect(useWebStore.getState().ctx.impactParam).toBe(false);
    expect(walk().style).not.toBe(rated);
    expect(JSON.stringify(useWebStore.getState().design.length)).toBe(before);
    expect(useWebStore.getState().design.openings).toHaveLength(3);
  });
  it('an unreachable link (no draft): a clear screen, the hold stays, no blank draft is saved', () => {
    beginHold();
    useWebStore.getState().setLink(TOK, 'checking');
    useWebStore.getState().setGuide('welcome');
    applyLinkResult(TOK, { status: 'offline', seed: null }, { own: true, restored: false, hold: true });
    let s = useWebStore.getState();
    expect(s.guide).toBe('offline');
    expect(s.seedHold).toBe(true);
    expect(s.busy).toBe(null);
    s.setTab('walls');
    saveDraftNow(TOK);
    expect(mem.size).toBe(0);
  });
  it('Try again: the building opens when the second check works', async () => {
    const answers = [{ status: 'offline' as const, seed: null }, { status: 'ok' as const, seed: env() }];
    const fetcher = (async () => answers.shift()!) as never;
    beginHold();
    useWebStore.getState().setLink(TOK, 'checking');
    await runLinkCheck(TOK, { own: true, restored: false, hold: true }, () => {}, fetcher, 60_000);
    expect(useWebStore.getState().guide).toBe('offline');
    const p = retryLinkCheck();
    expect(useWebStore.getState().link).toBe('checking');
    await p;
    const s = useWebStore.getState();
    expect(s.guide).toBe(null);
    expect(s.design.length).toBe(40);
    expect(s.seedHold).toBe(false);
  });
  it('one automatic retry after a few seconds', async () => {
    const answers = [{ status: 'offline' as const, seed: null }, { status: 'ok' as const, seed: env() }];
    const fetcher = (async () => answers.shift()!) as never;
    beginHold();
    await runLinkCheck(TOK, { own: true, restored: false, hold: true }, () => {}, fetcher, 4000);
    expect(useWebStore.getState().guide).toBe('offline');
    await vi.advanceTimersByTimeAsync(4100);
    expect(useWebStore.getState().guide).toBe(null);
    expect(useWebStore.getState().design.length).toBe(40);
  });
  it('Start a blank design releases the hold; a late answer then changes nothing', () => {
    beginHold();
    applyLinkResult(TOK, { status: 'offline', seed: null }, { own: true, restored: false, hold: true });
    useWebStore.getState().setSeedHold(false);
    useWebStore.getState().setGuide('welcome');
    applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: false, hold: true });
    expect(useWebStore.getState().design).toEqual(fresh.design);
    expect(useWebStore.getState().guide).toBe('welcome');
  });
  it('an unreachable link after the customer began: no hijack, the hold is released', () => {
    beginHold();
    useWebStore.getState().setGuideStyle('garage');
    useWebStore.getState().setGuide('size');
    applyLinkResult(TOK, { status: 'offline', seed: null }, { own: true, restored: false, hold: true });
    expect(useWebStore.getState().guide).toBe('size');
    expect(useWebStore.getState().seedHold).toBe(false);
  });
  it('the busy screen is capped; the building still lands when it arrives late and nothing was touched', () => {
    beginHold();
    useWebStore.getState().setGuide('welcome');
    vi.advanceTimersByTime(2600);
    expect(useWebStore.getState().busy).toBe(null);
    expect(useWebStore.getState().seedHold).toBe(true);
    applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: false, hold: true });
    expect(useWebStore.getState().design.length).toBe(40);
    expect(useWebStore.getState().guide).toBe(null);
    expect(useWebStore.getState().seedHold).toBe(false);
  });
  it('a late building never replaces what the customer already began; it is remembered for Start over', () => {
    beginHold();
    vi.advanceTimersByTime(2600);
    useWebStore.getState().setGuideStyle('carport');
    useWebStore.getState().setGuide('size');
    useWebStore.getState().update((d) => {
      d.length = 50;
    });
    applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: false, hold: true });
    const s = useWebStore.getState();
    expect(s.design.length).toBe(50);
    expect(s.guide).toBe('size');
    expect(s.seed).not.toBe(null);
    expect(s.seedHold).toBe(false);
  });
  it('an untouched plain building is never saved while the link has not answered', () => {
    useWebStore.getState().setLink(TOK, 'checking');
    saveDraftNow(TOK);
    expect(mem.size).toBe(0);
    useWebStore.getState().setLink(TOK, 'offline');
    saveDraftNow(TOK);
    expect(mem.size).toBe(0);
    useWebStore.getState().update((d) => {
      d.length = 44;
    });
    saveDraftNow(TOK);
    expect(mem.size).toBe(1);
  });
  it('the hold is released even if applying the building throws', () => {
    beginHold();
    const real = useWebStore.getState().replace;
    useWebStore.setState({
      replace: () => {
        throw new Error('boom');
      },
    });
    expect(() => applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: false, hold: true })).toThrow('boom');
    useWebStore.setState({ replace: real });
    expect(useWebStore.getState().seedHold).toBe(false);
    expect(useWebStore.getState().busy).toBe(null);
  });
  it('saveDraftNow writes nothing while the page waits; afterwards it writes', () => {
    beginHold();
    saveDraftNow(TOK);
    expect(mem.size).toBe(0);
    expect(restoreDraft(TOK)).toBe(false);
    useWebStore.getState().setSeedHold(false);
    saveDraftNow(TOK);
    expect(mem.size).toBe(1);
  });
  it('Start over goes back to the building when there is one', () => {
    expect(startOverDesign(null)).toBe(DEFAULT_DESIGN);
    applyLinkResult(TOK, { status: 'ok', seed: env() }, { own: true, restored: false, hold: false });
    const seed = useWebStore.getState().seed!;
    expect(startOverDesign(seed)).toBe(seed.design);
    useWebStore.getState().replace(startOverDesign(seed));
    expect(useWebStore.getState().design.length).toBe(40);
    expect(useWebStore.getState().design.leanTos).toHaveLength(1);
  });
});
