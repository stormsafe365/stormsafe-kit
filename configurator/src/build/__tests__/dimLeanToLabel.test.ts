import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Dimensioned spacing page — the lean-to footprint label rule (verifier round 3,
 * 10/3/26), on the pricing program's OWN drawing function (public/quote-builder.html
 * dimElevSVG, extracted into a node vm):
 *
 *   a lean-to label is never drawn on top of any opening rectangle or opening
 *   label. Order: (1) inside the footprint when it fits clear of openings;
 *   (2) outside — above the lean-to roof line, centred, leader tick down to the
 *   footprint, inside the viewBox and clear of the peak / leg labels; (3) beside
 *   the footprint on the free side; (4) shortened to "LTn" with the full text in
 *   the card's legend line. Never a backing rectangle over an opening.
 *
 * Geometries: the round-3 repro builds N1–N3 and P (CCI gable-end lean-tos 10′
 * long, shorter than their own label, with a door inside the footprint), where the
 * previous rule painted a backing rectangle over the door's W×H label.
 */

const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

function grabVar(name: string): string {
  const m = new RegExp('\\n\\s*var ' + name + '\\s*=').exec(html);
  if (!m) throw new Error('no var ' + name);
  const i = html.indexOf('=', m.index) + 1;
  let depth = 0;
  let j = i;
  let inStr: string | null = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth === 0) break;
  }
  return 'var ' + name + '=' + html.slice(i, j) + ';\n';
}
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

let code = '';
for (const v of ['DIM_K', 'DIM_C', '_dimSvgN']) code += grabVar(v);
for (const f of ['_dimFtIn', '_dimIn', '_dimT', 'dimElevSVG']) code += grabFn(f);
code += 'this.dimElevSVG=dimElevSVG;';
const ctx: any = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const dimElevSVG: (...a: any[]) => string = ctx.dimElevSVG;

type Box = { x0: number; x1: number; y0: number; y1: number };
type Text = Box & { t: string; cls: string; x: number; y: number };
function parse(svg: string) {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.slice(1).map(Number);
  const texts: Text[] = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"( text-anchor="(\w+)")? font-size="([\d.]+)"([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const x = +m[1], y = +m[2], anchor = m[4] || 'start', size = +m[5], attrs = m[6], t = m[7];
    const w = t.length * size * 0.58, x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    const cls = (/class="([^"]+)"/.exec(attrs) || [])[1] || '';
    return { t, cls, x, y, x0, x1: x0 + w, y0: y - size * 0.9, y1: y + size * 0.2 };
  });
  const openings: Box[] = [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" fill="url\(#/g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[1] + +m[3], y1: +m[2] + +m[4] }));
  const footprints: Box[] = [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" fill="rgba\(167,139,250,\.05\)"/g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[1] + +m[3], y1: +m[2] + +m[4] }));
  const backings = [...svg.matchAll(/<rect [^>]*rx="2" fill="#0d1820"/g)].length;
  const ticks = [...svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" stroke="#a78bfa" stroke-opacity="\.8" stroke-width="1"\/>/g)].map((m) => ({ x: +m[1], y0: +m[2], y1: +m[4] }));
  const ltLabels = texts.filter((t) => t.cls === 'dim-lt');
  const openingLabels = texts.filter((t) => t.cls !== 'dim-lt' && (/×/.test(t.t) || /^sill /.test(t.t)));
  const otherLabels = texts.filter((t) => t.cls !== 'dim-lt' && (/^Peak/.test(t.t) || /^Center clearance/.test(t.t) || / leg$/.test(t.t) || /^frame lines/.test(t.t)));
  return { vb, texts, openings, footprints, backings, ticks, ltLabels, openingLabels, otherLabels };
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.y0 < b.y1 - 0.01 && a.y1 > b.y0 + 0.01;

// The front-gable card as dimSpacingPageHTML builds it: W, H, geometric peak,
// the wall's openings (collectElevItems), the CCI clearance figures, pitch,
// the lean-to as _dimLeanTos reads it (conn = min(H, low + w·pitch/12)).
const wtd = (x: number) => ({ type: 'wtd', x, w: 3, h: 6.67 });
function gable(W: number, H: number, items: any[], clr: { center: number; peak: number }, lt: { n: number; w: number; ll: number; low: number; start: number }) {
  const conn = Math.min(H, lt.low + lt.w * 3 / 12);
  const l = { n: lt.n, w: lt.w, ll: lt.ll, len: lt.ll, conn, low: lt.low, pitch: 3 };
  const svg = dimElevSVG(W, H, H + (W / 2) * 3 / 12, true, items, false, null, clr, { pitch: 3, ends: ['LEFT', 'RIGHT'], open: false, sideLeans: [], foot: [{ l, x0: lt.start }] });
  return { svg, notes: ctx.dimElevSVG.notes as string[], conn };
}
const BUILDS = {
  'N1 20x30x14 · walk 2′ · LT 12′ proj × 10′ at the left corner (8′ leg → conn 11′)': () =>
    gable(20, 14, [wtd(2)], { center: 16.5, peak: 17.583 }, { n: 1, w: 12, ll: 10, low: 8, start: 0 }),
  'N2 24x30x14 · walks 9′ + 18′ · LT 10′ × 10′ at 13′ (9′ leg → conn 11′6″)': () =>
    gable(24, 14, [wtd(9), wtd(18)], { center: 16.583, peak: 17.917 }, { n: 1, w: 10, ll: 10, low: 9, start: 13 }),
  'N3 20x30x14 · 10×10 roll-up 7.6′ + walk 3.6′ · LT 12′ × 10′ at 4′ (9′ leg → conn 12′)': () =>
    gable(20, 14, [{ type: 'rollup', x: 7.6, w: 10, h: 10 }, wtd(3.6)], { center: 16.5, peak: 17.583 }, { n: 1, w: 12, ll: 10, low: 9, start: 4 }),
  'P 30x40x12 · window 12.8′ (sill 4′2″) + walk 25′ · LT 12′ × 10′ at 20′ (9′ leg → conn 12′ = eave)': () =>
    gable(30, 12, [{ type: 'win', x: 12.8, w: 2.5, h: 2.5, yo: 4.1667 }, wtd(25)], { center: 13.1667, peak: 16.25 }, { n: 1, w: 12, ll: 10, low: 9, start: 20 }),
};

describe('spacing page — lean-to footprint label never covers an opening (round 3)', () => {
  for (const [name, build] of Object.entries(BUILDS)) {
    it(name, () => {
      const { svg, notes, conn } = build();
      const p = parse(svg);
      expect(p.backings, 'no backing rectangle anywhere').toBe(0);
      expect(p.ltLabels.length, 'one footprint label').toBe(1);
      const lab = p.ltLabels[0];
      expect(lab.t).toMatch(/^LT1 · \d+′ × 10′ lean-to$/); // these four have room above the roof line: full text, no legend
      expect(notes).toEqual([]);
      for (const o of p.openings) expect(overlaps(lab, o), `label ${JSON.stringify(lab)} over opening ${JSON.stringify(o)}`).toBe(false);
      for (const o of p.openingLabels) expect(overlaps(lab, o), `label over opening label "${o.t}"`).toBe(false);
      for (const o of p.otherLabels) expect(overlaps(lab, o), `label over "${o.t}"`).toBe(false);
      expect(lab.x0).toBeGreaterThanOrEqual(0); expect(lab.y0).toBeGreaterThanOrEqual(0);
      expect(lab.x1).toBeLessThanOrEqual(p.vb[0]); expect(lab.y1).toBeLessThanOrEqual(p.vb[1]);
      // the 10′ footprint is narrower than its label, so the label sits ABOVE the roof line (the dashed connection line),
      // centred on the lean-to, with a leader tick down to the footprint when there is a gap
      const fp = p.footprints[0];
      expect(fp).toBeTruthy();
      expect(lab.y1, 'label bottom above the footprint top (connection line at ' + conn + '′)').toBeLessThanOrEqual(fp.y0 + 0.5);
      expect(Math.abs(lab.x - (fp.x0 + fp.x1) / 2), 'centred on the lean-to').toBeLessThan(1);
      if (fp.y0 - lab.y1 > 4) {
        const tick = p.ticks.find((t) => t.x >= lab.x0 && t.x <= lab.x1 && t.y0 >= lab.y1 - 1 && t.y1 <= fp.y0 + 0.1);
        expect(tick, 'leader tick from the label down to the footprint').toBeTruthy();
      }
    });
  }

  it('last resort: "LTn" + legend line when neither inside, above nor beside fits (12′ eave, lean-to to the eave over a 10×10 roll-up, 12×12 next to it, frame-lines note above)', () => {
    // Right-Eave card: L = 30, conn 12 = eave (9′ leg + 12′ @ 3:12), footprint 0..10 filled by a 10×10 roll-up, a 12×12 at 11′, 5′ OC frame lines
    const l = { n: 1, w: 12, ll: 10, len: 10, conn: 12, low: 9, pitch: 3 };
    const svg = dimElevSVG(30, 12, 15.75, false, [{ type: 'rollup', x: 0, w: 10, h: 10 }, { type: 'rollup', x: 11, w: 12, h: 12 }], false, 'left', null,
      { ends: ['FRONT GABLE', 'BACK GABLE'], foot: [{ l, x0: 0 }], truss: [0, 5, 10, 15, 20, 25, 30], oc: 5 });
    const notes: string[] = ctx.dimElevSVG.notes;
    const p = parse(svg);
    expect(p.backings).toBe(0);
    expect(p.ltLabels.map((t) => t.t)).toEqual(['LT1']);
    expect(notes).toEqual(['LT1 = 12′ × 10′ lean-to']);
    const lab = p.ltLabels[0];
    for (const o of p.openings) expect(overlaps(lab, o)).toBe(false);
    for (const o of p.openingLabels) expect(overlaps(lab, o)).toBe(false);
    expect(lab.y0).toBeGreaterThanOrEqual(0);
  });

  it('inside the footprint when it fits (20′ lean-to on a 40′ eave, no openings): no tick, no legend', () => {
    const l = { n: 2, w: 10, ll: 20, len: 20, conn: 11.5, low: 9, pitch: 3 };
    const svg = dimElevSVG(40, 12, 15.75, false, [], false, 'left', null, { ends: ['FRONT GABLE', 'BACK GABLE'], foot: [{ l, x0: 10 }], truss: [], oc: 0 });
    const p = parse(svg);
    expect(ctx.dimElevSVG.notes).toEqual([]);
    expect(p.ltLabels.map((t) => t.t)).toEqual(['LT2 · 10′ × 20′ lean-to']);
    const lab = p.ltLabels[0], fp = p.footprints[0];
    expect(lab.x0).toBeGreaterThan(fp.x0); expect(lab.x1).toBeLessThan(fp.x1); expect(lab.y0).toBeGreaterThan(fp.y0); expect(lab.y1).toBeLessThan(fp.y1);
    expect(p.ticks.length).toBe(0);
  });
});
