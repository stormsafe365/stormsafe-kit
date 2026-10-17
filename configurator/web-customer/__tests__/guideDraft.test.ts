// The building style picked in the guided questions comes back after a reload (the Size step keeps
// showing it instead of asking Garage / Carport / Garage + Carport again - owner 10/17/26).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restoreDraft, saveDraftNow } from '../src/draft';
import { useWebStore } from '../src/store';

const TOK = 'Ab3_-xYz0123456789ABCE';

describe('guided style in the draft', () => {
  // a stand-in browser storage (tests run without a browser), as in blankStart.test.ts
  const realWindow = (globalThis as { window?: unknown }).window;
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) },
    };
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });
  it('style, barn style and how they came in survive a reload', () => {
    const st = useWebStore.getState();
    st.setGuideStyle('ag');
    st.setGuideBarn('raised');
    st.setGuideMode('know');
    saveDraftNow(TOK);
    st.setGuideStyle(null);
    st.setGuideBarn(null);
    st.setGuideMode('help');
    expect(restoreDraft(TOK)).toBe(true);
    const after = useWebStore.getState();
    expect([after.guideStyle, after.guideBarn, after.guideMode]).toEqual(['ag', 'raised', 'know']);
    window.localStorage.removeItem(`ss-design-draft:${TOK}`);
  });
  it('a made-up value in a saved draft is ignored', () => {
    const st = useWebStore.getState();
    st.setGuideStyle(null);
    saveDraftNow(TOK);
    const raw = JSON.parse(window.localStorage.getItem(`ss-design-draft:${TOK}`)!);
    window.localStorage.setItem(`ss-design-draft:${TOK}`, JSON.stringify({ ...raw, gs: 'castle', gb: 'tower', gm: 'x' }));
    expect(restoreDraft(TOK)).toBe(true);
    expect(useWebStore.getState().guideStyle).toBe(null);
    window.localStorage.removeItem(`ss-design-draft:${TOK}`);
  });
});
