import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure, type Member } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { BuildingConfig, LeanTo, LeanToOpening, Opening } from '@/types/building';
import {
  HEADER_UP,
  JAMB_IN,
  JAMB_PITCH,
  frameOutTrimBars,
  leanToFrameOutTrim,
  leanToSideBandFt,
  mainFrameOutTrim,
  mainWallSheetSpan,
} from '../frameOutFraming';
import { sideBandHeight } from '@/three/LeanToSiding';

/**
 * Framed openings on OPEN walls (owner 10/14/26) — drawing only. In sheeting a
 * frame-out keeps exactly today's trimmed hole; on an open wall it gets steel
 * (doubled jambs + header, legs removed, base rail kept) and trim only where
 * the hole cuts sheeting.
 */

type S = ReturnType<typeof deriveStructure>;
const build = (over: Partial<BuildingConfig>): S => deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, openings: [], ...over }));
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;

// Program "Left Eave Side" garage-door frame-out (10x8) = internal 'right' (+X), centred on a 30' wall.
const fo = (o: Partial<Opening> = {}): Opening => ({ id: 'fo', type: 'frameOut', side: 'right', offset: 15, width: 10, height: 8, sillHeight: 0, customerSupplied: true, ...o });
const carport = (panels: number, openings: Opening[] = [fo()]) =>
  build({ buildingType: 'carport', width: 24, length: 30, legHeight: 10, eavePanelFt: { left: panels, right: panels }, openings, trussSpacingFt: 5 } as Partial<BuildingConfig>);
const garage = (openings: Opening[] = [fo()], over: Partial<BuildingConfig> = {}) =>
  build({ buildingType: 'garage', width: 24, length: 30, legHeight: 10, openings, trussSpacingFt: 5, ...over } as Partial<BuildingConfig>);

const jambs = (s: S) => (s.frameOutMembers ?? []).filter((m) => m.kind === 'jamb');
const headers = (s: S) => (s.frameOutMembers ?? []).filter((m) => m.kind === 'header');
const railsAt = (s: S, x: number) => s.members.filter((m) => m.kind === 'baseRail' && near(m.start[0], x) && near(m.end[0], x));
/** Do the rails (their union along Z) cover [z0, z1] with no gap? */
const coversZ = (rails: Member[], z0: number, z1: number) => {
  const segs = rails.map((r) => [Math.min(r.start[2], r.end[2]), Math.max(r.start[2], r.end[2])]).sort((a, b) => a[0] - b[0]);
  let at = z0;
  for (const [a, b] of segs) if (a <= at + 1e-6 && b > at) at = b;
  return at >= z1 - 1e-6;
};

describe('sheeting rule (mainWallSheetSpan)', () => {
  it('carport eave: nothing, or the eave-down panel band', () => {
    expect(mainWallSheetSpan(carport(0), 'right', 15)).toBeNull();
    expect(mainWallSheetSpan(carport(3), 'right', 15)).toEqual([7, 10]);
  });
  it('garage: closed eave floor to eave; open side none; banded side the band', () => {
    expect(mainWallSheetSpan(garage(), 'right', 15)).toEqual([0, 10]);
    expect(mainWallSheetSpan(garage([], { wallOverrides: { leftOpen: false, rightOpen: true } }), 'right', 15)).toBeNull();
    expect(mainWallSheetSpan(garage([], { wallOverrides: { leftOpen: false, rightOpen: false, rightBandFt: 6 } }), 'right', 15)).toEqual([4, 10]);
  });
  it('ends: open none, gable-only the triangle, closed floor to roof', () => {
    const c = carport(0);
    expect(mainWallSheetSpan(c, 'front', 12)).toBeNull();
    const g = carport(0, []);
    const gg = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'carport', width: 24, length: 30, legHeight: 10, openings: [], wallOverrides: { leftOpen: false, rightOpen: false, front: 'gableOnly' } }));
    expect(mainWallSheetSpan(g, 'front', 12)).toBeNull();
    const sp = mainWallSheetSpan(gg, 'front', 12)!;
    expect(sp[0]).toBeCloseTo(10, 6);
    expect(sp[1]).toBeCloseTo(gg.peakHeight, 6);
    expect(mainWallSheetSpan(garage(), 'front', 12)![0]).toBe(0);
  });
});

describe('a frame-out in a SHEETED wall is drawn exactly as before', () => {
  it('fully sheeted garage: full trim (null), no steel, base rail cut at the opening as before', () => {
    const s = garage();
    expect(mainFrameOutTrim(s, fo())).toBeNull();
    expect(s.frameOutMembers).toBeUndefined();
    expect('frameOutMembers' in s).toBe(false);
    expect(coversZ(railsAt(s, 12), -5, 5)).toBe(false);
  });
  it('a GCH partition / closed end frame-out stays trimmed', () => {
    const s = garage([fo({ side: 'front', offset: 12 })]);
    expect(mainFrameOutTrim(s, fo({ side: 'front', offset: 12 }))).toBeNull();
    expect(s.frameOutMembers).toBeUndefined();
  });
  it('doors and windows are never treated as frame-outs', () => {
    const s = carport(0);
    expect(mainFrameOutTrim(s, { ...fo(), type: 'rollUpDoor' })).toBeNull();
  });
});

describe('a frame-out on an OPEN carport side', () => {
  const s = carport(0);
  it('no trim at all', () => {
    expect(mainFrameOutTrim(s, fo())).toEqual({ header: false, sill: false, left: null, right: null });
  });
  it('doubled jambs at each side, base rail to the eave', () => {
    const j = jambs(s);
    expect(j.length).toBe(4);
    const zs = j.map((m) => m.start[2]).sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo(-5 - JAMB_IN - JAMB_PITCH, 6);
    expect(zs[1]).toBeCloseTo(-5 - JAMB_IN, 6);
    expect(zs[2]).toBeCloseTo(5 + JAMB_IN, 6);
    expect(zs[3]).toBeCloseTo(5 + JAMB_IN + JAMB_PITCH, 6);
    for (const m of j) {
      expect(m.start[0]).toBeCloseTo(12, 6);
      expect(Math.min(m.start[1], m.end[1])).toBe(0);
      expect(Math.max(m.start[1], m.end[1])).toBeCloseTo(10, 6);
    }
  });
  it('a header at the opening top, tied into the nearest legs (5ft bents)', () => {
    const h = headers(s);
    expect(h.length).toBe(1);
    expect(h[0].start[1]).toBeCloseTo(8 + HEADER_UP, 6);
    expect(Math.min(h[0].start[2], h[0].end[2])).toBeCloseTo(-10, 6);
    expect(Math.max(h[0].start[2], h[0].end[2])).toBeCloseTo(10, 6);
  });
  it('legs inside the opening are removed below the header; the base rail is KEPT across it', () => {
    const inLegs = s.members.filter((m) => m.kind === 'leg' && near(m.start[0], 12) && m.start[2] > -5 && m.start[2] < 5);
    for (const m of inLegs) expect(Math.min(m.start[1], m.end[1])).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(coversZ(railsAt(s, 12), -5, 5)).toBe(true);
  });
  it('the other side is untouched (no steel there)', () => {
    expect((s.frameOutMembers ?? []).every((m) => near(m.start[0], 12) && near(m.end[0], 12))).toBe(true);
  });
  it('drawing only: the BOM members (legs, rails) are the same as a sheeted-side build would have minus nothing new', () => {
    expect(s.members.some((m) => m.kind === 'jamb' || m.kind === 'header')).toBe(false);
  });
});

describe('a frame-out reaching up into a 1-panel (3ft) eave-down band', () => {
  const s = carport(3);
  it('trim only around the notch in the band: header + the jambs from the band bottom up', () => {
    const t = mainFrameOutTrim(s, fo())!;
    expect(t.header).toBe(true);
    expect(t.sill).toBe(false);
    expect(t.left).toEqual([7, 8]);
    expect(t.right).toEqual([7, 8]);
  });
  it('steel header at the notch top (the cut panel bottom over the opening) and doubled jambs', () => {
    expect(jambs(s).length).toBe(4);
    expect(headers(s)[0].start[1]).toBeCloseTo(8 + HEADER_UP, 6);
  });
  it('an opening below the band: no trim at all', () => {
    const low = carport(3, [fo({ height: 6.67 })]);
    expect(mainFrameOutTrim(low, fo({ height: 6.67 }))).toEqual({ header: false, sill: false, left: null, right: null });
  });
});

describe('trim bars (frameOutTrimBars)', () => {
  it('a notch: header + two short jamb bars that close into it', () => {
    const bars = frameOutTrimBars({ header: true, sill: false, left: [7, 8], right: [7, 8] }, 10, 8, 0, 0.17);
    expect(bars.length).toBe(3);
    const jamb = bars.find((b) => b.x < 0)!;
    expect(jamb.h).toBeCloseTo(1 + 0.17, 6);
    expect(jamb.y + 4).toBeCloseTo((7 + 8.17) / 2, 6); // centre in absolute height
  });
  it('no sheeting: nothing', () => {
    expect(frameOutTrimBars({ header: false, sill: false, left: null, right: null }, 10, 8, 0, 0.17)).toEqual([]);
  });
});

describe('a window frame-out up an open wall gets a sill tube', () => {
  it('header above, sill tube below, jambs full height', () => {
    const s = carport(0, [fo({ width: 2.5, height: 2.5, sillHeight: 4.17 })]);
    const h = headers(s).map((m) => m.start[1]).sort((a, b) => a - b);
    expect(h.length).toBe(2);
    expect(h[0]).toBeCloseTo(4.17 - HEADER_UP, 6);
    expect(h[1]).toBeCloseTo(6.67 + HEADER_UP, 6);
  });
});

describe('open ends (front gable of a carport)', () => {
  it('jambs rise to the rafter line, header runs jamb to jamb', () => {
    const s = carport(0, [fo({ side: 'front', offset: 12 })]);
    const j = jambs(s);
    expect(j.length).toBe(4);
    for (const m of j) {
      expect(m.start[2]).toBeCloseTo(-15, 6);
      const x = m.start[0];
      expect(Math.max(m.start[1], m.end[1])).toBeCloseTo(s.peakHeight - Math.abs(x) * ((s.peakHeight - 10) / 12), 6);
    }
    const h = headers(s);
    expect(h.length).toBe(1);
    expect(Math.min(h[0].start[0], h[0].end[0])).toBeCloseTo(-5 - JAMB_IN - JAMB_PITCH, 6);
    expect(Math.max(h[0].start[0], h[0].end[0])).toBeCloseTo(5 + JAMB_IN + JAMB_PITCH, 6);
  });
});

describe('lean-to walls', () => {
  const lfo = (o: Partial<LeanToOpening> = {}): LeanToOpening => ({ id: 'lt1:fo', type: 'frameOut', wall: 'outer', widthFt: 10, heightFt: 8, sillFt: 0, offsetFt: 15, ...o });
  const leanTo = (o: Partial<LeanTo>): LeanTo => ({
    id: 'lt1', type: 'attached', attachedSide: 'Left Eave', widthFt: 12, lengthFt: 30, lowLegHeightFt: 10, roofPitch: '2:12', enclosure: 'open', openings: [lfo()], ...o,
  });
  const withLt = (lt: LeanTo) => build({ buildingType: 'garage', width: 24, length: 30, legHeight: 12, leanTos: [lt], trussSpacingFt: 5 } as Partial<BuildingConfig>);

  it('the band rule matches the drawing (LeanToSiding.sideBandHeight)', () => {
    for (const v of ['open', 'closed', 'q1', 'q2', 'q3', '1panel', '2panel', '3panel', '4panel', '5panel', '1_5panel'])
      for (const lh of [7, 10, 16]) expect(leanToSideBandFt(v, lh)).toBeCloseTo(sideBandHeight(v, lh), 9);
  });
  it('open lean-to: steel on the outer wall (x = 24), rail kept, no trim', () => {
    const s = withLt(leanTo({}));
    const lt = s.leanTos[0];
    expect(leanToFrameOutTrim(lt, lt.openings[0])).toEqual({ header: false, sill: false, left: null, right: null });
    const j = jambs(s);
    expect(j.length).toBe(4);
    for (const m of j) {
      expect(m.start[0]).toBeCloseTo(24, 6);
      expect(Math.max(m.start[1], m.end[1])).toBeCloseTo(10, 6);
    }
    expect(headers(s).length).toBe(1);
    expect(coversZ(railsAt(s, 24), -5, 5)).toBe(true);
  });
  it('enclosed lean-to: trimmed as before, no steel, rail cut', () => {
    const s = withLt(leanTo({ enclosure: 'enclosed' }));
    const lt = s.leanTos[0];
    expect(leanToFrameOutTrim(lt, lt.openings[0])).toBeNull();
    expect(s.frameOutMembers).toBeUndefined();
    expect(coversZ(railsAt(s, 24), -5, 5)).toBe(false);
  });
  it('open lean-to END wall: jambs up to the lean-to rafter, header jamb to jamb', () => {
    const s = withLt(leanTo({ openings: [lfo({ wall: 'front', offsetFt: 6, widthFt: 6, heightFt: 6.67 })] }));
    const j = jambs(s);
    expect(j.length).toBeGreaterThanOrEqual(2);
    for (const m of j) expect(m.start[2]).toBeCloseTo(-15, 6);
    expect(headers(s).length).toBe(1);
  });
  it('a storage stretch of an open outer wall is closed: a frame-out there stays trimmed', () => {
    const s = withLt(leanTo({ storage: { end: 'front', lengthFt: 15 }, openings: [lfo({ offsetFt: 7 })] } as Partial<LeanTo>));
    const lt = s.leanTos[0];
    expect(lt.storage).toBeDefined();
    expect(leanToFrameOutTrim(lt, lt.openings[0])).toBeNull();
  });
});
