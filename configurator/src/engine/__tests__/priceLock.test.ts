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

  it('refuses totals it cannot reproduce (e.g. a deposit clamped at $0)', () => {
    const PL = load();
    const p = { disc: 0, tax: 7, agx: false, depPct: 17, adType: 'dollar', adVal: 5000 };
    const m = PL.forward(10000, p);
    expect(m.clamped).toBe(true);
    expect(PL.invert({ total: m.adjTot, deposit: m.dep, balance: m.bal }, p)).toBeNull();
    expect(PL.invert({ total: 12345.67, deposit: 1, balance: 2 }, { ...p, adVal: 0 })).toBeNull();
  });
});
