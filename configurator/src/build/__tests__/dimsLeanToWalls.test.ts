import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Spacing page (Dimensioned Layout & Spacing), owner 11/9/26 on Michael Bescript's quote: "Dimensions & Spacing pages dont
 * reflect all the windows ... on the lean-to". _dimLtWallItems turns each eave lean-to opening (ltAccXs spots, the 3D's frame:
 * outer wall from the lean-to's FRONT end, end walls from min(inner, outer) = the outer post on a Right Eave lean-to, the main
 * wall on a Left Eave one; geometry.ts: Right Eave outer at -halfW - w, Left Eave at +halfW + w) into the card frames, standing
 * outside: outer wall like that eave's card, front end seen from the front, back end seen from behind.
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
const code = grabFn('_dimLtWallItems') + grabFn('dimQ') + `
var SIZES={wtd:{w:3,h:6.6667,sill:0},win:{w:2.5,h:3,sill:4.16667},rollup:{w:8,h:8,sill:0},frameout:{w:10,h:10,sill:0}};
function ltPartDims(ae){ var s=SIZES[ae._t]; return s?{w:s.w,h:s.h,sill:s.sill}:null; }
function ltAccXs(ae){ return ae._xs; }
function acc(t,loc,xs){ var f={'.lt-acc-loc':loc,'.lt-acc-type':t}; return {_t:t,_xs:xs,querySelector:function(s){ return (s in f)?{value:f[s]}:null; }}; }
function lean(side,accs,walls,stor){ return {eave:true,side:side,ll:70,w:14,stor:stor||null,walls:walls||{side:'closed',front:'closed',back:'closed'},
  el:{querySelectorAll:function(){ return accs; }}}; }
function run(side,accs,walls,stor){ return JSON.parse(JSON.stringify(_dimLtWallItems(lean(side,accs,walls,stor)))); }
`;
type It = { type: string; x: number; x3: number; w: number };
type Out = { outer: It[]; front: It[]; back: It[] };
const ctx = vm.createContext({ Math, JSON }) as unknown as { run: (side: string, accs: unknown[], walls?: unknown, stor?: unknown) => Out };
vm.runInContext(code, ctx as unknown as vm.Context);
const acc = (t: string, loc: string, xs: number[]) => vm.runInContext(`acc(${JSON.stringify(t)},${JSON.stringify(loc)},${JSON.stringify(xs)})`, ctx as unknown as vm.Context);

describe('lean-to openings on the spacing page', () => {
  it('Right Eave lean-to: outer wall front on the left (as is); front end flipped (main wall on the left); back end as is', () => {
    const o = ctx.run('Right Eave', [acc('win', 'outer', [5, 20]), acc('wtd', 'front', [1]), acc('win', 'back', [2])]);
    expect(o.outer.map((u) => u.x)).toEqual([5, 20]);
    expect(o.front[0]).toMatchObject({ type: 'wtd', x: 14 - 1 - 3, x3: 1 }); // 1' from the outer post = 10' from the main wall
    expect(o.back[0]).toMatchObject({ type: 'win', x: 2 });
  });
  it('Left Eave lean-to: outer wall back on the left (flipped); front end flipped (outer post on the left); back end as is', () => {
    const o = ctx.run('Left Eave', [acc('win', 'outer', [5]), acc('wtd', 'front', [1]), acc('win', 'back', [2])]);
    expect(o.outer[0].x).toBe(70 - 5 - 2.5);
    expect(o.front[0].x).toBe(14 - 1 - 3);
    expect(o.back[0].x).toBe(2);
  });
  it('only what the 3D draws: no door / window on an open outer wall (unless in the storage section) or a not-Closed end; frame-outs always', () => {
    const open = { side: 'open', front: 'open', back: 'gable' };
    const o = ctx.run('Right Eave', [acc('win', 'outer', [5, 60]), acc('wtd', 'front', [1]), acc('win', 'back', [2]), acc('frameout', 'front', [2])], open, { end: 'back', len: 15 });
    expect(o.outer.map((u) => u.x3)).toEqual([60]); // 60 + 1.25 sits in the 15' storage at the back (55'-70')
    expect(o.front.map((u) => u.type)).toEqual(['fo']);
    expect(o.back).toEqual([]);
  });
  it('the page draws a card per lean-to wall with openings, and the plans tick them', () => {
    expect(html).toContain("html+=card(nm+' \\u00b7 '+(loc==='front'?'Front End \\u00b7 seen from the front':'Back End \\u00b7 seen from behind'),'ltwall:'+l.n+':'+loc,");
    expect(html).toContain("if(lw.outer.length) html+=card(nm+' \\u00b7 Outer Wall','ltwall:'+l.n+':outer',");
    expect(html).toContain("lw.outer.forEach(function(u){ tk(u, xo+dir*6, py(a+u.x3), xo+dir*6, py(a+u.x3+u.w)); });");
  });
});
