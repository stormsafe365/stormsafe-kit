// The design page starts with a plain building (owner 10/16/26: "they get the link & the building
// already has [parts] on it ... it shouldnt have any doors windows nothing on it yet"), and a
// customer's draft saved before that loses the old starter parts only if they were never touched.
import { afterEach, describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN, hasWalkDoorOrWindow, OLD_STARTER_OPENINGS, STATE_SCHEMA, STATE_VERSION, withoutOldStarterParts, type WebDesign } from '../src/model/design';
import { normalizeDesign } from '../src/model/normalize';
import { buildSpec } from '../src/model/spec';
import { restoreDraft, keepDraft } from '../src/draft';
import { useWebStore } from '../src/store';
import { SAMPLE_DESIGN } from './sample';

const TOK = 'Ab3_-xYz0123456789ABCD';
const KEY = `ss-design-draft:${TOK}`;

describe('a plain building to start', () => {
  it('no doors, windows, framed openings or lean-tos', () => {
    expect(DEFAULT_DESIGN.openings).toEqual([]);
    expect(DEFAULT_DESIGN.leanTos).toEqual([]);
    expect(DEFAULT_DESIGN.wraps).toEqual([]);
    expect(DEFAULT_DESIGN.wainscot).toBe(false);
    for (const impact of [false, true]) expect(normalizeDesign(DEFAULT_DESIGN, impact).openings).toEqual([]);
  });
  it('the store starts plain, and the spec says so', () => {
    expect(useWebStore.getState().design.openings).toEqual([]);
    const s = buildSpec(normalizeDesign(DEFAULT_DESIGN, false), { zip: null, county: null, impact: false });
    expect(s).toContain('Doors, windows and framed openings: None');
  });
});

describe('old drafts: the starter parts come off only if untouched', () => {
  it('all three untouched come off; everything else stays', () => {
    const d = cloneDesign(SAMPLE_DESIGN);
    d.colors.roof = 'black';
    const out = withoutOldStarterParts(d);
    expect(out.openings).toEqual([]);
    expect(out.colors.roof).toBe('black');
  });
  it('also in an impact county (the page showed the rated walk door / window instead)', () => {
    const shown = normalizeDesign(cloneDesign(SAMPLE_DESIGN), true);
    expect(shown.openings.find((o) => o.kind === 'walk')?.style).not.toBe('std'); // the rated one was showing
    expect(withoutOldStarterParts(shown).openings).toEqual([]);
  });
  it('a starter part the customer moved, resized or changed: nothing comes off', () => {
    const moved = cloneDesign(SAMPLE_DESIGN);
    moved.openings[0].pos = 3;
    expect(withoutOldStarterParts(moved).openings).toHaveLength(3);
    const bigger = cloneDesign(SAMPLE_DESIGN);
    bigger.openings[0].w = 12;
    expect(withoutOldStarterParts(bigger).openings).toHaveLength(3);
    const black = cloneDesign(SAMPLE_DESIGN);
    black.openings[1].style = 'black';
    expect(withoutOldStarterParts(black).openings).toHaveLength(3);
    const gone = cloneDesign(SAMPLE_DESIGN);
    gone.openings.splice(2, 1); // the customer deleted the window and kept the rest
    expect(withoutOldStarterParts(gone).openings).toHaveLength(2);
  });
  it('any sign the customer worked on the doors keeps all of them (an added door, a lean-to door, openers)', () => {
    const added = cloneDesign(SAMPLE_DESIGN);
    added.openings.push({ id: 'o4', kind: 'rollup', wall: 'back', w: 10, h: 10, sill: 0, pos: 7, color: 'white' });
    expect(withoutOldStarterParts(added).openings.map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    const openers = cloneDesign(SAMPLE_DESIGN);
    openers.upgrades.openers = true;
    expect(withoutOldStarterParts(openers).openings).toHaveLength(3);
    const lean = cloneDesign(SAMPLE_DESIGN);
    lean.leanTos = [{ id: 'l1', side: 'Left Eave', width: 12, length: 30, start: 0, lowLeg: 8, walls: {}, openings: [{ id: 'lo1', kind: 'walk', wall: 'outer', w: 3, h: 80 / 12, sill: 0, pos: 4, style: 'std' }] } as unknown as WebDesign['leanTos'][number]];
    expect(withoutOldStarterParts(lean).openings).toHaveLength(3);
  });
  it('the Hi-Impact line only says "shown" when there is a walk door or window to show', () => {
    expect(hasWalkDoorOrWindow(DEFAULT_DESIGN)).toBe(false);
    expect(hasWalkDoorOrWindow(SAMPLE_DESIGN)).toBe(true);
    const plain = buildSpec(normalizeDesign(DEFAULT_DESIGN, true), { zip: '33401', county: 'Palm Beach', impact: true });
    expect(plain).toContain('impact-rated windows and walk-in doors (none in this design yet)');
    const withParts = buildSpec(normalizeDesign(SAMPLE_DESIGN, true), { zip: '33401', county: 'Palm Beach', impact: true });
    expect(withParts).toContain('impact-rated windows and walk-in doors (shown in this design)');
  });
  it('a plain design is left as it is', () => {
    const d = cloneDesign(DEFAULT_DESIGN);
    expect(withoutOldStarterParts(d)).toBe(d);
  });
});

describe('drafts on the phone', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
    useWebStore.getState().replace(cloneDesign(DEFAULT_DESIGN));
  });
  const fakeStorage = () => {
    const mem = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) },
    };
    return mem;
  };
  const draftOf = (design: WebDesign, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ t: Date.now(), ...extra, state: { schema: STATE_SCHEMA, v: STATE_VERSION, design }, contact: { name: 'Pat' }, tab: 'colors' });

  it('a draft saved before 10/16 (no marker): the untouched starter parts come off, the rest is kept', () => {
    const mem = fakeStorage();
    const d = cloneDesign(SAMPLE_DESIGN);
    d.colors.walls = 'burgundy';
    mem.set(KEY, draftOf(d));
    expect(restoreDraft(TOK)).toBe(true);
    const st = useWebStore.getState();
    expect(st.design.openings).toEqual([]);
    expect(st.design.colors.walls).toBe('burgundy');
    expect(st.contact.name).toBe('Pat');
  });
  it('a draft already SENT before 10/16 keeps its parts (the rep has that design)', () => {
    const mem = fakeStorage();
    mem.set(KEY, draftOf(cloneDesign(SAMPLE_DESIGN), { sentAt: Date.now() - 3600000 }));
    expect(restoreDraft(TOK)).toBe(true);
    expect(useWebStore.getState().design.openings).toHaveLength(3);
  });
  it('a draft saved by this page keeps every part, even ones placed like the old starters', () => {
    const mem = fakeStorage();
    mem.set(KEY, draftOf(cloneDesign(SAMPLE_DESIGN), { blankStart: 1 }));
    expect(restoreDraft(TOK)).toBe(true);
    expect(useWebStore.getState().design.openings.map((o) => o.id)).toEqual(OLD_STARTER_OPENINGS.map((o) => o.id));
  });
  it('this page saves its drafts with the marker', async () => {
    const mem = fakeStorage();
    const stop = keepDraft(TOK);
    try {
      useWebStore.getState().replace(cloneDesign(SAMPLE_DESIGN));
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      stop();
    }
    expect(JSON.parse(mem.get(KEY)!).blankStart).toBe(1);
  });
});
