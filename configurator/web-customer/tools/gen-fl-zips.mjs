// Writes web-customer/src/model/flZips.ts: Florida ZIP -> county, taken from the
// quote program's own ZIP table (public/quote-builder.html, `var ZIP = {...}`),
// so the design page names the same county the quote will. County names only:
// no cities, no prices. The test (__tests__/flZips.test.ts) re-reads the
// program and fails if the two drift apart.
//
//   node web-customer/tools/gen-fl-zips.mjs        (from configurator/)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const program = path.resolve(here, '../../public/quote-builder.html');
const out = path.resolve(here, '../src/model/flZips.ts');

/** { '33401': 'Palm Beach', ... } from the program source. */
export function readProgramZips(html) {
  const start = html.indexOf('var ZIP = {');
  if (start < 0) throw new Error('var ZIP = { not found in quote-builder.html');
  const end = html.indexOf('\n};', start);
  if (end < 0) throw new Error('end of the ZIP table not found');
  const map = {};
  const re = /'(\d{5})':\['[^']*','([^']+)'\]/g;
  let m;
  while ((m = re.exec(html.slice(start, end)))) map[m[1]] = m[2];
  if (Object.keys(map).length < 1000) throw new Error('ZIP table looks short: ' + Object.keys(map).length);
  return map;
}

/** County -> "32003 32006 ..." (sorted), the compact form stored in flZips.ts. */
export function groupByCounty(map) {
  const by = {};
  for (const [zip, county] of Object.entries(map)) (by[county] ||= []).push(zip);
  const keys = Object.keys(by).sort();
  return Object.fromEntries(keys.map((k) => [k, by[k].sort().join(' ')]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const grouped = groupByCounty(readProgramZips(readFileSync(program, 'utf8')));
  const body = Object.entries(grouped)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');
  const ts = `/**
 * Florida ZIP -> county, GENERATED from the quote program's ZIP table by
 * web-customer/tools/gen-fl-zips.mjs. Do not edit by hand. County names only.
 */
const BY_COUNTY: Record<string, string> = {
${body}
};

let index: Map<string, string> | null = null;

/** The county for a 5-digit Florida ZIP the quote program knows, else null. */
export function countyForZip(zip: string | null | undefined): string | null {
  if (!zip || !/^\\d{5}$/.test(zip)) return null;
  if (!index) {
    index = new Map();
    for (const [county, zips] of Object.entries(BY_COUNTY)) for (const z of zips.split(' ')) index.set(z, county);
  }
  return index.get(zip) ?? null;
}

export const FL_ZIP_COUNT = ${Object.values(grouped).reduce((n, v) => n + v.split(' ').length, 0)};
`;
  writeFileSync(out, ts);
  console.log(`wrote ${out}: ${Object.keys(grouped).length} counties`);
}
