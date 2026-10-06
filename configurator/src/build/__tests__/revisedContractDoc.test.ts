import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 10/6/26 (revised contract): "shouldnt it say whats been revised?"
 * The orange REVISED CONTRACT box lists every change with its price
 * (+ Added / − Removed / ~ Changed / Moved old → new position), then
 * "Original contract $X → Revised $Y"; > 6 changes → the first 5 + a Change
 * Summary page. Itemized rows are tagged ADDED / CHANGED (previous amount struck)
 * and removed items are kept struck through with their credit. The contract
 * number is the one the CRM hands over (quote number, or "<agreement> Rev n").
 * The program's own functions run here in a vm.
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
function grabVar(name: string): string {
  const m = new RegExp('\\nvar ' + name + '=[^\\n]*').exec(html);
  if (!m) throw new Error('no var ' + name);
  return m[0].replace(/\/\/.*$/, '') + '\n';
}

const FNS = ['rvBalance', 'rvMoney', 'rvTotal', 'rvDate', 'rvKind', 'rvPos', 'rvMoveText', 'rvCap', 'rvLine', 'rvLineHTML', 'rvAgreementTitle', 'rvBoxHTML',
  'rvPayRowsHTML', 'rvRowAttr', 'rvRowTag', 'rvOldAmt', 'rvRemovedRowsHTML', 'rvSummaryHTML', 'rvTagRow', '_dim8', '_dimFtIn', 'posRefName', '_esc', 'fC', 'fD'];
const ctx = vm.createContext({});
vm.runInContext(grabVar('RV_BOX_MAX') + grabVar('RV_TAGS') + FNS.map(grabFn).join(''), ctx);
type Line = Record<string, unknown>;
const P = ctx as unknown as {
  rvLine: (l: Line) => { kind: string; sym: string; verb: string; text: string; amt: number | null };
  rvBoxHTML: (o: Record<string, unknown>) => string;
  rvPayRowsHTML: (o: Record<string, unknown>) => string;
  rvBalance: (t: number, d: number, p: number) => { paid: number; additional: number; balance: number; refund: number };
  rvRemovedRowsHTML: (doc: unknown) => string;
  rvSummaryHTML: (o: Record<string, unknown>) => string;
  rvRowTag: (it: unknown) => string;
  rvRowAttr: (it: unknown) => string;
  rvOldAmt: (it: unknown, f: (n: number) => string) => string;
  rvTagRow: (it: Record<string, unknown>, el: unknown, done: unknown[]) => void;
  rvMoney: (n: number) => string;
  fC: (n: number) => string;
};
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// The automatic revision of the e2e scenario (the CRM's diffBuilds lines).
const AUTO: Line[] = [
  { kind: 'remove', printKind: 'Remove', desc: "Remove lean-to Attached (to main building) — Left Eave (12' × 40')", amount: -5240 },
  { kind: 'change', printKind: 'Modify', desc: 'Window Hi-Impact 36×48 — Right Eave Side — changed: type White 30×30 → Hi-Impact 36×48', amount: 345 },
  { kind: 'add', printKind: 'Add', desc: 'Add roll-up door 10×8 — Back Gable End', amount: 950 },
  { kind: 'move', printKind: 'Modify', desc: 'Window White 30×30 — Left Eave Side — moved (placement only)', amount: 0, wall: 'Left Eave Side',
    from: [{ val: '12', side: 'left' }], to: [{ val: '18.5208', side: 'left' }], fromSill: '', toSill: '4.5' },
];
const DOC = { agreementNo: 'SS-2026-00144', revNo: '1', signed: true, signedDate: '2026-10-01', originalTotal: 21962.63, depositPaid: 3506,
  adjustment: -50, adjLabel: 'Adjustment to final build price (after discount and tax)', lines: AUTO };

describe('change lines', () => {
  it('reads like the owner asked: + Added / − Removed / ~ Changed / Moved old → new', () => {
    const r = AUTO.map((l) => P.rvLine(l));
    expect(r.map((x) => x.sym + ' ' + x.verb)).toEqual(['− Removed', '~ Changed', '+ Added', '↔ Moved']);
    expect(r[0].text).toBe("Lean-to Attached (to main building) — Left Eave (12' × 40')");
    expect(r[1].text).toBe('Window Hi-Impact 36×48 — Right Eave Side — type White 30×30 → Hi-Impact 36×48');
    expect(r[2].text).toBe('Roll-up door 10×8 — Back Gable End');
    // the shared feet-inch-fraction formatter (1/8"), the named reference end, the sill
    expect(r[3].text).toBe("Window White 30×30 — Left Eave Side — 12' from the front gable → 18'6¼\" from the front gable; sill 4'2\" → 4'6\"");
    expect(r.map((x) => x.amt)).toEqual([-5240, 345, 950, 0]);
    expect(P.rvMoney(-5240)).toBe('−$5,240.00');
    expect(P.rvMoney(950)).toBe('+$950.00');
    expect(P.rvMoney(0)).toBe('$0.00');
  });
  it('a manual (typed) line shows the same way, by its Add / Remove / Modify kind', () => {
    const m = [{ kind: 'manual', printKind: 'Add', desc: 'Roll-Up Door 10x10 — Front Gable End', amount: 1450 },
      { kind: 'manual', printKind: 'Remove', desc: 'Window — Left Eave Side', amount: -295 },
      { kind: 'manual', printKind: 'Modify', desc: 'Wall color Burgundy → Black', amount: 0 }].map((l) => P.rvLine(l));
    expect(m.map((x) => x.sym + ' ' + x.verb + ' ' + x.text)).toEqual(['+ Added Roll-Up Door 10x10 — Front Gable End', '− Removed Window — Left Eave Side', '~ Changed Wall color Burgundy → Black']);
  });
  it('auto-spaced positions and gable references', () => {
    const l = P.rvLine({ kind: 'move', desc: 'Roll-up door 10×8 — Back Gable End — moved (placement only)', wall: 'Back Gable End', from: [{ val: '', side: 'left' }], to: [{ val: '3', side: 'right' }], amount: 0 });
    expect(l.text).toBe("Roll-up door 10×8 — Back Gable End — auto-spaced → 3' from the left eave corner");
  });
});

describe('REVISED CONTRACT box', () => {
  const box = P.rvBoxHTML({ doc: DOC, origTot: 21962.63, revTot: 17622.63, legend: { added: true, changed: true, removed: true } });
  const t = text(box);
  it('names the revision, the agreement and its signed date', () => {
    expect(t).toContain('REVISED CONTRACT — REVISION 1 to Agreement SS-2026-00144, signed October 1, 2026');
    expect(t).toContain('Supersedes the previously signed agreement.');
  });
  it('one line per change with its price, then original → revised', () => {
    expect(t).toContain("− Removed Lean-to Attached (to main building) — Left Eave (12' × 40') −$5,240.00");
    expect(t).toContain('+ Added Roll-up door 10×8 — Back Gable End +$950.00');
    expect(t).toContain('~ Changed Window Hi-Impact 36×48');
    expect(t).toContain('+$345.00');
    expect(t).toContain('↔ Moved Window White 30×30');
    expect(t).toContain('Adjustment to final build price (after discount and tax) −$50.00');
    expect(t).toContain('Original contract $21,962.63 → Revised $17,622.63 (−$4,340.00)');
  });
  it('the sentence matches what is shown, and the initials box sits beside it', () => {
    expect(t).toContain('In the itemized pricing below, added items are tagged ADDED, changed items are tagged CHANGED with the previous amount struck through and removed items are listed struck through with their credit.');
    expect(t).not.toContain('highlighted');
    expect(box).toContain('class="c-rv-init"');
    expect(t).toContain('Customer initials:');
    const only = text(P.rvBoxHTML({ doc: { ...DOC, lines: AUTO.slice(2, 3) }, origTot: 1, revTot: 2, legend: { added: true } }));
    expect(only).toContain('In the itemized pricing below, added items are tagged ADDED.');
    const none = text(P.rvBoxHTML({ doc: { ...DOC, lines: AUTO.slice(3) }, origTot: 1, revTot: 1, legend: {} }));
    expect(none).not.toContain('itemized pricing below');
  });
  it('> 6 changes: the first 5 + "see the Change Summary on the last page"', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ kind: 'add', desc: 'Add window ' + (i + 1), amount: 100 }));
    const b = text(P.rvBoxHTML({ doc: { ...DOC, lines: many }, origTot: 1000, revTot: 1700, legend: {} }));
    expect(b).toContain('Window 5');
    expect(b).not.toContain('Window 6');
    expect(b).toContain('+ 2 more changes — see the Change Summary on the last page');
    const six = text(P.rvBoxHTML({ doc: { ...DOC, lines: many.slice(0, 6) }, origTot: 1000, revTot: 1600, legend: {} }));
    expect(six).toContain('Window 6');
    expect(six).not.toContain('Change Summary');
    const sum = text(P.rvSummaryHTML({ doc: { ...DOC, lines: many }, origTot: 1000, revTot: 1700 }));
    expect(sum).toContain('Change Summary — REVISION 1 to Agreement SS-2026-00144');
    for (let i = 1; i <= 7; i++) expect(sum).toContain('Window ' + i);
    expect(sum).toContain('Customer initials:');
  });
  it('an original that was never signed: "Quote … (not signed yet)", "Original quote", no "signed"', () => {
    const u = text(P.rvBoxHTML({ doc: { ...DOC, signed: false, signedDate: null }, origTot: 21962.63, revTot: 17622.63, legend: {} }));
    expect(u).toContain('REVISION 1 to Quote SS-2026-00144 (not signed yet)');
    expect(u).toContain('Original quote $21,962.63 → Revised $17,622.63');
    expect(u).not.toMatch(/signed agreement|, signed /);
  });
  it('signed with no known date: the date is left off', () => {
    const s = text(P.rvBoxHTML({ doc: { ...DOC, signedDate: null }, origTot: 2, revTot: 3, legend: {} }));
    expect(s).toContain('REVISION 1 to Agreement SS-2026-00144 Supersedes');
  });
  it('without the CRM (standalone reopen): the old size / storage wording, still the money line', () => {
    const s = text(P.rvBoxHTML({ doc: null, origTot: 100, revTot: 150, sizeText: 'Building size revised: 30×40×12 → 30×50×12.', legend: { added: true } }));
    expect(s).toContain('REVISED CONTRACT Supersedes the previously signed agreement. Building size revised: 30×40×12 → 30×50×12.');
    expect(s).toContain('Original contract $100.00 → Revised $150.00 (+$50.00)');
  });
});

describe('payment summary + itemized rows', () => {
  it('Original contract total → Changes → Revised total → Deposit already paid → New balance due', () => {
    const p = text(P.rvPayRowsHTML({ doc: DOC, origTot: 21962.63, revTot: 17622.63, dep: 2813, paid: 3506 }));
    expect(p).toBe('Original contract total $21,962.63 Changes −$4,340.00 Revised contract total $17,622.63 Deposit already paid −$3,506.00 New balance due $14,116.63');
    const u = text(P.rvPayRowsHTML({ doc: { ...DOC, signed: false }, origTot: 1000, revTot: 1200, dep: 204, paid: 0 }));
    expect(u).toBe('Original quote total $1,000.00 Changes +$200.00 Revised contract total $1,200.00 Additional deposit due now −$204.00 New balance due (at scheduling) $996.00');
  });
  it('one balance rule: paid money is credited; overpaid → refund, never a negative balance', () => {
    // price decrease, paid more than the revised deposit: the excess comes off the balance
    expect({ ...P.rvBalance(17622.63, 2813, 3506) }).toEqual({ paid: 3506, additional: 0, balance: 14116.63, refund: 0 });
    // price increase: the rest of the deposit is due now; the balance is what is left after it
    expect({ ...P.rvBalance(25000, 4000, 3506) }).toEqual({ paid: 3506, additional: 494, balance: 21000, refund: 0 });
    // paid more than the whole revised total
    expect({ ...P.rvBalance(3000, 500, 3506) }).toEqual({ paid: 3506, additional: 0, balance: 0, refund: 506 });
    const r = text(P.rvPayRowsHTML({ doc: DOC, origTot: 3700, revTot: 3000, dep: 500, paid: 3506 }));
    expect(r).toContain('New balance due $0.00 Refund due to buyer $506.00');
    const g = text(P.rvPayRowsHTML({ doc: DOC, origTot: 20000, revTot: 25000, dep: 4000, paid: 3506 }));
    expect(g).toContain('Deposit already paid −$3,506.00 Additional deposit due now −$494.00 New balance due (at scheduling) $21,000.00');
  });
  it('ADDED rows: light green tint + tag; CHANGED: previous amount struck → new; plain rows untouched', () => {
    expect(P.rvRowAttr({ hl: false })).toBe('');
    expect(P.rvRowTag({ hl: false })).toBe('');
    expect(P.rvRowAttr({ hl: true, tag: 'ADDED' })).toBe(' style="background:#ecfdf5"');
    expect(text(P.rvRowTag({ hl: true }))).toBe('ADDED');
    const el = { dataset: { rvNew: 'change', rvDelta: '345' } };
    const done: unknown[] = [];
    const a: Record<string, unknown> = { amt: 1280, hl: true };
    P.rvTagRow(a, el, done);
    expect(a.tag).toBe('CHANGED');
    expect(a.old).toBe(935);
    expect(P.rvOldAmt(a, P.fC)).toBe('<s style="color:#94a3b8;font-weight:600">$935</s> → ');
    const b: Record<string, unknown> = { amt: 150, hl: true };
    P.rvTagRow(b, el, done); // the element's 2nd row (e.g. its side frame): tagged, no strike
    expect(b.tag).toBe('CHANGED');
    expect(b.old).toBeUndefined();
    const n: Record<string, unknown> = { amt: 950, hl: true };
    P.rvTagRow(n, { dataset: { rvNew: 'add' } }, done);
    expect(n.tag).toBe('ADDED');
    const s: Record<string, unknown> = { amt: 1200, hl: true };
    P.rvTagRow(s, { dataset: { rvOrig: '1' } }, done); // a signed lean-to whose storage changed
    expect(s.tag).toBe('CHANGED');
  });
  it('REMOVED rows: kept, struck through, credit negative', () => {
    const r = P.rvRemovedRowsHTML(DOC);
    expect(r).toContain('background:#fef2f2');
    expect(text(r)).toBe("REMOVED Lean-to Attached (to main building) — Left Eave (12' × 40') — — −$5,240.00");
    expect(r).toContain('<s style="color:#64748b">');
    expect(P.rvRemovedRowsHTML({ lines: AUTO.slice(1) })).toBe('');
  });
});

describe('printContract wiring', () => {
  const src = html.slice(html.indexOf('async function printContract(){'), html.indexOf('// Small HTML-escape helper used by printContract'));
  it('the contract number is the CRM hand-off (quote / agreement number), read before the 3D-capture await', () => {
    const read = src.indexOf("_ssCtNo=window._ctNo?String(window._ctNo):''");
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(src.indexOf('await '));
    expect(src).toContain("var orderNum=_ssCtNo||('SS-'+now.getFullYear()+'-'+String(Date.now()).slice(-5));");
  });
  it('the box, payment rows, removed rows and the summary page are wired in', () => {
    expect(src).toContain('rvBoxHTML({doc:_ssRvDoc');
    expect(src).toContain('rvPayRowsHTML({doc:_ssRvDoc');
    expect(src).toContain('rowsHTML+=rvRemovedRowsHTML(_ssRvDoc)');
    expect(src).toContain("_header('Change Summary','')+rvSummaryHTML(");
    expect(src).not.toContain('Added items are highlighted below');
    // the right box uses the same balance rule as the left (paid money credited, refund line)
    expect(src).toContain('fD(_rvBalC?_rvBalC.balance:bal)');
    expect(src).toContain('Refund Due to Buyer');
    expect(src).toContain('rvBalance(tot-addDiscAmountPrint,dep,_rvDepPaid).additional');
  });
});
