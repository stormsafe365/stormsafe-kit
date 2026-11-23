import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * 11-23a - CCI walk-in door rule (CCI latch sheet 11/10/26: certified roll-ups have no outside locks, so the building needs a
 * walk-in door): a FRAMED OPENING a person can walk through counts as the walk-in access. Owner 11/23/26 (a 36' wide with two
 * framed openings for the customer's own double walk doors could not be saved): "this guy has framed openings for double walk
 * doors.. so he'll have doors just not ours". Window frame-outs, the 45-degree angle cut and the double-tubed end do not count.
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
    if (c === '/' && html[j - 1] !== '\\' && /[(,=!&|?:;{}]\s*$/.test(html.slice(Math.max(0, j - 3), j))) {
      // a regex literal: skip to its closing slash (none of these functions has '/' inside a class)
      let k = j + 1;
      for (; k < html.length; k++) { if (html[k] === '\\') { k++; continue; } if (html[k] === '/') break; }
      j = k; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(i, j + 1) + '\n';
}
type El = { q: Record<string, string> };
const el = (q: Record<string, string>): El => ({ q });
type Ctx = {
  ACTIVE_MFR: string; INPUT_MODE: boolean; __dom: Record<string, El[]>;
  cciFoWalkable: (n: unknown) => boolean; cciDoorCounts: () => { rollup: number; walk: number }; cciWalkMissing: () => boolean;
};
const ctx = vm.createContext({}) as unknown as Ctx;
vm.runInContext(
  grabFn('cciDoorCertified') + grabFn('cciFoWalkable') + grabFn('cciDoorCounts') + grabFn('cciWalkMissing') +
    "var ACTIVE_MFR='CCI', INPUT_MODE=false, __dom={};" +
    "function wrap(e){ return { querySelector:function(c){ return e.q[c]!=null?{value:e.q[c]}:null; } }; }" +
    "var document={ querySelectorAll:function(s){ return (__dom[s]||[]).map(wrap); } };",
  ctx as unknown as vm.Context,
);
const ROLLUP = el({ '.rsz': '12x12', '.rdtype': 'rollup', '.rqt': '1' });
const dom = (ace: El[] = [], lt: El[] = [], we: El[] = []) => { ctx.__dom = { '.re': [ROLLUP], '.we': we, '.ace': ace, '.lt-acc-e': lt }; };

describe('cciFoWalkable: which framed openings are a way in', () => {
  it('walk-through, double door, garage, side opening and custom frame-outs count', () => {
    for (const n of [
      'Framed Opening — Walk-Through Door 36"x80"', 'Framed Opening — Double Door 72"x80"', 'Framed Opening — Custom Walk-Through Door (Custom Size)',
      'Framed Opening — Custom Frame Out (Custom Size)', 'Framed Opening (Custom Size)', "Framed Opening — Garage Door (6'-10' Wide)",
      'Framed Opening — Custom Garage Door (Custom Size)', "Framed Opening — Side Opening, No Door (12' Wide)", 'Framed Opening',
    ]) expect(ctx.cciFoWalkable(n)).toBe(true);
  });
  it('window frame-outs, the 45-degree angle cut, the double-tubed end and other components do not', () => {
    for (const n of [
      'Framed Opening — Window 30"x30"', 'Framed Opening — Window (Custom Size)', 'Framed Opening — 45° Angle (+ Frameout Charge)',
      'Framed Opening — Double-Tubed End (per opening)', 'Gutter', '', null, undefined,
    ]) expect(ctx.cciFoWalkable(n)).toBe(false);
  });
});

describe('the walk-in rule counts walkable framed openings (no price effect)', () => {
  it("the owner's case: a certified roll-up + 2 framed openings for the customer's own double walk doors -> not blocked", () => {
    dom([el({ '.act': 'Framed Opening — Custom Frame Out (Custom Size)', '.acq': '2' })]);
    expect(ctx.cciDoorCounts()).toEqual({ rollup: 1, walk: 2 });
    expect(ctx.cciWalkMissing()).toBe(false);
    dom([el({ '.act': 'Framed Opening — Double Door 72"x80"', '.acq': '' })]); // qty blank = 1
    expect(ctx.cciDoorCounts()).toEqual({ rollup: 1, walk: 1 });
    expect(ctx.cciWalkMissing()).toBe(false);
  });
  it('a window frame-out, the 45-degree cut or the double-tubed end alone still blocks', () => {
    for (const n of ['Framed Opening — Window 30"x30"', 'Framed Opening — 45° Angle (+ Frameout Charge)', 'Framed Opening — Double-Tubed End (per opening)', 'Gutter']) {
      dom([el({ '.act': n, '.acq': '1' })]);
      expect(ctx.cciWalkMissing()).toBe(true);
    }
  });
  it('a lean-to walk-door frame-out counts; a lean-to window frame-out does not', () => {
    dom([], [el({ '.lt-acc-type': 'frameout', '.lt-acc-fo-type': 'Framed Opening — Walk-Through Door 36"x80"', '.lt-acc-qty': '1' })]);
    expect(ctx.cciDoorCounts()).toEqual({ rollup: 1, walk: 1 });
    expect(ctx.cciWalkMissing()).toBe(false);
    dom([], [el({ '.lt-acc-type': 'frameout', '.lt-acc-fo-type': 'Framed Opening — Window 30"x30"', '.lt-acc-qty': '1' })]);
    expect(ctx.cciWalkMissing()).toBe(true);
  });
  it('a walk door still counts; CA and manual line items are never blocked', () => {
    dom([], [], [el({ '.wqt': '1' })]);
    expect(ctx.cciWalkMissing()).toBe(false);
    dom();
    expect(ctx.cciWalkMissing()).toBe(true);
    ctx.ACTIVE_MFR = 'CA'; expect(ctx.cciWalkMissing()).toBe(false); ctx.ACTIVE_MFR = 'CCI';
    ctx.INPUT_MODE = true; expect(ctx.cciWalkMissing()).toBe(false); ctx.INPUT_MODE = false;
  });
  it('the red notes name the framed opening', () => {
    expect(html).toContain('must have a walk-in door (or a framed opening for one). Add a walk-through door or a framed opening.');
    expect(html).toContain('needs a walk-in door (or a framed opening for one) \\u2014 add a Walk-Through Door or a framed opening.');
  });
});
