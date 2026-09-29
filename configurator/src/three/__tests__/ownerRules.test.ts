import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { WallSide } from '@/types/building';
import { resolveBuilding } from '@/engine/ruleEngine';
import { deriveStructure, openingWorldTransform } from '@/engine/geometry';
import { DEFAULT_CONFIG } from '@/config/constants';
import { useEditorStore } from '@/store/useEditorStore';
import {
  CLICK_DRAG_THRESHOLD_PX,
  WALK_DOOR_SWING_RAD,
  swingAngle,
  walkDoorHingeX,
  walkDoorKnobX,
} from '../openingAnim';
import { ftIn, roofLengthFt, roofLengthLabel } from '../dimLabels';

/**
 * Guard tests for the owner's opening rules. They lock behaviour that a visual
 * port could quietly break:
 * - walk doors hinge LEFT / knob RIGHT;
 * - hi-impact doors (opening.impact) swing OUT, standard doors swing IN;
 * - a press under 5px is a click (open/close), never a drag;
 * - the Spacing roof-length label is span + 2 x structure.roofOverhangFt;
 * - click-to-open state and the Spacing overlay are wired up;
 * - no teal selection tint on main-building openings or lean-to fixtures.
 * The source checks at the bottom make sure the component still USES these
 * helpers, so a test can't pass while the rendered code drifts.
 */

// Read before any test touches the store.
const INITIAL_SHOW_SPACING = useEditorStore.getState().showSpacing;

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const build = () =>
  deriveStructure(
    resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', width: 24, length: 30, legHeight: 10, openings: [] } as never),
  );

// Outward unit normal of each wall (away from the building).
const OUTWARD: Record<Exclude<WallSide, 'partition'>, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, -1),
  back: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

/**
 * Rebuild the walk-door node chain from Openings.tsx: the door group at the
 * wall transform, the hinge pivot at walkDoorHingeX(w), the swing group turned
 * by swingAngle, the re-centre at +w/2, and the knob at walkDoorKnobX(w).
 */
function walkDoorWorld(side: Exclude<WallSide, 'partition'>, impact: boolean, t: number) {
  const s = build();
  const w = 3;
  const { pos, rotY } = openingWorldTransform(side, 6, 6.67 / 2, s);
  const door = new THREE.Object3D();
  door.position.set(pos[0], pos[1], pos[2]);
  door.rotation.y = rotY;
  const pivot = new THREE.Object3D();
  pivot.position.set(walkDoorHingeX(w), 0, 0);
  const swing = new THREE.Object3D();
  swing.rotation.y = swingAngle(impact, t);
  const recenter = new THREE.Object3D();
  recenter.position.set(w / 2, 0, 0);
  const knob = new THREE.Object3D();
  knob.position.set(walkDoorKnobX(w), 0, 0);
  door.add(pivot);
  pivot.add(swing);
  swing.add(recenter);
  recenter.add(knob);
  door.updateMatrixWorld(true);
  const w3 = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  return {
    center: new THREE.Vector3(pos[0], pos[1], pos[2]),
    localPlusZ: new THREE.Vector3(0, 0, 1).applyQuaternion(door.quaternion),
    hinge: w3(pivot),
    knob: w3(knob),
  };
}

describe('walk-door swing: hi-impact swings OUT, standard swings IN', () => {
  it('standard door → positive angle (inward)', () => {
    for (const t of [0.001, 0.25, 0.5, 1]) expect(swingAngle(false, t)).toBeGreaterThan(0);
    expect(swingAngle(false, 1)).toBe(1.6);
  });

  it('hi-impact door → negative angle (outward)', () => {
    for (const t of [0.001, 0.25, 0.5, 1]) expect(swingAngle(true, t)).toBeLessThan(0);
    expect(swingAngle(true, 1)).toBe(-1.6);
  });

  it('no impact flag (undefined) is a standard door', () => {
    expect(swingAngle(undefined, 1)).toBe(swingAngle(false, 1));
  });

  it('shut (t = 0) → 0 either way', () => {
    expect(Math.abs(swingAngle(false, 0))).toBe(0);
    expect(Math.abs(swingAngle(true, 0))).toBe(0);
  });

  it('matches the original inline expression exactly: (impact ? -1 : 1) * t * 1.6', () => {
    expect(WALK_DOOR_SWING_RAD).toBe(1.6);
    for (const impact of [false, true]) {
      for (const t of [0, 0.001, 0.1, 0.25, 0.3333, 0.5, 0.75, 0.998, 1]) {
        expect(Object.is(swingAngle(impact, t), (impact ? -1 : 1) * t * 1.6)).toBe(true);
      }
    }
  });

  // The sign rule only means "in" / "out" because the engine points every
  // opening's local +Z OUTWARD. Check that premise and the physical result on
  // all four walls.
  for (const side of ['front', 'back', 'left', 'right'] as const) {
    it(`${side} wall: local +Z is outward, standard knob ends up inside, impact knob outside`, () => {
      const n = OUTWARD[side];
      const std = walkDoorWorld(side, false, 1);
      expect(std.localPlusZ.distanceTo(n)).toBeLessThan(1e-9);
      expect(std.knob.clone().sub(std.center).dot(n)).toBeLessThan(-1); // swung IN
      const imp = walkDoorWorld(side, true, 1);
      expect(imp.knob.clone().sub(imp.center).dot(n)).toBeGreaterThan(1); // swung OUT
    });

    it(`${side} wall: seen from outside, hinge on the LEFT and knob on the RIGHT`, () => {
      const n = OUTWARD[side];
      const shut = walkDoorWorld(side, false, 0);
      // Viewer stands outside looking in (along -n); their right = forward x up.
      const right = n.clone().negate().cross(new THREE.Vector3(0, 1, 0));
      expect(shut.hinge.clone().sub(shut.center).dot(right)).toBeCloseTo(-1.5, 6);
      expect(shut.knob.clone().sub(shut.center).dot(right)).toBeCloseTo(1.3, 6);
    });
  }

  it('hinge and knob helpers match the original inline positions', () => {
    for (const w of [3, 3.5, 6]) {
      expect(Object.is(walkDoorHingeX(w), -w / 2)).toBe(true);
      expect(Object.is(walkDoorKnobX(w), w / 2 - 0.2)).toBe(true);
    }
  });
});

describe('click vs drag threshold', () => {
  it('is 5px (the render lab used 4px — do not copy it)', () => {
    expect(CLICK_DRAG_THRESHOLD_PX).toBe(5);
  });
});

describe('Spacing roof-length label = span + 2 x roofOverhangFt', () => {
  it('6" overhang (0.5 ft): 50\' wall → 51\' roof', () => {
    expect(roofLengthFt(50, 0.5)).toBe(51);
    expect(roofLengthLabel(50, 0.5)).toBe("51' roof");
    expect(roofLengthLabel(30, 0.5)).toBe("31' roof");
  });

  it('12" overhang (1.0 ft): 50\' wall → 52\' roof', () => {
    expect(roofLengthFt(50, 1)).toBe(52);
    expect(roofLengthLabel(50, 1)).toBe("52' roof");
    expect(roofLengthLabel(30, 1)).toBe("32' roof");
  });

  it('keeps inches on odd spans', () => {
    expect(roofLengthLabel(24.5, 0.5)).toBe(`25'6" roof`);
    expect(roofLengthLabel(20.25, 1)).toBe(`22'3" roof`);
  });

  it('matches the original inline expression exactly: ftIn(span + 2 * oh) + " roof"', () => {
    for (const span of [20, 24, 24.5, 30, 40, 50, 60.25, 100]) {
      for (const oh of [0, 0.5, 1]) {
        expect(roofLengthFt(span, oh)).toBe(span + 2 * oh);
        expect(roofLengthLabel(span, oh)).toBe(`${ftIn(span + 2 * oh)} roof`);
      }
    }
  });

  it('ftIn formats feet-inches', () => {
    expect(ftIn(4.75)).toBe(`4'9"`);
    expect(ftIn(10)).toBe(`10'`);
    expect(ftIn(6.6667)).toBe(`6'8"`);
    expect(ftIn(0)).toBe(`0'`);
  });
});

describe('click-to-open and Spacing state (editor store)', () => {
  it('toggleOpen flips one part; closeAllOpenings shuts everything (PDF capture relies on it)', () => {
    const st = useEditorStore.getState();
    st.closeAllOpenings();
    st.toggleOpen('walkDoor-1');
    expect(useEditorStore.getState().openIds['walkDoor-1']).toBe(true);
    st.toggleOpen('walkDoor-1');
    expect(useEditorStore.getState().openIds['walkDoor-1']).toBe(false);
    st.toggleOpen('a');
    st.toggleOpen('b');
    useEditorStore.getState().closeAllOpenings();
    expect(Object.values(useEditorStore.getState().openIds).some(Boolean)).toBe(false);
  });

  it('Spacing overlay is off by default and toggles', () => {
    expect(INITIAL_SHOW_SPACING).toBe(false);
    useEditorStore.getState().setShowSpacing(true);
    expect(useEditorStore.getState().showSpacing).toBe(true);
    useEditorStore.getState().setShowSpacing(false);
    expect(useEditorStore.getState().showSpacing).toBe(false);
  });
});

// Source checks: the rendered components must keep using the helpers above
// and keep the owner-rule wiring. If a later change trips one of these on
// purpose, update the rule here AND get the owner's OK.
describe('Openings.tsx / LeanToSiding.tsx keep the owner-rule wiring', () => {
  const openings = src('../Openings.tsx');
  const leanTo = src('../LeanToSiding.tsx');
  const capture = src('../CaptureHook.tsx');

  it('walk-door swing uses swingAngle(opening.impact, t) — no re-typed sign or angle', () => {
    expect(openings).toMatch(/swingRef\.current\.rotation\.y = swingAngle\(opening\.impact, t\)/);
    expect(openings).not.toMatch(/\*\s*t\s*\*\s*1\.6/);
  });

  it('walk door hinges on the left jamb and the knob is on the right', () => {
    expect(openings).toMatch(/<group position=\{\[walkDoorHingeX\(w\), 0, 0\]\}>\s*<group ref=\{swingRef\}>/);
    expect(openings).toMatch(/<group position=\{\[walkDoorKnobX\(w\),/);
  });

  it('click vs drag uses the shared 5px constant (main building and lean-tos)', () => {
    for (const code of [openings, leanTo]) {
      expect(code).toMatch(/moved < CLICK_DRAG_THRESHOLD_PX/);
      expect(code).not.toMatch(/moved\s*[<>]=?\s*\d/);
    }
    // A click opens/closes (never on a frame-out); a drag slides the part.
    expect(openings).toMatch(/if \(moved < CLICK_DRAG_THRESHOLD_PX && opening\.type !== 'frameOut'\) toggleOpen\(oid\)/);
    expect(openings).toMatch(/useEditorStore\(\(s\) => !!s\.openIds\[opening\.id\]\)/);
  });

  it('Spacing overlay roof label comes from structure.roofOverhangFt (never a hardcoded 0.5)', () => {
    expect(openings).toMatch(/const oh = structure\.roofOverhangFt\b/);
    expect(openings).toMatch(/label=\{roofLengthLabel\(span, oh\)\}/);
    expect(openings).toMatch(/a=\{pt\(-oh, /);
    expect(openings).toMatch(/b=\{pt\(span \+ oh, /);
  });

  it('Spacing button overlay is wired; placement guides hide while it is on', () => {
    expect(openings).toMatch(/\{showSpacing && <SpacingOverlay /);
    expect(openings).toMatch(/\{sel && !showSpacing && \(/);
  });

  it('no teal selection tint on main-building openings', () => {
    expect(openings).not.toMatch(/22d3c8/i);
  });

  it('no teal selection tint on lean-to fixtures (OpeningFixture has no selected state)', () => {
    const fixture = src('../OpeningFixture.tsx');
    expect(fixture).not.toMatch(/22d3c8/i);
    expect(fixture).not.toMatch(/\bselected\b/);
    expect(leanTo).not.toMatch(/selected=\{selected\}/);
  });

  it('PDF capture hides Spacing and shuts opened parts before the snapshots', () => {
    expect(capture).toMatch(/ed\.setShowSpacing\(false\)/);
    expect(capture).toMatch(/ed\.closeAllOpenings\(\)/);
  });
});
