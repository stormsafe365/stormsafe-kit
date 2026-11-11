import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/11/26 (screenshot of a reopened quote: "Lean-tos (as originally quoted)", "Insulation (as originally quoted)"):
 * "remove the '(as originally quoted)'". The held-price rows print the short label; saved quotes whose hold-ref still
 * carries the long labels print it short too. Amounts and the unnamed remainder row unchanged.
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
const m = /\nfunction gHoldRows\(h\)\{[\s\S]*?\n\}\n/.exec(html.split('\r\n').join('\n'));
if (!m) throw new Error('gHoldRows not found');
type Ctx = { __ref: string; gHoldRows: (h: number) => Array<{ label: string; amt: number }> };
const ctx = vm.createContext({}) as unknown as Ctx;
vm.runInContext(m[0] + "var __ref=''; function gHold(){ return 0; } function G(id){ return id==='hold-ref'?{value:__ref}:null; }", ctx as unknown as vm.Context);

describe('held-price rows', () => {
  it('drop " (as originally quoted)" from every named row (saved long labels included)', () => {
    ctx.__ref = JSON.stringify({ parts: [
      { k: 'wideLean', label: 'Lean-tos (as originally quoted)', amt: 1200 },
      { k: 'insulLean', label: 'Insulation (as originally quoted)', amt: 210 },
      { k: 'leanOc', label: "Lean-to 4' OC framing (as originally quoted)", amt: -150 },
    ] });
    expect(ctx.gHoldRows(1300)).toEqual([
      { label: 'Lean-tos', amt: 1200 },
      { label: 'Insulation', amt: 210 },
      { label: "Lean-to 4' OC framing", amt: -150 },
      { label: 'Pricing as originally quoted', amt: 40 },
    ]);
  });
  it('amounts still add up to the hold; no hold = no rows', () => {
    ctx.__ref = JSON.stringify({ parts: [{ label: 'Side frames (as originally quoted)', amt: 300 }] });
    const rows = ctx.gHoldRows(300);
    expect(rows).toEqual([{ label: 'Side frames', amt: 300 }]);
    expect(ctx.gHoldRows(0)).toEqual([]);
  });
  it('the printed rows contain no "(as originally quoted)"', () => {
    expect(html).toContain(".split(' (as originally quoted)').join('')");
  });
});
