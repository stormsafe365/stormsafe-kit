import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { StructureModel } from '@/engine/geometry';
import { useEditorStore } from '@/store/useEditorStore';
import { FOUNDATION, type FoundationLayout } from '../foundationLayout';
import { jointGeometry, unionSolidGeometry } from '../foundationGeometry';
import { ENHANCED_LOOK, siteRects, type Footprint } from './look';
import { createConcreteTexture, createContactTexture, createGroundSurfaceTexture } from './siteTextures';

type SurfaceKind = 'concrete' | 'gravel' | 'asphalt' | 'dirt';

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

const bbox = (rs: Footprint[]): Footprint => ({
  x0: Math.min(...rs.map((r) => r.x0)),
  x1: Math.max(...rs.map((r) => r.x1)),
  z0: Math.min(...rs.map((r) => r.z0)),
  z1: Math.max(...rs.map((r) => r.z1)),
});
const grow = (r: Footprint, d: number): Footprint => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });

/** Solid (exterior) vs see-through (Structure / Cutaway) for an imperatively built material. */
function setGhost(m: THREE.Material, opacity: number) {
  const ghost = opacity < 1;
  if (m.transparent === ghost && m.opacity === opacity) return;
  m.transparent = ghost;
  m.opacity = opacity;
  m.depthWrite = !ghost;
  m.needsUpdate = true;
}

/**
 * ENHANCED site: the ground and whatever the building stands on, by the
 * quote's Foundation Type (foundationLayout.ts, CCI FL foundation details):
 *  - concrete: a 4" light-concrete slab, top at y = 0 and 2" above the ground,
 *    its edge 6" past the base rails (the union of the building + lean-to
 *    rectangles, so an L-shaped build gets an L-shaped slab), faint broom
 *    finish, saw-cut control joints every <= 12 ft;
 *  - gravel / asphalt / ground: no slab — a subtle pad of that surface, top at
 *    y = 0, 2 ft past the footprint;
 *  - footers: no slab — compacted dirt at grade between the footing strips
 *    (the footings, bars and anchors are FoundationDetails).
 * Plus two very soft contact decals (owner override: no cast shadows): the
 * building + lean-to rectangles on the slab / pad top (clipped to it), and the
 * slab / pad edge on the ground.
 *
 * Structure / Cutaway: the ground and the slab / pad go see-through so the
 * footings, bars and anchor embedment read like the CCI sections; the decals
 * hide. The slab's TOP stays at y = 0, so nothing else in the scene moves.
 * Mounted by BuildingModel OUTSIDE ShellGroup (it owns its own view-mode
 * opacity), only while the look is enhanced. Every object is tagged
 * userData.captureIgnore (via the group) so the PDF capture framing ignores it.
 * Materials and textures are built imperatively (no JSX texture props, so R3F
 * never rewrites a colorSpace) and disposed when replaced or unmounted.
 */
export function EnhancedSite({ structure, layout }: { structure: StructureModel; layout: FoundationLayout }) {
  const viewMode = useEditorStore((s) => s.viewMode);
  const rects = siteRects(structure);
  const surface: SurfaceKind =
    layout.type === 'concrete' ? 'concrete' : layout.type === 'gravel' ? 'gravel' : layout.type === 'asphalt' ? 'asphalt' : 'dirt';
  const surfRects = (layout.slab ?? layout.pad ?? []) as Footprint[];
  const key = [
    surface,
    layout.gradeY,
    layout.padTop,
    ...rects.map((r) => [r.x0, r.x1, r.z0, r.z1].map((v) => v.toFixed(3)).join(',')),
    '|',
    ...surfRects.map((r) => [r.x0, r.x1, r.z0, r.z1].map((v) => v.toFixed(3)).join(',')),
  ].join(';');

  // Size-independent resources: once per mount. Surface textures / materials
  // are made on first use (a concrete quote never builds the gravel tile).
  const statics = useMemo(() => {
    const surfaces = new Map<SurfaceKind, { tex: THREE.Texture; mat: THREE.MeshStandardMaterial }>();
    const surfaceMat = (k: SurfaceKind) => {
      let s = surfaces.get(k);
      if (!s) {
        const spec =
          k === 'concrete'
            ? { color: ENHANCED_LOOK.slab.color, roughness: ENHANCED_LOOK.slab.roughness }
            : ENHANCED_LOOK.pads[k];
        const tex = k === 'concrete' ? createConcreteTexture({ broom: true }) : createGroundSurfaceTexture(k);
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color), map: tex, roughness: spec.roughness, metalness: 0 });
        s = { tex, mat };
        surfaces.set(k, s);
      }
      return s.mat;
    };
    const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ENHANCED_LOOK.ground), toneMapped: false });
    const groundGeo = new THREE.CircleGeometry(ENHANCED_LOOK.groundRadius, 96);
    const jointMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ENHANCED_LOOK.slab.joint),
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    jointMat.userData.keepTransparent = true;
    return { surfaces, surfaceMat, groundMat, groundGeo, jointMat };
  }, []);
  useEffect(
    () => () => {
      statics.surfaces.forEach((s) => {
        s.tex.dispose();
        s.mat.dispose();
      });
      statics.groundMat.dispose();
      statics.groundGeo.dispose();
      statics.jointMat.dispose();
    },
    [statics],
  );

  // Footprint / foundation dependent resources: rebuilt only when those change
  // (size, lean-tos, Foundation Type), never on color, opening or drag updates.
  const site = useMemo(() => {
    const { slab: cs, ground: cg } = ENHANCED_LOOK.contact;
    const tile = surface === 'concrete' ? ENHANCED_LOOK.slab.tileFt : ENHANCED_LOOK.pads[surface].tileFt;
    const top = layout.slab ? 0 : layout.padTop;
    // A pad is only its exposed 2" (down to just under grade) — no buried block.
    const bottom = layout.slab ? -FOUNDATION.slabT : layout.gradeY - 0.01;
    const surfGeo = surfRects.length ? unionSolidGeometry(surfRects, top, bottom, tile) : null;

    const sb = surfRects.length ? bbox(surfRects) : bbox(rects);
    const sw = sb.x1 - sb.x0;
    const sl = sb.z1 - sb.z0;
    const cx = (sb.x0 + sb.x1) / 2;
    const cz = (sb.z0 + sb.z1) / 2;
    // The building + lean-to rectangles shaded on the slab / pad top, clipped to it.
    const topShadeTex = createContactTexture(sb, rects, cs.fade, cs.alpha, surfRects);
    const topShadeGeo = new THREE.PlaneGeometry(sw, sl);
    const topShadeMat = decalMaterial(topShadeTex);
    // The slab / pad edge shaded on the ground.
    const gPlane = grow(sb, cg.fade);
    const groundShadeTex = createContactTexture(gPlane, surfRects.length ? surfRects : rects, cg.fade, cg.alpha);
    const groundShadeGeo = new THREE.PlaneGeometry(gPlane.x1 - gPlane.x0, gPlane.z1 - gPlane.z0);
    const groundShadeMat = decalMaterial(groundShadeTex);
    const joints = jointGeometry(layout.joints, 0.0025);
    return { cx, cz, top, surfGeo, topShadeTex, topShadeGeo, topShadeMat, groundShadeTex, groundShadeGeo, groundShadeMat, joints };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      site.surfGeo?.dispose();
      site.topShadeTex.dispose();
      site.topShadeGeo.dispose();
      site.topShadeMat.dispose();
      site.groundShadeTex.dispose();
      site.groundShadeGeo.dispose();
      site.groundShadeMat.dispose();
      site.joints?.dispose();
    },
    [site],
  );

  const surfMat = statics.surfaceMat(surface);
  const exterior = viewMode === 'exterior';
  // Structure / Cutaway: see-through ground + slab / pad (exterior: solid).
  useLayoutEffect(() => {
    const g = viewMode === 'cutaway' ? ENHANCED_LOOK.ghost.cutaway : viewMode === 'structure' ? ENHANCED_LOOK.ghost.structure : null;
    setGhost(statics.groundMat, g ? g.ground : 1);
    setGhost(surfMat, g ? g.surface : 1);
    statics.jointMat.opacity = g ? 0.8 * g.surface : 0.8;
  }, [viewMode, statics, surfMat]);

  return (
    <group userData={{ captureIgnore: true, enhancedSite: true }}>
      <mesh
        geometry={statics.groundGeo}
        material={statics.groundMat}
        rotation-x={-Math.PI / 2}
        position={[0, layout.gradeY, 0]}
        renderOrder={-3}
      />
      <mesh
        geometry={site.groundShadeGeo}
        material={site.groundShadeMat}
        rotation-x={-Math.PI / 2}
        position={[site.cx, layout.gradeY + 0.004, site.cz]}
        renderOrder={1}
        visible={exterior}
      />
      {site.surfGeo && <mesh geometry={site.surfGeo} material={surfMat} renderOrder={-1} />}
      {site.joints && <mesh geometry={site.joints} material={statics.jointMat} renderOrder={1} />}
      <mesh
        geometry={site.topShadeGeo}
        material={site.topShadeMat}
        rotation-x={-Math.PI / 2}
        position={[site.cx, site.top + 0.004, site.cz]}
        renderOrder={1}
        visible={exterior}
      />
    </group>
  );
}
