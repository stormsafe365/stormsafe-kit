/**
 * Which pages may talk to the customizer over postMessage.
 *
 * Default list (override at build time with VITE_SS_ALLOWED_ORIGINS, comma
 * separated — see README.md):
 *   https://stormsafesteel.com, https://www.stormsafesteel.com   the live site
 *   https://stormsafesteel.pages.dev, https://*.stormsafesteel.pages.dev   staging + previews
 *   https://www-stormsafesteel-com.filesusr.com   the Wix HTML-embed frame (until the cutover)
 *   http://localhost:*, http://127.0.0.1:*   local testing (embed-test.html)
 *
 * Patterns: an exact origin, "https://*.example.com" (any subdomain, not the
 * bare domain), "http://host:*" (any port), or "null" (a file:// or sandboxed
 * parent — then the reply goes to "*", because a "null" origin cannot be
 * targeted). Messages from any other origin are ignored.
 */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://stormsafesteel.com',
  'https://www.stormsafesteel.com',
  'https://stormsafesteel.pages.dev',
  'https://*.stormsafesteel.pages.dev',
  'https://www-stormsafesteel-com.filesusr.com',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

/** "a, b ,c" → ['a','b','c'] (blank → the default list). */
export function parseAllowList(raw: string | undefined | null): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED_ORIGINS.slice();
}

function splitOrigin(o: string): { scheme: string; host: string; port: string } | null {
  const m = /^(https?):\/\/([a-z0-9.-]+|\*\.[a-z0-9.-]+)(?::(\d{1,5}|\*))?$/i.exec(o);
  return m ? { scheme: m[1].toLowerCase(), host: m[2].toLowerCase(), port: m[3] ?? '' } : null;
}

/** Does `origin` (MessageEvent.origin) match one of the patterns? */
export function originAllowed(origin: string, list: readonly string[]): boolean {
  if (typeof origin !== 'string' || !origin) return false;
  if (origin === 'null') return list.includes('null');
  const o = splitOrigin(origin);
  if (!o || o.host.startsWith('*')) return false;
  for (const pat of list) {
    if (pat === origin) return true;
    const p = splitOrigin(pat);
    if (!p || p.scheme !== o.scheme) continue;
    const hostOk = p.host.startsWith('*.') ? o.host.endsWith(p.host.slice(1)) && o.host.length > p.host.length - 1 : p.host === o.host;
    if (!hostOk) continue;
    if (p.port === '*' || p.port === o.port) return true;
  }
  return false;
}

/** Where a reply to `origin` is posted: the origin itself, or "*" only for a null (unknown) origin. */
export const replyTarget = (origin: string): string => (origin === 'null' ? '*' : origin);
