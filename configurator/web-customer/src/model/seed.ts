/**
 * The building a rep's design link opens on (the "seed"). It comes from the page's own server
 * (GET /api/link) as the same saved-design envelope the page keeps in a draft, and is treated as
 * untrusted: anything that is not a valid envelope means "no seed" and the page starts as usual.
 */
import { checkState } from './validate';
import { parseZip } from './params';
import type { WebDesign } from './design';

export interface Seed {
  design: WebDesign;
  /** The building's 5-digit ZIP (the county is found from it by the page), or null. */
  zip: string | null;
  /** The impact-rated windows / walk doors choice the building was quoted with (null = the county rule decides). */
  impact: boolean | null;
}

/** null = nothing usable. Values are clamped later by normalizeDesign (store.replace). */
export function parseSeed(raw: unknown): Seed | null {
  const chk = checkState(raw);
  if (!chk.ok) {
    if (raw != null) console.warn('Design link building not used:', chk.error);
    return null;
  }
  const ctx = (raw as { ctx?: { zip?: unknown; impact?: unknown } }).ctx;
  const z = ctx && typeof ctx === 'object' ? ctx.zip : null;
  const im = ctx && typeof ctx === 'object' ? ctx.impact : null;
  return { design: chk.design, zip: parseZip(typeof z === 'string' ? z : null), impact: typeof im === 'boolean' ? im : null };
}
