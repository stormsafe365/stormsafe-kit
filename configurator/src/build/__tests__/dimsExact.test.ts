import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { offset3DToProgramX, programXTo3DOffset, programXToTyped, typedValueText } from '../positionMap';
import { clampWallCenter, snapGapInto } from '@/engine/wallFit';
import { dimQ as dimQ3D, ftIn, inchLabel } from '@/three/dimLabels';

/**
 * Owner 10/6/26: "still showing 8' 11.75 instead of 9', make sure it will
 * always be consistent. we need to be dialed in on every quote, contract,
 * layout etc" (screenshot 94: door 3'x6'8.04" at 4'4" from the back gable,
 * gap 8'11.75", window 3'0.25"x5'2.25", sill 4'2.04").
 *
 * Root cause: the window is 36¼" wide. A 3D drag snapped the window's edge
 * toward the FRONT gable to a whole inch (its row's button: Auto = "From Front
 * Gable"), so the edge facing the door — 36¼" further on — sat ¾" off the
 * inch: 8'11¾" from the door, while the 3D's own label (rounded to the inch)
 * said 9'. Plus float noise printed as decimals (6.67 ft → 6'8.04").
 *
 * Fix: ONE 1/8" grid for every size and spot (dimQ), ONE formatter (feet-inches
 * with 1/8" fraction glyphs), and the drag snaps the GAP to its nearest
 * neighbour to a whole inch. The program's own functions run here in a vm.
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

const ctx = vm.createContext({});
vm.runInContext(
  ['getPosItems', 'dimQ', '_dim8', '_dimFtIn', '_dimIn', 'ft', 'posRefName', 'posDescribe', 'checkTrussHitFromFront', 'getTrussOC'].map(grabFn).join('') +
    'function MFR(){ return { wtdTypes: [], winTypes: [{v:"w3036", fw:30, fh:36, color:"white"}] }; }\n' +
    'var __f = {bw:"30", bl:"80", btype:"standard", "oc-spacing":"4oc"}; function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n',
  ctx,
);
type Item = { x: number; w: number; h: number; yo?: number };
const P = ctx as unknown as {
  getPosItems: (entry: unknown, qty: number, itemW: number, faceW: number, itemH: number, type: string, extraH?: number) => Item[];
  dimQ: (ft: number) => number;
  _dimFtIn: (ft: number) => string;
  _dimIn: (ft: number) => string;
  ft: (n: number | string) => string;
  posDescribe: (loc: string, val: string | number, side: string) => string;
  checkTrussHitFromFront: (d: number, w: number, L: number) => number[];
};

type Side = 'left' | 'right';
type Row = { val: string; side: Side };
function entry(loc: string, rows: Row[], extra: Record<string, unknown> = {}) {
  const rs = rows.map((r) => ({ querySelector: (s: string) => (s === 'input' ? { value: r.val } : s === '.pos-toggle button.active' ? { dataset: { side: r.side } } : null) }));
  return {
    querySelector: (s: string) => {
      if (s === '.pos-section') return { querySelectorAll: (q: string) => (q === '.pos-row' ? rs : []) };
      if (s === '.wloc, .nloc, .rloc, .fo-loc') return { value: loc };
      if (s in extra) return extra[s];
      return null;
    },
  };
}

/** A printed dimension back to whole eighths of an inch (the audit's parser). */
function parse8(t: string): number {
  const F: Record<string, number> = { '': 0, '⅛': 1, '¼': 2, '⅜': 3, '½': 4, '⅝': 5, '¾': 6, '⅞': 7 };
  let m = /^(−?)(\d+)'(?:(\d+)([⅛¼⅜½⅝¾⅞]?)")?$/.exec(t);
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * 96 + Number(m[3] || 0) * 8 + F[m[4] || '']);
  m = /^(−?)(\d+)([⅛¼⅜½⅝¾⅞]?)"$/.exec(t);
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * 8 + F[m[3]]);
  throw new Error('not a dimension: ' + t);
}

describe('ONE formatter: feet-inches to the nearest 1/8", never decimals', () => {
  it("the owner's numbers print exact", () => {
    expect(P._dimFtIn(36.25 / 12)).toBe(`3'0¼"`);
    expect(P._dimFtIn(62.25 / 12)).toBe(`5'2¼"`);
    expect(P._dimFtIn(6.67)).toBe(`6'8"`); // the walk door's 6.67 ft was 6'8.04"
    expect(P._dimFtIn(4.17)).toBe(`4'2"`); // the sill box's 4.17 ft was 4'2.04"
    expect(P._dimFtIn(4.16667)).toBe(`4'2"`);
    expect(P._dimFtIn(9)).toBe(`9'`);
    expect(P._dimFtIn(4 + 4 / 12)).toBe(`4'4"`);
    expect(P._dimFtIn(8 + 11.75 / 12)).toBe(`8'11¾"`);
    expect(P._dimFtIn(0.5)).toBe(`0'6"`);
    expect(P._dimFtIn(30)).toBe(`30'`);
    expect(P._dimFtIn(1 / 96)).toBe(`0'0⅛"`);
    expect(P._dimFtIn(11.99 / 12)).toBe(`1'`); // rounds up into the next foot cleanly
    expect(P._dimFtIn(-1.5)).toBe(`−1'6"`);
    expect(P._dimIn(36.25 / 12)).toBe(`36¼"`);
    expect(P._dimIn(6.67)).toBe(`80"`);
    expect(P.ft(4 + 4 / 12)).toBe('4′ 4″');
    expect(P.ft(60 + 7.75 / 12)).toBe('60′ 7¾″');
    expect(P.ft('4.333')).toBe('4′ 4″');
  });
  it('the 3D labels use the same rule (ftIn / inchLabel = _dimFtIn / _dimIn on 20,000 values)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 20000; n++) {
      const v = n < 2000 ? n / 96 : rnd() * 120;
      expect(ftIn(v)).toBe(P._dimFtIn(v));
      expect(inchLabel(v)).toBe(P._dimIn(v));
      expect(dimQ3D(v)).toBe(P.dimQ(v));
      expect(P._dimFtIn(v)).not.toMatch(/\./);
      expect(P.ft(v)).not.toMatch(/\./);
      expect(parse8(P._dimFtIn(v))).toBe(Math.round(v * 96));
    }
  });
});

describe("the owner's left eave (80' x 30', 4' OC): door 4'4\" From Back Gable, 36¼\" x 62¼\" window 9' after it", () => {
  const L = 80, DOOR = 3, WIN = 36.25 / 12;
  const door = () => P.getPosItems(entry('Left Eave Side', [{ val: '4.333', side: 'right' }]), 1, DOOR, L, 6.67, 'fo')[0];
  const gapFrom = (win: Item) => P._dimFtIn(win.x - (door().x + door().w));
  it('door: 4\'4", 3\' x 6\'8" (typed 4.333 reads as exactly 52")', () => {
    const d = door();
    expect(d.x * 96).toBe(52 * 8);
    expect(P._dimFtIn(d.x)).toBe(`4'4"`);
    expect(`${P._dimFtIn(d.w)}x${P._dimFtIn(d.h)}`).toBe(`3'x6'8"`);
  });
  it("typed 16'4\" From Back Gable → 9'", () => {
    const [w] = P.getPosItems(entry('Left Eave Side', [{ val: '16.333', side: 'right' }]), 1, WIN, L, 62.25 / 12, 'fo', 4.17);
    expect(gapFrom(w)).toBe(`9'`);
    expect(`${P._dimFtIn(w.w)}x${P._dimFtIn(w.h)}`).toBe(`3'0¼"x5'2¼"`);
    expect(`sill ${P._dimFtIn(w.yo!)}`).toBe(`sill 4'2"`);
  });
  it("typed From FRONT Gable at the exact spot (60'7¾\") → 9' (and the card says so)", () => {
    const typed = L - (4 + 4 / 12) - DOOR - 9 - WIN; // 60'7¾"
    const [w] = P.getPosItems(entry('Left Eave Side', [{ val: typedValueText(typed), side: 'left' }]), 1, WIN, L, 62.25 / 12, 'fo', 4.17);
    expect(typedValueText(typed)).toBe('60.6458');
    expect(gapFrom(w)).toBe(`9'`);
    expect(P.posDescribe('Left Eave Side', typedValueText(typed), 'left')).toBe(`60'7¾" from the front gable to its near edge`);
  });
  it("a 3D drag that shows 9' writes 9' (gap to the nearest neighbour snapped to the inch) — every wall frame, both buttons", () => {
    const d = door();
    // Left Eave = 3D 'right' side, mirrored: 3D offset runs from the FRONT.
    const doorOff = programXTo3DOffset('Left Eave Side', d.x, d.w, L);
    for (const rawGap of [8.97, 8.99, 9, 9.01, 9.04]) {
      const raw = programXTo3DOffset('Left Eave Side', d.x + d.w + rawGap, WIN, L);
      const off = clampWallCenter(raw, WIN, L, [{ offset: doorOff, width: DOOR }], 40);
      for (const side of ['left', 'right'] as const) {
        const x = offset3DToProgramX('Left Eave Side', off, WIN, L);
        const val = typedValueText(programXToTyped('Left Eave Side', x, WIN, L, side));
        const [w] = P.getPosItems(entry('Left Eave Side', [{ val, side }]), 1, WIN, L, 62.25 / 12, 'fo', 4.17);
        expect(gapFrom(w)).toBe(`9'`);
      }
    }
  });
  it('before the fix: snapping the FRONT-side edge to the inch gave 8\'11¾" (the screenshot)', () => {
    const typedOld = Math.round((L - (4 + 4 / 12) - DOOR - 8.99 - WIN) * 12) / 12; // old write-back: nearest inch from the front
    const [w] = P.getPosItems(entry('Left Eave Side', [{ val: String(typedOld), side: 'left' }]), 1, WIN, L, 62.25 / 12, 'fo', 4.17);
    expect(gapFrom(w)).toBe(`8'11¾"`);
  });
});

describe('snapGapInto: the gap to the nearest neighbour is a whole inch', () => {
  it('beside a 36¼" opening, either side', () => {
    const sib = [{ offset: 20 + 36.25 / 24, width: 36.25 / 12 }]; // left edge 20', right edge 23'0¼"
    const right = clampWallCenter(23 + 0.25 / 12 + 5.03 + 1.5, 3, 80, sib, 50) - 1.5; // left edge ~5.03' past it
    expect(Math.round((right - (23 + 0.25 / 12)) * 96)).toBe(5 * 96); // 5' exactly from its right edge
    const left = clampWallCenter(20 - 4.98 - 1.5, 3, 80, sib, 50) + 1.5; // right edge ~4.98' before it
    expect(Math.round((20 - left) * 96)).toBe(5 * 96);
  });
  it('a whole-inch gap to the wall end when that is nearest', () => {
    const c = clampWallCenter(1.9 + 36.25 / 24, 36.25 / 12, 40, [], 10);
    expect(Math.round((c - 36.25 / 24) * 96)).toBe(2 * 96 - 8 * 1); // 1'11" from the corner (nearest inch to 1.9')
  });
  it('never breaks the 1\' rule; null when nothing fits', () => {
    expect(snapGapInto([], 5, 3, 40, [])).toBeNull();
    const c = clampWallCenter(0, 3, 40, [], 10);
    expect(c - 1.5).toBeCloseTo(1, 9);
  });
});

describe('chains add up EXACTLY to the wall length (random walls, fractional widths, typed + auto)', () => {
  it('2,000 walls', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const locs = ['Front Gable End', 'Back Gable End', 'Left Eave Side', 'Right Eave Side', 'Partition Wall'];
    for (let n = 0; n < 2000; n++) {
      const loc = locs[n % 5];
      const face = loc.includes('Eave') ? [20, 21, 40, 50, 80, 100][Math.floor(rnd() * 6)] : [12, 18, 24, 30, 40][Math.floor(rnd() * 5)];
      const w = [3, 2.5, 36.25 / 12, 3.02, 35.875 / 12, 10, 6.67, 4.1][Math.floor(rnd() * 8)];
      const qty = 1 + Math.floor(rnd() * 3);
      const rows: Row[] = [];
      for (let i = 0; i < qty; i++) rows.push(rnd() < 0.5 ? { val: '', side: 'left' } : { val: String(Math.round(rnd() * Math.max(0, face - w) * 1000) / 1000), side: rnd() < 0.5 ? 'left' : 'right' });
      const items = P.getPosItems(entry(loc, rows), qty, w, face, 6.67, 'fo').sort((a, b) => a.x - b.x);
      // the chain as a spacing page prints it: corner gap, width, gap, width, ..., corner gap
      const parts: string[] = [];
      let at = 0;
      for (const it of items) { parts.push(P._dimFtIn(it.x - at)); parts.push(P._dimFtIn(it.w)); at = it.x + it.w; }
      parts.push(P._dimFtIn(face - at));
      for (const t of parts) expect(t).not.toMatch(/\./);
      expect(parts.reduce((s, t) => s + parse8(t), 0)).toBe(face * 96);
      for (const it of items) { expect(Math.abs(it.x * 96 - Math.round(it.x * 96))).toBeLessThan(1e-6); expect(Math.abs(it.w * 96 - Math.round(it.w * 96))).toBeLessThan(1e-6); }
    }
  });
  it('a 30×36 window is 36" tall in every drawing (its type, not 30×30)', () => {
    const e = entry('Front Gable End', [{ val: '', side: 'left' }], { '.ntp': { value: 'w3036' } });
    const [it] = P.getPosItems(e, 1, 2.5, 30, 2.5, 'win', 4.16667);
    expect(`${P._dimIn(it.w)}x${P._dimIn(it.h)} sill ${P._dimFtIn(it.yo!)}`).toBe(`30"x36" sill 4'2"`);
  });
  it('truss check: a frame line exactly 2" from the jamb clears (1/8" grid, no float noise)', () => {
    expect(P.checkTrussHitFromFront(P.dimQ(50 / 12), 3, 80)).toEqual([]); // edge 50", line at 48"
    expect(P.checkTrussHitFromFront(P.dimQ(49.875 / 12), 3, 80)).toEqual([4]); // 1⅞" → side frame
  });
});
