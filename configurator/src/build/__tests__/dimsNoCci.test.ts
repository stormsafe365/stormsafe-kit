import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/16/26: "the dimensions and frame & clearance should not reflect anything about CCI - this is being sent from
 * StormSafe on quotes". The Dimensions & Spacing page tiles + footnote say "approx." - never "CCI approx." / "Dealer Handbook".
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

describe('Dimensions & Spacing page: no CCI wording', () => {
  it('peak / interior clearance tiles and the footnote say approx. only', () => {
    expect(html).not.toContain('CCI approx');
    expect(html).not.toContain('CCI approximate');
    expect(html).not.toContain('(Dealer Handbook).');
    expect(html).toContain("+pitch+':12 \u00b7 approx.':pitch+':12 roof pitch']);");
    expect(html).toContain("+_dimFtIn(cc.center)+' (approx.)':'')]);");
    expect(html).toContain("'center, under the braces \u00b7 approx.']);");
    expect(html).toContain("' &nbsp;Center &amp; peak clearances are approximate.'");
  });
});
