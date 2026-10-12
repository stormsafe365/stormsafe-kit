import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner case 10/12/26 (Robert Frick, CCI carport 16x40x16, both sides closed): since 845415c (8/26/26) rc() mirrored a
 * carport's sp-left / sp-right into the Section-4 wall rows wle / wre (and a row edit back into 4B), so gWalls priced a
 * closed side ("Each Side Closed") and gSidePanels priced the same side again ("Side Panels - Left: Closed, ...").
 * Owner follow-up: "Why do you even have it twice" — a carport now has ONE control per eave side, 4B — Side Panels: the
 * Section-4 rows are hidden on a carport and never read for one (eaveVal), nothing is mirrored, a closed side is priced
 * once (gWalls via eaveVal) and partial panels price in gSidePanels. Runs the program's own functions in a vm.
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
const SIDE_OPTS = ['open', '1panel', '1_5panel', '2panel', '2_5panel', '3panel', '3_5panel', 'q1', 'q2', 'q3', 'closed'];
const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: {}, __el: {}, SIDE_OPTS };
vm.createContext(ctx);
vm.runInContext(
  ['gSidePanels', 'sidePanelLength', 'sideClosurePrice', 'cciUnits', 'cciPanelTiers', 'cciColUp', 'cpJTrim', 'eaveVal', 'cpEaveRows', 'cpAdoptSavedEaves', 'cpWallChanged', 'gWalls']
    .map(grabFn).join('') +
    // a DOM-ish G(): __f holds the field values; sp-left / sp-right carry their option lists; rows / notes carry a style
    'function G(id){ if(!(id in __f) && !/-row$|-note$/.test(id)) return null;\n' +
    '  if(!__el[id]) __el[id] = { id:id, style:{ display:"" }, options:(/^sp-/.test(id)?SIDE_OPTS.map(function(v){ return { value:v }; }):[]),\n' +
    '    get value(){ return __f[id]; }, set value(v){ __f[id]=v; }, get checked(){ return __f[id]===true; } };\n' +
    '  return __el[id]; }\n' +
    // a closed side = the both-sides chart halved (16 tall, 40 long: 2,365 / 2); the pair = PB p2 2,365; panels = PB p2 "Panels 3'"
    'function scLookup(h, l, w){ return 1183; }\nfunction scPairLookup(h, l, w){ return 2365; }\n' +
    'function ecLookup(){ return 0; }\nfunction gableOnlyCost(){ return 0; }\nfunction halfClosedCost(){ return 0; }\nfunction fsWalls(){ return 0; }\n' +
    'var SP = { full: {21:110, 26:130, 31:155, 36:175}, halfTrim: {21:220, 26:260, 31:310, 36:350}, tiers: [21,26,31,36] };\n' +
    'function MFR(){ return { sidePanels: SP, panelTier: function(l){ for (var i=0;i<SP.tiers.length;i++){ if (SP.tiers[i]>=l) return SP.tiers[i]; } return 36; } }; }\n',
  ctx,
);
const run = (js: string, f: Record<string, string>, mfr = 'CCI') =>
  vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; __el={}; ${js}`, ctx) as unknown;
// a carport whose hidden Section-4 rows say something else than 4B (as an old save or a stale row would)
const carport = (l: string, r: string, rows = 'Open') =>
  ({ btype: 'carport', bw: '16', bl: '40', bh: '16', wfg: 'Open', wbg: 'Open', wle: rows, wre: rows, 'sp-left': l, 'sp-right': r });

describe('a closed carport side is charged once, and set in ONE place (4B — Side Panels)', () => {
  it('Robert Frick: CCI carport 16x40x16, both sides closed in 4B -> Each Side Closed once ($2,365), no side-panel charge', () => {
    expect(run('gWalls()', carport('closed', 'closed'))).toBe(2365);
    expect(run('gSidePanels()', carport('closed', 'closed'))).toBe(0);
  });
  it('CA carport, both sides closed -> no side-panel charge either (same code path)', () => {
    expect(run('gSidePanels()', carport('closed', 'closed'), 'CA')).toBe(0);
  });
  it('one closed side = one side price; partial panels still price per panel (40 long = one 36 panel row)', () => {
    expect(run('gWalls()', carport('closed', 'open'))).toBe(1183);
    expect(run('gSidePanels()', carport('closed', '2panel'))).toBe(2 * 175);
    expect(run('gSidePanels()', carport('1panel', 'open'))).toBe(175);
  });
  it('the hidden Section-4 rows are never read on a carport (a stale "Closed" row prices nothing)', () => {
    expect(run('gWalls()', carport('open', 'open', 'Closed'))).toBe(0);
    expect(run('[eaveVal("wle"), eaveVal("wre")].join("|")', carport('open', 'open', 'Closed'))).toBe('Open|Open');
    expect(run('[eaveVal("wle"), eaveVal("wre")].join("|")', carport('closed', '2panel', 'Open'))).toBe('Closed|2panel');
  });
  it('every other type still reads its Section-4 rows', () => {
    const std = { btype: 'standard', bw: '24', bl: '40', bh: '12', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: '2panel', 'sp-left': 'open', 'sp-right': 'open' };
    expect(run('[eaveVal("wle"), eaveVal("wre")].join("|")', std)).toBe('Closed|2panel');
    expect(run('gWalls()', std)).toBe(1183);
  });
  it('no mirroring: a Section-4 row change does not touch 4B on a carport; GCH still forwards (its controls are unchanged)', () => {
    expect(run('cpWallChanged("wle","sp-left"); __f["sp-left"]', carport('open', 'open', 'Closed'))).toBe('open');
    expect(html).not.toContain('_cpMirror');
    const gch = { btype: 'gch', wle: 'Closed', wre: '2panel', 'gch-left': 'open', 'gch-right': 'open' };
    expect(run('cpWallChanged("wle","sp-left"); cpWallChanged("wre","sp-right"); __f["gch-left"]+"|"+__f["gch-right"]', gch)).toBe('closed|2panel');
  });
  it('Section-4 eave rows hidden on a carport with the note; shown on every other type', () => {
    expect(run('cpEaveRows(); [G("wre-row").style.display, G("wle-row").style.display, G("cp-eave-note").style.display].join("|")', carport('open', 'open'))).toBe('none|none|');
    expect(run('cpEaveRows(); [G("wre-row").style.display, G("wle-row").style.display, G("cp-eave-note").style.display].join("|")', { btype: 'standard' })).toBe('||none');
    expect(html).toContain('<div class="enote" id="cp-eave-note" style="display:none;margin:4px 0 6px;font-size:10px">Carport sides are set in 4B — Side Panels</div>');
  });
  it('reopen: a side an old save kept only on the Section-4 row goes into 4B; a side set in 4B always wins', () => {
    // before 7/30/26 the rows were their own setting (left closed on the row, 4B open)
    expect(run('var t=cpAdoptSavedEaves(__f); t.join(",")+"|"+__f["sp-left"]+"|"+__f["sp-right"]',
      carport('open', 'closed', 'Closed'))).toBe('sp-left|closed|closed');
    // 8/26–10/12 saves: rows mirrored 4B -> nothing to take
    expect(run('cpAdoptSavedEaves(__f).length', carport('closed', 'q2', 'Open'))).toBe(0);
    // conflicting: 4B has a partial, the row says Closed -> 4B wins
    expect(run('cpAdoptSavedEaves(__f); __f["sp-left"]', carport('2panel', 'open', 'Closed'))).toBe('2panel');
    // a row panel value maps 1:1
    expect(run('cpAdoptSavedEaves(__f); __f["sp-right"]', { ...carport('open', 'open', 'Open'), wre: '3_5panel' })).toBe('3_5panel');
  });
  it('J-trim (Price Book 2 p2 $60/$70/$85/$95/$110 by 20/25/30/35/40 long): per side with panels, per connected unit', () => {
    const jt = (l: string, r: string, len: string, on = true, mfr = 'CCI') =>
      run('cpJTrim()', { ...carport(l, r), bl: len, 'sp-jtrim': on as unknown as string }, mfr);
    expect(jt('3panel', '3panel', '100')).toBe(2 * (95 + 95 + 85)); // Sensei config 13: $550
    expect(jt('1panel', '1panel', '60')).toBe(2 * (85 + 85)); // Sensei config 14: $340
    expect(jt('closed', '2panel', '40')).toBe(110); // a closed side has no J-trim
    expect(jt('closed', 'closed', '40')).toBe(0);
    expect(jt('q2', 'open', '24')).toBe(70); // 24' rounds UP to the 25' column
    expect(jt('3panel', '3panel', '100', false)).toBe(0); // unticked
    expect(jt('3panel', '3panel', '100', true, 'CA')).toBe(0); // CCI only
    // and it is in the side-panel price: 3 panels a side on 100' = (175+175+155) x 2 + 550
    expect(run('gSidePanels()', { ...carport('3panel', '3panel'), bl: '100', 'sp-jtrim': true as unknown as string })).toBe(2 * (175 + 175 + 155) * 3 + 550);
  });
  it('a save by this program carries the marker the price lock uses (cpOnce)', () => {
    expect(html).toContain('pbRule:1, cpOnce:1,');
    expect(html).toContain("label:'Carport sides (as originally quoted)'");
  });
});
