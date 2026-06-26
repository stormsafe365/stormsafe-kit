// One-off extractor: pulls pricing DATA literals out of the QTEPRO builder HTML
// and writes them to src/pricing/qtepro/data/*.json — guaranteeing the numbers
// match the builder (already verified vs Sensei/IdeaRoom) byte-for-byte.
//
// Logic functions (gBase, gLeg, …) are ported by hand; only data is extracted.
// Run: node scripts/extract-pricing.mjs <path-to-builder.html>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = process.argv[2];
if (!HTML) { console.error('usage: node extract-pricing.mjs <builder.html>'); process.exit(1); }

const html = readFileSync(HTML, 'utf8');
const sStart = html.indexOf('<script>');
const sEnd = html.lastIndexOf('</script>');
const src = html.slice(sStart + '<script>'.length, sEnd);

/**
 * From index `i` (pointing at an opening { or [), scan to the matching close,
 * skipping string literals, line comments, and block comments. Returns the
 * substring including both brackets.
 */
function extractBalanced(s, i) {
  const open = s[i];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j], n = s[j + 1];
    // comments
    if (c === '/' && n === '/') { const e = s.indexOf('\n', j); j = e < 0 ? s.length : e; continue; }
    if (c === '/' && n === '*') { const e = s.indexOf('*/', j + 2); j = e < 0 ? s.length : e + 1; continue; }
    // strings
    if (c === '"' || c === "'" || c === '`') {
      for (j++; j < s.length; j++) { if (s[j] === '\\') j++; else if (s[j] === c) break; }
      continue;
    }
    if (c === open || (open === '{' && c === '{') || (open === '[' && c === '[')) {
      if (c === open) depth++;
    }
    if (c === close) { depth--; if (depth === 0) return s.slice(i, j + 1); }
    // also track the opposite bracket type for nesting (objects with arrays etc.)
    if (open === '{' && c === '[') { /* handled by separate pass below */ }
  }
  throw new Error('unbalanced from ' + i);
}

// More robust balanced scan that tracks BOTH bracket types together.
function extractLiteral(s, fromIdx) {
  // find first { or [ at/after fromIdx
  let i = fromIdx;
  while (i < s.length && s[i] !== '{' && s[i] !== '[') i++;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j], n = s[j + 1];
    if (c === '/' && n === '/') { const e = s.indexOf('\n', j); j = e < 0 ? s.length : e; continue; }
    if (c === '/' && n === '*') { const e = s.indexOf('*/', j + 2); j = e < 0 ? s.length : e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (j++; j < s.length; j++) { if (s[j] === '\\') j++; else if (s[j] === c) break; }
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  throw new Error('unbalanced literal from ' + i);
}

function grab(varName) {
  const re = new RegExp('var\\s+' + varName + '\\s*=', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('not found: ' + varName);
  const lit = extractLiteral(src, m.index + m[0].length);
  // eslint-disable-next-line no-eval
  return (0, eval)('(' + lit + ')');
}

const SHARED = ['WIDTHS','LENGTHS','PV','PR','PB','HU','RDP_STD','RDP_CHAIN','RDP_HI',
  'EXT_SH','EXT_SH_30','EXT_BSC_30','EXT_L','SC','EC','CCI_WIDE_SC','CCI_WIDE_EC',
  'HI_LIFT_WIDTHS','HI_LIFT_HEIGHTS'];

const shared = {};
for (const name of SHARED) {
  try { shared[name] = grab(name); }
  catch (e) { console.error('  ! ' + name + ': ' + e.message); }
}

const MAN = grab('MANUFACTURERS');

// Report which MANUFACTURERS keys are functions (must be hand-ported) vs data.
const fnKeys = {};
for (const mk of Object.keys(MAN)) {
  fnKeys[mk] = Object.keys(MAN[mk]).filter((k) => typeof MAN[mk][k] === 'function');
}

const outDir = resolve(__dirname, '..', 'src', 'pricing', 'qtepro', 'data');
mkdirSync(outDir, { recursive: true });

// JSON.stringify drops function values automatically → pure data remains.
writeFileSync(resolve(outDir, 'shared-tables.json'), JSON.stringify(shared, null, 0));
writeFileSync(resolve(outDir, 'manufacturers.json'), JSON.stringify(MAN, null, 0));

// ── Summary (no big dumps) ───────────────────────────────────────────────────
const size = (v) => Array.isArray(v) ? `array[${v.length}]` : (v && typeof v === 'object' ? `obj{${Object.keys(v).length}}` : typeof v);
console.log('SHARED TABLES:');
for (const k of Object.keys(shared)) console.log(`  ${k}: ${size(shared[k])}`);
console.log('\nMANUFACTURERS data keys (functions excluded from JSON):');
for (const mk of Object.keys(MAN)) {
  const dataKeys = Object.keys(MAN[mk]).filter((k) => typeof MAN[mk][k] !== 'function');
  console.log(`  ${mk}: ${dataKeys.length} data keys, ${fnKeys[mk].length} fn keys`);
  console.log(`    data: ${dataKeys.join(', ')}`);
  console.log(`    fns : ${fnKeys[mk].join(', ')}`);
}

// ── Spot-checks against known-verified values ───────────────────────────────
const PVc = JSON.parse(JSON.stringify(shared.PV));
for (let i = 0; i < 10; i++) { PVc[26][i] = PVc[25][i]; PVc[46][i] = PVc[45][i]; }
const checks = [
  ['PV[46][5] (22x46 Vert) == 5890', PVc[46][5] === 5890],
  ['CCI commercialBase[46][?60 combLen]', MAN.CCI.commercialBase.rows[46][2] + MAN.CCI.commercialBase.rows[46][3] === 27790],
  ['SC[6][20] == 440', shared.SC[6][20] === 440],
  ['EC[12][6] == 540', shared.EC[12][6] === 540],
  ['RDP_STD 10x10 == 1050', shared.RDP_STD['10x10'] === 1050],
];
console.log('\nSPOT-CHECKS:');
for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
