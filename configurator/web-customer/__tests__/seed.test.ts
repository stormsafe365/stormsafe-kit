// A design link that opens on the lead's own building (the "seed"): parsing the untrusted seed,
// the link check on the page side (fetchLink), the start-up rules (applyLinkResult) and the draft hold.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSeed } from '../src/model/seed';
import { fetchLink, checkLink } from '../src/send';
import { applyLinkResult, beginHold, startOverDesign } from '../src/linkStart';
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
    expect(s.design).toBe(before);
    expect(s.guide).toBe('resume');
    expect(s.seed?.design.length).toBe(40);
    expect(s.seedNote).toBe(false);
  });
  it('no building / expired / offline / framed / unusable: the page is unchanged', () => {
    for (const [r, own] of [
      [{ status: 'ok', seed: null }, true],
      [{ status: 'expired', seed: null }, true],
      [{ status: 'offline', seed: null }, true],
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
