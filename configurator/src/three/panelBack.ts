import * as THREE from 'three';

/**
 * PANEL BACK SIDE (owner 10/5/26, photo of a green carport: "the colors only
 * shows on the outside - the inside panels almost look white").
 *
 * A painted steel sheet is painted on ONE face only. Its other face is the
 * plain, unpainted Galvalume back: a light silver-white with the ribs still
 * reading. Every sheet the builder draws (walls, gables, roof, lean-to walls /
 * roofs) therefore shows its chosen color + wainscot on its PAINTED face only,
 * and this one light material on the other face.
 *
 *  - Exterior walls / gables / roofs: painted face = outside.
 *  - Storage partitions (End / Left / Right, lean-to storage partition): the
 *    painted face is the MAIN-ROOM face (as Sensei shows; it keeps the wall
 *    color + wainscot), the face inside the storage room is the back.
 *  - GCH divider: painted face toward the open carport bay (where its wainscot
 *    already sits), the face inside the enclosed garage is the back.
 *  - The wainscot is paint on the outside of the sheet: it is drawn on the
 *    painted face only, never on the back.
 *
 * Both Looks use these helpers (classic three/Siding.tsx + LeanToSiding.tsx,
 * enhanced three/enhanced/materials.ts 'panelBack').
 */

/** The unpainted back of a steel panel: near-white silver (Galvalume back side). */
export const PANEL_BACK_HEX = '#DFE3E6';

export type Dir3 = readonly [number, number, number];

const dot = (a: Dir3, b: Dir3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Which face of a zero-thickness sheet carries the paint. `frontNormal` = the
 * mesh's geometric front-face normal (three.js: counter-clockwise winding; a
 * PlaneGeometry's +Z; a BasisPanel's u x v), `paintDir` = the world direction
 * the painted face looks (outward for an exterior wall, toward the main room
 * for a storage partition). Returns the side to draw the PAINT on and the side
 * to draw the panel BACK on.
 */
export function sheetSides(frontNormal: Dir3, paintDir: Dir3): { paint: THREE.Side; back: THREE.Side } {
  return dot(frontNormal, paintDir) >= 0 ? { paint: THREE.FrontSide, back: THREE.BackSide } : { paint: THREE.BackSide, back: THREE.FrontSide };
}

/**
 * Turn a (formerly DoubleSide) sheet material into its one-sided painted face.
 * shadowSide stays DoubleSide, so the sheet casts EXACTLY the shadow it cast as
 * a DoubleSide material (a one-sided material would otherwise render only its
 * other side into the shadow map). Returns the same material.
 */
export function oneSided<M extends THREE.Material>(m: M, side: THREE.Side): M {
  m.side = side;
  m.shadowSide = THREE.DoubleSide;
  return m;
}

/** A plan rectangle (world X / Z): the area inside a building's (or lean-to's) wall lines. */
export interface PlanRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * ROOF UNDERSIDE split (one sheet, two looks). The underside skin keeps its
 * LIVE Galvalume look under the overhang (the soffit, seen from outside under
 * every eave and rake), and is the light panel back over the room inside the
 * wall lines. Both are the SAME underside geometry drawn twice with
 * complementary clipping planes (world space, renderer.localClippingEnabled):
 *  - 'soffit' (the old underside material): discards fragments INSIDE the rect
 *    (clipIntersection: clipped only by all four planes at once);
 *  - 'inside' (the panel back): discards fragments OUTSIDE the rect (any plane).
 * The soffit keeps the exact LIVE triangles + material, so every exterior view
 * of the overhang is unchanged; the boundary sits on the wall sheet lines.
 */
export function roofUnderClip(rect: PlanRect, keep: 'soffit' | 'inside'): { planes: THREE.Plane[]; intersection: boolean } {
  const { x0, x1, z0, z1 } = rect;
  if (keep === 'soffit')
    return {
      // clipped when x < x1, x > x0, z < z1, z > z0 (all four = inside the rect)
      planes: [new THREE.Plane(new THREE.Vector3(1, 0, 0), -x1), new THREE.Plane(new THREE.Vector3(-1, 0, 0), x0), new THREE.Plane(new THREE.Vector3(0, 0, 1), -z1), new THREE.Plane(new THREE.Vector3(0, 0, -1), z0)],
      intersection: true,
    };
  return {
    // clipped when x > x1, x < x0, z > z1, z < z0 (any = outside the rect)
    planes: [new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1), new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0), new THREE.Plane(new THREE.Vector3(0, 0, -1), z1), new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0)],
    intersection: false,
  };
}

/** Apply roofUnderClip to a material (returns it). */
export function clipRoofUnder<M extends THREE.Material>(m: M, rect: PlanRect, keep: 'soffit' | 'inside'): M {
  const c = roofUnderClip(rect, keep);
  m.clippingPlanes = c.planes;
  m.clipIntersection = c.intersection;
  return m;
}

/** Is world point p kept by roofUnderClip(rect, keep)? (three.js clip rule; for tests.) */
export function keptByRoofUnderClip(rect: PlanRect, keep: 'soffit' | 'inside', p: Dir3): boolean {
  const c = roofUnderClip(rect, keep);
  const v = new THREE.Vector3(p[0], p[1], p[2]);
  const clipped = c.planes.map((pl) => pl.distanceToPoint(v) < 0);
  return c.intersection ? !clipped.every(Boolean) : !clipped.some(Boolean);
}

/**
 * userData of a sheet's back-face mesh: the PDF capture (CaptureHook) skips it,
 * so the framing sees exactly the meshes it saw before the back faces existed.
 */
export const PANEL_BACK_USERDATA: Record<string, unknown> = { captureIgnore: true, panelBack: true };
