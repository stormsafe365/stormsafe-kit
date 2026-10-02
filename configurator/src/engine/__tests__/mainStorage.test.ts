import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/constants';
import { COMPONENT_OUTSET, deriveStructure, openingWorldTransform, storagePartition, type Member } from '../geometry';
import { resolveBuilding } from '../ruleEngine';
import { NO_STORAGE, partitionLocationAllowed, readMainStorage, storageFromSpec } from '@/build/mainStorage';
import type { BuildingConfig, Opening, StorageMode } from '@/types/building';

/**
 * Main-building storage partitions (owner 10/1/26): the program's End Storage
 * (cross partition at a frame-line depth from either end) and Left / Right
 * Storage (lengthwise partition) drawn in the 3D. VIEW-ONLY — nothing here
 * prices anything. A GCH (utility) keeps its divider exactly as before.
 */

const cfg = (over: Partial<BuildingConfig> = {}, storage?: { mode: StorageMode; lengthFt: number }): BuildingConfig => ({
  ...DEFAULT_CONFIG,
  buildingType: 'garage',
  width: 30,
  length: 40,
  legHeight: 12,
  trussSpacingFt: 4, // the program's spacing for a 30-wide (getTrussInfo)
  manufacturer: 'CCI',
  ...over,
  walls: { ...DEFAULT_CONFIG.walls, storage: storage ?? { mode: 'none', lengthFt: 0 } },
});
const build = (over: Partial<BuildingConfig> = {}, storage?: { mode: StorageMode; lengthFt: number }) =>
  deriveStructure(resolveBuilding(cfg(over, storage)));

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;
const atZ = (m: Member, z: number) => near(m.start[2], z) && near(m.end[2], z);
const atX = (m: Member, x: number) => near(m.start[0], x) && near(m.end[0], x);
const opening = (o: Partial<Opening>): Opening => ({
  id: 'o1',
  type: 'rollUpDoor',
  side: 'partition',
  offset: 15,
  width: 10,
  height: 10,
  sillHeight: 0,
  ...o,
});

describe('storagePartition: where the wall stands', () => {
  const frames = [-20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20];
  it('End Storage at the back: depth in from +L/2, sheet facing the main room (−Z)', () => {
    expect(storagePartition('garage', { mode: 'endBack', lengthFt: 12 }, 30, 40, frames)).toEqual({ partitionZ: 8, partitionKind: 'storage', partitionFaces: -1 });
  });
  it('End Storage at the front: depth in from −L/2, facing +Z', () => {
    expect(storagePartition('garage', { mode: 'end', lengthFt: 20 }, 30, 40, frames)).toEqual({ partitionZ: 0, partitionKind: 'storage', partitionFaces: 1 });
  });
  it('snaps onto a frame line within 0.05 ft', () => {
    expect(storagePartition('garage', { mode: 'endBack', lengthFt: 12.03 }, 30, 40, frames)).toMatchObject({ partitionZ: 8 });
  });
  it('Left / Right (internal −X / +X): x in from that eave, facing the main room', () => {
    expect(storagePartition('garage', { mode: 'left', lengthFt: 12 }, 30, 40, frames)).toEqual({ sidePartition: { x: -3, faces: 1 } });
    expect(storagePartition('garage', { mode: 'right', lengthFt: 12 }, 30, 40, frames)).toEqual({ sidePartition: { x: 3, faces: -1 } });
  });
  it('kept 1 ft off the walls; none / no length / a GCH → no storage partition', () => {
    expect(storagePartition('garage', { mode: 'endBack', lengthFt: 99 }, 30, 40, frames)).toMatchObject({ partitionZ: -19 });
    expect(storagePartition('carport', { mode: 'left', lengthFt: 99 }, 30, 40, frames)).toEqual({ sidePartition: { x: 14, faces: 1 } });
    expect(storagePartition('garage', { mode: 'none', lengthFt: 12 }, 30, 40, frames)).toBe(null);
    expect(storagePartition('garage', { mode: 'end', lengthFt: 0 }, 30, 40, frames)).toBe(null);
    expect(storagePartition('utility', { mode: 'end', lengthFt: 12 }, 30, 40, frames)).toBe(null);
    expect(storagePartition('garage', undefined, 30, 40, frames)).toBe(null);
  });
});

describe('End Storage cross partition in the structure', () => {
  const bare = build();
  const s = build({}, { mode: 'endBack', lengthFt: 12 });
  it('enclosure: a storage partition 12 ft in from the back, on a truss line; the partition wall takes openings', () => {
    expect(s.enclosure.partitionZ).toBe(8);
    expect(s.enclosure.partitionKind).toBe('storage');
    expect(s.enclosure.partitionFaces).toBe(-1);
    expect(s.framePositionsZ).toContain(8);
    expect(s.walls.partition.available).toBe(true);
    expect(bare.walls.partition.available).toBe(false);
  });
  it('framed: its bent (already a truss line) plus a base rail and girt rows across the width', () => {
    const rails = s.members.filter((m) => m.kind === 'baseRail' && atZ(m, 8));
    expect(rails.length).toBe(1);
    // between the eave legs' inner faces (14-gauge leg = 0.2 ft → 0.1 in from each eave)
    expect(rails[0].length).toBeCloseTo(30 - 2 * 0.1, 6);
    expect(Math.max(rails[0].start[0], rails[0].end[0])).toBeCloseTo(14.9, 6);
    const girts = s.members.filter((m) => m.kind === 'girt' && atZ(m, 8));
    const endGirts = s.members.filter((m) => m.kind === 'girt' && atZ(m, 20));
    expect(girts.length).toBe(endGirts.length);
    expect(girts.length).toBeGreaterThan(0);
    // nothing else changed: same bents, same everything off the partition line
    const off = (ms: Member[]) => ms.filter((m) => !((m.kind === 'baseRail' || m.kind === 'girt') && atZ(m, 8)));
    expect(off(s.members)).toEqual(bare.members);
    expect(s.framePositionsZ).toEqual(bare.framePositionsZ);
  });
  it('its rails + girts stop against the eave legs — never in the eave walls’ plane (no line bleeding through the sheeting)', () => {
    const stor = s.members.filter((m) => (m.kind === 'baseRail' || m.kind === 'girt') && atZ(m, 8));
    for (const m of stor) expect(Math.max(Math.abs(m.start[0]), Math.abs(m.end[0]))).toBeCloseTo(14.9, 6);
    // a heavier gauge (12-gauge leg 0.27 ft) moves them in with the leg's face
    const g12 = build({ framingGauge: '12-gauge' }, { mode: 'endBack', lengthFt: 12 });
    const stor12 = g12.members.filter((m) => (m.kind === 'baseRail' || m.kind === 'girt') && atZ(m, 8));
    expect(stor12.length).toBe(stor.length);
    for (const m of stor12) expect(Math.max(Math.abs(m.start[0]), Math.abs(m.end[0]))).toBeCloseTo(15 - 0.135, 6);
  });
  it('an off-grid depth still gets its own bent (framePositionsZ stays the truss grid)', () => {
    const odd = build({}, { mode: 'endBack', lengthFt: 10 });
    expect(odd.enclosure.partitionZ).toBe(10);
    expect(odd.framePositionsZ).toEqual(bare.framePositionsZ);
    expect(odd.members.some((m) => m.kind === 'rafter' && atZ(m, 10))).toBe(true);
    expect(bare.members.some((m) => m.kind === 'rafter' && atZ(m, 10))).toBe(false);
  });
  it('a partition door cuts its base rail + girts, and mounts on the main-room face', () => {
    const d = build({ openings: [opening({ offset: 15, width: 10, height: 10 })] }, { mode: 'endBack', lengthFt: 12 });
    const rails = d.members.filter((m) => m.kind === 'baseRail' && atZ(m, 8));
    expect(rails.length).toBe(2); // −15..−5 and 5..15 (door x = −5..5)
    for (const r of rails) expect(Math.min(Math.abs(r.start[0]), Math.abs(r.end[0]))).toBeCloseTo(5, 6);
    const t = openingWorldTransform('partition', 15, 5, d);
    expect(t.pos[0]).toBe(0);
    expect(t.pos[2]).toBeCloseTo(8 - COMPONENT_OUTSET, 9);
    expect(t.rotY).toBe(Math.PI);
    const f = build({ openings: [opening({})] }, { mode: 'end', lengthFt: 20 });
    const tf = openingWorldTransform('partition', 15, 5, f);
    expect(tf.pos[2]).toBeCloseTo(0 + COMPONENT_OUTSET, 9);
    expect(tf.rotY).toBe(0);
  });
  it('wall area adds the partition (end wall + gable)', () => {
    expect(s.areas.walls - bare.areas.walls).toBeCloseTo(30 * s.legHeight + 0.5 * 30 * s.rise, 6);
  });
});

describe('Left / Right lengthwise partition in the structure', () => {
  const bare = build();
  const s = build({}, { mode: 'right', lengthFt: 12 }); // program "Left Storage"
  const x = 3;
  it('a post on every frame line up to the roofline, a base rail and girts along the full length', () => {
    expect(s.enclosure.sidePartition).toEqual({ x, faces: -1 });
    expect(s.enclosure.partitionZ).toBe(null);
    const posts = s.members.filter((m) => m.kind === 'leg' && atX(m, x));
    expect(posts.length).toBe(s.framePositionsZ.length);
    const roofY = s.peakHeight - Math.abs(x) * (s.rise / 15);
    for (const p of posts) expect(Math.max(p.start[1], p.end[1])).toBeCloseTo(roofY, 6);
    // interior frame lines: on the line; the two END posts stand just inside the
    // end walls (outer face 0.1 ft in = one 14-gauge leg half-depth), never in the
    // end wall's own plane behind the sheeting (verifier 10/2/26: 1-px bleed line)
    const pz = posts.map((p) => p.start[2]).sort((a, b) => a - b);
    expect(pz[0]).toBeCloseTo(-20 + 0.2, 6);
    expect(pz[pz.length - 1]).toBeCloseTo(20 - 0.2, 6);
    expect(pz.slice(1, -1)).toEqual(s.framePositionsZ.slice(1, -1));
    // rails + girts run between those outer faces
    expect(s.members.filter((m) => m.kind === 'baseRail' && atX(m, x)).map((m) => +m.length.toFixed(6))).toEqual([39.8]);
    for (const g of s.members.filter((m) => m.kind === 'girt' && atX(m, x))) expect(g.length).toBeCloseTo(39.8, 6);
    expect(s.members.filter((m) => m.kind === 'girt' && atX(m, x)).length).toBeGreaterThan(0);
    const added = (m: Member) => (m.kind === 'leg' || m.kind === 'baseRail' || m.kind === 'girt') && atX(m, x);
    expect(s.members.filter((m) => !added(m))).toEqual(bare.members);
    expect(s.walls.partition.available).toBe(false); // no door location on a lengthwise partition
  });
});

describe('GCH (utility) is untouched by the storage hook', () => {
  it('a utility with walls.storage set derives exactly the same structure', () => {
    const base = { buildingType: 'utility' as const, enclosedLengthFt: 20, openEnd: 'front' as const };
    const a = build(base);
    for (const mode of ['end', 'endBack', 'left', 'right'] as const) expect(build(base, { mode, lengthFt: 12 })).toEqual(a);
    expect(a.enclosure.partitionKind).toBeUndefined();
    const t = openingWorldTransform('partition', 15, 5, build({ ...base, openings: [opening({})] }));
    expect(t.pos[2]).toBe(a.enclosure.partitionZ);
    expect(t.rotY).toBe(Math.PI);
  });
  it('a garage with no storage derives the same structure as before (no new enclosure keys)', () => {
    expect(Object.keys(build().enclosure).sort()).toEqual(['back', 'front', 'partitionZ', 'sideBandFt', 'sideOpen', 'sideZ', 'type']);
  });
});

describe('bridge: program aewSpec() → 3D storage; Partition Wall location gate', () => {
  it('maps End front/back and the front-view Left/Right swap', () => {
    expect(storageFromSpec({ on: true, kind: 'end', end: 'back', depthFt: 12 })).toEqual({ mode: 'endBack', lengthFt: 12 });
    expect(storageFromSpec({ on: true, kind: 'end', end: 'front', depthFt: 20 })).toEqual({ mode: 'end', lengthFt: 20 });
    expect(storageFromSpec({ on: true, kind: 'left', widthFt: 12 })).toEqual({ mode: 'right', lengthFt: 12 });
    expect(storageFromSpec({ on: true, kind: 'right', widthFt: 9 })).toEqual({ mode: 'left', lengthFt: 9 });
  });
  it('off / incomplete / missing → none', () => {
    expect(storageFromSpec({ on: false, kind: 'end', end: 'back', depthFt: 12 })).toEqual(NO_STORAGE);
    expect(storageFromSpec({ on: true, kind: 'end', end: 'back', depthFt: 0 })).toEqual(NO_STORAGE);
    expect(storageFromSpec(null)).toEqual(NO_STORAGE);
    expect(readMainStorage({})).toEqual(NO_STORAGE);
    expect(readMainStorage({ aewSpec: () => { throw new Error('boot'); } })).toEqual(NO_STORAGE);
    expect(readMainStorage({ aewSpec: () => ({ on: true, kind: 'end', end: 'back', depthFt: 8 }) })).toEqual({ mode: 'endBack', lengthFt: 8 });
  });
  it('Partition Wall location: GCH, or End Storage on any other type — never Left/Right', () => {
    expect(partitionLocationAllowed('gch', 'yes')).toBe(true);
    expect(partitionLocationAllowed('gch', 'no')).toBe(true);
    expect(partitionLocationAllowed('standard', 'yes')).toBe(true);
    expect(partitionLocationAllowed('widespan', 'yes')).toBe(true);
    expect(partitionLocationAllowed('standard', 'no')).toBe(false);
    expect(partitionLocationAllowed('standard', 'left')).toBe(false);
    expect(partitionLocationAllowed('standard', 'right')).toBe(false);
  });
});
