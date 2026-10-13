/**
 * URL parameters the website passes in: ?zip=33401&county=Palm%20Beach&impact=1
 *   zip     5 digits (ZIP+4 keeps the first 5); anything else is ignored
 *   county  a Florida county, any common spelling ("St Lucie", "Palm Beach County",
 *           "miami dade"); anything else is ignored
 *   impact  1 / true / yes = impact-rated windows + walk doors; 0 / false / no = not;
 *           absent = the county rule the quote applies (rules.impactRequired)
 */
import { FL_COUNTIES } from './catalog';
import type { WebContext } from './design';

export function parseZip(v: string | null | undefined): string | null {
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(String(v ?? ''));
  return m ? m[1] : null;
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/\bsaint\b/g, 'st')
    .replace(/[^a-z]/g, '');

const COUNTY_BY_KEY = new Map<string, string>(FL_COUNTIES.map((c) => [squash(c), c]));
COUNTY_BY_KEY.set('dade', 'Miami-Dade');

export function parseCounty(v: string | null | undefined): string | null {
  const raw = String(v ?? '').trim();
  if (!raw || raw.length > 40) return null;
  return COUNTY_BY_KEY.get(squash(raw)) ?? null;
}

export function parseImpact(v: string | null | undefined): boolean | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return null;
}

export function parseParams(search: string): WebContext {
  const p = new URLSearchParams(search);
  return { zip: parseZip(p.get('zip')), county: parseCounty(p.get('county')), impactParam: parseImpact(p.get('impact')) };
}
