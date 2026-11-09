import * as THREE from 'three';

/**
 * EXACT capture framing (owner 11/9/26: "i dont want any small steps back").
 *
 * The PDF capture used to fit the camera by iterating "recenter, then scale the
 * distance by the measured extent" 4 times. That assumes every point is about as
 * far away as the target, which is false for a lean-to on the camera's side: its
 * posts are ~2x closer than the main building, so each step over-corrected and
 * the camera swung 72 ft -> 42 -> 69 -> 44 ... and stopped wherever step 4 left
 * it (the building ~41-50% of the picture instead of ~84%).
 *
 * This solves it in one go. The view DIRECTION is kept (R / U / F = the camera's
 * right / up / forward). A point p is inside the frame margins when
 *     |(p - C)·R| <= mx·(p - C)·F   and   |(p - C)·U| <= my·(p - C)·F
 * (mx = marginX·tan(half fov across), my = marginY·tan(half fov up)). Each side is
 * linear in the camera position C, so the closest C where every point fits is a
 * closed form: across, C·F = -(K1 + K2) / 2mx with K1 = max(p·R - mx p·F),
 * K2 = max(-p·R - mx p·F) (likewise up); the camera takes the farther of the two,
 * so the tighter direction lands exactly on its margin. Then each direction is
 * centred (the content's left / right — and top / bottom — NDC extents made
 * equal) by bisection, which is exact for perspective (the depths no longer move).
 * Points far / centred the same way as before give the same framing as the old
 * converged fit; only the views that never converged change.
 */
export interface CaptureFit {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export function fitCameraToPoints(
  pts: readonly THREE.Vector3[],
  basis: { R: THREE.Vector3; U: THREE.Vector3; F: THREE.Vector3 },
  tanHalfX: number,
  tanHalfY: number,
  marginX = 0.86,
  marginY = 0.84,
  minDist = 3,
): CaptureFit | null {
  const n = pts.length;
  if (!n || !(tanHalfX > 0) || !(tanHalfY > 0)) return null;
  const R = basis.R.clone().normalize(), U = basis.U.clone().normalize(), F = basis.F.clone().normalize();
  const mx = marginX * tanHalfX, my = marginY * tanHalfY;
  const a = new Float64Array(n), e = new Float64Array(n), b = new Float64Array(n);
  let k1 = -Infinity, k2 = -Infinity, l1 = -Infinity, l2 = -Infinity, sumB = 0, minB = Infinity;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    a[i] = p.dot(R); e[i] = p.dot(U); b[i] = p.dot(F);
    k1 = Math.max(k1, a[i] - mx * b[i]); k2 = Math.max(k2, -a[i] - mx * b[i]);
    l1 = Math.max(l1, e[i] - my * b[i]); l2 = Math.max(l2, -e[i] - my * b[i]);
    sumB += b[i]; minB = Math.min(minB, b[i]);
  }
  if (![k1, k2, l1, l2, sumB].every(Number.isFinite)) return null;
  const meanB = sumB / n;
  // the farther of the two depths (smaller C·F = further back along the view)
  let cF = Math.min(-(k1 + k2) / (2 * mx), -(l1 + l2) / (2 * my));
  cF = Math.min(cF, meanB - minDist, minB - 0.5); // never closer than minDist, never on top of a point
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = b[i] - cF;
  // centre one direction: the c where max((v - c)/d) = -min((v - c)/d)
  const centre = (v: Float64Array, lo: number, hi: number): number => {
    const g = (c: number) => {
      let mxN = -Infinity, mnN = Infinity;
      for (let i = 0; i < n; i++) { const q = (v[i] - c) / d[i]; if (q > mxN) mxN = q; if (q < mnN) mnN = q; }
      return mxN + mnN; // decreasing in c
    };
    if (!(hi > lo)) return (lo + hi) / 2;
    for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (g(m) > 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  // feasible ranges at this depth (the content stays inside its margins anywhere in them)
  const cR = centre(a, k1 + mx * cF, -k2 - mx * cF);
  const cU = centre(e, l1 + my * cF, -l2 - my * cF);
  const position = R.clone().multiplyScalar(cR).add(U.clone().multiplyScalar(cU)).add(F.clone().multiplyScalar(cF));
  const target = position.clone().add(F.clone().multiplyScalar(meanB - cF));
  return { position, target };
}
