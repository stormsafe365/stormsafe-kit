/**
 * Pure 2D polygon cutting for wall sheeting (render-upgrade Phase 6). Shared
 * by the classic lean-to ends (LeanToSiding GableEnd: partial ends cut around
 * their frame-outs) and the enhanced lean-to shell (enhanced/leanToShell.ts).
 *
 * Coordinates are a wall's plane: c = along-wall world coordinate, y = height.
 */

export type P2 = [number, number];

/** A rectangular opening on a wall: center c, width w, vertical extent [y0, y1]. */
export interface CutHole {
  c: number;
  w: number;
  y0: number;
  y1: number;
}

const EPS = 0.01;

/** Signed area (CCW > 0). */
export function polyArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Drop repeated and collinear vertices (clipping leaves both). */
export function cleanPoly(poly: P2[]): P2[] {
  const pts = poly.slice();
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const same = Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (same || Math.abs(cr) < 1e-9) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts.length < 3 ? [] : pts;
}

/** Sutherland-Hodgman clip to the half-plane f(p) >= 0 (f linear). */
export function clipHalf(poly: P2[], f: (p: P2) => number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return cleanPoly(out);
}

/** Holes that actually reach into the outline's bounding box. */
export function holesTouching(poly: P2[], holes: CutHole[]): CutHole[] {
  if (poly.length < 3) return [];
  const cs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const lo = Math.min(...cs);
  const hi = Math.max(...cs);
  const yLo = Math.min(...ys);
  const yHi = Math.max(...ys);
  return holes.filter((h) => h.c + h.w / 2 > lo + EPS && h.c - h.w / 2 < hi - EPS && h.y1 > yLo + EPS && h.y0 < yHi - EPS);
}

/**
 * Cut a sheet outline around rectangular holes -> convex pieces. Column sweep
 * (like Siding.stripsAround): split at every outline vertex and hole edge,
 * clip the outline to each column (one trapezoid for every lean-to outline,
 * incl. the L-shaped half end), then subtract the holes covering the column
 * with horizontal half-plane clips. Works for sloped tops and bottoms.
 */
export function cutHoles(poly: P2[], holes: CutHole[]): P2[][] {
  if (poly.length < 3) return [];
  const cs = poly.map((p) => p[0]);
  const lo = Math.min(...cs);
  const hi = Math.max(...cs);
  const hs = holesTouching(poly, holes);
  const xs = [...cs, ...hs.flatMap((h) => [h.c - h.w / 2, h.c + h.w / 2])]
    .map((c) => Math.min(hi, Math.max(lo, c)))
    .sort((a, b) => a - b)
    .filter((c, i, arr) => i === 0 || c - arr[i - 1] > 1e-7);
  const out: P2[][] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const ca = xs[i];
    const cb = xs[i + 1];
    if (cb - ca <= 0.02) continue;
    let pieces = [clipHalf(clipHalf(poly, (p) => p[0] - ca), (p) => cb - p[0])];
    const mid = (ca + cb) / 2;
    for (const h of hs) {
      if (mid < h.c - h.w / 2 || mid > h.c + h.w / 2) continue;
      pieces = pieces.flatMap((pc) => [clipHalf(pc, (p) => h.y0 - p[1]), clipHalf(pc, (p) => p[1] - h.y1)]);
    }
    for (const pc of pieces) if (Math.abs(polyArea(pc)) > 1e-4) out.push(pc);
  }
  return out;
}
