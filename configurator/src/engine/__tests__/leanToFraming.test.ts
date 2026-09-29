import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure, legStyleFor, type Member } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { LeanTo, LeanToOpening, Opening } from '@/types/building';

/**
 * Lean-to FRAMING accuracy (render-upgrade phase 8, drawing only — no price
 * change). Owner 9/29/26: lean-to posts follow the SAME leg rule as the main
 * building (a 15'+ post is doubled); lean-to bents get a real knee brace; a
 * gable-attached lean-to's posts run at the main truss OC from its own start.
 */

type S = ReturnType<typeof deriveStructure>;

const build = (over: Partial<typeof DEFAULT_CONFIG>, leanTos: LeanTo[] = [], openings: Opening[] = []): S =>
  deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', openings, leanTos, ...over }));

const leanTo = (o: Partial<LeanTo>): LeanTo => ({
  id: 'lt1',
  type: 'attached',
  attachedSide: 'Left Eave',
  widthFt: 12,
  lengthFt: 40,
  lowLegHeightFt: 8,
  roofPitch: '2:12',
  enclosure: 'enclosed',
  openings: [],
  ...o,
});

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;
const isVertical = (m: Member) => near(m.start[0], m.end[0]) && near(m.start[2], m.end[2]) && m.start[1] !== m.end[1];
const topOf = (m: Member) => Math.max(m.start[1], m.end[1]);

/** Legs standing at world X = x (eave lean-to posts / main eave legs), optionally at run Z = z. */
const legsAtX = (s: S, x: number, z?: number) =>
  s.members.filter((m) => m.kind === 'leg' && isVertical(m) && near(m.start[0], x) && (z === undefined || near(m.start[2], z)));
/** Legs standing at world Z = z (gable lean-to posts), optionally at run X = x. */
const legsAtZ = (s: S, z: number, x?: number) =>
  s.members.filter((m) => m.kind === 'leg' && isVertical(m) && near(m.start[2], z) && (x === undefined || near(m.start[0], x)));

const cross2 = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

describe('legStyleFor — the one leg rule, shared by the main building and lean-tos', () => {
  const legsPerBent = (W: number, H: number) => {
    const s = build({ width: W, length: 40, legHeight: H });
    return s.members.filter((m) => m.kind === 'leg').length / s.frameCount;
  };
  const hasRungs = (W: number, H: number) => {
    const s = build({ width: W, length: 40, legHeight: H });
    const halfW = W / 2;
    return s.members.some(
      (m) =>
        m.kind === 'brace' &&
        near(m.start[1], m.end[1]) &&
        near(m.start[2], m.end[2]) &&
        Math.abs(m.start[0] - m.end[0]) > 0.5 &&
        Math.min(Math.abs(m.start[0]), Math.abs(m.end[0])) > halfW - 2.5,
    );
  };

  it('matches the program badges: ladder W>=52, double W 32-51 or 15ft+, else single', () => {
    expect(legStyleFor(24, 14)).toBe('single');
    expect(legStyleFor(24, 15)).toBe('double');
    expect(legStyleFor(30, 20)).toBe('double');
    expect(legStyleFor(32, 8)).toBe('double');
    expect(legStyleFor(51, 12)).toBe('double');
    expect(legStyleFor(52, 8)).toBe('ladder');
    expect(legStyleFor(60, 20)).toBe('ladder');
    // Lean-to widths (8-20) never reach the width rules: height alone decides.
    for (const lw of [8, 10, 12, 14, 16, 20]) {
      expect(legStyleFor(lw, 14)).toBe('single');
      expect(legStyleFor(lw, 15)).toBe('double');
    }
  });

  it('is exactly what the main building draws (legs per bent + rungs) across widths and heights', () => {
    for (const W of [12, 24, 30, 32, 40, 50, 52, 56]) {
      for (const H of [8, 12, 14, 15, 16, 20]) {
        const style = legStyleFor(W, H);
        expect(legsPerBent(W, H)).toBe(style === 'single' ? 2 : 4);
        expect(hasRungs(W, H)).toBe(style === 'ladder');
      }
    }
  });
});

describe('lean-to posts follow the main leg rule (15ft+ = double post)', () => {
  // 30x40x20 main; Left Eave lean-to (+X), 12 wide, 2:12, full length.
  const main = { width: 30, length: 40, legHeight: 20 };
  const outerX = 15 + 12;

  it('a 14ft outer post stays single: one leg per bent at the outer wall, none inboard of it', () => {
    const s = build(main, [leanTo({ lowLegHeightFt: 14 })]);
    const lt = s.leanTos[0];
    expect(legsAtX(s, outerX).length).toBe(lt.trussOffsets.length);
    expect(legsAtX(s, outerX - 0.4).length).toBe(0);
    for (const m of legsAtX(s, outerX)) expect(topOf(m)).toBeCloseTo(14, 6);
    // single outer base rail line only
    const rails = s.members.filter((m) => m.kind === 'baseRail' && near(m.start[0], m.end[0]) && m.start[0] > 15.5);
    for (const r of rails) expect(r.start[0]).toBeCloseTo(outerX, 6);
  });

  it('a 15ft outer post is DOUBLED: second post 0.4ft inboard, rising to the rafter, plus a doubled base rail', () => {
    const s = build(main, [leanTo({ lowLegHeightFt: 15 })]);
    const lt = s.leanTos[0];
    const n = lt.trussOffsets.length;
    expect(legsAtX(s, outerX).length).toBe(n);
    const inner = legsAtX(s, outerX - 0.4);
    expect(inner.length).toBe(n);
    // connH = 15 + 12*2/12 = 17; the rafter climbs 2ft over 12ft -> +0.4*2/12 at the second post.
    for (const m of inner) expect(topOf(m)).toBeCloseTo(15 + (0.4 * 2) / 12, 6);
    const rails = (x: number) => s.members.filter((m) => m.kind === 'baseRail' && near(m.start[0], x) && near(m.end[0], x));
    expect(rails(outerX).length).toBe(n - 1);
    expect(rails(outerX - 0.4).length).toBe(n - 1);
  });

  it('Right Eave and gable lean-tos double inboard too (toward the main building)', () => {
    const r = build(main, [leanTo({ attachedSide: 'Right Eave', lowLegHeightFt: 16 })]);
    expect(legsAtX(r, -outerX).length).toBe(r.leanTos[0].trussOffsets.length);
    expect(legsAtX(r, -outerX + 0.4).length).toBe(r.leanTos[0].trussOffsets.length);

    const g = build(main, [leanTo({ attachedSide: 'Back Gable', lengthFt: 30, lowLegHeightFt: 16 })]);
    const zOut = 20 + 12;
    expect(legsAtZ(g, zOut).length).toBe(g.leanTos[0].trussOffsets.length);
    expect(legsAtZ(g, zOut - 0.4).length).toBe(g.leanTos[0].trussOffsets.length);
  });

  it('lean-to widths never make a ladder: no rungs on a lean-to', () => {
    const s = build(main, [leanTo({ lowLegHeightFt: 18, widthFt: 20 })]);
    const rungs = s.members.filter((m) => m.kind === 'brace' && near(m.start[1], m.end[1]) && m.start[0] > 15.5);
    expect(rungs.length).toBe(0);
  });

  it('the main building legs are untouched by a lean-to (same members before the lean-to block)', () => {
    const bare = build(main);
    const withLt = build(main, [leanTo({ lowLegHeightFt: 16 })]);
    expect(withLt.members.slice(0, bare.members.length)).toEqual(bare.members);
  });
});

describe('lean-to inner posts: never a duplicate of a main leg', () => {
  // 30x40x12 (4ft OC): main trusses at z = -20, -16, ..., 20 on both eave walls.
  const main = { width: 30, length: 40, legHeight: 12 };

  it('full-length eave lean-to: every bent rides on a main leg, so NO lean-to inner post is drawn', () => {
    const s = build(main, [leanTo({ lowLegHeightFt: 8 })]);
    // Main legs at x = +15 reach the 12ft eave; a lean-to inner post would stop at connH = 10.
    const atWall = legsAtX(s, 15);
    expect(atWall.length).toBe(s.frameCount);
    for (const m of atWall) expect(topOf(m)).toBeCloseTo(12, 6);
  });

  it('partial lean-to between main trusses: only its two off-grid END bents get an inner post (at connH)', () => {
    // Starts 10ft back, runs 20ft: ends at z = -10 and z = 10 (off the 4ft grid).
    const s = build(main, [leanTo({ attachedSide: 'Right Eave', lengthFt: 20, offsetFt: 10, lowLegHeightFt: 8 })]);
    const connH = 8 + 2;
    const ltInner = legsAtX(s, -15).filter((m) => near(topOf(m), connH));
    expect(ltInner.map((m) => m.start[2]).sort((a, b) => a - b)).toEqual([-10, 10]);
    // No lean-to post doubles up a main leg anywhere along the wall.
    for (const z of s.framePositionsZ) expect(legsAtX(s, -15, z).length).toBe(1);
  });

  it('a 15ft+ off-grid inner post is doubled into the lean-to (toward the outer wall)', () => {
    // 30x40x20, lean-to low 16 at 2:12 -> connH 18; starts 3ft back (off the grid).
    const s = build({ width: 30, length: 40, legHeight: 20 }, [leanTo({ lengthFt: 22, offsetFt: 3, lowLegHeightFt: 16 })]);
    const zA = -20 + 3;
    expect(legsAtX(s, 15, zA).length).toBe(1);
    expect(topOf(legsAtX(s, 15, zA)[0])).toBeCloseTo(18, 6);
    expect(legsAtX(s, 15.4, zA).length).toBe(1);
  });

  it('gable lean-to: inner posts along the main gable wall, except at the main corner legs', () => {
    const s = build({ width: 24, length: 42, legHeight: 10, trussSpacingFt: 5 }, [
      leanTo({ attachedSide: 'Front Gable', widthFt: 10, lengthFt: 24, lowLegHeightFt: 7 }),
    ]);
    const connH = 7 + (10 * 2) / 12;
    const ltInner = legsAtZ(s, -21).filter((m) => near(topOf(m), connH));
    // Posts at x = -12, -7, -2, 3, 8, 12; the corners (+-12) are main legs.
    expect(ltInner.map((m) => m.start[0]).sort((a, b) => a - b)).toEqual([-7, -2, 3, 8]);
  });
});

describe('lean-to knee braces are real (not on the rafter line)', () => {
  const cases: Array<[string, Partial<LeanTo>]> = [
    ['Left Eave', { attachedSide: 'Left Eave' }],
    ['Right Eave', { attachedSide: 'Right Eave' }],
    ['Front Gable', { attachedSide: 'Front Gable', lengthFt: 30 }],
    ['Back Gable', { attachedSide: 'Back Gable', lengthFt: 30 }],
  ];
  for (const [name, o] of cases) {
    it(`${name}: one knee brace per bent, from the outer post up to the rafter, not collinear with it`, () => {
      const s = build({ width: 30, length: 40, legHeight: 12 }, [leanTo({ lowLegHeightFt: 8, ...o })]);
      const lt = s.leanTos[0];
      const eave = name.includes('Eave');
      const acrossOf = (p: readonly number[]) => (eave ? p[0] : p[2]);
      const runOf = (p: readonly number[]) => (eave ? p[2] : p[0]);
      const outerC = eave ? lt.outer.x : lt.outer.z;
      const innerC = eave ? lt.inner.x : lt.inner.z;
      const lh = 8;
      const connH = 10;
      const ltBraces = s.members.filter(
        (m) => m.kind === 'brace' && (near(acrossOf(m.start), outerC) || near(acrossOf(m.end), outerC)),
      );
      expect(ltBraces.length).toBe(lt.trussOffsets.length);
      const braceLen = Math.min(3, lh * 0.45);
      for (const b of ltBraces) {
        // Starts on the outer post braceLen below the low eave...
        expect(acrossOf(b.start)).toBeCloseTo(outerC, 6);
        expect(b.start[1]).toBeCloseTo(lh - braceLen, 6);
        // ...ends ON the rafter line, about braceLen inboard of the outer post.
        const t = (acrossOf(b.end) - innerC) / (outerC - innerC);
        expect(b.end[1]).toBeCloseTo(connH + (lh - connH) * t, 6);
        const inboard = Math.abs(acrossOf(b.end) - outerC);
        expect(inboard).toBeGreaterThan(braceLen * 0.9);
        expect(inboard).toBeLessThan(braceLen * 1.01);
        // Same bent plane (constant run coordinate).
        expect(runOf(b.start)).toBeCloseTo(runOf(b.end), 6);
        // Not collinear with the rafter (inner, connH) -> (outer, lh).
        const c = cross2(outerC - innerC, lh - connH, acrossOf(b.end) - acrossOf(b.start), b.end[1] - b.start[1]);
        expect(Math.abs(c)).toBeGreaterThan(1);
      }
    });
  }

  it('no lean-to brace lies on (or duplicates) its rafter — the old corner-brace loop is gone', () => {
    for (const side of ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable'] as const) {
      const s = build({ width: 30, length: 40, legHeight: 12 }, [leanTo({ attachedSide: side, lengthFt: 30 })]);
      const rafters = s.members.filter((m) => m.kind === 'rafter');
      const braces = s.members.filter((m) => m.kind === 'brace');
      for (const b of braces) {
        for (const r of rafters) {
          // same plane: the brace's run coordinate equals the rafter's
          const eave = side.includes('Eave');
          const run = (p: readonly number[]) => (eave ? p[2] : p[0]);
          const across = (p: readonly number[]) => (eave ? p[0] : p[2]);
          if (!near(run(b.start), run(r.start)) || !near(run(b.end), run(r.start))) continue;
          const rx = across(r.end) - across(r.start);
          const ry = r.end[1] - r.start[1];
          const onLine = (p: readonly number[]) => Math.abs(cross2(rx, ry, across(p) - across(r.start), p[1] - r.start[1])) < 1e-6;
          expect(onLine(b.start) && onLine(b.end)).toBe(false);
        }
      }
    }
  });
});

describe('gable-attached lean-to posts run at the main truss OC from the lean-to start', () => {
  const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

  it('24x42 (5ft OC), full-width Front Gable lean-to: 0,5,10,15,20,24 (not the old 0,1,6,...,24 from the main Z grid)', () => {
    const s = build({ width: 24, length: 42, legHeight: 10, trussSpacingFt: 5 }, [
      leanTo({ attachedSide: 'Front Gable', widthFt: 12, lengthFt: 24 }),
    ]);
    const lt = s.leanTos[0];
    expect(lt.trussOffsets.map((v) => +v.toFixed(6))).toEqual([0, 5, 10, 15, 20, 24]);
    // The outer posts stand exactly there (world X = -12 + offset).
    const zOut = -21 - 12;
    expect(legsAtZ(s, zOut).map((m) => +m.start[0].toFixed(6)).sort((a, b) => a - b)).toEqual([-12, -7, -2, 3, 8, 12]);
  });

  it('every bay is <= the OC and all but the last are exactly the OC (regular), for offsets and both gables', () => {
    const cfgs: Array<[number, number, number, Partial<LeanTo>]> = [
      [30, 50, 4, { attachedSide: 'Back Gable', lengthFt: 30 }],
      [30, 40, 4, { attachedSide: 'Back Gable', lengthFt: 20, offsetFt: 3 }],
      [24, 30, 5, { attachedSide: 'Front Gable', lengthFt: 24 }],
      [40, 60, 4, { attachedSide: 'Front Gable', lengthFt: 26, offsetFt: 7 }],
    ];
    for (const [W, L, oc, o] of cfgs) {
      const s = build({ width: W, length: L, legHeight: 12, trussSpacingFt: oc }, [leanTo(o)]);
      const lt = s.leanTos[0];
      const g = gaps(lt.trussOffsets);
      expect(lt.trussOffsets[0]).toBeCloseTo(0, 6);
      expect(lt.trussOffsets[lt.trussOffsets.length - 1]).toBeCloseTo(lt.lengthFt, 6);
      for (const d of g) expect(d).toBeLessThanOrEqual(oc + 1e-6);
      for (const d of g.slice(0, -1)) expect(d).toBeCloseTo(oc, 6);
      // one outer post per bent
      const zOut = lt.outer.z;
      expect(legsAtZ(s, zOut).length).toBe(lt.trussOffsets.length);
    }
  });

  it('eave lean-tos still sit on the main truss grid (rafters tie to the main legs)', () => {
    const s = build({ width: 30, length: 40, legHeight: 12, trussSpacingFt: 4 }, [leanTo({ lengthFt: 40 })]);
    const lt = s.leanTos[0];
    expect(lt.trussOffsets.map((v) => v + lt.spanStart)).toEqual(s.framePositionsZ);
  });
});

describe('outer-wall openings cut a DOUBLED lean-to post (both posts + both rails)', () => {
  // 30x40x20 + Left Eave lean-to 12 wide, low 16 (double outer posts), full length, 4ft OC.
  const fo: LeanToOpening = { id: 'lt1:fo', type: 'frameOut', wall: 'outer', widthFt: 10, heightFt: 10, sillFt: 0, offsetFt: 20 };
  const s = build({ width: 30, length: 40, legHeight: 20, trussSpacingFt: 4 }, [leanTo({ lowLegHeightFt: 16, lengthFt: 40, openings: [fo] })]);
  const outerX = 27;

  it('no post (outer or its inboard twin) stands inside the frame-out; stubs survive above it', () => {
    for (const x of [outerX, outerX - 0.4]) {
      const at0 = legsAtX(s, x, 0); // the bent at the opening centre (z = 0)
      for (const m of at0) expect(Math.min(m.start[1], m.end[1])).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(at0.length).toBe(1); // the header stub
    }
    // A bent outside the opening keeps both full posts.
    expect(legsAtX(s, outerX, -16).length).toBe(1);
    expect(topOf(legsAtX(s, outerX, -16)[0])).toBeCloseTo(16, 6);
    expect(legsAtX(s, outerX - 0.4, -16).length).toBe(1);
  });

  it('both outer base rails are cut across the floor-level opening', () => {
    for (const x of [outerX, outerX - 0.4]) {
      const rails = s.members.filter((m) => m.kind === 'baseRail' && near(m.start[0], x) && near(m.end[0], x));
      expect(rails.length).toBeGreaterThan(0);
      for (const r of rails) {
        const lo = Math.min(r.start[2], r.end[2]);
        const hi = Math.max(r.start[2], r.end[2]);
        expect(hi <= -5 + 1e-6 || lo >= 5 - 1e-6).toBe(true);
      }
    }
  });

  it('main-wall framed openings on the SAME side do NOT erase the doubled lean-to posts', () => {
    const mainFo = { id: 'fo', type: 'frameOut', side: 'right', offset: 20, width: 10, height: 10, sillHeight: 0, customerSupplied: true } as Opening;
    const bare = build({ width: 30, length: 40, legHeight: 20, trussSpacingFt: 4 }, [leanTo({ lowLegHeightFt: 16, lengthFt: 40 })]);
    const withMain = build({ width: 30, length: 40, legHeight: 20, trussSpacingFt: 4 }, [leanTo({ lowLegHeightFt: 16, lengthFt: 40 })], [mainFo]);
    for (const x of [outerX, outerX - 0.4]) expect(legsAtX(withMain, x).length).toBe(legsAtX(bare, x).length);
    // ...while the main +X legs inside the opening ARE cut (proves the opening is on the lean-to side).
    const mainCut = legsAtX(withMain, 15, 0);
    for (const m of mainCut) expect(Math.min(m.start[1], m.end[1])).toBeGreaterThanOrEqual(10 - 1e-6);
  });
});
