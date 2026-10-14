import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Quote PDF "3D Building Rendering" + "Elevation Views" pages (owner 10/14/26: "too small ... like the gable views").
 * The pages use the page: cards share a 900-px-wide page (printed scaled to Letter = 1164 px tall) by their real
 * shape, gables side by side or stacked (whichever shows them bigger), and every picture is cropped to the
 * building (the capture's imgs[view+'Box']) plus a 4% margin. Runs the program's own threeDPageHTML in a node vm.
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function matchEnd(from: number): number {
  let depth = 0;
  let inStr: string | null = null;
  let j = html.indexOf('{', from);
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
  return j;
}
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
}
const ctx: Record<string, unknown> = { __f: { bw: '40', bl: '75', bh: '16', ws: 'Vertical', pitch: '2:12' } };
vm.createContext(ctx);
vm.runInContext(
  grabFn('threeDPageHTML') +
    "function G(id){ var v=__f[id]; return v==null?null:{ value:v, textContent:v }; }\nfunction buildingPageHTML(){ return 'NO-3D'; }\n",
  ctx,
);
const run = (imgs: Record<string, string>) => vm.runInContext('threeDPageHTML(' + JSON.stringify(imgs) + ')', ctx) as string;
const SRC = { iso: 'I', left: 'R', front: 'F', back: 'B', right: 'L' };
// card = width/height of every picture box, page by page
function cards(out: string) {
  const pages = out.split('page-break-before:always').slice(1);
  return pages.map((pg) => [...pg.matchAll(/<div style="width:(\d+)px;max-width:100%;margin:14px auto 0;[^>]*>(?:<div[^>]*>([A-Z ]+)<\/div>)?<div style="width:100%;height:(\d+)px/g)]
    .map((m) => ({ w: +m[1], h: +m[3], label: m[2] || 'ISO' })));
}
// page height as laid out: padding 48 + header 42 + caption 28 + per card: gap 14 + border 2 + label 30 + picture
const pageH = (cs: { h: number; label: string }[], side: boolean) =>
  48 + 42 + 28 + cs.reduce((s, c) => s + c.h + 16 + (c.label !== 'ISO' ? 30 : 0), 0) - (side ? Math.min(cs[0].h, cs[1].h) + 46 : 0);

describe('quote 3D pages use the page', () => {
  it('Kevin Marks 40x75x16 + 12x60 lean-to (his capture): gables stacked full width, every page under one Letter page', () => {
    const k = run({ ...SRC, isoAr: '1.47', leftAr: '3', frontAr: '2.4', backAr: '2.351', rightAr: '3',
      isoBox: '0.0786,0.0790,0.9214,0.9200', leftBox: '0.0729,0.1725,0.9271,0.8275', frontBox: '0.1350,0.1810,0.8640,0.8185',
      backBox: '0.2630,0.1805,0.9110,0.8345', rightBox: '0.0700,0.1705,0.9300,0.8295' });
    const [p1, p2] = cards(k);
    expect(p1.map((c) => c.label)).toEqual(['ISO', 'RIGHT EAVE SIDE']);
    expect(p2.map((c) => c.label)).toEqual(['FRONT', 'BACK', 'LEFT EAVE SIDE']);
    expect(k.includes('display:flex;justify-content:center')).toBe(false); // stacked, not side by side
    for (const c of [...p1, ...p2]) expect(c.w).toBeGreaterThan(600); // 10-14: gables 372 x 155
    expect(pageH(p1, false)).toBeLessThanOrEqual(1120);
    expect(pageH(p2, false)).toBeLessThanOrEqual(1120);
  });
  it('a square-ish gable (24x40 carport) sits side by side, bigger than before', () => {
    const k = run({ ...SRC, isoAr: '1.6', leftAr: '2.2', frontAr: '1.25', backAr: '1.25', rightAr: '2.2',
      frontBox: '0.08,0.08,0.92,0.92', backBox: '0.08,0.08,0.92,0.92' });
    const p2 = cards(k)[1];
    expect(k.includes('display:flex;justify-content:center')).toBe(true);
    expect(p2[0].w).toBe(p2[1].w);
    expect(p2[0].h).toBeGreaterThan(300); // 10-14: 320-px cap at 374 wide = 299
    expect(pageH(p2, true)).toBeLessThanOrEqual(1120);
  });
  it('any shape fits one printed page (gables 0.8-4, eaves 1.2-6, iso 1.3-2.2)', () => {
    for (const g of [0.8, 1, 1.3, 1.7, 2.2, 2.8, 4]) for (const e of [1.2, 2, 3, 4.5, 6]) for (const i of [1.3, 1.6, 2.2]) {
      const k = run({ ...SRC, isoAr: String(i), leftAr: String(e), rightAr: String(e), frontAr: String(g), backAr: String(g) });
      const side = k.includes('display:flex;justify-content:center');
      const [p1, p2] = cards(k);
      expect(pageH(p1, false), `iso ${i} eave ${e}`).toBeLessThanOrEqual(1120);
      expect(pageH(p2, side), `gable ${g} eave ${e}`).toBeLessThanOrEqual(1120);
      for (const c of [...p1, ...p2]) expect(c.w, `g${g} e${e} i${i}`).toBeLessThanOrEqual(852);
    }
  });
  it('crops the picture to the building box + 4% margin (no Box = the whole picture, as before)', () => {
    const k = run({ ...SRC, frontAr: '2', frontBox: '0.25,0.2,0.75,0.8' });
    // box 0.5 x 0.6 of a 2:1 picture = 1.0 x 0.6 picture-heights; pad = 0.04 * 1.0 = 0.04
    // -> x 0.23..0.77 (pad/ar = 0.02), y 0.16..0.84; crop 0.54 x 0.68 -> shown 185.185% x 147.059%, at -42.593% / -23.529%
    expect(k).toContain('<img src="F" style="position:absolute;left:-42.593%;top:-23.529%;width:185.185%;height:147.059%;max-width:none;display:block">');
    expect(k).toContain('<img src="B" style="position:absolute;left:0.000%;top:0.000%;width:100.000%;height:100.000%;max-width:none;display:block">');
  });
  it('no 3D pictures: the 2D building page, as before', () => {
    expect(run({})).toBe('NO-3D');
  });
});
