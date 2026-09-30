import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { deriveStructure, type Member } from '../geometry';
import { resolveBuilding } from '../ruleEngine';
import { inStorageSegment, leanToWallSettings, rendersLeanToFixture, type LeanToStorageSpan } from '../leanToFixtures';
import { leanToOpeningSheeted } from '@/three/enhanced/fixtureLayout';
import { readLeanToStorage } from '@/build/leanToAccessory';
import type { BuildingConfig, LeanTo, LeanToOpening } from '@/types/building';

/**
 * Lean-to STORAGE SECTION — engine + visibility rules (VIEW-ONLY drawing; the
 * program prices it). Owner 9/29/26: a partition wall closes off one end of
 * the lean-to as a storage room; doors / windows / roll-ups go on the
 * partition. The storage END and the outer wall along the storage length are
 * drawn closed (the program prices them that way).
 */

type S = ReturnType<typeof deriveStructure>;

/** 30 x 40 x 12 garage, trusses 5' OC (z = -20, -15, ..., 20). */
const build = (lt: LeanTo, over: Partial<BuildingConfig> = {}): S =>
  deriveStructure(
    resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', width: 30, length: 40, legHeight: 12, trussSpacingFt: 5, openings: [], leanTos: [lt], ...over }),
  );

/** 12 x 40 Right Eave lean-to (inner x = -15, outer x = -27, run z = -20..20), 10' low leg. */
const leanTo = (o: Partial<LeanTo> = {}): LeanTo => ({
  id: 'lt1',
  type: 'attached',
  attachedSide: 'Right Eave',
  widthFt: 12,
  lengthFt: 40,
  lowLegHeightFt: 10,
  roofPitch: '2:12',
  enclosure: 'open',
  openings: [],
  ...o,
});

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;
/** Members lying entirely in the plane z = run. */
const inPlaneZ = (s: S, run: number, kind?: Member['kind']) =>
  s.members.filter((m) => near(m.start[2], run) && near(m.end[2], run) && (!kind || m.kind === kind));
const vertical = (m: Member) => near(m.start[0], m.end[0]) && near(m.start[2], m.end[2]) && !near(m.start[1], m.end[1]);

const rollUp = (o: Partial<LeanToOpening> = {}): LeanToOpening => ({
  id: 'p1',
  type: 'rollUpDoor',
  wall: 'partition',
  widthFt: 10,
  heightFt: 8,
  sillFt: 0,
  offsetFt: 6,
  ...o,
});

describe('storage section — engine (deriveStructure)', () => {
  it('no storage section: no storage key, and exactly the members of a lean-to whose storage is undefined', () => {
    const a = build(leanTo());
    const b = build(leanTo({ storage: undefined }));
    expect('storage' in a.leanTos[0]).toBe(false);
    expect(JSON.stringify(b.members)).toBe(JSON.stringify(a.members));
    expect(JSON.stringify(b.leanTos)).toBe(JSON.stringify(a.leanTos));
  });

  it('storage at the BACK on a truss line: partition uses that bent (no extra members), storage stretch = the last 10 ft of the outer wall', () => {
    const plain = build(leanTo());
    const s = build(leanTo({ storage: { end: 'back', lengthFt: 10 } }));
    const st = s.leanTos[0].storage as LeanToStorageSpan;
    expect(st).toEqual({ end: 'back', lengthFt: 10, runAt: 10, segStart: 30, segEnd: 40, faces: -1 });
    expect(s.leanTos[0].trussOffsets).toEqual(plain.leanTos[0].trussOffsets);
    expect(s.members.length).toBe(plain.members.length);
  });

  it('storage at the FRONT off the truss grid: a full partition bent is added (outer + inner post, rafter, knee brace) and joins the post guides', () => {
    const plain = build(leanTo());
    const s = build(leanTo({ storage: { end: 'front', lengthFt: 7 } }));
    const st = s.leanTos[0].storage as LeanToStorageSpan;
    expect(st).toEqual({ end: 'front', lengthFt: 7, runAt: -13, segStart: 0, segEnd: 7, faces: 1 });
    expect(inPlaneZ(plain, -13)).toEqual([]);
    const legs = inPlaneZ(s, -13, 'leg').filter(vertical);
    expect(legs.some((m) => near(m.start[0], -27))).toBe(true); // outer post
    expect(legs.some((m) => near(m.start[0], -15))).toBe(true); // inner post (no main leg at z = -13)
    expect(inPlaneZ(s, -13, 'rafter')).toHaveLength(1);
    expect(inPlaneZ(s, -13, 'brace')).toHaveLength(1); // knee brace
    expect(s.leanTos[0].trussOffsets).toContain(7);
  });

  it('the storage length stays inside the run (at least 0.5 ft short of it); zero / missing = no storage', () => {
    expect(build(leanTo({ storage: { end: 'back', lengthFt: 60 } })).leanTos[0].storage?.lengthFt).toBeCloseTo(39.5, 6);
    expect('storage' in build(leanTo({ storage: { end: 'back', lengthFt: 0 } })).leanTos[0]).toBe(false);
  });

  it('a partition door: no knee brace or post across it in the partition bent; without the storage section it moves no framing', () => {
    const withDoor = build(leanTo({ storage: { end: 'front', lengthFt: 7 }, openings: [rollUp()] }));
    const noDoor = build(leanTo({ storage: { end: 'front', lengthFt: 7 } }));
    // Roll-up 10 wide, centre 6 ft from the outer edge (x = -21): x -26..-16, y 0..8.
    expect(inPlaneZ(noDoor, -13, 'brace')).toHaveLength(1);
    expect(inPlaneZ(withDoor, -13, 'brace')).toHaveLength(0);
    for (const m of inPlaneZ(withDoor, -13, 'leg')) {
      const x = m.start[0];
      const inside = x > -26 + 0.01 && x < -16 - 0.01;
      if (inside) expect(Math.min(m.start[1], m.end[1])).toBeGreaterThanOrEqual(8 - 0.01);
    }
    // Orphan partition opening (no storage section): framing identical to no opening at all.
    expect(JSON.stringify(build(leanTo({ openings: [rollUp()] })).members)).toBe(JSON.stringify(build(leanTo()).members));
  });
});

describe('storage section — which walls are closed and which fixtures draw', () => {
  const st: LeanToStorageSpan = { end: 'back', lengthFt: 10, runAt: 10, segStart: 30, segEnd: 40, faces: -1 };

  it('leanToWallSettings closes the storage END (whatever it was set to) and passes the storage along; without one: no storage key', () => {
    expect(leanToWallSettings({ enclosure: 'open', storage: st })).toEqual({ side: 'open', front: 'open', back: 'closed', storage: st });
    expect(leanToWallSettings({ enclosure: 'custom', customWalls: { front: 'q2', back: 'gable', side: 'q3' }, storage: st })).toEqual({
      side: 'q3',
      front: 'q2',
      back: 'closed',
      storage: st,
    });
    const plain = leanToWallSettings({ enclosure: 'custom', customWalls: { front: 'q2', back: 'gable', side: 'q3' } });
    expect(plain).toEqual({ side: 'q3', front: 'q2', back: 'gable' });
    expect('storage' in plain).toBe(false);
  });

  it('partition openings draw only with a storage section (frame-outs too)', () => {
    const open = leanToWallSettings({ enclosure: 'open' });
    const withSt = leanToWallSettings({ enclosure: 'open', storage: st });
    for (const t of ['rollUpDoor', 'walkDoor', 'window', 'frameOut'] as LeanToOpening['type'][]) {
      expect(rendersLeanToFixture({ type: t, wall: 'partition' }, open)).toBe(false);
      expect(rendersLeanToFixture({ type: t, wall: 'partition' }, withSt)).toBe(true);
    }
  });

  it('an outer-wall door on an OPEN side draws only when its centre is on the closed storage stretch', () => {
    const w = leanToWallSettings({ enclosure: 'open', storage: st });
    expect(rendersLeanToFixture({ type: 'walkDoor', wall: 'outer', offsetFt: 35 }, w)).toBe(true);
    expect(rendersLeanToFixture({ type: 'walkDoor', wall: 'outer', offsetFt: 30 }, w)).toBe(true);
    expect(rendersLeanToFixture({ type: 'walkDoor', wall: 'outer', offsetFt: 20 }, w)).toBe(false);
    expect(rendersLeanToFixture({ type: 'walkDoor', wall: 'outer', offsetFt: 35 }, leanToWallSettings({ enclosure: 'open' }))).toBe(false);
    expect(inStorageSegment({ offsetFt: 29.9 }, st)).toBe(false);
    expect(inStorageSegment({}, st)).toBe(false);
  });

  it('the storage END wall draws its doors now that it is closed', () => {
    const w = leanToWallSettings({ enclosure: 'open', storage: st });
    expect(rendersLeanToFixture({ type: 'walkDoor', wall: 'back' }, w)).toBe(true);
    expect(rendersLeanToFixture({ type: 'walkDoor', wall: 'front' }, w)).toBe(false);
  });

  it('reveal (sheeting around it): partition and the storage stretch are sheeted, never a frame-out', () => {
    const w = leanToWallSettings({ enclosure: 'open', storage: st });
    expect(leanToOpeningSheeted({ type: 'walkDoor', wall: 'partition' }, w)).toBe(true);
    expect(leanToOpeningSheeted({ type: 'frameOut', wall: 'partition' }, w)).toBe(false);
    expect(leanToOpeningSheeted({ type: 'window', wall: 'outer', offsetFt: 36 }, w)).toBe(true);
    expect(leanToOpeningSheeted({ type: 'window', wall: 'outer', offsetFt: 10 }, w)).toBe(false);
    expect(leanToOpeningSheeted({ type: 'window', wall: 'partition' }, leanToWallSettings({ enclosure: 'open' }))).toBe(false);
  });
});

describe('storage section — BuildHost reads it from the PROGRAM (ltStorage, the price authority)', () => {
  const el = {} as Element;
  it('draws a storage room exactly when the program prices one', () => {
    expect(readLeanToStorage({ ltStorage: () => ({ valid: true, end: 'back', len: 10 }) }, el)).toEqual({ end: 'back', lengthFt: 10 });
    expect(readLeanToStorage({ ltStorage: () => ({ valid: true, end: 'front', len: 8 }) }, el)).toEqual({ end: 'front', lengthFt: 8 });
    // Switched on but not priced (blank / bad length), None, free-standing, a throw, an old program: nothing.
    expect(readLeanToStorage({ ltStorage: () => ({ valid: false, end: 'back', len: 0 }) }, el)).toBeUndefined();
    expect(readLeanToStorage({ ltStorage: () => ({ valid: false, end: '', len: 0 }) }, el)).toBeUndefined();
    expect(readLeanToStorage({ ltStorage: () => ({ valid: true, end: 'none', len: 10 }) }, el)).toBeUndefined();
    expect(
      readLeanToStorage(
        {
          ltStorage: () => {
            throw new Error('boot');
          },
        },
        el,
      ),
    ).toBeUndefined();
    expect(readLeanToStorage({}, el)).toBeUndefined();
  });
});
