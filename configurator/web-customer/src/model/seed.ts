/**
 * The building a rep's design link opens on (the "seed"). It comes from the page's own server
 * (GET /api/link) as the same saved-design envelope the page keeps in a draft, and is treated as
 * untrusted: anything that is not a valid envelope means "no seed" and the page starts as usual.
 */
import { checkState } from './validate';
import { parseZip } from './params';
import { checkContact, EMPTY_CONTACT, NAME_BAD_RE } from './link';
import type { WebDesign } from './design';

/** What the rep already has for the customer (all optional; each checked with the send form's own rules). */
export interface SeedContact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface Seed {
  design: WebDesign;
  /** The building's 5-digit ZIP (the county is found from it by the page), or null. */
  zip: string | null;
  /** The impact-rated windows / walk doors choice the building was quoted with (null = the county rule decides). */
  impact: boolean | null;
  /** Name / phone / email to put in the send form (null = none usable). */
  contact: SeedContact | null;
}

/** Keeps only the values the send form would accept; anything else is ignored. */
export function cleanSeedContact(raw: unknown): SeedContact | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: SeedContact = {};
  const ok = (key: 'name' | 'phone' | 'email', v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    let s = v.trim();
    if (key === 'name') s = s.replace(new RegExp(NAME_BAD_RE.source, 'g'), '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    return checkContact({ ...EMPTY_CONTACT, [key]: s })[key] ? null : s;
  };
  for (const k of ['name', 'phone', 'email'] as const) {
    const v = ok(k, r[k]);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
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
  return { design: chk.design, zip: parseZip(typeof z === 'string' ? z : null), impact: typeof im === 'boolean' ? im : null, contact: cleanSeedContact((raw as { contact?: unknown }).contact) };
}
