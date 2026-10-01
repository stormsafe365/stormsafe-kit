import * as THREE from 'three';

/**
 * How far the back face of a trim plate lapped onto a wall sheet sits off that
 * sheet, inside the plate (1/8", the same as the lean-to LEAN_TO.trimLift and
 * the wainscot Z-trim standoff).
 *
 * WHY: the wall sheets are zero-thickness DoubleSide planes. A trim plate
 * (base trim, corner flashing, bottom trim) modeled as a box ON the sheet has
 * its back face exactly in the sheet's plane. Seen from inside the building,
 * that back face faces the camera and ties with the sheet in the depth buffer,
 * so the trim color z-fights through the sheet: the dark, jagged, hatched band
 * on the wall right above the base rail (owner 9/30/26) and the matching
 * vertical bands beside the corner legs. With the back face off the plane the
 * sheet always wins from inside; from outside that face is a back face behind
 * the plate's own outer face, so the outside look does not change.
 */
export const TRIM_LIFT = 0.01;

/**
 * A BoxGeometry of `size` whose one face on local `axis`, `sign` side (the
 * face whose outward normal is sign x axis: the face lying on the sheet) is
 * drawn `by` inside the box. The other five faces are the plain BoxGeometry's
 * (a BoxGeometry has 4 vertices of its own per face, so only that face moves).
 */
export function lappedBoxGeometry(size: readonly [number, number, number], axis: 0 | 1 | 2, sign: -1 | 1, by = TRIM_LIFT): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const pos = g.attributes.position.array as Float32Array;
  const nor = g.attributes.normal.array as Float32Array;
  for (let i = 0; i < pos.length; i += 3) if (Math.round(nor[i + axis]) === sign) pos[i + axis] -= sign * by;
  g.attributes.position.needsUpdate = true;
  return g;
}
