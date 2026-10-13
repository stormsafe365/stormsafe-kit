/**
 * The customer page's state: the design (always normalized) + where the
 * visitor is. The 3D store (src/store/useBuildingStore) is DERIVED from it
 * (sync.ts) — the only thing that flows back is where a door was dragged.
 */
import { create } from 'zustand';
import { cloneDesign, DEFAULT_DESIGN, STATE_SCHEMA, STATE_VERSION, type WebContext, type WebDesign, type WebState } from './model/design';
import { normalizeDesign } from './model/normalize';
import { impactRequired } from './model/rules';

export type TabKey = 'size' | 'walls' | 'doors' | 'leantos' | 'colors';

interface WebStore {
  design: WebDesign;
  ctx: WebContext;
  /** Impact-rated windows + walk doors required (URL impact=1, or the county rule). */
  impact: boolean;
  tab: TabKey;
  /** Overlay text while a picture is being made (null = none). */
  busy: string | null;
  /** Edit a copy of the design; the result is normalized against the rules. */
  update: (edit: (d: WebDesign) => void) => void;
  /** Replace the design (a loaded / reset design), normalized. */
  replace: (d: WebDesign) => void;
  setCtx: (ctx: WebContext) => void;
  setTab: (t: TabKey) => void;
  setBusy: (m: string | null) => void;
}

/** Normalize with the impact rule of the design's own size (Okaloosa / Okeechobee depend on it). */
export function settle(d: WebDesign, ctx: WebContext): { design: WebDesign; impact: boolean } {
  const sized = normalizeDesign(d, false);
  const impact = impactRequired(ctx, sized);
  return { design: impact ? normalizeDesign(d, true) : sized, impact };
}

const EMPTY_CTX: WebContext = { zip: null, county: null, impactParam: null };

export const useWebStore = create<WebStore>((set, get) => ({
  ...settle(DEFAULT_DESIGN, EMPTY_CTX),
  ctx: EMPTY_CTX,
  tab: 'size',
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
