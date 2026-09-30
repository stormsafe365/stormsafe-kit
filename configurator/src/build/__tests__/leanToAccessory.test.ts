import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LEAN_TO_BLACK, isImpactWalkDoorType, leanToWalkDoorLook, leanToWindowLook, type ProgramTypeRow } from '../leanToAccessory';

// Render-upgrade Phase 7: VIEW-ONLY lean-to walk-door / window details read
// from the program's own lean-to accessory type selects. The tables below are
// copied from public/quote-builder.html MANUFACTURERS (CA + CCI wtdTypes /
// winTypes); the last test checks they still match the program.

const CA_WTD: ProgramTypeRow[] = [{ v: 'std' }, { v: 'hi' }];
const CA_WIN: ProgramTypeRow[] = [
  { v: 'std', fw: 30, fh: 30 },
  { v: 'hi', fw: 30, fh: 30 },
];
const CCI_WTD: ProgramTypeRow[] = [
  { v: 'std', style: 'std', color: 'white' },
  { v: 'std_blk', style: 'std', color: 'black' },
  { v: '6panel', style: '6panel', color: 'white' },
  { v: '6panel_blk', style: '6panel', color: 'black' },
  { v: '9lite', style: '9lite', color: 'white' },
  { v: '9lite_blk', style: '9lite', color: 'black' },
  { v: 'diamond', style: 'diamond', color: 'white' },
  { v: 'hiwind', style: 'std', color: 'white' },
];
const CCI_WIN: ProgramTypeRow[] = [
  { v: 'std', fw: 30, fh: 30, color: 'white' },
  { v: 'w3036', fw: 30, fh: 36, color: 'white' },
  { v: 'b3030', fw: 30, fh: 30, color: 'black' },
  { v: 'b3036', fw: 30, fh: 36, color: 'black' },
  { v: 'hw', fw: 30, fh: 30, color: 'white' },
  { v: 'hi', fw: 30, fh: 30, color: 'white' },
  { v: 'hi3036', fw: 30, fh: 36, color: 'white' },
];

describe('lean-to walk door (hi-impact swings OUT, same rule as the main building)', () => {
  it('impact = CA "hi" / CCI "hiwind" only', () => {
    expect(isImpactWalkDoorType('hi')).toBe(true);
    expect(isImpactWalkDoorType('hiwind')).toBe(true);
    for (const v of ['std', 'std_blk', '6panel', '9lite_blk', 'diamond', '', undefined, 'high', 'hiwind2']) expect(isImpactWalkDoorType(v)).toBe(false);
  });

  it('CCI: face style + black from the type table', () => {
    expect(leanToWalkDoorLook('hiwind', CCI_WTD)).toEqual({ impact: true, doorStyle: 'std', color: undefined });
    expect(leanToWalkDoorLook('9lite_blk', CCI_WTD)).toEqual({ impact: false, doorStyle: '9lite', color: LEAN_TO_BLACK });
    expect(leanToWalkDoorLook('6panel', CCI_WTD)).toEqual({ impact: false, doorStyle: '6panel', color: undefined });
    expect(leanToWalkDoorLook('diamond', CCI_WTD).doorStyle).toBe('diamond');
  });

  it('CA (no style / color columns) and unknown values fall back to a white standard slab', () => {
    expect(leanToWalkDoorLook('hi', CA_WTD)).toEqual({ impact: true, doorStyle: 'std', color: undefined });
    expect(leanToWalkDoorLook('std', CA_WTD)).toEqual({ impact: false, doorStyle: 'std', color: undefined });
    expect(leanToWalkDoorLook(undefined, undefined)).toEqual({ impact: false, doorStyle: 'std', color: undefined });
  });
});

describe('lean-to window size + frame color from the program type', () => {
  it('CCI 30x36 types draw 2.5 x 3 ft; black types get the black frame', () => {
    expect(leanToWindowLook('hi3036', CCI_WIN)).toEqual({ widthFt: 2.5, heightFt: 3, color: undefined });
    expect(leanToWindowLook('w3036', CCI_WIN)).toEqual({ widthFt: 2.5, heightFt: 3, color: undefined });
    expect(leanToWindowLook('b3036', CCI_WIN)).toEqual({ widthFt: 2.5, heightFt: 3, color: LEAN_TO_BLACK });
    expect(leanToWindowLook('b3030', CCI_WIN)).toEqual({ widthFt: 2.5, heightFt: 2.5, color: LEAN_TO_BLACK });
  });

  it('30x30 types and unknown values keep the classic 30x30 (2.5 x 2.5 ft)', () => {
    expect(leanToWindowLook('std', CA_WIN)).toEqual({ widthFt: 2.5, heightFt: 2.5, color: undefined });
    expect(leanToWindowLook('hi', CCI_WIN)).toEqual({ widthFt: 2.5, heightFt: 2.5, color: undefined });
    expect(leanToWindowLook(undefined, undefined)).toEqual({ widthFt: 2.5, heightFt: 2.5, color: undefined });
    expect(leanToWindowLook('nope', CCI_WIN)).toEqual({ widthFt: 2.5, heightFt: 2.5, color: undefined });
  });

  it('the copied tables still match the pricing program (quote-builder.html)', () => {
    const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
    for (const r of CCI_WTD) expect(html).toMatch(new RegExp(`\\{v:'${r.v}',\\s*label:'[^']*',\\s*style:'${r.style}',\\s*color:'${r.color}'\\}`));
    for (const r of CCI_WIN) expect(html).toMatch(new RegExp(`\\{v:'${r.v}',\\s*label:'[^']*',\\s*fw:${r.fw}, fh:${r.fh}, color:'${r.color}'\\}`));
    // The lean-to selects the 3D reads are the program's own.
    expect(html).toMatch(/<select class="lt-acc-wtd-hi"/);
    expect(html).toMatch(/<select class="lt-acc-win-hi"/);
  });
});
