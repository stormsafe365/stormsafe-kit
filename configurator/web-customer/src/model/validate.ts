/**
 * postMessage shapes the customizer accepts, and the checks a saved design
 * passes before it is reopened. Everything that arrives from the parent page
 * is untrusted: unknown types are ignored, wrong shapes are refused with a
 * reason, and an accepted design is re-normalized (normalize.ts) so it can
 * only ever hold values the customer could have picked.
 *
 *   { type: 'ss-request-design', id?, allViews? }
 *   { type: 'ss-load-design', id?, state: { schema: 'ss-web-design', v: 1, design, ctx? } }
 */
import { STATE_SCHEMA, STATE_VERSION, type WebDesign } from './design';
import { MAX_LEANTO_OPENINGS, MAX_LEANTOS, MAX_OPENINGS } from './normalize';

export const MAX_STATE_CHARS = 256 * 1024;

export type IncomingMessage =
  | { type: 'ss-request-design'; id?: string; allViews: boolean }
  | { type: 'ss-load-design'; id?: string; state: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A request id the parent can match replies on: a short string or a finite number. */
function cleanId(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && /^[\w.:-]{1,64}$/.test(v)) return v;
  return undefined;
}

/** null = not a customizer message (ignore it silently). */
export function parseMessage(data: unknown): IncomingMessage | null {
  if (!isObj(data) || typeof data.type !== 'string') return null;
  const id = cleanId(data.id);
  if (data.type === 'ss-request-design') return { type: 'ss-request-design', ...(id ? { id } : {}), allViews: data.allViews === true };
  if (data.type === 'ss-load-design') return { type: 'ss-load-design', ...(id ? { id } : {}), state: data.state };
  return null;
}

export type StateCheck = { ok: true; design: WebDesign } | { ok: false; error: string };

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Structural check of a saved state (values are clamped later by normalizeDesign). */
export function checkState(state: unknown): StateCheck {
  if (!isObj(state)) return { ok: false, error: 'state must be an object' };
  let size = 0;
  try {
    size = JSON.stringify(state).length;
  } catch {
    return { ok: false, error: 'state is not plain JSON' };
  }
  if (size > MAX_STATE_CHARS) return { ok: false, error: 'state is too large' };
  if (state.schema !== STATE_SCHEMA) return { ok: false, error: `state.schema must be "${STATE_SCHEMA}"` };
  if (state.v !== STATE_VERSION) return { ok: false, error: `unsupported state version (expected ${STATE_VERSION})` };
  const d = state.design;
  if (!isObj(d)) return { ok: false, error: 'state.design must be an object' };
  if (!['garage', 'carport', 'combo'].includes(d.type as string)) return { ok: false, error: 'design.type must be garage, carport or combo' };
  for (const k of ['width', 'length', 'height'] as const) if (!finite(d[k])) return { ok: false, error: `design.${k} must be a number` };
  if (d.enclosedLength !== undefined && !finite(d.enclosedLength)) return { ok: false, error: 'design.enclosedLength must be a number' };
  if (!isObj(d.walls)) return { ok: false, error: 'design.walls must be an object' };
  if (!isObj(d.colors)) return { ok: false, error: 'design.colors must be an object' };
  for (const k of ['roof', 'walls', 'trim', 'wainscot']) {
    if ((d.colors as Record<string, unknown>)[k] !== undefined && typeof (d.colors as Record<string, unknown>)[k] !== 'string') {
      return { ok: false, error: `design.colors.${k} must be a string` };
    }
  }
  if (!Array.isArray(d.openings)) return { ok: false, error: 'design.openings must be an array' };
  if (d.openings.length > MAX_OPENINGS) return { ok: false, error: `at most ${MAX_OPENINGS} doors / windows` };
  for (const o of d.openings) {
    if (!isObj(o) || typeof o.kind !== 'string' || typeof o.wall !== 'string' || !finite(o.pos)) {
      return { ok: false, error: 'each opening needs kind, wall and a numeric pos' };
    }
  }
  const lts = d.leanTos ?? [];
  if (!Array.isArray(lts)) return { ok: false, error: 'design.leanTos must be an array' };
  if (lts.length > MAX_LEANTOS) return { ok: false, error: `at most ${MAX_LEANTOS} lean-tos` };
  for (const lt of lts) {
    if (!isObj(lt) || typeof lt.side !== 'string' || !finite(lt.width) || !finite(lt.length)) {
      return { ok: false, error: 'each lean-to needs side, width and length' };
    }
    const ops = lt.openings ?? [];
    if (!Array.isArray(ops) || ops.length > MAX_LEANTO_OPENINGS) return { ok: false, error: `a lean-to holds at most ${MAX_LEANTO_OPENINGS} doors / windows` };
    for (const o of ops) {
      if (!isObj(o) || typeof o.kind !== 'string' || typeof o.wall !== 'string' || !finite(o.pos)) {
        return { ok: false, error: 'each lean-to opening needs kind, wall and a numeric pos' };
      }
    }
  }
  if (d.upgrades !== undefined && !isObj(d.upgrades)) return { ok: false, error: 'design.upgrades must be an object' };
  if (d.wraps !== undefined && (!Array.isArray(d.wraps) || d.wraps.length > 4 || d.wraps.some((k) => typeof k !== 'string'))) {
    return { ok: false, error: 'design.wraps must be a list of corners' };
  }
  // Plain-JSON copy: drops functions / prototypes and anything non-serializable.
  const design = JSON.parse(JSON.stringify(d)) as WebDesign;
  if (!Array.isArray(design.leanTos)) design.leanTos = [];
  if (!Array.isArray(design.wraps)) design.wraps = [];
  return { ok: true, design };
}
