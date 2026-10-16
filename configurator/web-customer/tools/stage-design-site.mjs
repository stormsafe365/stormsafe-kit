// Stage the customer design-link site for Cloudflare Pages (project
// "stormsafe-design", https://stormsafe-design.pages.dev). Run AFTER the web
// build wrote <out>/dist:
//
//   SS_WEB_OUT=<out>/dist npx vite build --config vite.web.config.ts
//   node web-customer/tools/stage-design-site.mjs <out> <path to CRM/.env.local>
//   cd <out> && npx -y wrangler@4 pages deploy dist --project-name stormsafe-design --branch main --commit-dirty=true
//
// It copies the server functions next to dist/, writes server/config.js (the
// database address + public key, from the CRM's .env.local — server side only,
// never inside dist/), adds dist/_headers, and refuses to stage if dist/ holds
// the key, a price table, or the words the customer must never see.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const [outArg, envArg] = process.argv.slice(2);
if (!outArg || !envArg) {
  console.error('usage: node stage-design-site.mjs <out folder> <CRM .env.local>');
  process.exit(2);
}
const out = path.resolve(outArg);
const dist = path.join(out, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) throw new Error(`${dist}\\index.html missing - run the web build first`);

// 1) database address + public (anon) key, server side only
const env = Object.fromEntries(
  readFileSync(envArg, 'utf8')
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || '')) throw new Error('VITE_SUPABASE_URL missing or odd in ' + envArg);
if (!key || key.length < 30) throw new Error('VITE_SUPABASE_ANON_KEY missing in ' + envArg);
// never the service-role key: a JWT anon key says "role":"anon"; a new publishable key starts sb_publishable_
if (key.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
  if (payload.role !== 'anon') throw new Error('refusing: the key in .env.local is not the anon key (role ' + payload.role + ')');
} else if (!key.startsWith('sb_publishable_')) throw new Error('refusing: unknown key type in .env.local');

mkdirSync(path.join(out, 'server'), { recursive: true });
cpSync(path.join(root, 'functions'), path.join(out, 'functions'), { recursive: true });
cpSync(path.join(root, 'server', 'core.js'), path.join(out, 'server', 'core.js'));
writeFileSync(path.join(out, 'server', 'config.js'), `// Written by stage-design-site.mjs. Server side only.\nexport const CONFIG = ${JSON.stringify({ url: url.replace(/\/+$/, ''), key })};\n`);

// 2) headers: no referrer (the link token is in the address), no indexing, no framing
writeFileSync(
  path.join(dist, '_headers'),
  [
    '/*',
    '  Referrer-Policy: no-referrer',
    '  X-Content-Type-Options: nosniff',
    '  X-Robots-Tag: noindex, nofollow',
    '  X-Frame-Options: DENY',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/',
    '  Cache-Control: no-cache',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
  ].join('\n'),
);

// 3) what must never be in the public files
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(dist);
const bad = [];
const NEVER = [
  [key, 'the database key'],
  ['supabase', 'the database address'],
  ['quote-builder', 'the quote program'],
  ['Send to CRM', 'CRM wording'],
  [' CRM', 'CRM wording'],
  ['Carolina Carports', 'a manufacturer name'],
  ['Sensei', 'a dealer tool name'],
];
for (const f of files) {
  if (!/\.(html|js|css|txt|json|_headers)$/.test(f) && !f.endsWith('_headers')) continue;
  const s = readFileSync(f, 'utf8');
  for (const [needle, what] of NEVER) if (needle && s.includes(needle)) bad.push(`${path.relative(out, f)}: ${what} ("${needle.slice(0, 20)}")`);
  // the shared estimator is aliased to a zeroed stub in the web build: its constants must all be 0
  const m = /marginMultiplier:([0-9.]+)/.exec(s);
  if (m && Number(m[1]) !== 0) bad.push(`${path.relative(out, f)}: estimator constants are not zeroed`);
}
if (!files.some((f) => f.endsWith('index.html'))) bad.push('no index.html');
if (bad.length) {
  console.error('NOT STAGED - public files contain:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log(`staged ${out}: dist (${files.length} files) + functions/api/{link,submit}.js + server/{core,config}.js`);
