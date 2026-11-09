import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/9/26 (a window label "Rough opening size 36-1/4" x 62-1/4"" next to the spacing page's 3'0¼"×5'2¼"): "make option
 * to convert to inches in quotes that also reflect in contracts". #dim-units (Feet & inches / Inches), saved with the quote:
 * every opening's size + sill in inches on the spacing page, the 2D elevations, the contract floor plan and the revised layout.
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  const i = m.index + 1;
  let j = html.indexOf('{', i);
  let depth = 0;
  let inStr: string | null = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && html[j + 1] === '/') { j = html.indexOf('\n', j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(i, j + 1) + '\n';
}
const ctx = vm.createContext({ Math }) as unknown as { dimUnitsIn: () => boolean; _dimIn: (f: number) => string; _dimFtIn: (f: number) => string; __u: string };
vm.runInContext(grabFn('dimUnitsIn') + grabFn('_dim8') + grabFn('_dimIn') + grabFn('_dimFtIn') + "var __u='ftin'; function G(id){ return id==='dim-units'?{value:__u}:null; }", ctx as unknown as vm.Context);

describe('opening sizes in inches (#dim-units)', () => {
  it('the owner\'s rough opening reads 36¼" × 62¼" in inches, 3\'0¼" × 5\'2¼" in feet & inches', () => {
    expect(ctx._dimIn(36.25 / 12) + '×' + ctx._dimIn(62.25 / 12)).toBe('36¼"×62¼"');
    expect(ctx._dimFtIn(36.25 / 12) + '×' + ctx._dimFtIn(62.25 / 12)).toBe('3\'0¼"×5\'2¼"');
    expect(ctx._dimIn(4.16667)).toBe('50"');
  });
  it('dimUnitsIn follows the select (default: feet & inches)', () => {
    expect(ctx.dimUnitsIn()).toBe(false);
    ctx.__u = 'in';
    expect(ctx.dimUnitsIn()).toBe(true);
    ctx.__u = 'ftin';
  });
  it('wiring: the option (default feet & inches), saved with the quote, used by every opening label', () => {
    expect(html).toContain('<select id="dim-units"');
    expect(html).toContain('<option value="ftin" selected>');
    expect(html).toContain("    'dim-units',");
    expect(html).toContain("_f=((typeof dimUnitsIn==='function'&&dimUnitsIn())||(fo&&it.dispUnit==='in'))?_dimIn:_dimFtIn;");
    expect(html).toContain("function _foD(v){ return (typeof dimUnitsIn==='function'&&dimUnitsIn())?_dimIn(v):_dimFtIn(v); }");
    expect(html).toContain("if(typeof dimUnitsIn==='function'&&dimUnitsIn()) return _dimIn(it.w)+'\\u00D7'+_dimIn(it.h);");
    expect(html.split("var dispIn=(du&&du.value==='in')||dimUnitsIn();").length - 1).toBe(2);
  });
});
