import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Footprint } from './enhanced/look';
import { FOUNDATION, type FootingStrip, type FoundationLayout, type SlabJoint } from './foundationLayout';

/**
 * Geometry for the foundation drawing (foundationLayout.ts): slab / pad
 * unions, thickened-edge footings, #5 bars, anchors and saw-cut joints.
 * Every builder returns a fresh BufferGeometry the caller owns (disposes).
 * Concrete / pad surfaces get WORLD-scaled UVs (feet / tile) so a texture
 * keeps a fixed scale on any size building.
 */

type V3 = [number, number, number];

/** Triangle soup builder: every quad is wound so its face normal points along `n`. */
class Soup {
  pos: number[] = [];
  quad(a: V3, b: V3, c: V3, d: V3, n: V3) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = ab[1] * ac[2] - ab[2] * ac[1];
    const cy = ab[2] * ac[0] - ab[0] * ac[2];
    const cz = ab[0] * ac[1] - ab[1] * ac[0];
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const [p, q, r, s] = flip ? [a, d, c, b] : [a, b, c, d];
    this.pos.push(...p, ...q, ...r, ...p, ...r, ...s);
  }
  tri(a: V3, b: V3, c: V3, n: V3) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = ab[1] * ac[2] - ab[2] * ac[1];
    const cy = ab[2] * ac[0] - ab[0] * ac[2];
    const cz = ab[0] * ac[1] - ab[1] * ac[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) this.pos.push(...a, ...c, ...b);
    else this.pos.push(...a, ...b, ...c);
  }
  /** Non-indexed geometry with flat normals and world UVs (top: x,z; x-facing: z,y; z-facing: x,y). */
  build(tileFt: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(this.pos);
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.computeVertexNormals();
    const n = g.attributes.normal;
    const uv = new Float32Array((p.length / 3) * 2);
    for (let i = 0; i < p.length / 3; i++) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      const ax = Math.abs(n.getX(i));
      const ay = Math.abs(n.getY(i));
      const az = Math.abs(n.getZ(i));
      const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
      uv[i * 2] = u / tileFt;
      uv[i * 2 + 1] = v / tileFt;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A closed slab-like solid over the UNION of `rects` (plan view), from
 * y = `bottom` up to y = `top`: top + bottom faces per grid cell and a side
 * face only on the union's outline (so an L-shaped build gets an L-shaped
 * slab with no internal faces and no coplanar overlap).
 */
export function unionSolidGeometry(rects: Footprint[], top: number, bottom: number, tileFt: number): THREE.BufferGeometry {
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]).map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap((r) => [r.z0, r.z1]).map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const covered = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= zs.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cz = (zs[j] + zs[j + 1]) / 2;
    return rects.some((r) => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1);
  };
  const s = new Soup();
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      if (!covered(i, j)) continue;
      const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
      s.quad([x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [0, 1, 0]);
      s.quad([x0, bottom, z0], [x1, bottom, z0], [x1, bottom, z1], [x0, bottom, z1], [0, -1, 0]);
      if (!covered(i - 1, j)) s.quad([x0, top, z0], [x0, top, z1], [x0, bottom, z1], [x0, bottom, z0], [-1, 0, 0]);
      if (!covered(i + 1, j)) s.quad([x1, top, z0], [x1, top, z1], [x1, bottom, z1], [x1, bottom, z0], [1, 0, 0]);
      if (!covered(i, j - 1)) s.quad([x0, top, z0], [x1, top, z0], [x1, bottom, z0], [x0, bottom, z0], [0, 0, -1]);
      if (!covered(i, j + 1)) s.quad([x0, top, z1], [x1, top, z1], [x1, bottom, z1], [x0, bottom, z1], [0, 0, 1]);
    }
  }
  return s.build(tileFt);
}

/**
 * Footing cross-section in (u, y): u = distance INWARD from the outer face.
 *  - 'underSlab': the thickened edge below a 4" slab — outer face from the
 *    slab underside down, the bottom `width` wide, then a 45 degree haunch up
 *    to the slab underside (details 1A / 1). The slab draws the top 4".
 *  - 'full': a stand-alone section whose top is y = 0 — a plain strip (footers
 *    only) or, with `haunch`, the thickened edge with its slab band (classic
 *    Structure view, where no slab is drawn).
 */
export function footingSection(f: Pick<FootingStrip, 'width' | 'depth'>, mode: 'underSlab' | 'full', haunch: boolean): Array<[number, number]> {
  const T = FOUNDATION.slabT;
  const D = f.depth;
  const W = f.width;
  if (mode === 'underSlab') return [[0, -T], [0, -D], [W, -D], [W + (D - T), -T]];
  if (haunch) return [[0, 0], [0, -D], [W, -D], [W + (D - T), -T], [W + (D - T), 0]];
  return [[0, 0], [0, -D], [W, -D], [W, 0]];
}

/** World point of section point (u, y) on a strip at run coordinate r. */
function stripPoint(f: FootingStrip, u: number, y: number, r: number): V3 {
  const a = f.outer - f.out * u;
  return f.run === 'z' ? [a, y, r] : [r, y, a];
}

/** Run coordinate of a strip's r0 / r1 end at inward offset u (a mitered end follows the 45 degree corner plane). */
const endAt = (f: FootingStrip, end: 0 | 1, u: number) => (end === 0 ? f.r0 + (f.miter0 ? u : 0) : f.r1 - (f.miter1 ? u : 0));

/** Every footing strip as one extruded convex section (sides + both end caps; mitered where strips meet at a corner). */
export function footingGeometry(strips: FootingStrip[], mode: 'underSlab' | 'full', haunch: boolean, tileFt: number): THREE.BufferGeometry {
  const s = new Soup();
  for (const f of strips) {
    const sec = footingSection(f, mode, haunch);
    const cu = sec.reduce((m, p) => m + p[0], 0) / sec.length;
    const cy = sec.reduce((m, p) => m + p[1], 0) / sec.length;
    const center = stripPoint(f, cu, cy, (f.r0 + f.r1) / 2);
    for (let i = 0; i < sec.length; i++) {
      const [u0, y0] = sec[i];
      const [u1, y1] = sec[(i + 1) % sec.length];
      const a = stripPoint(f, u0, y0, endAt(f, 0, u0));
      const b = stripPoint(f, u1, y1, endAt(f, 0, u1));
      const c = stripPoint(f, u1, y1, endAt(f, 1, u1));
      const d = stripPoint(f, u0, y0, endAt(f, 1, u0));
      const mid = stripPoint(f, (u0 + u1) / 2, (y0 + y1) / 2, (f.r0 + f.r1) / 2);
      s.quad(a, b, c, d, [mid[0] - center[0], mid[1] - center[1], mid[2] - center[2]]);
    }
    // End caps (convex section -> fan); planar also when mitered.
    for (const [end, sign] of [[0, -1], [1, 1]] as const) {
      const n: V3 = f.run === 'z' ? [0, 0, sign] : [sign, 0, 0];
      const at = (k: number) => stripPoint(f, sec[k][0], sec[k][1], endAt(f, end, sec[k][0]));
      for (let i = 1; i < sec.length - 1; i++) s.tri(at(0), at(i), at(i + 1), n);
    }
  }
  return s.build(tileFt);
}

/** Orient a unit-Y primitive along `axis`, then place it at `at`. */
function placed(g: THREE.BufferGeometry, axis: 'x' | 'y' | 'z', at: V3, tilt = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  if (axis === 'x') m.makeRotationZ(-Math.PI / 2);
  else if (axis === 'z') m.makeRotationX(Math.PI / 2);
  if (tilt) m.premultiply(new THREE.Matrix4().makeRotationX(tilt));
  m.setPosition(at[0], at[1], at[2]);
  g.applyMatrix4(m);
  return g;
}

/** #5 continuous bars in every footing strip (3" cover), as one mesh. */
export function rebarGeometry(strips: FootingStrip[]): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const r = FOUNDATION.barDia / 2;
  const cover = FOUNDATION.barCover;
  for (const f of strips) {
    const y = -f.depth + cover + r;
    const us =
      f.bars <= 1
        ? [f.width / 2]
        : Array.from({ length: f.bars }, (_, i) => cover + r + (i * (f.width - 2 * (cover + r))) / (f.bars - 1));
    for (const u of us) {
      // A free end keeps 3" cover; at a mitered corner the bar runs to the
      // corner plane (+ its radius), meeting the perpendicular strip's bar as an L.
      const a = f.miter0 ? endAt(f, 0, u) - r : f.r0 + cover;
      const b = f.miter1 ? endAt(f, 1, u) + r : f.r1 - cover;
      if (b - a <= 0.1) continue;
      const g = new THREE.CylinderGeometry(r, r, b - a, 8, 1, false);
      parts.push(placed(g, f.run, stripPoint(f, u, y, (a + b) / 2)));
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Hex nut: a 6-sided prism along `axis` (unit-Y primitive rotated). */
const nut = (axis: 'x' | 'y' | 'z', at: V3) => placed(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 6), axis, at);
/** 2" washer (the details' "2" WASHERS"). */
const washer = (axis: 'x' | 'y' | 'z', at: V3) => placed(new THREE.CylinderGeometry(1 / 12, 1 / 12, 0.012, 20), axis, at);
const rod = (axis: 'x' | 'y' | 'z', at: V3, len: number, r = 0.021) => placed(new THREE.CylinderGeometry(r, r, len, 10), axis, at);

/**
 * Anchor hardware, split into what shows ABOVE the surface (nut / washer /
 * bolt stub on the rail; the eye, through-bolt, washers and nuts at the rail)
 * and what is embedded BELOW it (the wedge anchor's shank + expansion clip in
 * the concrete; the helical anchor's rod + two helix plates in the ground),
 * which only the Structure / Cutaway views draw.
 */
export function anchorGeometry(layout: Pick<FoundationLayout, 'anchor' | 'anchors' | 'railHalf'>): {
  above: THREE.BufferGeometry | null;
  below: THREE.BufferGeometry | null;
} {
  const above: THREE.BufferGeometry[] = [];
  const below: THREE.BufferGeometry[] = [];
  const h = layout.railHalf;
  for (const a of layout.anchors) {
    const P = (acrossOff: number, y: number, runOff = 0): V3 =>
      a.run === 'z' ? [a.c + acrossOff, y, a.z + runOff] : [a.x + runOff, y, a.c + acrossOff];
    const ax: 'x' | 'z' = a.run === 'z' ? 'x' : 'z'; // across axis
    if (layout.anchor === 'wedge') {
      // Wedge / expansion anchor straight down through the rail's top (1A / 1B / 1).
      const top = h;
      above.push(washer('y', P(0, top + 0.006)));
      above.push(nut('y', P(0, top + 0.012 + 0.02)));
      above.push(rod('y', P(0, top + 0.052 + 0.015), 0.03));
      const embed = FOUNDATION.wedgeEmbed;
      below.push(rod('y', P(0, (top - embed) / 2), top + embed));
      below.push(rod('y', P(0, -embed + 0.045), 0.07, 0.027)); // expansion clip
    } else {
      // Helical eye anchor beside the rail (Base Rail Anchorage / 1C): the eye
      // on the rail's INSIDE face, a 1/2" through-bolt across the rail with a
      // 2" washer + nut each side.
      const s = a.inward;
      const yb = h * 0.5; // mid-height of the rail's exposed part
      // A forged eye a bit larger than the 2" washer, so its loop reads around it.
      const R = 0.1;
      const tube = 0.022;
      const boltOut = -(h + 0.058); // past the outer washer + nut
      const boltIn = h + 2 * tube + 0.058; // past the eye, inner washer + nut
      above.push(rod(ax, P(s * ((boltIn + boltOut) / 2), yb), boltIn - boltOut));
      above.push(washer(ax, P(-s * (h + 0.006), yb)));
      above.push(nut(ax, P(-s * (h + 0.012 + 0.02), yb)));
      const eyeAt = P(s * (h + tube), yb);
      const eye = new THREE.TorusGeometry(R, tube, 8, 20);
      if (ax === 'x') eye.rotateY(Math.PI / 2);
      eye.translate(eyeAt[0], eyeAt[1], eyeAt[2]);
      above.push(eye);
      above.push(washer(ax, P(s * (h + 2 * tube + 0.006), yb)));
      above.push(nut(ax, P(s * (h + 2 * tube + 0.012 + 0.02), yb)));
      // The anchor rod from the eye straight down, with two helix plates near its tip.
      const depth = FOUNDATION.eyeDepth;
      const rodTop = yb - R;
      below.push(rod('y', P(s * (h + tube), (rodTop - depth) / 2), rodTop + depth, 0.03));
      for (const k of [0.35, 0.8]) {
        below.push(placed(new THREE.CylinderGeometry(0.25, 0.25, 0.015, 20), 'y', P(s * (h + tube), -depth + k), 0.14));
      }
    }
  }
  const merge = (parts: THREE.BufferGeometry[]) => {
    if (!parts.length) return null;
    // Torus + cylinders share position / normal / uv, all indexed.
    const m = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return m;
  };
  return { above: merge(above), below: merge(below) };
}

/** Saw-cut control joints: thin strips on the slab top at y = `y`. */
export function jointGeometry(joints: SlabJoint[], y: number, widthFt = 0.035): THREE.BufferGeometry | null {
  if (!joints.length) return null;
  const s = new Soup();
  const hw = widthFt / 2;
  for (const j of joints) {
    if (j.run === 'z') s.quad([j.at - hw, y, j.r0], [j.at + hw, y, j.r0], [j.at + hw, y, j.r1], [j.at - hw, y, j.r1], [0, 1, 0]);
    else s.quad([j.r0, y, j.at - hw], [j.r1, y, j.at - hw], [j.r1, y, j.at + hw], [j.r0, y, j.at + hw], [0, 1, 0]);
  }
  return s.build(1);
}

