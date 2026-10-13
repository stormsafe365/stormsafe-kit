import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 10/12/26: "Can you add a tab on the quoting tool so i can make the
 * background white if someone wants, someone's asking because they need to
 * print the quote but its background is too dark & taking up too much ink".
 *
 * The quote PDF has a Quote style: Dark (on-screen, default) / White
 * (print-friendly). White is the SAME document printQuote builds for Dark,
 * recoloured by quoteWhiteDoc (plus 3D pictures re-captured on a light
 * background). The fixtures are Dark quote documents captured from the program
 * BEFORE this change (3D Builder leanto-wrap 2ce0207, frozen date, images cut
 * to "AA"): a CCI carport like Robert Frick's (3D pages + spacing page), a
 * garage with doors and a wrapped lean-to (2D elevations + spacing page) and a
 * CA delivered-only quote with an additional discount (2D elevations). A
 * headless run of the new program reproduces each of them byte for byte in
 * Dark; here the White pass over them is checked.
 */

const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
const fixture = (n: string) => gunzipSync(readFileSync(fileURLToPath(new URL(`./fixtures/quote-dark-${n}.html.gz`, import.meta.url)))).toString('utf8');
const FIXTURES = ['carport-frick', 'garage-wrap', 'ca-delivered'];

// The program's own QUOTE STYLE block, run in a vm with a stand-in localStorage / document.
const a = html.indexOf("var QSTYLE_KEY='ss_quote_style';");
const z = html.indexOf('async function printQuote(){');
const BLOCK = html.slice(a, z);
type Btn = { attrs: Record<string, string>; getAttribute: (k: string) => string | null; setAttribute: (k: string, v: string) => void };
const btn = (style: string): Btn => {
  const attrs: Record<string, string> = { 'data-qstyle': style, 'aria-checked': 'false' };
  return { attrs, getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; } };
};
// The mobile action bar stand-in (what _mabRoom measures): shown + fixed, or hidden.
type Bar = { cs: { display: string; position: string }; getBoundingClientRect: () => { height: number } };
const bar = (height: number, shown = true): Bar => ({ cs: { display: shown ? 'flex' : 'none', position: 'fixed' }, getBoundingClientRect: () => ({ height }) });
type Program = {
  quoteStyle: () => string; setQuoteStyle: (v: string) => void; quoteWhiteDoc: (d: string) => string;
  QW_FILL: Record<string, object>; QW_TEXT: Record<string, object>; QW_LINE: Record<string, object>; QW_STROKE: Record<string, object>;
  _qwKeys: (l: string[][]) => Record<string, object>; _qwMap: (m: Record<string, object>, c: string, band?: boolean) => string;
  _qwTrimInk: (hex: string) => string; _qwDrawing: <T>(on: boolean, fn: () => T) => T; _qwDraw: boolean;
  QW_FO: { box: string; size: string; sub: string }; _mabRoom: () => void;
};
function program(store: Map<string, string> | null, mab: Bar | null = null, block = BLOCK) {
  const buttons = [btn('dark'), btn('white'), btn('dark'), btn('white')];
  const listeners: Record<string, (e: { key: string | null }) => void> = {};
  const cssProps: Record<string, string> = {};
  const ctx: Record<string, unknown> = {
    localStorage: store
      ? { getItem: (k: string) => (store.has(k) ? store.get(k) : null), setItem: (k: string, v: string) => { store.set(k, String(v)); } }
      : { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } },
    document: {
      querySelectorAll: (sel: string) => (sel === '.qstyle-b' ? buttons : []),
      querySelector: (sel: string) => (sel === '.mobile-action-bar' ? mab : null),
      documentElement: { style: { setProperty: (k: string, v: string) => { cssProps[k] = v; } } },
    },
    getComputedStyle: (el: Bar) => el.cs,
  };
  ctx.window = ctx;
  ctx.addEventListener = (t: string, f: (e: { key: string | null }) => void) => { listeners[t] = f; };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return { P: ctx as unknown as Program, buttons, listeners, store, cssProps };
}
const checked = (b: Btn[]) => b.map((x) => x.attrs['data-qstyle'] + ':' + x.attrs['aria-checked']).join(',');

// ── colour helpers for the structure checks ──
const COL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const hex = (c: string) => { c = c.toLowerCase(); return c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c; };
const rgba = (c: string): number[] => {
  if (c[0] === '#') { const h = hex(c); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1]; }
  const p = /rgba?\(([^)]*)\)/.exec(c)![1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
};
const onWhite = ([r, g, b, al]: number[]) => [r * al + 255 * (1 - al), g * al + 255 * (1 - al), b * al + 255 * (1 - al)];
const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const L_LIMIT = lum([0xe5, 0xe7, 0xeb]); // "no background darker than #e5e7eb"
// Paint colours (every hex in the MANUFACTURERS table) and the swatch / drawing bases: never theme colours.
const mi = html.indexOf('var MANUFACTURERS = {');
const PAINT = new Set((html.slice(mi, html.indexOf('function MFR()', mi)).match(/#[0-9a-fA-F]{6}\b/g) || []).map(hex));
['#9ea4aa', '#dde1e4', '#a8adb2', '#e6e9eb', '#999fa5', '#cfd3d6', '#b8bdc2', '#9ea5a8', '#1a1a1a', '#6b6360'].forEach((c) => PAINT.add(c));

type Finding = { c: string; where: string };
function scan(doc: string) {
  const darkBg: Finding[] = [], darkSvg: Finding[] = [], faintText: Finding[] = [];
  const decl = (css: string, tag: string | null) => css.replace(/(^|[{;\s])([a-zA-Z-]+)\s*:\s*([^;{}"']*)/g, (m, _p, prop: string, v: string) => {
    prop = prop.toLowerCase();
    const cols = v.match(COL) || [];
    if (/^background(-color|-image)?$/.test(prop)) for (const c of cols) {
      if (c[0] === '#' && PAINT.has(hex(c))) continue; // a paint swatch
      if (/^rgba\((0|255),(0|255),(0|255),/.test(c.replace(/\s/g, ''))) continue; // the swatch sheen / ribs
      if (hex(c) === '#1fcec4' && tag === 'span') continue; // the teal ROOF / WALLS tag pill (dark text on it)
      if (lum(onWhite(rgba(c))) < L_LIMIT) darkBg.push({ c, where: `${tag || 'css'} ${prop}:${v.slice(0, 60)}` });
    }
    if (prop === 'color') for (const c of cols) if (1.05 / (lum(onWhite(rgba(c))) + 0.05) < 3) faintText.push({ c, where: `${tag || 'css'} ${v.slice(0, 40)}` });
    return m;
  });
  doc.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/g, (m, css: string) => { decl(css, null); return m; });
  const THEME_DARK = ['#080f14', '#06101a', '#0d1117', '#111d28', '#08121d', '#0d1820', '#182535', '#1c2e3f', '#162840', '#151009', '#1a1e0a'];
  doc.replace(/<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g, (m, tag: string, attrs: string) => {
    attrs.replace(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (mm, an: string, v1?: string, v2?: string) => {
      const v = (v1 ?? v2) as string;
      if (an.toLowerCase() === 'style') decl(v, tag);
      else if (an.toLowerCase() === 'fill' && !/^(text|tspan)$/i.test(tag)) for (const c of v.match(COL) || []) if (THEME_DARK.includes(hex(c))) darkSvg.push({ c, where: tag });
      return mm;
    });
    return m;
  });
  return { darkBg, darkSvg, faintText };
}
const blankColours = (d: string) => d.replace(COL, 'C');
const visibleText = (d: string) => d.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);

describe('Quote style choice (Dark default, remembered per tool)', () => {
  it('defaults to Dark and paints the control', () => {
    const { P, buttons } = program(new Map());
    expect(P.quoteStyle()).toBe('dark');
    expect(checked(buttons)).toBe('dark:true,white:false,dark:true,white:false');
  });
  it("remembers the rep's choice in localStorage ('ss_quote_style')", () => {
    const store = new Map<string, string>();
    const { P, buttons } = program(store);
    P.setQuoteStyle('white');
    expect(store.get('ss_quote_style')).toBe('white');
    expect(P.quoteStyle()).toBe('white');
    expect(checked(buttons)).toBe('dark:false,white:true,dark:false,white:true');
    expect(program(store).P.quoteStyle()).toBe('white'); // next visit
    P.setQuoteStyle('nonsense');
    expect(P.quoteStyle()).toBe('dark');
  });
  it('anything but "white" in storage is Dark; blocked storage still works for the session', () => {
    expect(program(new Map([['ss_quote_style', 'WHITE']])).P.quoteStyle()).toBe('dark');
    const { P } = program(null);
    expect(P.quoteStyle()).toBe('dark');
    P.setQuoteStyle('white');
    expect(P.quoteStyle()).toBe('white');
  });
  it('follows a change made in another window of the tool (the CRM bar)', () => {
    const store = new Map<string, string>();
    const { buttons, listeners } = program(store);
    store.set('ss_quote_style', 'white');
    listeners.storage({ key: 'ss_quote_style' });
    expect(checked(buttons)).toBe('dark:false,white:true,dark:false,white:true');
  });
});

describe('the control sits next to SAVE / PRINT PDF', () => {
  const ctrl = /<div class="qstyle" role="radiogroup" aria-label="Quote style for SAVE \/ PRINT PDF">[\s\S]*?data-qstyle="dark"[^>]*>[\s\S]*?Dark \(on-screen\)<\/button>[\s\S]*?data-qstyle="white"[^>]*>[\s\S]*?White \(print-friendly\)<\/button>[\s\S]*?<\/div>/;
  it('in the summary panel, right above the buttons', () => {
    expect(html).toMatch(new RegExp(ctrl.source + '\\s*<div style="margin-top:10px" class="desktop-btns">\\s*<button class="sbtn" type="button" onclick="printQuote\\(\\)"'));
  });
  it('in the mobile action bar (the 3D Builder / CRM / NEWTOOL panes)', () => {
    expect(html).toMatch(new RegExp('<div class="mobile-action-bar">\\s*' + ctrl.source + '\\s*<button class="sbtn" type="button" onclick="printQuote\\(\\)"'));
  });
});

describe('printQuote wiring: Dark untouched, White recoloured', () => {
  const pq = html.slice(z, html.indexOf('\nfunction threeDPageHTML(', z));
  it('reads the style once', () => {
    expect(pq.match(/quoteStyle\(\)/g)).toHaveLength(1);
    expect(pq).toMatch(/var qWhite = \(quoteStyle\(\) === 'white'\);/);
  });
  it('Dark captures the 3D exactly as before; White asks for the light background', () => {
    expect(pq).toMatch(/imgs3D = await \(qWhite \? cap\(\{theme:'light'\}\) : cap\(\)\);/);
  });
  it('the finished document is recoloured only for White, and only the quote', () => {
    expect(pq.match(/quoteWhiteDoc\(/g)).toHaveLength(1);
    expect(pq).toMatch(/if\(qWhite\) fullDoc = quoteWhiteDoc\(fullDoc\);[\s\S]*if\(!_ssSavePdfViaElectron\(fullDoc, _ssPdfName\('Quote'\), pwin\)\)/);
    const contract = html.slice(html.indexOf('async function printContract(){'), html.indexOf('\nfunction _esc(s){'));
    expect(contract).not.toMatch(/quoteWhiteDoc|quoteStyle\(/);
  });
});

describe('White pages: the Dark document, light (fixtures from the program before this change)', () => {
  const { P } = program(new Map());
  for (const n of FIXTURES) {
    const dark = fixture(n);
    const white = P.quoteWhiteDoc(dark);
    it(`${n}: the Dark fixture really is dark`, () => {
      expect(dark).toContain('html,body{background:#080f14}');
      expect(scan(dark).darkBg.length).toBeGreaterThan(20);
    });
    it(`${n}: no background darker than #e5e7eb, no dark theme fill in the drawings`, () => {
      const s = scan(white);
      expect(s.darkBg).toEqual([]);
      expect(s.darkSvg).toEqual([]);
      expect(white).toContain('html,body{background:#ffffff}');
    });
    it(`${n}: every text colour reads on white (>= 3:1)`, () => {
      expect(scan(white).faintText).toEqual([]);
    });
    it(`${n}: only colours change — same content, same prices, same page order`, () => {
      expect(white).not.toBe(dark);
      expect(blankColours(white)).toBe(blankColours(dark));
      expect(visibleText(white)).toEqual(visibleText(dark));
      expect(white.split('page-break-before:always').length).toBe(dark.split('page-break-before:always').length);
    });
    it(`${n}: paint swatches and the drawn building keep their exact colours`, () => {
      for (const c of PAINT) {
        const re = new RegExp(c + '\\b', 'gi');
        expect((white.match(re) || []).length, c).toBe((dark.match(re) || []).length);
      }
    });
    it(`${n}: the warning / equipment boxes are orange, never amber or yellow`, () => {
      expect(white).not.toMatch(/#f59e0b|#e8b45a|#fbbf24/i);
    });
  }
  it('no theme colour the White pass swaps is a paint colour (CA, CCI, prints, doors)', () => {
    for (const m of [P.QW_FILL, P.QW_TEXT, P.QW_LINE]) for (const k of Object.keys(m)) expect(PAINT.has(k), k).toBe(false);
  });
  it('the brand stays: teal headings (darker for print), teal rules, orange warnings', () => {
    const white = P.quoteWhiteDoc(fixture('carport-frick'));
    expect(white).toContain('.qhdr-title-text{font-size:22pt;font-weight:900;color:#0b8a82');
    expect(white).toContain('border-bottom:2px solid #1fcec4');
    expect(white).toMatch(/Equipment Required/);
    expect(white).toMatch(/qwarr-head" style="border-color:#f0883e;background:#fff3e9;color:#c2560f"/);
  });
  it('only colour declarations change: text, data and other attributes keep their characters', () => {
    const plain = '<div class="x" data-v="#080f14" title="color:#fff">#080f14 text; background:#111d28</div>';
    expect(P.quoteWhiteDoc(plain)).toBe(plain);
    expect(P.quoteWhiteDoc('<div style="background:#111d28;color:#fff">x</div>')).toBe('<div style="background:#ffffff;color:#0f1b2d">x</div>');
    // white labels drawn ON the building (an opening) stay white; page text turns dark
    expect(P.quoteWhiteDoc('<text fill="rgba(255,255,255,0.95)">17x14</text><text fill="#c2c0b6">24\'</text>')).toBe('<text fill="rgba(255,255,255,0.95)">17x14</text><text fill="#5a6370">24\'</text>');
  });
});

// ── Fixes from the 10/12 verification of the White style ──
const contrastOnWhite = (c: string) => 1.05 / (lum(onWhite(rgba(c))) + 0.05);
const contrast = (fg: number[], bg: number[]) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const pq = html.slice(z, html.indexOf('\nfunction threeDPageHTML(', z));

describe('White: one colour for a band and a panel (a re-themed copy — NEWTOOL)', () => {
  const { P } = program(new Map());
  // NEWTOOL's copy re-themes #1C2E3F (header bands, badges) and #111d28 (panels) into ONE colour, #34363A.
  const retheme = (t: string) => t.replace(/#1C2E3F|#111d28/gi, '#34363A');
  const N = program(new Map(), null, retheme(BLOCK)).P;
  it('keeps both entries: bold rules (bands, badges) get the band, every other rule the panel', () => {
    const m = P._qwKeys([['#34363A', '#e3ebf0', 'band'], ['#34363A', '#ffffff']]);
    expect([P._qwMap(m, '#34363a', true), P._qwMap(m, '#34363A', false)]).toEqual(['#e3ebf0', '#ffffff']);
    expect(N.quoteWhiteDoc('<div style="background:#34363A;color:#fff;font-weight:800">FRONT</div><div style="background:#34363A">x</div>'))
      .toBe('<div style="background:#e3ebf0;color:#0f1b2d;font-weight:800">FRONT</div><div style="background:#ffffff">x</div>');
    // the program's own colours: one entry each, any rule
    expect(P.quoteWhiteDoc('<div style="background:#1C2E3F">a</div><div style="background:#111d28;font-weight:700">b</div>'))
      .toBe('<div style="background:#e3ebf0">a</div><div style="background:#ffffff;font-weight:700">b</div>');
  });
  for (const n of FIXTURES) {
    it(`${n}: the re-themed copy's White pages are exactly the program's White pages`, () => {
      const dark = fixture(n);
      expect(retheme(dark)).not.toBe(dark);
      expect(N.quoteWhiteDoc(retheme(dark))).toBe(P.quoteWhiteDoc(dark));
    });
  }
});

describe('White: the spacing page outlines print as clear lines (also printed in black and white)', () => {
  const { P } = program(new Map());
  const BRIGHT = /^(#22d3c8|#a78bfa|#b8a6fb|#7fa6f0|#e58bb0|rgba\(167,\s*139,\s*250,)/i;
  for (const n of ['carport-frick', 'garage-wrap']) {
    it(`${n}: every stroke of the drawings reads >= 2:1 on white; door / window / opening / lean-to outlines >= 3.5:1`, () => {
      const white = P.quoteWhiteDoc(fixture(n));
      const a = white.indexOf('data-dim-page="1"');
      expect(a).toBeGreaterThan(0);
      const dims = white.slice(a, white.indexOf('page-break-before:always', a + 40));
      const strokes = [...dims.matchAll(/\sstroke="([^"]+)"/g)].map((m) => m[1]).filter((c) => c !== 'none' && !PAINT.has(hex(c)));
      expect(strokes.length).toBeGreaterThan(50);
      expect(strokes.filter((c) => contrastOnWhite(c) < 2)).toEqual([]);
      expect(strokes.filter((c) => BRIGHT.test(c))).toEqual([]);
      for (const c of ['#0b8a82', '#6b4fd8', '#3a62c2', '#b4407a', 'rgba(107,79,216,0.913)']) expect(contrastOnWhite(c), c).toBeGreaterThan(3.5);
      // the Dark spacing page is untouched (its accents are the on-screen brights)
      expect(fixture(n)).toMatch(/stroke="#a78bfa"|stroke="#22d3c8"|stroke="#e58bb0"/);
    });
  }
  it('a page rule (CSS border) keeps its light weight; only the drawings get the stronger ink', () => {
    expect(P.quoteWhiteDoc('<div style="border-right:1px solid rgba(255,255,255,.08)"></div>')).toBe('<div style="border-right:1px solid rgba(15,27,45,0.168)"></div>');
    expect(P.quoteWhiteDoc('<line stroke="rgba(255,255,255,.16)"/><rect stroke="rgba(167,139,250,.75)"/><rect stroke="#22d3c8"/>'))
      .toBe('<line stroke="rgba(15,27,45,0.412)"/><rect stroke="rgba(107,79,216,0.913)"/><rect stroke="#0b8a82"/>');
  });
});

describe('White: 2D elevations drawn for a white page', () => {
  const { P } = program(new Map());
  it('open posts / roof lines: the real trim colour (Dark draws a dark trim #CCCCCC); a very light trim mid grey', () => {
    expect(P._qwTrimInk('#1D1E20')).toBe('#1D1E20'); // Black trim: shows on white
    expect(P._qwTrimInk('#8A8A88')).toBe('#8A8A88');
    expect(P._qwTrimInk('#F2F1EA')).toBe('#8a939c'); // White trim would vanish on the white page
    expect(contrastOnWhite(P._qwTrimInk('#FFFFFF'))).toBeGreaterThan(3);
  });
  it('framed openings: a light box with dark labels (no big dark block to print)', () => {
    const box = onWhite(rgba(P.QW_FO.box));
    expect(lum(box)).toBeGreaterThan(L_LIMIT);
    expect(contrast(onWhite(rgba(P.QW_FO.size)), box)).toBeGreaterThan(7);
    expect(contrast(onWhite(rgba(P.QW_FO.sub)), box)).toBeGreaterThan(4.5);
    // the White pass leaves them as they are (not white-ink colours it re-inks)
    const svg = `<rect fill="${P.QW_FO.box}"/><text fill="${P.QW_FO.size}">17'x14'</text>`;
    expect(P.quoteWhiteDoc(svg)).toBe(svg);
  });
  it('the flag is on only inside _qwDrawing, and comes back off after a throw', () => {
    expect(P._qwDraw).toBe(false);
    expect(P._qwDrawing(true, () => P._qwDraw)).toBe(true);
    expect(P._qwDrawing(false, () => P._qwDraw)).toBe(false);
    expect(() => P._qwDrawing(true, () => { throw new Error('boom'); })).toThrow('boom');
    expect(P._qwDraw).toBe(false);
  });
  it('drawElev reads it (Dark exactly as before); only printQuote sets it, only for the White 2D building page', () => {
    const e0 = html.indexOf('function drawElev(');
    const elev = html.slice(e0, html.indexOf('\nfunction collectLTsForViews(', e0));
    expect(elev).toMatch(/var visTC=function\(hex\)\{if\(_qwDraw\)return _qwTrimInk\(hex\);var r=[^\n]*\)<60\?'#CCCCCC':hex;\};/);
    expect(elev).toContain(`fill="'+(_qwDraw?QW_FO.box:'rgba(10,20,35,0.55)')+'"/>`);
    expect(elev.match(/\(_qwDraw\?QW_FO\.(size|sub):'rgba\(255,255,255,0\.\d+\)'\)/g)).toHaveLength(4);
    expect(elev).not.toMatch(/fill="rgba\(10,20,35|fill="rgba\(255,255,255,0\.(95|92|75)\)"/);
    expect(html.match(/_qwDrawing\(/g)).toHaveLength(2); // the definition + the one call
    expect(pq).toMatch(/\(imgs3D && imgs3D\.iso\) \? threeDPageHTML\(imgs3D\) : _qwDrawing\(qWhite, buildingPageHTML\)\)/);
    expect(html.match(/_qwDraw\s*=/g)).toHaveLength(3); // var _qwDraw=false + the two in _qwDrawing
  });
});

describe('White: a 3D view that cannot take light pictures', () => {
  it('falls back to the 2D drawings instead of printing dark pictures in light boxes', () => {
    expect(pq).toMatch(/imgs3D = await \(qWhite \? cap\(\{theme:'light'\}\) : cap\(\)\);[^\n]*\n[^\n]*catch\(e\)\{[^\n]*\n[^\n]*\n[^\n]*\n\s*if\(qWhite && imgs3D && imgs3D\.theme !== 'light'\)\{[^\n]*imgs3D = null; \}/);
    // Dark ignores the flag: same capture, same pages as before
    expect(pq.match(/imgs3D\.theme/g)).toHaveLength(1);
  });
});

describe('mobile action bar (the panes in the 3D Builder / CRM / NEWTOOL): the form stays clear of it', () => {
  it('the room rule wins over the older `.left{padding:14px 14px 80px}` (higher specificity)', () => {
    const css = html.slice(0, html.indexOf('</style>'));
    expect(css).toContain('.mobile-action-bar .qstyle{flex:0 0 100%;margin:0}.qstyle-b{padding:7px 6px}.main>.left{padding-bottom:var(--mab-room,118px)}');
    expect(css).not.toMatch(/[}\s]\.left\{padding-bottom/);
    expect(html).toMatch(/<div class="main">\r?\n<div class="left">/);
  });
  it('measures the bar: room = its height + 18px, kept up to date on resize', () => {
    const a = program(new Map(), bar(137.4));
    expect(a.cssProps['--mab-room']).toBe('156px');
    expect(typeof a.listeners.resize).toBe('function');
    expect(program(new Map(), bar(100, false)).cssProps['--mab-room']).toBeUndefined(); // desktop: the bar is hidden
    expect(program(new Map(), null).cssProps['--mab-room']).toBeUndefined();
  });
});
