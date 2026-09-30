import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { StructureModel } from '@/engine/geometry';
import { ENHANCED_LOOK, siteFootprint, siteRects, type Footprint } from './look';
import { createConcreteTexture, createContactTexture } from './siteTextures';

const T = ENHANCED_LOOK.slab.thickness;

/**
 * Box geometry whose UVs are WORLD feet / tile (top/bottom: x,z; sides: the
 * horizontal axis and y), so the concrete grain keeps a fixed 6 ft scale and
 * stays put when the slab resizes. (cx, cz) = the box's world center.
 */
function slabGeometry(w: number, l: number, cx: number, cz: number, tile: number) {
  const g = new THREE.BoxGeometry(w, T, l);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx;
    const y = p.getY(i) - T / 2;
    const z = p.getZ(i) + cz;
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, x / tile, z / tile);
    else if (ax > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return g;
}

/** Transparent darkening decal (never forced opaque by a view-mode pass). */
function decalMaterial(map: THREE.Texture) {
  const m = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
    fog: false,
  });
  m.userData.keepTransparent = true;
  return m;
}

/**
 * ENHANCED site (HANDOFF Step 7, owner override applied): an unlit light
 * gray-green ground, a 4" light-concrete slab 2 ft past the footprint
 * (building + lean-tos, bounding rectangle) and two very soft contact decals —
 * the building + lean-to rectangles on the slab (an L-shaped build leaves its
 * open notch unshaded), the slab edge on the ground. No cast shadows anywhere.
 *
 * The slab's TOP is at y = 0 and it is built DOWNWARD, so nothing else in the
 * scene moves. Mounted by BuildingModel OUTSIDE ShellGroup (never ghosted by
 * Structure/Cutaway), only while the look is enhanced. Every object is tagged
 * userData.captureIgnore (via the group) so the PDF capture framing ignores it.
 * Materials and textures are built imperatively (no JSX texture props, so R3F
 * never rewrites a colorSpace) and disposed when replaced or unmounted.
 */
export function EnhancedSite({ structure }: { structure: StructureModel }) {
  const rects = siteRects(structure);
  const fp = siteFootprint(structure);
  const key = rects.map((r) => [r.x0, r.x1, r.z0, r.z1].map((v) => v.toFixed(3)).join(',')).join('|');

  // Size-independent resources: once per mount.
  const statics = useMemo(() => {
    const concrete = createConcreteTexture();
    const slabMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ENHANCED_LOOK.slab.color),
      map: concrete,
      roughness: ENHANCED_LOOK.slab.roughness,
      metalness: 0,
    });
    const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ENHANCED_LOOK.ground), toneMapped: false });
    const groundGeo = new THREE.CircleGeometry(ENHANCED_LOOK.groundRadius, 96);
    return { concrete, slabMat, groundMat, groundGeo };
  }, []);
  useEffect(
    () => () => {
      statics.concrete.dispose();
      statics.slabMat.dispose();
      statics.groundMat.dispose();
      statics.groundGeo.dispose();
    },
    [statics],
  );

  // Footprint-dependent resources: rebuilt only when the footprint changes
  // (size / lean-tos), never on color, opening or drag updates.
  const site = useMemo(() => {
    const { margin, tileFt } = ENHANCED_LOOK.slab;
    const { slab: cs, ground: cg } = ENHANCED_LOOK.contact;
    const fw = fp.x1 - fp.x0;
    const fl = fp.z1 - fp.z0;
    const cx = (fp.x0 + fp.x1) / 2;
    const cz = (fp.z0 + fp.z1) / 2;
    const sw = fw + 2 * margin;
    const sl = fl + 2 * margin;
    const slabGeo = slabGeometry(sw, sl, cx, cz, tileFt);

    const grow = (r: Footprint, d: number): Footprint => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });
    const aw = fw + 2 * cs.fade;
    const al = fl + 2 * cs.fade;
    const slabShadeTex = createContactTexture(grow(fp, cs.fade), rects, cs.fade, cs.alpha);
    const slabShadeGeo = new THREE.PlaneGeometry(aw, al);
    const slabShadeMat = decalMaterial(slabShadeTex);

    const slabRect = grow(fp, margin);
    const gw = sw + 2 * cg.fade;
    const gl = sl + 2 * cg.fade;
    const groundShadeTex = createContactTexture(grow(slabRect, cg.fade), [slabRect], cg.fade, cg.alpha);
    const groundShadeGeo = new THREE.PlaneGeometry(gw, gl);
    const groundShadeMat = decalMaterial(groundShadeTex);

    return { cx, cz, slabGeo, slabShadeTex, slabShadeGeo, slabShadeMat, groundShadeTex, groundShadeGeo, groundShadeMat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      site.slabGeo.dispose();
      site.slabShadeTex.dispose();
      site.slabShadeGeo.dispose();
      site.slabShadeMat.dispose();
      site.groundShadeTex.dispose();
      site.groundShadeGeo.dispose();
      site.groundShadeMat.dispose();
    },
    [site],
  );

  return (
    <group userData={{ captureIgnore: true, enhancedSite: true }}>
      <mesh
        geometry={statics.groundGeo}
        material={statics.groundMat}
        rotation-x={-Math.PI / 2}
        position={[0, -T, 0]}
      />
      <mesh
        geometry={site.groundShadeGeo}
        material={site.groundShadeMat}
        rotation-x={-Math.PI / 2}
        position={[site.cx, -T + 0.004, site.cz]}
        renderOrder={1}
      />
      <mesh geometry={site.slabGeo} material={statics.slabMat} position={[site.cx, -T / 2, site.cz]} />
      <mesh
        geometry={site.slabShadeGeo}
        material={site.slabShadeMat}
        rotation-x={-Math.PI / 2}
        position={[site.cx, 0.004, site.cz]}
        renderOrder={1}
      />
    </group>
  );
}
