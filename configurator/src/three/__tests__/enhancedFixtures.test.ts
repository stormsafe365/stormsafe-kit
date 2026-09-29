import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_CONFIG } from '@/config/constants';
import { COMPONENT_OUTSET, SHEET_OUTSET, deriveStructure, openingWorldTransform, type StructureModel } from '@/engine/geometry';
import { resolveBuilding } from '@/engine/ruleEngine';
import type { BuildingConfig, LeanTo, Opening, WallSide } from '@/types/building';
import {
  OPEN_SECS,
  WALK_DOOR_SWING_RAD,
  WALK_DOOR_SWING_RAD_ENHANCED,
  easeInOut,
  rollUpTravel,
  sashTravel,
  stepOpenClassic,
  stepOpenTimed,
  swingAngle,
  walkDoorHingeX,
  walkDoorKnobX,
} from '../openingAnim';
import {
  FIXTURE,
  fixtureFaceZ,
  leanToOpeningSheeted,
  mainOpeningsSheeted,
  panelCenterZ,
  rollUpClipY,
  trimCenterZ,
  walkDoorPivotZ,
} from '../enhanced/fixtureLayout';
import { disposeEnhancedMaterials, getEnhancedMaterial, materialKey } from '../enhanced/materials';
import { eaveSurfaces, gableSurfaces, resolveWalls } from '../LeanToSiding';
import { leanToGaps, leanToSizeLabel, leanToWallFrame } from '../LeanToSpacing';

// Render-upgrade Phase 7: enhanced door / window / roll-up / frame-out
// fixtures, click-to-open motion, lean-to parity (pure parts).

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const build = (over: Partial<BuildingConfig> = {}): StructureModel =>
  deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, width: 24, length: 30, legHeight: 10, openings: [], leanTos: [], ...over } as BuildingConfig));

const opening = (over: Partial<Opening>): Opening => ({
  id: over.id ?? 'o',
  type: 'walkDoor',
  side: 'left',
  offset: 10,
  width: 3,
  height: 6.67,
  sillHeight: 0,
  ...over,
});

afterAll(() => disposeEnhancedMaterials());

describe('open / close motion (view-only)', () => {
  it('stepOpenClassic is the original inline ease, step for step', () => {
    // The pre-Phase-7 Openings.tsx useFrame body, verbatim.
    const original = (cur: number, target: number, dt: number) => {
      if (Math.abs(cur - target) < 0.001) return cur;
      cur += (target - cur) * Math.min(1, dt * 4);
      if (Math.abs(cur - target) < 0.002) cur = target;
      return cur;
    };
    for (const target of [0, 1]) {
      let a = 1 - target;
      let b = 1 - target;
      for (const dt of [0.016, 0.016, 0.033, 0.1, 0.016, 0.5, 0.016, 0.016, 0.2, 1, 0.016]) {
        a = stepOpenClassic(a, target, dt);
        b = original(b, target, dt);
        expect(Object.is(a, b)).toBe(true);
      }
      expect(a).toBe(target);
    }
  });

  it('stepOpenTimed runs linearly over its duration and never overshoots', () => {
    let t = 0;
    for (let i = 0; i < 10; i++) t = stepOpenTimed(t, 1, 0.1, 1.0);
    expect(t).toBeCloseTo(1, 12);
    expect(stepOpenTimed(0.95, 1, 0.5, 1)).toBe(1);
    expect(stepOpenTimed(0.05, 0, 0.5, 1)).toBe(0);
    expect(stepOpenTimed(1, 1, 0.5, 1)).toBe(1);
  });

  it('easeInOut is 0 -> 1, monotonic', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = easeInOut(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('HANDOFF durations: roll-up 1.8 s, walk door 1.0 s, window 0.8 s', () => {
    expect(OPEN_SECS.rollUpDoor).toBe(1.8);
    expect(OPEN_SECS.walkDoor).toBe(1.0);
    expect(OPEN_SECS.window).toBe(0.8);
  });

  it('roll-up rises h - 0.22 (bottom rail parks under the header); lower sash slides h/2 - 0.06', () => {
    expect(rollUpTravel(10)).toBeCloseTo(9.78, 12);
    expect(sashTravel(2.5)).toBeCloseTo(1.19, 12);
    // Fully open, the roll-up bottom rail top stays under the opening top (h/2 in the fixture frame).
    for (const h of [7, 8, 10, 12, 14]) {
      const railTop = -h / 2 + FIXTURE.rail.up + FIXTURE.rail.h / 2 + rollUpTravel(h);
      expect(railTop).toBeLessThanOrEqual(h / 2 + 1e-9);
    }
  });

  it('enhanced swing: ~88 degrees, sign rule unchanged (impact OUT, standard IN)', () => {
    expect(WALK_DOOR_SWING_RAD_ENHANCED).toBeCloseTo((88 * Math.PI) / 180, 12);
    expect(swingAngle(true, 1, WALK_DOOR_SWING_RAD_ENHANCED)).toBeLessThan(0);
    expect(swingAngle(false, 1, WALK_DOOR_SWING_RAD_ENHANCED)).toBeGreaterThan(0);
    expect(swingAngle(undefined, 0.5)).toBe(0.5 * WALK_DOOR_SWING_RAD); // default = the classic 1.6 rad
  });
});

describe('enhanced fixture placement (inside the unchanged wall transform)', () => {
  const s = build();

  it('the fixture sits ON the siding: trim proud of the sheeting face, leaf / curtain flush behind it', () => {
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const faceZ = fixtureFaceZ(side);
      const { pos, rotY } = openingWorldTransform(side, 6, 5, s);
      const face = new THREE.Vector3(0, 0, faceZ).applyEuler(new THREE.Euler(0, rotY, 0)).add(new THREE.Vector3(...pos));
      // The sheeting plane of that wall: eave sides at +-(W/2 + SHEET_OUTSET), ends at +-(L/2 + SHEET_OUTSET).
      if (side === 'left' || side === 'right') expect(Math.abs(face.x)).toBeCloseTo(s.width / 2 + SHEET_OUTSET, 9);
      else expect(Math.abs(face.z)).toBeCloseTo(s.length / 2 + SHEET_OUTSET, 9);
    }
    expect(fixtureFaceZ('left')).toBeCloseTo(-(COMPONENT_OUTSET - SHEET_OUTSET), 12);
    expect(fixtureFaceZ('leanTo')).toBe(fixtureFaceZ('left'));
    expect(fixtureFaceZ('partition')).toBe(0); // the partition fixture sits in its sheet plane
    const f = fixtureFaceZ('front');
    expect(trimCenterZ(f) - FIXTURE.trimProj / 2).toBeGreaterThan(f); // never coplanar with the sheet
    expect(panelCenterZ(f) + FIXTURE.panelDepth / 2).toBeLessThan(f); // flush, just behind the face
    expect(FIXTURE.trimFace).toBeCloseTo(0.17, 12);
    expect(FIXTURE.trimProj).toBeCloseTo(0.07, 12);
  });

  it('roll-up clip plane is just above the opening top', () => {
    expect(rollUpClipY(0, 10)).toBeCloseTo(10.01, 12);
    expect(rollUpClipY(4, 3)).toBeCloseTo(7.01, 12);
  });

  /** Leaf corners (fixture frame, xz) when fully open, following the enhanced node chain. */
  const leafCorners = (impact: boolean, w: number, maxRad: number) => {
    const faceZ = fixtureFaceZ('left');
    const pivotZ = walkDoorPivotZ(impact, faceZ);
    const pz = panelCenterZ(faceZ);
    const pivot = new THREE.Object3D();
    pivot.position.set(walkDoorHingeX(w), 0, pivotZ);
    const swing = new THREE.Object3D();
    swing.rotation.y = swingAngle(impact, 1, maxRad);
    const leaf = new THREE.Object3D();
    leaf.position.set(w / 2, 0, pz - pivotZ);
    pivot.add(swing);
    swing.add(leaf);
    pivot.updateMatrixWorld(true);
    const d = FIXTURE.panelDepth / 2;
    return [
      [-w / 2, -d],
      [w / 2, -d],
      [-w / 2, d],
      [w / 2, d],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(leaf.matrixWorld));
  };

  it('shut, the leaf pivot chain puts the leaf exactly in the opening', () => {
    for (const impact of [false, true]) {
      const faceZ = fixtureFaceZ('left');
      const pivotZ = walkDoorPivotZ(impact, faceZ);
      expect(walkDoorHingeX(3) + 3 / 2).toBe(0);
      expect(pivotZ + (panelCenterZ(faceZ) - pivotZ)).toBeCloseTo(panelCenterZ(faceZ), 12);
    }
  });

  it('hi-impact leaf swings OUT, standard IN, and neither cuts into the hinge-side jamb trim', () => {
    const w = 3;
    const faceZ = fixtureFaceZ('left');
    const out = leafCorners(true, w, WALK_DOOR_SWING_RAD_ENHANCED);
    const inn = leafCorners(false, w, WALK_DOOR_SWING_RAD_ENHANCED);
    expect(Math.max(...out.map((p) => p.z))).toBeGreaterThan(faceZ + 2.5); // outside the wall
    expect(Math.min(...inn.map((p) => p.z))).toBeLessThan(faceZ - 2.5); // inside
    // The jamb trim lies at x <= -w/2: an open leaf stays right of it.
    for (const p of [...out, ...inn]) expect(p.x).toBeGreaterThanOrEqual(-w / 2 - 1e-9);
    // (A 1.6 rad out-swing about that pivot WOULD cut into the trim — why the enhanced look uses 88 degrees.)
    expect(Math.min(...leafCorners(true, w, WALK_DOOR_SWING_RAD).map((p) => p.x))).toBeLessThan(-w / 2 - 0.01);
  });

  it('knob right / hinges left of the leaf centre (seen from outside)', () => {
    expect(walkDoorKnobX(3)).toBeGreaterThan(0);
    expect(walkDoorHingeX(3)).toBeLessThan(0);
  });
});

describe('reveal only where sheeting surrounds the opening', () => {
  it('main building: closed garage wall yes, frame-out never, open carport side no', () => {
    const s = build();
    const ops = [
      opening({ id: 'walk', side: 'left', offset: 10 }),
      opening({ id: 'win', type: 'window', side: 'right', offset: 12, width: 2.5, height: 2.5, sillHeight: 4.17 }),
      opening({ id: 'rud', type: 'rollUpDoor', side: 'front', offset: 12, width: 10, height: 8 }),
      opening({ id: 'fo', type: 'frameOut', side: 'back', offset: 12, width: 6, height: 7 }),
    ];
    const m = mainOpeningsSheeted(s, ops);
    expect(m).toEqual({ walk: true, win: true, rud: true, fo: false });
    const carport = build({ buildingType: 'carport' });
    expect(mainOpeningsSheeted(carport, [opening({ id: 'walk', side: 'left', offset: 10 })]).walk).toBe(false);
  });

  it('lean-to: only a fully closed wall, never a frame-out', () => {
    const walls = { side: 'closed', front: 'closed', back: 'open' };
    expect(leanToOpeningSheeted({ type: 'walkDoor', wall: 'outer' }, walls)).toBe(true);
    expect(leanToOpeningSheeted({ type: 'window', wall: 'front' }, walls)).toBe(true);
    expect(leanToOpeningSheeted({ type: 'walkDoor', wall: 'back' }, walls)).toBe(false);
    expect(leanToOpeningSheeted({ type: 'frameOut', wall: 'outer' }, walls)).toBe(false);
    expect(leanToOpeningSheeted({ type: 'rollUpDoor', wall: 'outer' }, { side: 'q3', front: 'closed', back: 'closed' })).toBe(false);
  });
});

describe('enhanced materials for fixtures', () => {
  it('walk-door leaf keys by style and white / black', () => {
    expect(materialKey({ surface: 'door', style: '6panel', dark: true })).toBe('door|6panel|blk');
    expect(materialKey({ surface: 'door', style: 'std', dark: false })).toBe('door|std|wht');
    expect(materialKey({ surface: 'door', style: 'std', dark: false })).not.toBe(materialKey({ surface: 'door', style: 'std', dark: true }));
  });

  it('roll-up parts clip everything above the opening top (a world-horizontal plane, part of the key)', () => {
    const plain = materialKey({ surface: 'opening', color: '#ffffff' });
    const clipped = materialKey({ surface: 'opening', color: '#ffffff', clipTopY: 10.01 });
    expect(clipped).not.toBe(plain);
    expect(materialKey({ surface: 'hardware', part: 'handle', clipTopY: 8.01 })).toBe('hardware|handle|clip8.01');
    const m = getEnhancedMaterial({ surface: 'opening', color: '#ffffff', clipTopY: 10.01 });
    expect(m.clippingPlanes).toHaveLength(1);
    const pl = m.clippingPlanes![0];
    expect(pl.distanceToPoint(new THREE.Vector3(3, 9.9, -4))).toBeGreaterThan(0); // kept
    expect(pl.distanceToPoint(new THREE.Vector3(-3, 10.2, 7))).toBeLessThan(0); // clipped
    expect(getEnhancedMaterial({ surface: 'opening', color: '#ffffff' }).clippingPlanes ?? []).toHaveLength(0);
  });
});

describe('lean-to Spacing overlay helpers', () => {
  const leanTo = (over: Partial<LeanTo> = {}): LeanTo => ({
    id: 'lt',
    type: 'attached',
    attachedSide: 'Left Eave',
    widthFt: 12,
    lengthFt: 30,
    lowLegHeightFt: 8,
    roofPitch: '2:12',
    enclosure: 'enclosed',
    openings: [],
    ...over,
  });

  it('gap chain corner -> opening -> corner; sizes like the main building', () => {
    expect(leanToGaps(30, [{ offsetFt: 15, widthFt: 2.5 }])).toEqual([
      [0, 13.75],
      [16.25, 30],
    ]);
    expect(leanToGaps(30, [{ offsetFt: 5, widthFt: 10 }, { offsetFt: 20, widthFt: 10 }])).toEqual([
      [10, 15],
      [25, 30],
    ]);
    expect(leanToSizeLabel({ type: 'window', widthFt: 2.5, heightFt: 3 })).toBe('30"x36"');
    expect(leanToSizeLabel({ type: 'walkDoor', widthFt: 3, heightFt: 6.67 })).toBe('36"x80"');
    expect(leanToSizeLabel({ type: 'rollUpDoor', widthFt: 10, heightFt: 8 })).toBe(`10'x8'`);
  });

  for (const attachedSide of ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable'] as const) {
    it(`${attachedSide}: the wall frame matches the fixture wall planes and faces outward`, () => {
      const s = build({ leanTos: [leanTo({ attachedSide, lengthFt: 20 })] });
      const lt = s.leanTos[0];
      const walls = resolveWalls(lt);
      const geo = lt.attachedSide.includes('Eave') ? eaveSurfaces(lt, 0.5, walls) : gableSurfaces(lt, 0.5, walls);
      const outer = leanToWallFrame(geo, 'outer');
      expect(outer.len).toBeCloseTo(geo.wall.b - geo.wall.a, 9);
      const p = outer.pt(3, 2);
      if (geo.wall.axis === 'z') {
        expect(p).toEqual([geo.wall.plane, 2, geo.wall.a + 3]);
        expect(outer.n[0]).toBe(Math.sign(geo.wall.plane));
      } else {
        expect(p).toEqual([geo.wall.a + 3, 2, geo.wall.plane]);
        expect(outer.n[2]).toBe(Math.sign(geo.wall.plane));
      }
      // The outer wall faces AWAY from the main building.
      const c = outer.pt(outer.len / 2, 1);
      const out = outer.pt(outer.len / 2, 1, 1);
      expect(Math.hypot(out[0], out[2])).toBeGreaterThan(Math.hypot(c[0], c[2]));
      for (const wall of ['front', 'back'] as const) {
        const f = leanToWallFrame(geo, wall);
        expect(f.len).toBeCloseTo(lt.widthFt, 6);
        // Sloped end: the low leg at the outer corner, the connection height at the building.
        const hOuter = f.heightAt(Math.abs(geo.gable.outerAcross - Math.min(geo.gable.innerAcross, geo.gable.outerAcross)));
        const hInner = f.heightAt(Math.abs(geo.gable.innerAcross - Math.min(geo.gable.innerAcross, geo.gable.outerAcross)));
        expect(hOuter).toBeCloseTo(geo.gable.lh, 6);
        expect(hInner).toBeCloseTo(geo.gable.connH, 6);
      }
    });
  }
});

describe('Phase 7 owner-rule wiring (source checks)', () => {
  const fixtures = src('../enhanced/fixtures.tsx');
  const classicFixture = src('../OpeningFixture.tsx');
  const leanTo = src('../LeanToSiding.tsx');
  const openings = src('../Openings.tsx');
  const hook = src('../useOpenAmount.ts');
  const host = src('../../build/BuildHost.tsx');

  it('enhanced walk door: hinge LEFT, knob RIGHT, sign from swingAngle(impact) — no re-typed sign', () => {
    expect(fixtures).toMatch(/swingRef\.current\.rotation\.y = swingAngle\(p\.impact, t, WALK_DOOR_SWING_RAD_ENHANCED\)/);
    expect(fixtures).toMatch(/<group position=\{\[walkDoorHingeX\(w\), 0, pivotZ\]\}>\s*<group ref=\{swingRef\}>/);
    expect(fixtures).toMatch(/position=\{\[walkDoorKnobX\(w\),/);
  });

  it('classic lean-to walk door swings on the same helpers', () => {
    expect(classicFixture).toMatch(/swingRef\.current\.rotation\.y = swingAngle\(impact, t\)/);
    expect(classicFixture).toMatch(/<group position=\{\[walkDoorHingeX\(w\), 0, 0\]\}>\s*<group ref=\{swingRef\}>/);
    expect(classicFixture).toMatch(/<group position=\{\[walkDoorKnobX\(w\),/);
  });

  it('lean-to click opens / closes with the shared 5px rule (never a frame-out); the drag gate is untouched', () => {
    expect(leanTo).toMatch(/if \(moved < CLICK_DRAG_THRESHOLD_PX && opening\.type !== 'frameOut'\) toggleOpen\(oid\)/);
    expect(leanTo).toMatch(/if \(moved < CLICK_DRAG_THRESHOLD_PX\) return;/);
    expect(leanTo).toMatch(/useEditorStore\.getState\(\)\.setDragMoved\(true\)/);
    // BuildHost writes a position back only after a REAL drag.
    expect(host).toMatch(/if \(prev\.dragging && !s\.dragging && prev\.dragMoved\) \{/);
    // Lean-to placement guides hide while Spacing is on (like the main building).
    expect(leanTo).toMatch(/\{selected && !showSpacing && <LeanToOpeningGuides /);
  });

  it('roll-ups keep a FIXED hit plane; the main-building click rule is unchanged', () => {
    expect(openings).toMatch(/\{isSlat && <OpeningHitPlane w=\{w\} h=\{h\} z=\{panelDepth \/ 2\} onPointerDown=\{onDown\} \/>\}/);
    expect(classicFixture).toMatch(/\{isSlat && <OpeningHitPlane /);
    expect(fixtures).toMatch(/material=\{hitMaterial\(\)\} onPointerDown=\{p\.onPointerDown\}/);
    expect(openings).toMatch(/if \(moved < CLICK_DRAG_THRESHOLD_PX && opening\.type !== 'frameOut'\) toggleOpen\(oid\)/);
  });

  it('PDF capture snaps every open part shut the moment captureMode turns on', () => {
    expect(hook).toMatch(/if \(s\.captureMode && !prev\.captureMode && progress\.current !== 0\) \{/);
    expect(hook).toMatch(/isOpen && !useEditorStore\.getState\(\)\.captureMode \? 1 : 0/);
    expect(hook).toMatch(/prefersReducedMotion\(\)/);
  });

  it('no teal selection tint in the enhanced fixtures', () => {
    expect(fixtures).not.toMatch(/22d3c8/i);
    expect(fixtures).not.toMatch(/\bselected\b/);
  });

  it('invisible click targets never move the PDF capture framing', () => {
    expect(classicFixture).toMatch(/onPointerDown=\{onPointerDown\} userData=\{\{ captureIgnore: true \}\}/);
    expect(fixtures).toMatch(/material=\{hitMaterial\(\)\} onPointerDown=\{p\.onPointerDown\} userData=\{\{ captureIgnore: true \}\}/);
  });
});

describe('enhanced fixture world placement matches the classic wall transform on every wall', () => {
  const s = build();
  const sides: Exclude<WallSide, 'partition'>[] = ['front', 'back', 'left', 'right'];
  it('local +Z is outward, so trim proud = outside the sheeting', () => {
    for (const side of sides) {
      const { pos, rotY } = openingWorldTransform(side, 6, 5, s);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
      const out = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const centre = new THREE.Vector3(...pos);
      const trimOuter = new THREE.Vector3(0, 0, trimCenterZ(fixtureFaceZ(side)) + FIXTURE.trimProj / 2).applyQuaternion(q).add(centre);
      const face = new THREE.Vector3(0, 0, fixtureFaceZ(side)).applyQuaternion(q).add(centre);
      expect(trimOuter.clone().sub(face).dot(out)).toBeGreaterThan(0);
    }
  });
});
