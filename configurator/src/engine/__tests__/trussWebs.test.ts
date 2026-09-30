import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure, trussStyleFor, type Member } from '../geometry';
import { generateBOM } from '../bom';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { LeanTo, Opening } from '@/types/building';

/**
 * Truss / bow WEB patterns from the manufacturers' "Trusses and Bows" charts
 * (owner 9/29/26 — drawing only): CCI dealer handbook p.27 and CA sheet AD-1.
 * Bows = rafters only; CCI 26-30 = raised tie + 2 struts; CCI 32+ = bottom
 * chord at the eave + king post + verticals (+ Howe diagonals); CA 25-30 =
 * sister chord on spacers; CA 31+ = box-eave parallel chord + flat raised
 * bottom chord + verticals (+ diagonals, + lacing at 52+).
 */

type S = ReturnType<typeof deriveStructure>;
type Mfr = 'CCI' | 'CA';

const build = (over: Partial<typeof DEFAULT_CONFIG>, openings: Opening[] = [], leanTos: LeanTo[] = []): S =>
  deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', length: 40, legHeight: 12, openings, leanTos, ...over }));
const bld = (width: number, manufacturer: Mfr, over: Partial<typeof DEFAULT_CONFIG> = {}, openings: Opening[] = []) =>
  build({ width, manufacturer, ...over }, openings);

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;
const inBent = (m: Member, z: number) => near(m.start[2], z) && near(m.end[2], z);
const isLevel = (m: Member) => near(m.start[1], m.end[1], 1e-6);
const isVert = (m: Member) => near(m.start[0], m.end[0], 1e-6);
const chords = (s: S, z?: number) => s.members.filter((m) => m.kind === 'chord' && (z === undefined || inBent(m, z)));
const webs = (s: S, z?: number) => s.members.filter((m) => m.kind === 'web' && (z === undefined || inBent(m, z)));
const truss = (s: S) => s.members.filter((m) => m.kind === 'web' || m.kind === 'chord');
const roofY = (s: S, x: number) => s.peakHeight - Math.abs(x) * (s.rise / (s.width / 2));

/** Per-bent pattern (every bent, end frames included, must match it). */
function perBent(s: S) {
  const z0 = s.framePositionsZ[0];
  const c = chords(s, z0);
  const w = webs(s, z0);
  for (const z of s.framePositionsZ) {
    expect(chords(s, z).length).toBe(c.length);
    expect(webs(s, z).length).toBe(w.length);
  }
  return {
    chords: c.length,
    levelChords: c.filter(isLevel).length,
    verts: w.filter(isVert).length,
    diags: w.filter((m) => !isVert(m)).length,
  };
}

/** Does segment a cross segment b in the bent's X-Y plane (strictly inside both)? */
function crosses(a: Member, b: Member): boolean {
  const [px, py] = [a.start[0], a.start[1]];
  const [rx, ry] = [a.end[0] - px, a.end[1] - py];
  const [qx, qy] = [b.start[0], b.start[1]];
  const [sx, sy] = [b.end[0] - qx, b.end[1] - qy];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((qx - px) * sy - (qy - py) * sx) / den;
  const u = ((qx - px) * ry - (qy - py) * rx) / den;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

/** Does member m pass through the open rectangle x∈(lo,hi), y∈(ylo,yhi)? (sampled) */
function throughRect(m: Member, lo: number, hi: number, ylo: number, yhi: number): boolean {
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const x = m.start[0] + (m.end[0] - m.start[0]) * t;
    const y = m.start[1] + (m.end[1] - m.start[1]) * t;
    if (x > lo + 0.01 && x < hi - 0.01 && y > ylo + 0.01 && y < yhi - 0.01) return true;
  }
  return false;
}

function opening(o: Partial<Opening> & Pick<Opening, 'type' | 'side' | 'offset' | 'width' | 'height'>): Opening {
  return { id: `${o.side}-${o.offset}`, sillHeight: 0, customerSupplied: true, ...o } as Opening;
}

describe('trussStyleFor — chart class by manufacturer + width', () => {
  it('both charts: up to 24 ft is a BOW', () => {
    for (const w of [12, 18, 24]) {
      expect(trussStyleFor(w, 'CCI')).toBe('bow');
      expect(trussStyleFor(w, 'CA')).toBe('bow');
    }
  });
  it('CCI: 26-30 / 32-40 / 42-50 / 52-60 (and wider keeps 52-60)', () => {
    expect([26, 28, 30].map((w) => trussStyleFor(w, 'CCI'))).toEqual(['cci-26-30', 'cci-26-30', 'cci-26-30']);
    expect([32, 36, 40].map((w) => trussStyleFor(w, 'CCI'))).toEqual(['cci-32-40', 'cci-32-40', 'cci-32-40']);
    expect([42, 46, 50].map((w) => trussStyleFor(w, 'CCI'))).toEqual(['cci-42-50', 'cci-42-50', 'cci-42-50']);
    expect([52, 56, 60, 80].map((w) => trussStyleFor(w, 'CCI'))).toEqual(['cci-52-60', 'cci-52-60', 'cci-52-60', 'cci-52-60']);
  });
  it('CA (AD-1): 25-30 / 31-41 / 42-51 / 52-60; unset manufacturer = CA', () => {
    expect([25, 26, 30].map((w) => trussStyleFor(w, 'CA'))).toEqual(['ca-25-30', 'ca-25-30', 'ca-25-30']);
    expect([31, 32, 40, 41].map((w) => trussStyleFor(w, 'CA'))).toEqual(['ca-31-41', 'ca-31-41', 'ca-31-41', 'ca-31-41']);
    expect([42, 50, 51].map((w) => trussStyleFor(w, 'CA'))).toEqual(['ca-42-51', 'ca-42-51', 'ca-42-51']);
    expect([52, 60, 80].map((w) => trussStyleFor(w, 'CA'))).toEqual(['ca-52-60', 'ca-52-60', 'ca-52-60']);
    expect(trussStyleFor(40)).toBe('ca-31-41');
  });
});

describe('web pattern per class (every bent, end frames included)', () => {
  it('24 ft BOW (CCI + CA): no web, no chord — rafters + knee braces + the peak collar tie as before', () => {
    for (const mfr of ['CCI', 'CA'] as const) {
      const s = bld(24, mfr);
      expect(truss(s).length).toBe(0);
      const braces = s.members.filter((m) => m.kind === 'brace');
      expect(braces.length).toBe(s.frameCount * 3); // 2 knee + collar tie
      expect(braces.filter(isLevel).length).toBe(s.frameCount);
    }
  });

  it('CCI 26-30: a raised TIE (about a third of the rise up) + 2 struts; collar tie gone', () => {
    for (const w of [26, 30]) {
      const s = bld(w, 'CCI');
      expect(perBent(s)).toEqual({ chords: 1, levelChords: 1, verts: 0, diags: 2 });
      const tie = chords(s, 0).length ? chords(s, 0)[0] : chords(s, s.framePositionsZ[0])[0];
      const halfW = w / 2;
      // meets both rafters 0.66 of the half-span out from the ridge
      expect(Math.abs(tie.start[0])).toBeCloseTo(0.66 * halfW, 5);
      expect(Math.abs(tie.end[0])).toBeCloseTo(0.66 * halfW, 5);
      expect(tie.start[1]).toBeCloseTo(roofY(s, 0.66 * halfW), 5);
      const frac = (tie.start[1] - s.legHeight) / s.rise;
      expect(frac).toBeGreaterThan(0.3);
      expect(frac).toBeLessThan(0.4);
      // struts run from the tie UP and OUT to the rafters
      for (const st of webs(s, s.framePositionsZ[0])) {
        const lo = st.start[1] < st.end[1] ? st.start : st.end;
        const hi = st.start[1] < st.end[1] ? st.end : st.start;
        expect(lo[1]).toBeCloseTo(tie.start[1], 5);
        expect(hi[1]).toBeCloseTo(roofY(s, hi[0]), 5);
        expect(Math.abs(hi[0])).toBeGreaterThan(Math.abs(lo[0]));
      }
      expect(s.members.filter((m) => m.kind === 'brace').length).toBe(s.frameCount * 2); // knees only
    }
  });

  it('CA 25-30: a SISTER chord under each rafter on 4 spacers a side; no tie, no collar tie', () => {
    for (const w of [26, 30]) {
      const s = bld(w, 'CA');
      expect(perBent(s)).toEqual({ chords: 2, levelChords: 0, verts: 8, diags: 0 });
      const z0 = s.framePositionsZ[0];
      for (const c of chords(s, z0)) {
        // parallel to the rafter, just under it, from 0.647 of the half-span in to the ridge line
        const xs = [Math.abs(c.start[0]), Math.abs(c.end[0])].sort((a, b) => a - b);
        expect(xs[0]).toBeCloseTo(0, 5);
        expect(xs[1]).toBeCloseTo(0.647 * (w / 2), 5);
        for (const p of [c.start, c.end]) {
          const gap = roofY(s, p[0]) - p[1];
          expect(gap).toBeGreaterThan(0.4);
          expect(gap).toBeLessThan(0.55);
        }
      }
      expect(s.members.filter((m) => m.kind === 'brace').length).toBe(s.frameCount * 2);
    }
  });

  it('CCI 32-40: bottom chord at the eave, king post + verticals at the 1/3 points, 1 diagonal a side', () => {
    for (const w of [32, 40]) {
      const s = bld(w, 'CCI');
      expect(perBent(s)).toEqual({ chords: 1, levelChords: 1, verts: 5, diags: 2 });
      const bc = chords(s, s.framePositionsZ[0])[0];
      expect(bc.start[1]).toBeCloseTo(s.legHeight, 6);
      expect(bc.length).toBeCloseTo(w, 6); // post to post
      const xs = webs(s, s.framePositionsZ[0]).filter(isVert).map((m) => Math.round(Math.abs(m.start[0]) * 1000) / 1000);
      expect([...new Set(xs)].sort((a, b) => a - b)).toEqual([0, w / 6, w / 3].map((x) => Math.round(x * 1000) / 1000));
    }
  });

  it('CCI 42-50: verticals at the 1/4 points + 2 Howe diagonals a side', () => {
    for (const w of [42, 50]) expect(perBent(bld(w, 'CCI'))).toEqual({ chords: 1, levelChords: 1, verts: 7, diags: 4 });
  });

  it('CCI 52-60: verticals at the 1/4 points + 3 Howe diagonals a side', () => {
    for (const w of [52, 60]) {
      const s = bld(w, 'CCI');
      expect(perBent(s)).toEqual({ chords: 1, levelChords: 1, verts: 7, diags: 6 });
      // Howe: every diagonal drops TOWARD the ridge (top end outboard of its foot)
      for (const d of webs(s, s.framePositionsZ[0]).filter((m) => !isVert(m))) {
        const foot = d.start[1] < d.end[1] ? d.start : d.end;
        const head = d.start[1] < d.end[1] ? d.end : d.start;
        expect(foot[1]).toBeCloseTo(s.legHeight, 6);
        expect(Math.abs(head[0])).toBeGreaterThan(Math.abs(foot[0]));
      }
    }
  });

  it('CA 31-41 (double post): box-eave lower chords + a flat RAISED bottom chord, verticals only', () => {
    for (const w of [32, 40]) {
      const s = bld(w, 'CA');
      expect(perBent(s)).toEqual({ chords: 3, levelChords: 1, verts: 11, diags: 0 });
      const flat = chords(s, s.framePositionsZ[0]).find(isLevel)!;
      expect(flat.start[1]).toBeGreaterThan(s.legHeight + 1); // raised above the eave
      expect(flat.length).toBeCloseTo(2 * 0.3 * (w / 2), 5);
      // sloped chords land on the eave post under the rafter
      for (const c of chords(s, s.framePositionsZ[0]).filter((m) => !isLevel(m))) {
        const eaveEnd = Math.abs(c.start[0]) > Math.abs(c.end[0]) ? c.start : c.end;
        expect(Math.abs(eaveEnd[0])).toBeCloseTo(w / 2, 6);
        expect(eaveEnd[1]).toBeLessThan(s.legHeight);
        expect(eaveEnd[1]).toBeGreaterThan(s.legHeight - 1);
      }
    }
  });

  it('CA 42-51: + the Λ of diagonals off the first vertical (2 a side), 5 box-eave verticals a side', () => {
    for (const w of [42, 50]) expect(perBent(bld(w, 'CA'))).toEqual({ chords: 3, levelChords: 1, verts: 15, diags: 4 });
  });

  it('CA 52-60 (ladder): zig-zag middle (3 diagonals a side) + LACED box-eave panels (8 a side); the vertical inside the ladder column is left out', () => {
    for (const w of [52, 60]) {
      const s = bld(w, 'CA');
      expect(perBent(s)).toEqual({ chords: 3, levelChords: 1, verts: 15, diags: 22 });
      // nothing stands inside the ladder column (inner chord 1.3 ft in at 12 ft)
      for (const m of webs(s)) {
        expect(Math.max(Math.abs(m.start[0]), Math.abs(m.end[0]))).toBeLessThan(w / 2 - 1.3);
      }
    }
  });

  it('CCI and CA differ where the charts differ', () => {
    // 30: CCI tie (level, well below the ridge) vs CA sister chord (sloped, under the rafter)
    expect(chords(bld(30, 'CCI')).every(isLevel)).toBe(true);
    expect(chords(bld(30, 'CA')).some(isLevel)).toBe(false);
    // 40 / 50 / 60: CCI bottom chord AT the eave; CA flat chord raised, box-eave chords sloped
    for (const w of [40, 50, 60]) {
      const cci = bld(w, 'CCI');
      const ca = bld(w, 'CA');
      expect(chords(cci).every((m) => isLevel(m) && near(m.start[1], cci.legHeight))).toBe(true);
      expect(chords(ca).filter(isLevel).every((m) => m.start[1] > ca.legHeight + 1)).toBe(true);
      expect(chords(ca).some((m) => !isLevel(m))).toBe(true);
    }
  });

  it('every web / chord stays inside the roof line and the walls (both mfrs, 26-60)', () => {
    for (const mfr of ['CCI', 'CA'] as const) {
      for (let w = 26; w <= 60; w += 2) {
        const s = bld(w, mfr);
        for (const m of truss(s)) {
          for (const p of [m.start, m.end]) {
            expect(Math.abs(p[0])).toBeLessThanOrEqual(w / 2 + 1e-6);
            expect(p[1]).toBeLessThanOrEqual(roofY(s, p[0]) + 1e-6);
            expect(p[1]).toBeGreaterThan(s.legHeight - 1);
          }
          expect(m.length).toBeGreaterThan(0.1);
        }
      }
    }
  });

  it('the members are drawn at a steeper custom pitch too (scaled to the rise)', () => {
    const s = bld(40, 'CCI', { roofPitch: 4 });
    const kp = webs(s, s.framePositionsZ[0]).find((m) => near(m.start[0], 0) && near(m.end[0], 0))!;
    expect(Math.max(kp.start[1], kp.end[1])).toBeCloseTo(s.peakHeight, 6);
    expect(Math.min(kp.start[1], kp.end[1])).toBeCloseTo(s.legHeight, 6);
  });
});

describe('knee braces vs the new chords', () => {
  it('a knee brace never pierces a truss chord (every class, both mfrs, single + double legs)', () => {
    for (const mfr of ['CCI', 'CA'] as const) {
      for (const w of [24, 26, 30, 32, 40, 42, 50, 52, 60]) {
        for (const legHeight of [12, 16]) {
          const s = bld(w, mfr, { legHeight });
          const z0 = s.framePositionsZ[0];
          const knees = s.members.filter((m) => m.kind === 'brace' && inBent(m, z0) && !isLevel(m));
          for (const k of knees) for (const c of chords(s, z0)) expect(crosses(k, c)).toBe(false);
        }
      }
    }
  });

  it('CA box-eave (double post): the knee brace now ENDS on the lower chord; bows keep the old brace', () => {
    const s = bld(40, 'CA');
    const z0 = s.framePositionsZ[0];
    const knees = s.members.filter((m) => m.kind === 'brace' && inBent(m, z0) && !isLevel(m));
    expect(knees.length).toBe(2);
    const lower = chords(s, z0).filter((m) => !isLevel(m));
    for (const k of knees) {
      const tip = k.start[1] > k.end[1] ? k.start : k.end;
      const onChord = lower.some((c) => {
        const t = (tip[0] - c.start[0]) / (c.end[0] - c.start[0]);
        return t >= -1e-6 && t <= 1 + 1e-6 && near(c.start[1] + (c.end[1] - c.start[1]) * t, tip[1], 1e-6);
      });
      expect(onChord).toBe(true);
      expect(tip[1]).toBeLessThan(roofY(s, tip[0]) - 0.3); // under the rafter
    }
    // a bow's knee brace still lands on the rafter
    const b = bld(24, 'CA');
    for (const k of b.members.filter((m) => m.kind === 'brace' && inBent(m, b.framePositionsZ[0]) && !isLevel(m))) {
      const tip = k.start[1] > k.end[1] ? k.start : k.end;
      expect(tip[1]).toBeCloseTo(roofY(b, tip[0]), 6);
    }
  });
});

describe('openings still clear the truss', () => {
  it('a gable-end door TALLER than the eave: nothing in the end frame passes through it; the far end is untouched', () => {
    for (const mfr of ['CCI', 'CA'] as const) {
      const bare = bld(40, mfr);
      const door = opening({ type: 'rollUpDoor', side: 'front', offset: 30, width: 10, height: 13.5 });
      const s = bld(40, mfr, {}, [door]);
      const halfW = 20;
      const halfL = s.length / 2;
      const lo = -halfW + 30 - 5;
      const hi = lo + 10;
      const front = truss(s).filter((m) => inBent(m, -halfL));
      expect(front.length).toBeGreaterThan(0);
      for (const m of front) expect(throughRect(m, lo, hi, 0, 13.5)).toBe(false);
      // something really was cut / left out in the front frame…
      expect(front).not.toEqual(truss(bare).filter((m) => inBent(m, -halfL)));
      // …and the back frame keeps the full pattern
      expect(truss(s).filter((m) => inBent(m, halfL))).toEqual(truss(bare).filter((m) => inBent(m, halfL)));
    }
  });

  it('CCI: the bottom chord is CUT around a tall end door (both stubs kept), webs over it left out', () => {
    const door = opening({ type: 'rollUpDoor', side: 'front', offset: 20, width: 12, height: 14 });
    const s = bld(40, 'CCI', {}, [door]);
    const halfL = s.length / 2;
    const bc = chords(s, -halfL);
    expect(bc.length).toBe(2);
    for (const c of bc) expect(Math.min(Math.abs(c.start[0]), Math.abs(c.end[0]))).toBeGreaterThanOrEqual(6 + 0.25 - 1e-6);
    // the king post stood in the door → gone from the front frame only
    const kp = (z: number) => webs(s, z).filter((m) => near(m.start[0], 0) && near(m.end[0], 0));
    expect(kp(-halfL).length).toBe(0);
    expect(kp(halfL).length).toBe(1);
  });

  it('an end door that stops at (or under) the eave leaves the truss alone — the chord is its header', () => {
    for (const mfr of ['CCI', 'CA'] as const) {
      const bare = bld(40, mfr);
      const s = bld(40, mfr, {}, [opening({ type: 'rollUpDoor', side: 'front', offset: 20, width: 12, height: 12 })]);
      expect(truss(s)).toEqual(truss(bare));
    }
  });

  it('a GCH partition door cuts the truss in the partition bent only', () => {
    const base = { buildingType: 'utility' as const, width: 40, length: 40, enclosedLengthFt: 20, openEnd: 'front' as const };
    const bare = build({ ...base, manufacturer: 'CCI' });
    const pz = bare.enclosure.partitionZ!;
    expect(bare.framePositionsZ.some((z) => near(z, pz))).toBe(true);
    const s = build({ ...base, manufacturer: 'CCI' }, [opening({ type: 'rollUpDoor', side: 'partition', offset: 20, width: 12, height: 14 })]);
    // partition door x = -halfW + offset ± width/2 = -6 .. 6
    const inPartition = truss(s).filter((mm) => inBent(mm, pz));
    for (const m of inPartition) expect(throughRect(m, -6, 6, 0, 14)).toBe(false);
    expect(inPartition).not.toEqual(truss(bare).filter((m) => inBent(m, pz)));
    expect(truss(s).filter((m) => !inBent(m, pz))).toEqual(truss(bare).filter((m) => !inBent(m, pz)));
  });

  it('eave frame-out: the CCI bottom chord stays (header) while the ladder column is cut', () => {
    const bare = bld(40, 'CCI');
    const bentZ = bare.framePositionsZ[2];
    const halfL = bare.length / 2;
    const fo = opening({ type: 'frameOut', side: 'right', offset: bentZ + halfL, width: 8, height: 12 });
    const s = bld(40, 'CCI', {}, [fo]);
    expect(chords(s)).toEqual(chords(bare));
    const legsAtBent = (st: S) => st.members.filter((m) => m.kind === 'leg' && inBent(m, bentZ) && m.start[0] > 0);
    expect(legsAtBent(s).length).toBeLessThan(legsAtBent(bare).length);
  });

  it('eave frame-out up to 11.5 ft on CA 40: no box-eave web / chord left inside the opening band at the wall', () => {
    const bare = bld(40, 'CA');
    const bentZ = bare.framePositionsZ[2];
    const halfL = bare.length / 2;
    const s = bld(40, 'CA', {}, [opening({ type: 'frameOut', side: 'left', offset: bentZ + halfL, width: 8, height: 11.5 })]);
    const nearWall = truss(s).filter((m) => inBent(m, bentZ) && Math.min(m.start[0], m.end[0]) < -20 + 2.25);
    expect(nearWall.length).toBeGreaterThan(0); // the lower chord is still there above the opening
    for (const m of nearWall) expect(Math.min(m.start[1], m.end[1])).toBeGreaterThanOrEqual(11.5 - 1e-6);
    // the other side is untouched
    const right = (st: S) => truss(st).filter((m) => inBent(m, bentZ) && Math.max(m.start[0], m.end[0]) > 20 - 2.25);
    expect(right(s)).toEqual(right(bare));
  });
});

describe('lean-to + mono-slope framing unchanged', () => {
  it('a free-standing single slope has no truss webs (plain rafter bent as before)', () => {
    for (const mfr of ['CCI', 'CA'] as const) {
      const s = bld(40, mfr, { monoDropFt: 3 });
      expect(truss(s).length).toBe(0);
    }
  });

  it('a lean-to adds no webs and does not change the main truss; webs never leave the main walls', () => {
    const lt: LeanTo = {
      id: 'lt1',
      type: 'attached',
      attachedSide: 'Left Eave',
      widthFt: 12,
      lengthFt: 40,
      lowLegHeightFt: 8,
      roofPitch: '2:12',
      enclosure: 'enclosed',
      openings: [],
    } as LeanTo;
    for (const mfr of ['CCI', 'CA'] as const) {
      const bare = bld(40, mfr);
      const s = build({ width: 40, manufacturer: mfr }, [], [lt]);
      expect(truss(s)).toEqual(truss(bare));
      for (const m of truss(s)) expect(Math.max(Math.abs(m.start[0]), Math.abs(m.end[0]))).toBeLessThanOrEqual(20 + 1e-6);
      // lean-to members (appended after the main building) carry no web / chord
      const ltMembers = s.members.slice(bare.members.length);
      expect(ltMembers.length).toBeGreaterThan(0);
      expect(ltMembers.some((m) => m.kind === 'web' || m.kind === 'chord')).toBe(false);
    }
  });
});

describe('drawing only', () => {
  it('the BOM steel lines never count truss webs / chords', () => {
    for (const mfr of ['CCI', 'CA'] as const) {
      const cfg = { ...DEFAULT_CONFIG, buildingType: 'garage' as const, width: 60, length: 40, legHeight: 12, openings: [], manufacturer: mfr };
      const r = resolveBuilding(cfg);
      const s = deriveStructure(r);
      const stripped = { ...s, members: s.members.filter((m) => m.kind !== 'web' && m.kind !== 'chord') };
      expect(truss(s).length).toBeGreaterThan(0);
      expect(generateBOM(r, s)).toEqual(generateBOM(r, stripped));
    }
  });
});
