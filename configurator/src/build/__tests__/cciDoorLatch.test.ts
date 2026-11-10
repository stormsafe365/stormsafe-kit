import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * CCI's latch sheet (emailed to the owner 11/10/26; owner picked "Both"): CERTIFIED garage doors - no outside locks, kick
 * locks inside on the bottom; "Must Have Walk In Doors On Any Building with Certified Roll Up Doors". The program sells CCI
 * certified doors (main, lean-to, partition), so every CCI roll-up line says its latch, and a CCI quote with roll-ups and no
 * walk-in door is flagged and its documents blocked (like overlapping openings). No price changes.
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
type El = { q: Record<string, string> };
const el = (q: Record<string, string>): El => ({ q });
type Ctx = {
  ACTIVE_MFR: string; INPUT_MODE: boolean; __dom: Record<string, El[]>; __toasts: string[]; __ovl: string;
  cciLatchNote: (t: string) => string; cciDoorCounts: () => { rollup: number; walk: number };
  cciWalkMissing: () => boolean; ovlPrintBlock: () => boolean;
};
const ctx = vm.createContext({}) as unknown as Ctx;
vm.runInContext(
  grabFn('cciDoorCertified') + grabFn('cciLatchNote') + grabFn('cciDoorCounts') + grabFn('cciWalkMissing') + grabFn('ovlPrintBlock') +
  "var ACTIVE_MFR='CCI', INPUT_MODE=false, CCI_WALK_MSG='walk msg', __dom={}, __toasts=[], __ovl='';" +
  "function wrap(e){ return { querySelector:function(c){ return e.q[c]!=null?{value:e.q[c]}:null; } }; }" +
  "var document={ querySelectorAll:function(s){ return (__dom[s]||[]).map(wrap); } };" +
  "function toast(m){ __toasts.push(m); } function ovlPrintIssue(){ return __ovl; } function G(){ return null; }",
  ctx as unknown as vm.Context,
);
function setDom(d: Record<string, El[]>) { ctx.__dom = d; ctx.__toasts = []; ctx.__ovl = ''; }

describe('CCI latches + walk-in door rule', () => {
  it('every CCI certified door line gets the latch; other manufacturers and uncertified doors get nothing', () => {
    ctx.ACTIVE_MFR = 'CCI';
    expect(ctx.cciLatchNote('rollup')).toBe(' · Kick Locks Inside (No Outside Locks)');
    expect(ctx.cciLatchNote('hiimpact')).toBe(' · Kick Locks Inside (No Outside Locks)');
    expect(ctx.cciLatchNote('standard')).toBe('');
    ctx.ACTIVE_MFR = 'CA';
    expect(ctx.cciLatchNote('rollup')).toBe('');
    ctx.ACTIVE_MFR = 'CCI';
  });
  it('counts roll-ups and walk-in doors on the main building and the lean-tos (quantities; doors with no size ignored)', () => {
    setDom({
      '.re': [el({ '.rsz': '10x10', '.rdtype': 'rollup', '.rqt': '2' }), el({ '.rsz': '', '.rdtype': 'rollup', '.rqt': '1' })],
      '.we': [],
      '.lt-acc-e': [el({ '.lt-acc-type': 'rollup', '.lt-acc-size': '8x8', '.lt-acc-qty': '1' }), el({ '.lt-acc-type': 'win', '.lt-acc-qty': '3' })],
    });
    expect(ctx.cciDoorCounts()).toEqual({ rollup: 3, walk: 0 });
    expect(ctx.cciWalkMissing()).toBe(true);
    ctx.__dom['.lt-acc-e'].push(el({ '.lt-acc-type': 'wtd', '.lt-acc-qty': '1' }));
    expect(ctx.cciDoorCounts()).toEqual({ rollup: 3, walk: 1 });
    expect(ctx.cciWalkMissing()).toBe(false);
  });
  it('a walk door on the main building satisfies it; no roll-ups = no rule; not CCI / manual line items = no rule', () => {
    setDom({ '.re': [el({ '.rsz': '10x10', '.rdtype': 'rollup', '.rqt': '1' })], '.we': [el({ '.wqt': '1' })], '.lt-acc-e': [] });
    expect(ctx.cciWalkMissing()).toBe(false);
    setDom({ '.re': [], '.we': [], '.lt-acc-e': [] });
    expect(ctx.cciWalkMissing()).toBe(false);
    setDom({ '.re': [el({ '.rsz': '10x10', '.rdtype': 'rollup', '.rqt': '1' })], '.we': [], '.lt-acc-e': [] });
    expect(ctx.cciWalkMissing()).toBe(true);
    ctx.ACTIVE_MFR = 'CA'; expect(ctx.cciWalkMissing()).toBe(false); ctx.ACTIVE_MFR = 'CCI';
    ctx.INPUT_MODE = true; expect(ctx.cciWalkMissing()).toBe(false); ctx.INPUT_MODE = false;
  });
  it('documents: blocked with the reason while the walk-in door is missing; an opening clash still wins; fine once added', () => {
    setDom({ '.re': [el({ '.rsz': '12x12', '.rdtype': 'rollup', '.rqt': '1' })], '.we': [], '.lt-acc-e': [] });
    expect(ctx.ovlPrintBlock()).toBe(true);
    expect(ctx.__toasts).toEqual(['walk msg']);
    ctx.__toasts = []; ctx.__ovl = 'clash';
    expect(ctx.ovlPrintBlock()).toBe(true);
    expect(ctx.__toasts[0]).toMatch(/^Openings clash/);
    setDom({ '.re': [el({ '.rsz': '12x12', '.rdtype': 'rollup', '.rqt': '1' })], '.we': [el({ '.wqt': '1' })], '.lt-acc-e': [] });
    expect(ctx.ovlPrintBlock()).toBe(false);
    expect(ctx.__toasts).toEqual([]);
  });
  it('wiring: the latch on the quote PDF + contract main and lean-to door rows and the text quote; the flag box; rc refresh', () => {
    expect(html.split("row(sz+' '+typeLabel+cciLatchNote(dtype),qty,unitP,unitP*qty);").length - 1).toBe(2);
    expect(html.split("' ('+alocLabel+')'+cciLatchNote('rollup'),aqty,ap,ap*aqty);").length - 1).toBe(2);
    expect(html).toContain("doorLines.push(qty+'x '+sz+' Roll-Up ('+loc+')'+cciLatchNote(_dt?_dt.value:'standard'));");
    expect(html).toContain('<div id="cci-walk-warn"');
    expect(html).toContain("try { cciWalkRefresh(); } catch(e){ console.warn('cciWalkRefresh failed:', e); }");
  });
  it('wiring: the default (wall-first) Doors section repeats the warning at its top, display only', () => {
    expect(html).toContain('<div class="s5-gchw" id="s5-walkw" aria-live="polite" hidden><span class="s5-gcht"></span></div>');
    expect(html).toMatch(/ {2}paintGch\(\);\r?\n {2}paintWalk\(\);\r?\n {2}paintSum\(\);/);
    expect(html).toContain("miss=typeof window.cciWalkMissing==='function'&&!!window.cciWalkMissing();");
  });
});
