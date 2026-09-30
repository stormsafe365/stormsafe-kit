import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TRIM_LIFT, lappedBoxGeometry } from '../lappedBox';
import { Emitter, SHELL, aabb, lapOn } from '../enhanced/shellGeometry';

// Wall-stripe fix (owner 9/30/26): a trim plate lying on a wall sheet draws its
// back face TRIM_LIFT inside the plate, never in the sheet's plane.

const faces = (g: THREE.BufferGeometry) => {
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  const out: { n: number[]; pts: number[][] }[] = [];
  for (let f = 0; f < p.length / 12; f++) {
    const pts = [0, 1, 2, 3].map((v) => [p[f * 12 + v * 3], p[f * 12 + v * 3 + 1], p[f * 12 + v * 3 + 2]]);
    out.push({ n: [n[f * 12], n[f * 12 + 1], n[f * 12 + 2]].map(Math.round), pts });
  }
  return out;
};

describe('lapped trim plates', () => {
  it('one shared 1/8" lift for the classic flashing and the enhanced shell trims', () => {
    expect(TRIM_LIFT).toBeCloseTo(0.01, 9);
    expect(SHELL.trimLift).toBe(TRIM_LIFT);
  });

  it('lappedBoxGeometry moves ONLY the chosen face, inward by TRIM_LIFT', () => {
    const size = [0.04, 10, 0.25] as const;
    for (const axis of [0, 1, 2] as const)
      for (const sign of [-1, 1] as const) {
        const plain = faces(new THREE.BoxGeometry(...size));
        const lapped = faces(lappedBoxGeometry(size, axis, sign));
        expect(lapped.length).toBe(6);
        for (let f = 0; f < 6; f++) {
          const isBack = plain[f].n[axis] === sign;
          for (let v = 0; v < 4; v++)
            for (let k = 0; k < 3; k++) {
              const want = plain[f].pts[v][k] - (isBack && k === axis ? sign * TRIM_LIFT : 0);
              expect(lapped[f].pts[v][k]).toBeCloseTo(want, 6);
            }
        }
      }
  });

  it('enhanced lapped plate: the five outer faces are the plain box, the back face sits trimLift in, and the recess is lined', () => {
    // a base-trim-like plate on the +X wall at x = 12.18 (outward +x): x 12.18..12.205, y 0..0.22, z -3..5
    const plainE = new Emitter();
    const lapE = new Emitter();
    aabb(plainE, [12.18, 0, -3], [12.205, 0.22, 5]);
    const lap = lapOn({ along: 'z', n: [1, 0, 0] });
    aabb(lapE, [12.18, 0, -3], [12.205, 0.22, 5], lap);
    // 6 faces x 2 triangles, the same 36 vertices except the back face (-x), then 4 lining strips x 2 triangles
    expect(lapE.pos.length).toBe(plainE.pos.length + 8 * 9);
    for (let i = 0; i < plainE.pos.length; i += 9) {
      const back = plainE.nor[i] === -1;
      for (let v = 0; v < 9; v++) {
        const want = plainE.pos[i + v] + (back && v % 3 === 0 ? SHELL.trimLift : 0);
        expect(lapE.pos[i + v]).toBeCloseTo(want, 9);
      }
      if (!back) for (let v = 0; v < 9; v++) expect(lapE.pos[i + v]).toBe(plainE.pos[i + v]); // bit-identical outside
    }
    // lining: every extra triangle lies within the recess (x 12.18..12.19), at right angles to the sheet, facing into the box
    for (let i = plainE.pos.length; i < lapE.pos.length; i += 9) {
      const n = [lapE.nor[i], lapE.nor[i + 1], lapE.nor[i + 2]];
      expect(Math.abs(n[0])).toBe(0);
      for (let v = 0; v < 9; v += 3) expect(lapE.pos[i + v]).toBeGreaterThanOrEqual(12.18 - 1e-9);
      for (let v = 0; v < 9; v += 3) expect(lapE.pos[i + v]).toBeLessThanOrEqual(12.18 + SHELL.trimLift + 1e-9);
      // into the box: the normal points from the face toward the box center (x 12.1925, y 0.11, z 1)
      const p = [lapE.pos[i], lapE.pos[i + 1], lapE.pos[i + 2]];
      const toCenter = [12.1925 - p[0], 0.11 - p[1], 1 - p[2]];
      expect(n[0] * toCenter[0] + n[1] * toCenter[1] + n[2] * toCenter[2]).toBeGreaterThan(0);
    }
  });

  it('lapOn picks the face toward the building (opposite the wall\'s outward normal)', () => {
    expect(lapOn({ along: 'z', n: [1, 0, 0] })).toEqual({ axis: 0, sign: -1, by: SHELL.trimLift });
    expect(lapOn({ along: 'z', n: [-1, 0, 0] })).toEqual({ axis: 0, sign: 1, by: SHELL.trimLift });
    expect(lapOn({ along: 'x', n: [0, 0, -1] })).toEqual({ axis: 2, sign: 1, by: SHELL.trimLift });
    expect(lapOn({ along: 'x', n: [0, 0, 1] })).toEqual({ axis: 2, sign: -1, by: SHELL.trimLift });
  });
});
