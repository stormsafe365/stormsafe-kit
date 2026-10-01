import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// The reopened-quote price lock lives inline in public/quote-builder.html
// (<script id="ss-price-lock">, ES5, window.PriceLock). Its money math must be
// identical to rc(): discount -> tax -> 17% deposit -> additional discount.
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
const src = (html.match(/<script id="ss-price-lock">([\s\S]*?)<\/script>/) || [])[1] || '';

type P = { disc: number; tax: number; agx: boolean; depPct: number; adType: string; adVal: number };
type Money = { sub: number; da: number; ad: number; ta: number; tot: number; grossDep: number; addDisc: number; dep: number; bal: number; adjTot: number; clamped: boolean };
type Lock = {
  forward: (sub: number, p: P) => Money;
  invert: (t: { total: number; deposit: number; balance: number }, p: P) => { subs: number[]; depPct: number } | null;
};

function load(): Lock {
  const mod = { exports: {} as unknown };
  vm.runInNewContext(src, { module: mod, Date, Math, JSON, parseFloat, parseInt, isNaN, isFinite, String, Number });
  return mod.exports as Lock;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

describe('price lock (quote-builder.html)', () => {
  it('is present and ES5 (no arrows / let / const / template literals)', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(/=>|\blet\s|\bconst\s|`/.test(src)).toBe(false);
  });

  it("reproduces Graham's 9/17 quote (#SS-2026-05670): $59,075 -> $44,448 / $5,222 / $39,226", () => {
    const PL = load();
    const p = { disc: 20, tax: 6, agx: true, depPct: 17, adType: 'pct', adVal: 35 };
    const m = PL.forward(59075, p);
    expect([m.da, m.ad, m.addDisc, m.dep, m.bal, m.adjTot]).toEqual([11815, 47260, 2812, 5222, 39226, 44448]);
    expect(PL.invert({ total: 44448, deposit: 5222, balance: 39226 }, p)).toEqual({ subs: [59075], depPct: 17 });
    // today's engine for the same build is $57,875: the $1,200 side frames are what the lock keeps
    expect(PL.forward(57875, p).adjTot).toBe(43545);
  });

  it('inverts saved card totals back to the subtotal (random discount / tax / exempt / additional discount)', () => {
    const PL = load();
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 600; i++) {
      const sub = Math.round(rnd() * 90000 + 2000) + (rnd() < 0.3 ? Math.round(rnd() * 9) / 10 : 0);
      const pct = rnd() < 0.4;
      const p = { disc: [0, 5, 10, 12.5, 15, 20][i % 6], tax: [0, 6, 6.5, 7, 7.5][i % 5], agx: i % 7 === 0, depPct: 17, adType: pct ? 'pct' : 'dollar', adVal: pct ? [0, 10, 35, 50][i % 4] : [0, 250, 500, 1000.5][i % 4] };
      const m = PL.forward(sub, p);
      if (m.clamped) continue;
      const inv = PL.invert({ total: r2(m.adjTot), deposit: r2(m.dep), balance: r2(m.bal) }, p);
      expect(inv, JSON.stringify({ sub, p })).not.toBeNull();
      expect(inv!.subs).toContain(r2(sub));
      for (const s of inv!.subs) {
        const f = PL.forward(s, { ...p, depPct: inv!.depPct });
        expect([r2(f.adjTot), r2(f.dep), r2(f.bal)]).toEqual([r2(m.adjTot), r2(m.dep), r2(m.bal)]);
      }
    }
  });

  it('revision baseline: saved totals on sold orders, on unsold quotes only while the lock holds', () => {
    const PL = load() as unknown as { on: boolean; st: unknown; rvBaseline: () => unknown };
    const saved = { total: 44448, deposit: 5222, balance: 39226 };
    expect(PL.rvBaseline()).toBeNull(); // nothing reopened
    PL.st = { requested: true, saved, sold: false, ok: true, choice: 'keep' }; PL.on = true;
    expect(PL.rvBaseline()).toEqual(saved);
    PL.st = { requested: true, saved, sold: false, ok: true, choice: 'today' }; PL.on = false;
    expect(PL.rvBaseline()).toBeNull(); // unsold + "Update to today's pricing": a normal contract, not REVISED
    PL.st = { requested: true, saved, sold: false, ok: false, choice: 'keep' }; PL.on = true;
    expect(PL.rvBaseline()).toBeNull(); // unsold, lock not holding
    PL.st = { requested: true, saved, sold: true, ok: false, choice: 'today' }; PL.on = false;
    expect(PL.rvBaseline()).toEqual(saved); // sold: the deposit was paid on the saved price
  });

  it('free-upgrade thresholds ride on the held price in all four pricing paths; Reset drops the lock', () => {
    expect(/function gThrAdj\(\)\{ return \(window\.PriceLock&&window\.PriceLock\.on\)\?gHold\(\):0; \}/.test(html)).toBe(true);
    expect((html.match(/\+gThrAdj\(\)/g) || []).length).toBe(4); // rc, printQuote, printContract, textQuote
    expect(/var thrPre=preSheetSub\+gThrAdj\(\);/.test(html)).toBe(true);
    expect(/\? thrPre\*0\.10 : 0;/.test(html)).toBe(true);
    expect(/function resetAll\(\)\{[\s\S]{0,400}?if\(window\.PriceLock\) PriceLock\.reset\(\);\s*window\._rvOrig=null;/.test(html)).toBe(true);
    expect(/preSheetSub\*0\.10/.test(html.slice(html.indexOf('function textQuote(')))).toBe(false); // the old ReferenceError
  });

  it('freshen (Duplicate): the copy becomes an ordinary quote at today\'s pricing, as a brand-new quote', () => {
    const mod = { exports: {} as unknown };
    let rcCalls = 0;
    const ctx: Record<string, unknown> = { module: mod, Date, Math, JSON, parseFloat, parseInt, isNaN, isFinite, String, Number,
      rc: () => { rcCalls++; }, _depPct: 25, _freeThresh: 10000, _fu14Ovr: true, _impOvr: true, _lapOvr: false, _nsOvr: false };
    vm.runInNewContext(src, ctx);
    type St = { requested: boolean; fresh: boolean; hold: number; notes: string[]; issues: string[]; compliance: unknown[]; active: boolean };
    const PL = mod.exports as { on: boolean; st: unknown; _pins: unknown; freshen: () => boolean; state: () => St; rvBaseline: () => unknown; openCompliance: () => unknown[] };
    const saved = { total: 44448, deposit: 5222, balance: 39226 };
    PL.on = true; PL._pins = { depPct: 17 };
    PL.st = { requested: true, ready: true, ok: true, sold: true, status: 'deposit_paid', saved, savedSub: 59075, hold: 1200, choice: 'keep',
      parts: [{ k: 'sideFrames', label: 'Side frames (as originally quoted)', amt: 1200, rules: ['side-frames'] }],
      rules: [{ id: 'impact', kind: 'input', flag: 'imp' }], decisions: [{ rule: 'impact', choice: 'keep', reason: 'x' }],
      notes: ['Roof style set to Regular: it is the only roof style that reproduces the saved price', 'Deposit % held at 25% (as saved).'],
      issues: ['Walk door 1 wloc: saved "Partition Wall", now ""', 'Held totals do not match'], tripIssues: ['Walk door 1 wloc: saved "Partition Wall", now ""'] };
    expect(PL.freshen()).toBe(true);
    expect(rcCalls).toBe(1);
    expect(PL.on).toBe(false);
    expect([ctx._depPct, ctx._fu14Ovr, ctx._impOvr]).toEqual([17, false, false]); // default deposit %, every rule applied
    const s = PL.state();
    expect([s.requested, s.fresh, s.active, s.hold]).toEqual([false, true, false, 0]); // to the CRM: an ordinary unsaved quote
    expect(s.notes).toEqual(['Roof style set to Regular: it is the only roof style that reproduces the saved price']);
    expect(s.issues).toEqual(['Walk door 1 wloc: saved "Partition Wall", now ""']); // only "did not reopen as saved"
    expect(s.compliance).toEqual([]);
    expect(PL.rvBaseline()).toBeNull(); // a copy prints a normal contract
  });

  it('GCH Partition Wall placement survives a restore; program files with no saved price get a note', () => {
    // the option is added (same value/text as the 3D host) before each saved location is set
    expect(html.includes("function _ensureLocOpt(sel, v){")).toBe(true);
    for (const s of ['_ensureLocOpt(locEl, d.rloc); locEl.value=d.rloc;', "if(cls==='wloc') _ensureLocOpt(fld, v);", "if(cls==='nloc') _ensureLocOpt(fld, v);", "_ensureLocOpt(foLocEl, d['fo-loc']); foLocEl.value=d['fo-loc'];"]) expect(html.includes(s), s).toBe(true);
    // loadQuote / loadFromLog options
    const fn = (html.match(/function _plFileOpts\(data\)\{[\s\S]*?\r?\n\}/) || [])[0] || '';
    const plFileOpts = vm.runInNewContext('(' + fn + ')', { parseFloat, isFinite, String }) as (d: unknown) => unknown;
    expect(plFileOpts({ priced: { v: 1 } })).toEqual({ lock: true });
    expect(plFileOpts({ totals: { total: '$14,520.00', deposit: '$2,307.00', balance: '$12,213.00' } })).toEqual({ lock: true, legacyTotals: { total: 14520, deposit: 2307, balance: 12213 } });
    expect(plFileOpts({ fields: {} })).toEqual({ unpriced: true });
    expect(plFileOpts({ totals: { total: 0 } })).toEqual({ unpriced: true });
    expect(html.includes('No saved price on record for this file — shown at today’s pricing.')).toBe(true);
  });

  it('refuses totals it cannot reproduce (e.g. a deposit clamped at $0)', () => {
    const PL = load();
    const p = { disc: 0, tax: 7, agx: false, depPct: 17, adType: 'dollar', adVal: 5000 };
    const m = PL.forward(10000, p);
    expect(m.clamped).toBe(true);
    expect(PL.invert({ total: m.adjTot, deposit: m.dep, balance: m.bal }, p)).toBeNull();
    expect(PL.invert({ total: 12345.67, deposit: 1, balance: 2 }, { ...p, adVal: 0 })).toBeNull();
  });
});
