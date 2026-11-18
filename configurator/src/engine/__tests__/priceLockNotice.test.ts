import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// 11-17b - the SAVED PRICE HELD notice (owner 11/17/26: "This warning box should be way more obvious, it should also
// state the manufacturer & maybe itemize what it can as far as what the discrepancies are within that specific quote").
// The price lock (<script id="ss-price-lock">) runs in a vm; the notice's helpers are exposed as PL._linesOfPass,
// PL._linesOfSnapshot, PL._diffRows, PL._mfrLine.
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
const src = (html.match(/<script id="ss-price-lock">([\s\S]*?)<\/script>/) || [])[1] || '';

type Row = { label: string; from: number | null; to: number | null; delta: number; money?: boolean };
type Lines = Record<string, number>;
type PL = {
  _linesOfPass: (r: unknown) => Lines | null;
  _linesOfSnapshot: (pr: unknown) => Lines | null;
  _diffRows: (a: Lines | null, b: Lines | null) => Row[] | null;
  _mfrLine: () => { name: string; warn: string };
  _data: unknown;
};
function load(ctx: Record<string, unknown> = {}): PL {
  const mod = { exports: {} as unknown };
  vm.runInNewContext(src, { module: mod, Date, Math, JSON, parseFloat, parseInt, isNaN, isFinite, String, Number, ...ctx });
  return mod.exports as PL;
}
// a price pass (window._qTotals) - only the fields the notice reads
const pass = (o: Record<string, number>) => ({ base: 4795, leg: 395, framingUpgrade: 0, ocUpgrade: 0, pitchUpgrade: 0, walls: 3170, vertWallUpg: 0, rud: 0, wtd: 0,
  win: 0, sf: 0, lapP: 0, sheetUpgrade: 0, wainP: 0, aewP: 0, leanToTotal: 0, connFeeTotal: 0, addCompTotal: 0, insulTotal: 0, fastenerP: 0, overhangP: 0,
  sidePanelP: 0, anchorP: 0, adjP: 0, holdP: 0, da: 0, ta: 543, addDiscAmount: 0, adjTot: 8903, ...o });

describe('the notice itemizes what differs', () => {
  it('still ES5 (the lock is loaded as a classic script)', () => {
    expect(/=>|\blet\s|\bconst\s|`/.test(src)).toBe(false);
  });
  it('a price pass and a saved snapshot read into the same line set', () => {
    const PL = load();
    const a = PL._linesOfPass(pass({}))!;
    expect(a.base).toBe(4795); expect(a.walls).toBe(3170); expect(a._tax).toBe(543); expect(a._total).toBe(8903);
    expect(PL._linesOfPass({ manual: true })).toBeNull();
    const s = PL._linesOfSnapshot({ hold: -400, lines: { base: 4795, leg: 395, oc: 400, walls: 3170 }, money: { da: 0, ta: 569, addDisc: 0, adjTot: 8903 } })!;
    expect(s.oc).toBe(400); expect(s.hold).toBe(-400); expect(s._tax).toBe(569);
    expect(PL._linesOfSnapshot({ sub: 1 })).toBeNull(); // a save from before line prices were kept
  });
  it("the rows add up to the total difference (lines, discount, tax, additional discount)", () => {
    const PL = load();
    // the owner's case shape: a held CA 20x40x8 reopened, then 10' tall + 10% discount
    const before = PL._linesOfPass(pass({}))!;
    const after = PL._linesOfPass(pass({ leg: 685, walls: 3765, da: 925, ta: 541, adjTot: 8861 }))!;
    const rows = PL._diffRows(before, after)!;
    expect(rows.map((r) => [r.label, r.delta])).toEqual([['Leg height', 290], ['Enclosed walls', 595], ['Discount', -925], ['Sales tax', -2]]);
    expect(rows.reduce((s, r) => s + r.delta, 0)).toBe(-42);
    expect(PL._diffRows(before, before)).toEqual([]);
    expect(PL._diffRows(null, after)).toBeNull();
  });
  it('an additional discount lowers the total; anything the lines do not explain is one "Other" row', () => {
    const PL = load();
    const a = PL._linesOfPass(pass({}))!;
    const b = PL._linesOfPass(pass({ addDiscAmount: 150, adjTot: 8753 }))!;
    expect(PL._diffRows(a, b)).toEqual([{ label: 'Additional discount (off deposit)', from: 0, to: 150, delta: -150, money: true }]);
    const c = { ...a, _total: a._total + 12.34 };
    expect(PL._diffRows(a, c)).toEqual([{ label: 'Other (not itemized)', from: null, to: null, delta: 12.34 }]);
  });
  it('names the manufacturer, and warns when it is not the one the quote was saved with', () => {
    const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CA', INPUT_MODE: false };
    const PL = load(ctx);
    PL._data = { mfr: 'CA' };
    expect(PL._mfrLine()).toEqual({ name: 'Carports Anywhere (CA)', warn: '' });
    ctx.ACTIVE_MFR = 'CCI';
    const PL2 = load({ ACTIVE_MFR: 'CCI', INPUT_MODE: false }); PL2._data = { mfr: 'CA' };
    expect(PL2._mfrLine()).toEqual({ name: 'Carolina Carports (CCI)', warn: 'Saved as Carports Anywhere (CA) — now priced as Carolina Carports (CCI).' });
    const PL3 = load({ ACTIVE_MFR: 'CCI', INPUT_MODE: true }); PL3._data = { mfr: 'CA' };
    expect(PL3._mfrLine()).toEqual({ name: 'Manual pricing (Input)', warn: '' });
  });
  it('wired: reopen keeps the as-reopened and saved lines, today keeps its lines, the box is loud and pulses', () => {
    expect(src).toContain('st.savedLines=linesOfSnapshot(pr);');
    expect(src).toContain('st.baseLines=linesOfPass(root._qTotals);');
    expect(src).toContain('sub:r2(r.sub), lines:linesOfPass(r) };');
    expect(src).toContain("section('Changed since you reopened it', since, diffRows(st.baseLines, nowLines)");
    expect(src).toContain("section('Saved price vs today’s pricing', td, diffRows(st.savedLines, st.today.lines)");
    expect(src).toContain('border:2px solid');
    expect(src).toContain('@media (prefers-reduced-motion: reduce){#pl-notice .pl-box.pl-pulse{animation:none}}');
  });
});
