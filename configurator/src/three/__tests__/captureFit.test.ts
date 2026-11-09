import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitCameraToPoints } from '../captureFit';

/** Box corners (min / max) as the capture collects them. */
const box = (min: [number, number, number], max: [number, number, number]) => {
  const out: THREE.Vector3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push(new THREE.Vector3(x, y, z));
  return out;
};
/** 24 x 20 x 10 building (x -12..12, z -10..10) + a 12 ft lean-to on +X (x 12..24, low 8) with posts every 5 ft. */
const building = () => {
  const pts = [...box([-12, 0, -10], [12, 10, 10]), ...box([-12, 10, -10], [12, 14, 10])];
  for (const z of [-10, -5, 0, 5, 10]) pts.push(...box([23.8, 0, z - 0.1], [24, 8, z + 0.1])); // outer lean-to posts
  pts.push(...box([12, 8, -10.5], [24.5, 10, 10.5])); // lean-to roof
  return pts;
};
const camAt = (pos: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number) => {
  const c = new THREE.PerspectiveCamera(fov, aspect, 0.1, 5000);
  c.position.copy(pos);
  c.lookAt(target);
  c.updateMatrixWorld();
  return c;
};
const ndc = (pts: THREE.Vector3[], cam: THREE.PerspectiveCamera) => {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (const p of pts) { const q = p.clone().project(cam); mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mny = Math.min(mny, q.y); mxy = Math.max(mxy, q.y); }
  return { mnx, mxx, mny, mxy };
};
const basisOf = (cam: THREE.PerspectiveCamera) => ({
  R: new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0),
  U: new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1),
  F: new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate(),
});
const fitWith = (pts: THREE.Vector3[], cam: THREE.PerspectiveCamera) => {
  const ty = Math.tan((cam.fov * Math.PI) / 360);
  const f = fitCameraToPoints(pts, basisOf(cam), ty * cam.aspect, ty)!;
  return camAt(f.position, f.target, cam.fov, cam.aspect);
};
/** The OLD CaptureHook loop (4 x recenter + re-distance), for comparison. */
const oldFit = (pts: THREE.Vector3[], cam: THREE.PerspectiveCamera, target: THREE.Vector3, steps = 4) => {
  const t = target.clone();
  for (let k = 0; k < steps; k++) {
    cam.updateMatrixWorld();
    const { mnx, mxx, mny, mxy } = ndc(pts, cam);
    const dist = cam.position.distanceTo(t);
    const vh = 2 * dist * Math.tan((cam.fov * Math.PI) / 360), vw = vh * cam.aspect;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(((mnx + mxx) / 2) * (vw / 2));
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).multiplyScalar(((mny + mxy) / 2) * (vh / 2));
    cam.position.add(right).add(up); t.add(right).add(up);
    const need = Math.max((mxx - mnx) / 2 / 0.86, (mxy - mny) / 2 / 0.84);
    const dir = cam.position.clone().sub(t).normalize();
    cam.position.copy(t.clone().add(dir.multiplyScalar(Math.max(dist * need, 3))));
    cam.lookAt(t);
    cam.updateMatrixWorld();
  }
  return cam;
};
const expectFilled = (pts: THREE.Vector3[], cam: THREE.PerspectiveCamera) => {
  const e = ndc(pts, cam);
  expect(e.mxx).toBeLessThanOrEqual(0.86 + 1e-6);
  expect(e.mnx).toBeGreaterThanOrEqual(-0.86 - 1e-6);
  expect(e.mxy).toBeLessThanOrEqual(0.84 + 1e-6);
  expect(e.mny).toBeGreaterThanOrEqual(-0.84 - 1e-6);
  // one direction exactly on its margin (the building fills the frame) ...
  expect(Math.max((e.mxx - e.mnx) / 2 / 0.86, (e.mxy - e.mny) / 2 / 0.84)).toBeCloseTo(1, 6);
  // ... and centred both ways
  expect(e.mxx + e.mnx).toBeCloseTo(0, 6);
  expect(e.mxy + e.mny).toBeCloseTo(0, 6);
  return e;
};

describe('exact capture framing (owner 11/9/26: no step back on a lean-to side picture)', () => {
  it('eave view with the lean-to on the camera side: the old loop stops part-way, the exact fit fills the frame', () => {
    const pts = building();
    const target = new THREE.Vector3(1, 6, 0);
    const start = () => camAt(new THREE.Vector3(75, 6.3, -2.7), target, 35, 1.607);
    const old = ndc(pts, oldFit(pts, start(), target));
    const oldFill = Math.max((old.mxx - old.mnx) / 2 / 0.86, (old.mxy - old.mny) / 2 / 0.84);
    expect(Math.abs(oldFill - 1)).toBeGreaterThan(0.05); // the bug: not on its margin after 4 steps
    const e = expectFilled(pts, fitWith(pts, start()));
    expect(e.mxx - e.mnx).toBeGreaterThan(old.mxx - old.mnx);
  });

  it('a view the old loop already got right comes out the same (front gable of a plain building)', () => {
    const pts = box([-12, 0, -10], [12, 14, 10]);
    const target = new THREE.Vector3(0, 7, 0);
    const old = oldFit(pts, camAt(new THREE.Vector3(0, 7, -80), target, 35, 2.4), target, 12);
    const neu = fitWith(pts, camAt(new THREE.Vector3(0, 7, -80), target, 35, 2.4));
    expect(neu.position.distanceTo(old.position)).toBeLessThan(0.02);
    expectFilled(pts, neu);
  });

  it('any building / direction: inside the margins, filled, centred (seeded random sets)', () => {
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let t = 0; t < 60; t++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 1 + Math.floor(rnd() * 6); i++) {
        const x = rnd() * 60 - 30, z = rnd() * 60 - 30, y = rnd() * 4;
        pts.push(...box([x, y, z], [x + 1 + rnd() * 30, y + 1 + rnd() * 16, z + 1 + rnd() * 30]));
      }
      const ang = rnd() * Math.PI * 2, el = rnd() * 0.6;
      const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(el), Math.sin(el), Math.sin(ang) * Math.cos(el));
      const c = new THREE.Vector3(); pts.forEach((p) => c.add(p)); c.divideScalar(pts.length);
      const cam = camAt(c.clone().add(dir.multiplyScalar(200)), c, 30 + rnd() * 20, 1 + rnd() * 2);
      const fitted = fitWith(pts, cam);
      // same view direction as before the fit
      expect(basisOf(fitted).F.dot(basisOf(cam).F)).toBeCloseTo(1, 9);
      expectFilled(pts, fitted);
    }
  });

  it('no points / bad field of view: no fit (the camera is left alone)', () => {
    const b = { R: new THREE.Vector3(1, 0, 0), U: new THREE.Vector3(0, 1, 0), F: new THREE.Vector3(0, 0, -1) };
    expect(fitCameraToPoints([], b, 0.5, 0.4)).toBeNull();
    expect(fitCameraToPoints(box([0, 0, 0], [1, 1, 1]), b, 0, 0.4)).toBeNull();
  });
});
