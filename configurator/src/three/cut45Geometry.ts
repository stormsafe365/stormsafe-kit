import * as THREE from 'three';

/**
 * Roll-up "45° Angle Cut" geometry (program ".r45" = Yes), shared by the
 * classic fixture (Openings.tsx) and the enhanced one (enhanced/fixtures.tsx).
 * Moved here verbatim from Openings.tsx: same shapes, same UVs, same
 * translation, so the classic door is unchanged.
 *
 * A SMALL manufacturer-style clip on both top corners (~6"-10"), not a
 * structural brace: the door still reads as a clean rectangle with clipped
 * corners, never a trapezoid.
 */

/** Chamfer leg (equal H/V = 45°). */
export const cut45Leg = (w: number, h: number) => Math.min(0.83, w * 0.09, h * 0.09);

/**
 * Door panel with both top corners cut at 45° (extruded chamfered rectangle),
 * centred on z = 0. Front-face UVs are normalized 0..1 over the bounding box so
 * the slat texture tiles exactly like the plain box panel does.
 */
export function chamferPanelGeometry(w: number, h: number, c: number, d: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2 - c);
  s.lineTo(w / 2 - c, h / 2);
  s.lineTo(-w / 2 + c, h / 2);
  s.lineTo(-w / 2, h / 2 - c);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
  return g;
}

/**
 * Trim as ONE continuous folded U-frame following the chamfered outline:
 * jambs + header + the two corner clips traced as a single band of uniform
 * width `t`, open at the bottom (floor door), centred on z = 0. Perfectly
 * mitered corners — no overshoot/notches from stacking separate boxes.
 */
export function chamferFrameGeometry(w: number, h: number, c: number, t: number, depth: number): THREE.ExtrudeGeometry {
  const a = t * (Math.SQRT2 - 1); // chamfer endpoints shift along the edges when offset out by t
  const s = new THREE.Shape();
  // Outer perimeter: up the left edge, across the top (around both clips), down the right.
  s.moveTo(-w / 2 - t, -h / 2);
  s.lineTo(-w / 2 - t, h / 2 - c + a);
  s.lineTo(-w / 2 + c - a, h / 2 + t);
  s.lineTo(w / 2 - c + a, h / 2 + t);
  s.lineTo(w / 2 + t, h / 2 - c + a);
  s.lineTo(w / 2 + t, -h / 2);
  // Inner perimeter (door edge) back down the right, across top, up the left.
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2 - c);
  s.lineTo(w / 2 - c, h / 2);
  s.lineTo(-w / 2 + c, h / 2);
  s.lineTo(-w / 2, h / 2 - c);
  s.lineTo(-w / 2, -h / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * The chamfer removes the door's top corners, exposing the rectangular wall
 * opening behind. Two corner triangles at the WALL plane `z` (fixture frame)
 * cap them so they read as solid sheeting. Wound to face +Z (outward).
 */
export function chamferFillGeometry(w: number, h: number, c: number, z: number): THREE.BufferGeometry {
  const v = new Float32Array([
    // top-right corner triangle
    w / 2, h / 2 - c, z, w / 2, h / 2, z, w / 2 - c, h / 2, z,
    // top-left corner triangle
    -w / 2, h / 2 - c, z, -w / 2 + c, h / 2, z, -w / 2, h / 2, z,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
