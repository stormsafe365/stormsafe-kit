import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  LT_PARTITION_CORNER_CLEAR_FT,
  LT_PARTITION_DOOR_HEADER_FT,
  LT_PARTITION_EPS_FT,
  LT_PARTITION_GAP_FT,
  LT_PARTITION_WINDOW_HEADER_FT,
} from '@/config/constants';
import { deriveStructure } from '../geometry';
import { resolveBuilding } from '../ruleEngine';
import { clampPartitionCenter, partitionGeom, partitionNeedFt, partitionSpotOk, partitionWallHeightAt, type PartitionGeom } from '../partitionFit';
import type { LeanTo, LeanToOpening } from '@/types/building';

/**
 * Lean-to STORAGE PARTITION — the main gable end's fit rules (owner 9/30/26:
 * "same spacing rules ... as the gable end requires on the main building").
 * The pricing program owns the rules (quote-builder.html LT_PART_*,
 * ltPartItemIssue / ltPartGapPairs); the 3D refuses to drag a partition opening
 * into a spot that breaks them (clampPartitionCenter). These tests pin the 3D
 * side AND run the program's own rule functions (extracted from the HTML) on
 * the same spots, so the two can never disagree.
 */

const HTML = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

/** Source of `function name(...){...}` from the program (brace-matched, string-aware). */
function programFn(name: string): string {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`program function ${name} not found`);
  let i = HTML.indexOf('{', start);
  let depth = 0;
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === "'" || c === '"') {
      for (i++; i < HTML.length && HTML[i] !== c; i++) if (HTML[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return HTML.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

const constLine = HTML.match(/var LT_PART_CLR=[^;]+;/);
type ProgItem = { ae: unknown; x: number; w: number; h: number; sill: number; kind: 'door' | 'win'; what: string; n: number; i: number };
const program = new Function(
  `${constLine ? constLine[0] : ''}
   ${programFn('_dimFtIn')}
   ${programFn('_ltPartIn')}
   ${programFn('_ltPartFt')}
   ${programFn('ltPartWallH')}
   ${programFn('ltPartItemIssue')}
   ${programFn('ltPartGapPairs')}
   return { ltPartWallH: ltPartWallH, ltPartItemIssue: ltPartItemIssue, ltPartGapPairs: ltPartGapPairs,
            C: { CLR: LT_PART_CLR, GAP: LT_PART_GAP, DOOR: LT_PART_DOOR_HDR, WIN: LT_PART_WIN_HDR, EPS: LT_PART_EPS } };`,
)() as {
  ltPartWallH: (g: PartitionGeom, x: number) => number;
  ltPartItemIssue: (g: PartitionGeom, it: ProgItem) => string;
  ltPartGapPairs: (items: ProgItem[], crossOnly: boolean) => unknown[];
  C: { CLR: number; GAP: number; DOOR: number; WIN: number; EPS: number };
};

/** 30 x 40 x 12 garage with one attached lean-to. */
const structure = (lt: Partial<LeanTo>) =>
  deriveStructure(
    resolveBuilding({
      ...DEFAULT_CONFIG,
      buildingType: 'garage',
      width: 30,
      length: 40,
      legHeight: 12,
      trussSpacingFt: 5,
      openings: [],
      leanTos: [
        {
          id: 'lt1',
          type: 'attached',
          attachedSide: 'Right Eave',
          widthFt: 12,
          lengthFt: 40,
          lowLegHeightFt: 10,
          roofPitch: '2:12',
          enclosure: 'open',
          openings: [],
          storage: { end: 'back', lengthFt: 10 },
          ...lt,
        } as LeanTo,
      ],
    }),
  ).leanTos[0];

const op = (o: Partial<LeanToOpening> = {}): LeanToOpening => ({
  id: 'p1',
  type: 'rollUpDoor',
  wall: 'partition',
  widthFt: 10,
  heightFt: 8,
  sillFt: 0,
  offsetFt: 6,
  ...o,
});

const geom = (len: number, low: number, pitch: number, lowAtZero: boolean): PartitionGeom => ({ len, low, slope: pitch / 12, lowAtZero });
const kindOf = (o: LeanToOpening): 'door' | 'win' => (o.type === 'window' || (o.type === 'frameOut' && o.sillFt > 0) ? 'win' : 'door');
/** The PROGRAM's verdict on one opening at centre `c` next to `sibs`. */
const programOk = (g: PartitionGeom, o: LeanToOpening, c: number, sibs: LeanToOpening[]) => {
  const it = (x: LeanToOpening, cx: number, ae: unknown): ProgItem => ({
    ae, x: cx - x.widthFt / 2, w: x.widthFt, h: x.heightFt, sill: x.sillFt, kind: kindOf(x), what: 'opening', n: 1, i: 0,
  });
  const me = it(o, c, 'me');
  if (program.ltPartItemIssue(g, me)) return false;
  return program.ltPartGapPairs([me, ...sibs.map((s, k) => it(s, s.offsetFt, k))], true).length === 0;
};

describe('partition fit — constants and geometry', () => {
  it('the 3D constants are the program\'s LT_PART_* numbers', () => {
    expect(constLine).not.toBeNull();
    expect(program.C).toEqual({
      CLR: LT_PARTITION_CORNER_CLEAR_FT,
      GAP: LT_PARTITION_GAP_FT,
      DOOR: LT_PARTITION_DOOR_HEADER_FT,
      WIN: LT_PARTITION_WINDOW_HEADER_FT,
      EPS: LT_PARTITION_EPS_FT,
    });
    expect([LT_PARTITION_CORNER_CLEAR_FT, LT_PARTITION_GAP_FT, LT_PARTITION_DOOR_HEADER_FT, LT_PARTITION_WINDOW_HEADER_FT]).toEqual([1, 1, 1, 0]);
  });

  it('outer (low) post is at offset 0 for Right Eave / Front Gable, at the far end for Left Eave / Back Gable (same as the program)', () => {
    const cases: Array<[LeanTo['attachedSide'], boolean]> = [
      ['Right Eave', true],
      ['Front Gable', true],
      ['Left Eave', false],
      ['Back Gable', false],
    ];
    for (const [side, lowAtZero] of cases) {
      const g = partitionGeom(structure({ attachedSide: side, widthFt: 12, lowLegHeightFt: 10, roofPitch: '2:12' }));
      expect(g).toEqual({ len: 12, low: 10, slope: expect.closeTo(2 / 12, 9), lowAtZero });
      // Program's ltPartGeom rule: lowAtZero = Right Eave || Front Gable.
      expect(g.lowAtZero).toBe(side === 'Right Eave' || side === 'Front Gable');
      expect(partitionWallHeightAt(g, lowAtZero ? 0 : 12)).toBeCloseTo(10, 9);
      expect(partitionWallHeightAt(g, lowAtZero ? 12 : 0)).toBeCloseTo(12, 9);
      for (const x of [0, 1, 3.5, 6, 11, 12]) expect(partitionWallHeightAt(g, x)).toBeCloseTo(program.ltPartWallH(g, x), 9);
    }
    const g3 = partitionGeom(structure({ widthFt: 20, lowLegHeightFt: 8, roofPitch: '3:12' }));
    expect(g3.slope).toBeCloseTo(0.25, 9);
  });

  it('header / window rule: doors need top + 1\', windows top only', () => {
    expect(partitionNeedFt(op({ heightFt: 8 }))).toBe(9);
    expect(partitionNeedFt(op({ type: 'walkDoor', widthFt: 3, heightFt: 6.67 }))).toBeCloseTo(7.67, 9);
    expect(partitionNeedFt(op({ type: 'window', widthFt: 2.5, heightFt: 2.5, sillFt: 4.16667 }))).toBeCloseTo(6.66667, 9);
    expect(partitionNeedFt(op({ type: 'frameOut', widthFt: 6, heightFt: 7, sillFt: 0 }))).toBe(8);
    expect(partitionNeedFt(op({ type: 'frameOut', widthFt: 3, heightFt: 3, sillFt: 4 }))).toBe(7);
  });
});

describe('partition fit — 3D drag clamp (clampPartitionCenter)', () => {
  it('approved CCI example: 10x8 on a 12\' partition (10\' low leg) has exactly one spot — 1\' from each corner', () => {
    const g = partitionGeom(structure({}));
    for (const raw of [-5, 0, 3, 6, 9, 20]) expect(clampPartitionCenter(raw, op(), g, [], 6)).toBeCloseTo(6, 9);
    expect(partitionSpotOk(6, op(), g, [])).toBe(true);
    expect(partitionSpotOk(5.5, op(), g, [])).toBe(false);
  });

  it('corner posts: a 6\' door stays 1\' clear of both corners', () => {
    const g = geom(12, 10, 2, true);
    expect(clampPartitionCenter(0, op({ widthFt: 6 }), g, [], 6)).toBeCloseTo(4, 9);
    expect(clampPartitionCenter(100, op({ widthFt: 6 }), g, [], 6)).toBeCloseTo(8, 9);
    expect(clampPartitionCenter(6.04, op({ widthFt: 6 }), g, [], 6)).toBeCloseTo(6, 9); // nearest inch
  });

  it('slope: a door too tall for the low side is held toward the building, on both orientations', () => {
    // 20' wide, 8' low leg, 3:12 -> 13' at the building. 10x8 needs 9' at its low jamb = 4' in from the outer post.
    const lowAt0 = geom(20, 8, 3, true);
    expect(clampPartitionCenter(0, op(), lowAt0, [], 10)).toBeCloseTo(4 + 5, 9);
    expect(clampPartitionCenter(50, op(), lowAt0, [], 10)).toBeCloseTo(20 - 1 - 5, 9);
    const lowAtEnd = geom(20, 8, 3, false);
    expect(clampPartitionCenter(50, op(), lowAtEnd, [], 10)).toBeCloseTo(20 - 4 - 5, 9);
    expect(clampPartitionCenter(-50, op(), lowAtEnd, [], 10)).toBeCloseTo(1 + 5, 9);
    // Non-inch bound snaps INTO the valid range: walk door (needs 7'8") on a 7' low leg at 3:12 ->
    // low jamb >= 2.64' in (1/8" tolerance) -> first whole inch 2'8".
    const g = geom(10, 7, 3, true);
    const c = clampPartitionCenter(0, op({ type: 'walkDoor', widthFt: 3, heightFt: 6.67 }), g, [], 5);
    expect(c - 1.5).toBeCloseTo(32 / 12, 9);
    expect(partitionSpotOk(c - 1 / 12, op({ type: 'walkDoor', widthFt: 3, heightFt: 6.67 }), g, [])).toBe(false);
    expect(partitionSpotOk(c, op({ type: 'walkDoor', widthFt: 3, heightFt: 6.67 }), g, [])).toBe(true);
  });

  it('never onto (or within 1\' of) another partition opening; jumps to the nearest free side', () => {
    const g = geom(20, 12, 2, true);
    const sib = op({ id: 'w', type: 'walkDoor', widthFt: 3, heightFt: 6.67, offsetFt: 10 });
    const me = op({ id: 'me', type: 'walkDoor', widthFt: 3, heightFt: 6.67 });
    // Left edge forbidden in (4.5, 12.5).
    expect(clampPartitionCenter(10.5, me, g, [sib], 3)).toBeCloseTo(12.5 + 1.5, 9);
    expect(clampPartitionCenter(9, me, g, [sib], 3)).toBeCloseTo(4.5 + 1.5, 9);
    expect(partitionSpotOk(6, me, g, [sib])).toBe(true);
    expect(partitionSpotOk(6.2, me, g, [sib])).toBe(false);
  });

  it('no valid spot anywhere -> the opening stays where it is', () => {
    const g = geom(8, 6, 2, true); // 6' low, 7'4" at the building
    expect(clampPartitionCenter(3, op({ widthFt: 6, heightFt: 7 }), g, [], 4)).toBe(4); // 7' door + 1' header: needs 8'
    expect(clampPartitionCenter(3, op({ widthFt: 10 }), g, [], 4)).toBe(4); // wider than 8 - 2
  });

  it('every clamped spot passes BOTH the 3D check and the PROGRAM\'s own rule functions (random sweep)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const types: LeanToOpening['type'][] = ['rollUpDoor', 'walkDoor', 'window', 'frameOut'];
    let moved = 0;
    let checked = 0;
    for (let n = 0; n < 4000; n++) {
      const len = [8, 10, 12, 14, 16, 20][Math.floor(rnd() * 6)];
      const g = geom(len, [6, 7, 8, 9, 10, 12][Math.floor(rnd() * 6)], rnd() < 0.5 ? 2 : 3, rnd() < 0.5);
      const t = types[Math.floor(rnd() * 4)];
      const o =
        t === 'rollUpDoor' ? op({ widthFt: [6, 8, 9, 10, 12][Math.floor(rnd() * 5)], heightFt: [6, 7, 8, 9, 10, 12][Math.floor(rnd() * 6)] })
        : t === 'walkDoor' ? op({ type: t, widthFt: 3, heightFt: 6.67 })
        : t === 'window' ? op({ type: t, widthFt: 2.5, heightFt: rnd() < 0.5 ? 2.5 : 3, sillFt: 4.16667 })
        : op({ type: t, widthFt: 2 + Math.round(rnd() * 16) / 2, heightFt: 2 + Math.round(rnd() * 16) / 2, sillFt: rnd() < 0.3 ? 4.17 : 0 });
      const sibs = rnd() < 0.5 ? [op({ id: 's', type: 'walkDoor', widthFt: 3, heightFt: 6.67, offsetFt: 1.5 + rnd() * (len - 3) })] : [];
      const cur = rnd() * len;
      const c = clampPartitionCenter(rnd() * (len + 6) - 3, o, g, sibs, cur);
      checked++;
      if (c === cur) {
        // Stayed put: then there is no valid whole-inch spot at all.
        let any = false;
        for (let xi = 0; xi <= len * 12 && !any; xi++) any = partitionSpotOk(xi / 12 + o.widthFt / 2, o, g, sibs);
        expect(any).toBe(false);
        continue;
      }
      moved++;
      expect(partitionSpotOk(c, o, g, sibs)).toBe(true);
      expect(programOk(g, o, c, sibs)).toBe(true);
      // The program stores the drag as the left edge to 3 decimals (writeBackLeanToOpening): still valid there.
      const stored = Number((Math.round((c - o.widthFt / 2) * 12) / 12).toFixed(3)) + o.widthFt / 2;
      expect(programOk(g, o, stored, sibs)).toBe(true);
    }
    expect(checked).toBe(4000);
    expect(moved).toBeGreaterThan(1000);
  });

  it('3D and program agree on every whole-inch spot (fits / doesn\'t fit)', () => {
    const openings = [
      op(),
      op({ widthFt: 6, heightFt: 9 }),
      op({ type: 'walkDoor', widthFt: 3, heightFt: 6.67 }),
      op({ type: 'window', widthFt: 2.5, heightFt: 3, sillFt: 4.16667 }),
      op({ type: 'frameOut', widthFt: 6, heightFt: 7, sillFt: 0 }),
    ];
    const sib = op({ id: 's', type: 'walkDoor', widthFt: 3, heightFt: 6.67, offsetFt: 9 });
    for (const g of [geom(12, 10, 2, true), geom(12, 7, 3, false), geom(20, 8, 3, true), geom(10, 6, 2, false)]) {
      for (const o of openings) {
        for (let xi = -12; xi <= g.len * 12 + 12; xi++) {
          const c = xi / 12 + o.widthFt / 2;
          expect(partitionSpotOk(c, o, g, [])).toBe(programOk(g, o, c, []));
          expect(partitionSpotOk(c, o, g, [sib])).toBe(programOk(g, o, c, [sib]));
        }
      }
    }
  });
});
