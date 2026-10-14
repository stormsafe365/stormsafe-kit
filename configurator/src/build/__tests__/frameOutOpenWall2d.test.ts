import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * The program's 2D building-view elevations (drawElev) — a framed opening on an
 * OPEN face (owner 10/14/26, display only). It used to close the whole face
 * ("doors need a wall") and draw a dark box in trim casing — a sheeted wall
 * that is not being sold. Now it stays open and the framed opening is steel
 * like the 3D: doubled jambs + header, the legs in it cut. Sheeted faces and
 * faces with a door / window keep the old drawing.
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
const e0 = html.indexOf('function drawElev(');
const elev = html.slice(e0, html.indexOf('\nfunction collectLTsForViews(', e0));
const els: Record<string, { innerHTML: string }> = {};
const ctx = vm.createContext({ document: { getElementById: (id: string) => (els[id] ??= { innerHTML: '' }) } });
vm.runInContext(
  `var _qwDraw=false; var QW_FO={box:'B',size:'S',sub:'U'}; function _qwTrimInk(h){return h;} function bldShade(h){return h;} function _dimFtIn(v){return v+'ft';} function MFR(){return {};}` +
    elev,
  ctx,
);
type Item = { type: string; x: number; w: number; h: number; yo?: number };
const draw = (wall: string, items: Item[], sidePanels: object | null, isSide = true): string => {
  vm.runInContext(
    `drawElev('t', ${isSide ? 30 : 24}, 10, 3, '#aaaaaa', '#bbbbbb', '#111111', '#cccccc', false, ${JSON.stringify(items)}, ${isSide}, 'Vertical', '${wall}', null, null, ${JSON.stringify(sidePanels)});`,
    ctx,
  );
  return els.t.innerHTML;
};
const FO: Item = { type: 'fo', x: 10, w: 10, h: 8 };
const BOX = 'rgba(10,20,35,0.55)';
// Posts / jambs / header are drawn in the visible trim tone (#111111 is dark -> #CCCCCC).
const steel = (svg: string) => (svg.match(/<rect [^>]*fill="#CCCCCC"\/>/g) ?? []).length;

describe('2D elevation: framed opening on an open face', () => {
  it('an open carport side with a 1-panel band stays open: no box, no casing; 4 jambs + a header replace the 3 legs in it', () => {
    const open = draw('Open', [FO], { hasPanels: true, ft: 3 });
    const bare = draw('Open', [], { hasPanels: true, ft: 3 });
    expect(open).not.toContain(BOX);
    expect(open).toContain('FRAMED OPENING');
    expect(steel(bare)).toBe(7); // legs at 0, 5 ... 30 ft
    // legs at 10 / 15 / 20 ft are gone (the opening reaches into the band: no stub), + 4 jamb tubes + 1 header
    expect(steel(open)).toBe(7 - 3 + 4 + 1);
  });
  it('an open side with no band: the legs keep their stub above the header', () => {
    const svg = draw('Open', [FO], null);
    expect(svg).not.toContain(BOX);
    expect(steel(svg)).toBe(7 + 4 + 1); // 3 cut legs keep a stub each
  });
  it('an open END (gable view): jambs + header between the corner posts', () => {
    const svg = draw('Open', [{ type: 'fo', x: 7, w: 10, h: 8 }], null, false);
    expect(svg).not.toContain(BOX);
    expect(steel(svg)).toBe(2 + 4 + 1);
  });
  it('a sheeted face keeps the trimmed box exactly as before', () => {
    const svg = draw('Closed', [FO], null);
    expect(svg).toContain(BOX);
  });
  it('a door / window on the open face still closes it (unchanged): the framed opening is the trimmed box there', () => {
    const svg = draw('Open', [FO, { type: 'wtd', x: 2, w: 3, h: 6.67 }], { hasPanels: true, ft: 3 });
    expect(svg).toContain(BOX);
  });
});
