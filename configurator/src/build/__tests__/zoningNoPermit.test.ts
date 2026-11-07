import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/7/26: "If i click not permitting - so no plans needed, no permit needed - then the zoning check list isn't
 * needed on the quotes". The quote PDF's Pre-Order Zoning Checklist page (zoningChecklistHTML) is left out when
 * Permitting = No; Yes, Customer Will Verify and not picked yet keep it (the program's own function, in a node vm).
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  const i = m.index + 1;
  let j = html.indexOf('{', i), depth = 0, inStr: string | null = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && html[j + 1] === '/') { j = html.indexOf('\n', j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(i, j + 1) + '\n';
}
const ctx = vm.createContext({});
vm.runInContext("var _G={perm:{value:''}}; function G(id){ return _G[id]||null; }\n" + grabFn('zoningChecklistHTML'), ctx);
const page = (perm: string | null) => vm.runInContext(perm === null ? '_G={}; zoningChecklistHTML()' : `_G={perm:{value:${JSON.stringify(perm)}}}; zoningChecklistHTML()`, ctx) as string;

describe('Pre-Order Zoning Checklist page on the quote PDF (owner 11/7/26)', () => {
  it('Permitting = No: no checklist page', () => {
    expect(page('no')).toBe('');
  });
  it('Yes, Customer Will Verify, not picked (and no field at all): the page as before', () => {
    for (const p of ['yes', 'verify', '', null]) {
      const h = page(p);
      expect(h).toMatch(/page-break-before:always/);
      expect(h).toMatch(/Questions to ask your building department/);
      expect(h).toMatch(/Building Department Contact/);
    }
  });
});
