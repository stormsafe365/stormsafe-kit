import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { dragWritePos, dragWritePosValue, dragWriteSide } from '../dragWriteBack';

/**
 * 3D drag of a door on the End Storage "Partition Wall" → the program's own
 * position fields (owner 10/3/26). writeBackDrag writes pos = centerline −
 * w/2 (nearest inch) into the entry's .pos-row input and sets its From Left
 * toggle; readOpenings then calls the program's getPosItems (faceW = W for
 * the Partition Wall, no mirroring) and the 3D centerline = x + w/2 — the
 * program's OWN function (public/quote-builder.html, in a node vm) closes the
 * loop here. Position has no price: the mapping never touches a total.
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

type Row = { val: string; side: 'left' | 'right' };
type Item = { x: number; w: number; h: number };
const ctx = vm.createContext({});
vm.runInContext(grabFn('getPosItems') + 'function MFR(){ return { wtdTypes: [], winTypes: [] }; }', ctx);
const getPosItems = ctx.getPosItems as (entry: unknown, qty: number, itemW: number, faceW: number, itemH: number, type: string) => Item[];

/** The slice of an entry's DOM that getPosItems reads (location, pos rows, roll-up color). */
function entry(loc: string, rows: Row[], extra: Record<string, string> = {}) {
  const row = (r: Row) => ({
    querySelector: (sel: string) => (sel === 'input' ? { value: r.val } : sel === '.pos-toggle button.active' ? { dataset: { side: r.side } } : null),
  });
  return {
    querySelector: (sel: string) => {
      if (sel === '.pos-section') return { querySelectorAll: (s: string) => (s === '.pos-row' ? rows.map(row) : []) };
      if (sel === '.wloc, .nloc, .rloc, .fo-loc') return { value: loc };
      if (sel in extra) return { value: extra[sel] };
      return null;
    },
  };
}

const W = 26;
/** readOpenings for a Partition Wall item: faceW = W, centerline = x + w/2, no mirror. */
const read3D = (rows: Row[], w: number, type = 'rollup') => getPosItems(entry('Partition Wall', rows, { '.rco': 'white' }), rows.length, w, W, w, type).map((it) => it.x + it.w / 2);
/** writeBackDrag for one item: the row it writes. */
const writeBack = (offset: number, w: number): Row => ({ val: dragWritePosValue(offset, w), side: dragWriteSide('partition') });

describe('Partition Wall drag → program position (round trip through the program\'s getPosItems)', () => {
  it('Partition Wall rows are written From Left (like the Front gable); only the Back gable is From Right', () => {
    expect(dragWriteSide('partition')).toBe('left');
    expect(dragWriteSide('front')).toBe('left');
    expect(dragWriteSide('left')).toBe('left');
    expect(dragWriteSide('right')).toBe('left');
    expect(dragWriteSide('back')).toBe('right');
  });
  it('program pos = centerline − w/2, nearest inch, never negative; tidy input text', () => {
    expect(dragWritePos(19, 10)).toBe(14);
    expect(dragWritePos(7 + 1 / 3, 10)).toBeCloseTo(2 + 1 / 3, 9);
    expect(dragWritePos(7.3, 10)).toBeCloseTo(2 + 4 / 12, 9); // 2.3' → 2' 4"
    expect(dragWritePos(4, 10)).toBe(0); // clamped at the corner
    expect(dragWritePosValue(19, 10)).toBe('14');
    expect(dragWritePosValue(7 + 1 / 3, 10)).toBe('2.333');
    expect(dragWritePosValue(9, 3)).toBe('7.5');
  });
  it('auto-placed 10x10 roll-up (program centres it at W/2) dragged 6\' → the program reads it 6\' over', () => {
    const [auto] = read3D([{ val: '', side: 'left' }], 10);
    expect(auto).toBe(13); // (26 − 10) / 2 + 5
    const row = writeBack(auto + 6, 10);
    expect(row).toEqual({ val: '14', side: 'left' });
    expect(read3D([row], 10)).toEqual([19]);
    const row2 = writeBack(auto - 6, 10);
    expect(row2).toEqual({ val: '2', side: 'left' });
    expect(read3D([row2], 10)).toEqual([7]);
  });
  it('auto-placed 3\' walk door dragged 4\' → program x 7.5 / 15.5 (From Left), same spot in 3D', () => {
    const [auto] = read3D([{ val: '', side: 'left' }], 3, 'wtd');
    expect(auto).toBe(13);
    expect(writeBack(auto - 4, 3)).toEqual({ val: '7.5', side: 'left' });
    expect(read3D([writeBack(auto - 4, 3)], 3, 'wtd')).toEqual([9]);
    expect(writeBack(auto + 4, 3)).toEqual({ val: '15.5', side: 'left' });
    expect(read3D([writeBack(auto + 4, 3)], 3, 'wtd')).toEqual([17]);
  });
  it('a row the rep typed From Right is rewritten From Left at the SAME spot (no jump) when dragged by 0', () => {
    const typed: Row = { val: '2', side: 'right' }; // x = 26 − 2 − 10 = 14 → centre 19
    const [c] = read3D([typed], 10);
    expect(c).toBe(19);
    expect(writeBack(c, 10)).toEqual({ val: '14', side: 'left' });
    expect(read3D([writeBack(c, 10)], 10)).toEqual([19]);
  });
  it('every reachable spot on the 26\' wall round-trips to within half an inch', () => {
    for (let c = 5; c <= 21; c += 0.137) {
      const [back] = read3D([writeBack(c, 10)], 10);
      expect(Math.abs(back - c)).toBeLessThanOrEqual(1 / 24 + 1e-9);
    }
  });
  it('a 2-door row: the dragged item and its frozen sibling each round-trip (siblings never re-auto-space)', () => {
    const rows = [writeBack(5, 8), writeBack(21, 8)];
    expect(rows).toEqual([{ val: '1', side: 'left' }, { val: '17', side: 'left' }]);
    expect(read3D(rows, 8)).toEqual([5, 21]);
  });
});

describe('BuildHost wires the partition exactly like the front gable', () => {
  const host = readFileSync(fileURLToPath(new URL('../BuildHost.tsx', import.meta.url)), 'utf8');
  it('Partition Wall → side partition; faceW = W for every non-eave location; only Left Eave / Back Gable mirror', () => {
    expect(host).toMatch(/'Partition Wall': 'partition',/);
    expect(host).toMatch(/const faceFor = \(loc: string\) => \(loc === 'Left Eave Side' \|\| loc === 'Right Eave Side' \? L : W\);/);
    expect(host).toMatch(/const mirror = loc === 'Left Eave Side' \|\| loc === 'Back Gable End';/);
  });
  it('writeBackDrag uses the shared mapping and the program\'s own pos rows + From Left/Right toggles, then rc()', () => {
    const fn = host.slice(host.indexOf('function writeBackDrag('), host.indexOf('function writeBackLeanToOpening('));
    expect(fn).toMatch(/const targetSide = dragWriteSide\(side\);/);
    expect(fn).toMatch(/input\.value = dragWritePosValue\(op\.offset, op\.width\);/);
    expect(fn).toMatch(/btn\.classList\.toggle\('active', btn\.dataset\.side === targetSide\);/);
    expect(fn).toMatch(/win\.updatePosSection\(entry, siblings\.length\);/);
    expect(fn).toMatch(/if \(wrote && typeof win\.rc === 'function'\) win\.rc\(\);/);
    expect(fn).not.toMatch(/partition/); // no partition special-case: the program's own fields, like every wall
  });
  it('the write-back only runs after a real drag (dragMoved), for the selected opening', () => {
    expect(host).toMatch(/if \(prev\.dragging && !s\.dragging && prev\.dragMoved\) \{\s*\/\/[^\n]*\n\s*writeBackDrag\(win, prev\.selectedOpeningId \?\? s\.selectedOpeningId\);/);
  });
});
