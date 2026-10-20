/**
 * The customer page's state: the design (always normalized) + where the
 * visitor is. The 3D store (src/store/useBuildingStore) is DERIVED from it
 * (sync.ts) — the only thing that flows back is where a door was dragged.
 */
import { create } from 'zustand';
import type { BarnStyle, GuideStyle } from './model/guide';
import { cloneDesign, DEFAULT_DESIGN, STATE_SCHEMA, STATE_VERSION, type WebContext, type WebDesign, type WebState } from './model/design';
import { normalizeDesign } from './model/normalize';
import { impactRequired } from './model/rules';
import { countyForZip } from './model/flZips';
import type { Seed } from './model/seed';
import { EMPTY_CONTACT, type Contact, type LinkStatus } from './model/link';

/** The guided start screens (null = the builder itself). */
export type GuideStep = 'resume' | 'welcome' | 'style' | 'barn' | 'size' | 'offline';

export type TabKey = 'size' | 'walls' | 'doors' | 'leantos' | 'upgrades' | 'colors' | 'send';

interface WebStore {
  design: WebDesign;
  ctx: WebContext;
  /** Impact-rated windows + walk doors required (URL impact=1, or the county rule). */
  impact: boolean;
  tab: TabKey;
  guide: GuideStep | null;
  setGuide: (g: GuideStep | null) => void;
  /** The building style picked in the guided questions (so Back from the builder returns to the sizes). */
  guideStyle: GuideStyle | null;
  setGuideStyle: (s: GuideStyle | null) => void;
  /** 'help' = the full questions (style, then sizes); 'know' = style only, then the builder to type exact sizes. */
  guideMode: 'help' | 'know';
  setGuideMode: (m: 'help' | 'know') => void;
  guideBarn: BarnStyle | null;
  setGuideBarn: (b: BarnStyle | null) => void;
  /** Overlay text while a picture is being made (null = none). */
  busy: string | null;
  /** Edit a copy of the design; the result is normalized against the rules. */
  update: (edit: (d: WebDesign) => void) => void;
  /** Replace the design (a loaded / reset design), normalized. */
  replace: (d: WebDesign) => void;
  setCtx: (ctx: WebContext) => void;
  setTab: (t: TabKey) => void;
  setBusy: (m: string | null) => void;
  /** The rep's design-link token (?t=) and what the server said about it. */
  token: string | null;
  link: LinkStatus;
  setLink: (token: string | null, link: LinkStatus) => void;
  /** The send form (kept while the customer moves between steps). */
  contact: Contact;
  setContact: (patch: Partial<Contact>) => void;
  /** Where the building goes: a 5-digit Florida ZIP sets the county (and the impact rule), as the quote does. */
  setZip: (zip: string) => void;
  /** The building the rep's link opened on (null = none): Start over goes back to it. */
  seed: Seed | null;
  setSeed: (s: Seed | null) => void;
  /** True while the page waits for the link's building: nothing is saved as a draft yet. */
  seedHold: boolean;
  setSeedHold: (b: boolean) => void;
  /** The one-time note on first opening the rep's building. */
  seedNote: boolean;
  setSeedNote: (b: boolean) => void;
  /** When the design was last sent (ms since epoch); null = not sent yet. */
  sentAt: number | null;
  setSent: (t: number | null) => void;
}

/** Normalize with the impact rule of the design's own size (Okaloosa / Okeechobee depend on it). */
export function settle(d: WebDesign, ctx: WebContext): { design: WebDesign; impact: boolean } {
  const sized = normalizeDesign(d, false);
  const impact = impactRequired(ctx, sized);
  return { design: impact ? normalizeDesign(d, true) : sized, impact };
}

/** The design is exactly the plain starting building (nothing built yet). */
export function isPlainStart(d: WebDesign, ctx: WebContext): boolean {
  return JSON.stringify(d) === JSON.stringify(settle(DEFAULT_DESIGN, ctx).design);
}

const EMPTY_CTX: WebContext = { zip: null, county: null, impactParam: null };

export const useWebStore = create<WebStore>((set, get) => ({
  ...settle(DEFAULT_DESIGN, EMPTY_CTX),
  ctx: EMPTY_CTX,
  tab: 'size',
  guide: null,
  setGuide: (guide) => set({ guide }),
  guideStyle: null,
  setGuideStyle: (guideStyle) => set({ guideStyle }),
  guideMode: 'help',
  setGuideMode: (guideMode) => set({ guideMode }),
  guideBarn: null,
  setGuideBarn: (guideBarn) => set({ guideBarn }),
  busy: null,
  update: (edit) => {
    const draft = cloneDesign(get().design);
    edit(draft);
    set(settle(draft, get().ctx));
  },
  replace: (d) => set(settle(d, get().ctx)),
  setCtx: (ctx) => set({ ctx, ...settle(get().design, ctx) }),
  setTab: (tab) => set({ tab }),
  setBusy: (busy) => set({ busy }),
  token: null,
  link: 'none',
  setLink: (token, link) => set({ token, link }),
  contact: { ...EMPTY_CONTACT },
  setContact: (patch) => set({ contact: { ...get().contact, ...patch } }),
  setZip: (raw) => {
    const zip = String(raw).replace(/\D/g, '').slice(0, 5);
    const full = zip.length === 5;
    const ctx: WebContext = { ...get().ctx, zip: full ? zip : null, county: full ? countyForZip(zip) : null };
    set({ ctx, contact: { ...get().contact, zip }, ...settle(get().design, ctx) });
  },
  seed: null,
  setSeed: (seed) => set({ seed }),
  seedHold: false,
  setSeedHold: (seedHold) => set({ seedHold }),
  seedNote: false,
  setSeedNote: (seedNote) => set({ seedNote }),
  sentAt: null,
  setSent: (sentAt) => set({ sentAt }),
}));

/** The saved state sent to the website (ss-design `state`). */
export function currentState(): WebState {
  const { design, ctx, impact } = useWebStore.getState();
  return {
    schema: STATE_SCHEMA,
    v: STATE_VERSION,
    design: cloneDesign(design),
    ctx: { zip: ctx.zip, county: ctx.county, impact },
  };
}
