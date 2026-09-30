import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { RenderStyle, ViewMode } from '@/store/useEditorStore';
import type { FoundationLayout } from './foundationLayout';
import { anchorGeometry, footingGeometry, rebarGeometry } from './foundationGeometry';
import { ENHANCED_LOOK } from './enhanced/look';
import { createConcreteTexture } from './enhanced/siteTextures';

/** Zinc-plated anchor hardware + #5 bars (drawing colors, both looks). */
const STEEL = '#d3d9de';
/**
 * Structure / Cutaway: the anchors are called out in the brand teal (true
 * size — a 2" washer is only a few pixels in a whole-building view, so color,
 * not scale, makes the connection points read), the bars in rust.
 */
const ANCHOR_CALLOUT = '#22d3c8';
const REBAR = '#a8683f';
const EDGE = '#5f676e';

interface Props {
  layout: FoundationLayout;
  look: RenderStyle;
  viewMode: ViewMode;
}

/**
 * The foundation's STRUCTURAL drawing (foundationLayout.ts — CCI FL
 * foundation/anchoring details): thickened-edge footings under the base
 * rails, their #5 continuous bars, and an anchor at every leg / post.
 * DRAWING ONLY.
 *
 * What shows where:
 *  - EXTERIOR (enhanced only — the classic exterior is untouched): what is
 *    above the surface — the wedge anchor's washer + nut on the rail, or the
 *    eye anchor's eye, through-bolt, washers and nuts at the rail; with
 *    Footers Only, the footing strips' 2" above the ground (solid concrete).
 *  - STRUCTURE / CUTAWAY (both looks): everything — see-through concrete
 *    footings, the bars inside them, the anchors' embedment / helical rods.
 *    (EnhancedSite ghosts the ground + slab in the same views.)
 * The classic look has no slab, so there the thickened edge is drawn with its
 * slab band (top at y = 0). Capture-ignored in the exterior (never moves the
 * PDF framing); a Structure / Cutaway capture frames the footings + anchor
 * depth. Mounted outside ShellGroup (owns its own opacity), no shadows.
 */
export function FoundationDetails({ layout, look, viewMode }: Props) {
  const enhanced = look === 'enhanced';
  const exterior = viewMode === 'exterior';

  const statics = useMemo(() => {
    const concrete = createConcreteTexture();
    const footingMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ENHANCED_LOOK.slab.color),
      map: concrete,
      roughness: 0.95,
      metalness: 0,
    });
    const rebarMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(REBAR), roughness: 0.7, metalness: 0.3 });
    const steelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(STEEL), roughness: 0.4, metalness: 0.35 });
    // Section outline (Structure / Cutaway): the footing's edges drawn like the CCI sections.
    const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(EDGE), transparent: true, opacity: 0.85, depthWrite: false });
    return { concrete, footingMat, rebarMat, steelMat, edgeMat };
  }, []);
  useEffect(
    () => () => {
      statics.concrete.dispose();
      statics.footingMat.dispose();
      statics.rebarMat.dispose();
      statics.steelMat.dispose();
      statics.edgeMat.dispose();
    },
    [statics],
  );

  // Footings under an enhanced slab start at its underside; everywhere else
  // (footers only, the classic look) the footing carries its own top at y = 0.
  const underSlab = layout.footingTop === 'slab' && enhanced;
  const key = JSON.stringify([underSlab, layout.footingTop, layout.anchor, layout.railHalf, layout.footings, layout.anchors]);
  const geo = useMemo(() => {
    const footing = layout.footings.length
      ? footingGeometry(layout.footings, underSlab ? 'underSlab' : 'full', layout.footingTop === 'slab', ENHANCED_LOOK.slab.tileFt)
      : null;
    const edges = footing ? new THREE.EdgesGeometry(footing, 30) : null;
    const rebar = rebarGeometry(layout.footings);
    const anchors = anchorGeometry(layout);
    return { footing, edges, rebar, above: anchors.above, below: anchors.below };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      geo.footing?.dispose();
      geo.edges?.dispose();
      geo.rebar?.dispose();
      geo.above?.dispose();
      geo.below?.dispose();
    },
    [geo],
  );

  // Footers only (enhanced exterior): the strips' tops show, solid. Structure /
  // Cutaway: see-through so the bars + embedment inside read.
  useLayoutEffect(() => {
    statics.steelMat.color.set(exterior ? STEEL : ANCHOR_CALLOUT);
    const m = statics.footingMat;
    const g = viewMode === 'cutaway' ? ENHANCED_LOOK.ghost.cutaway : viewMode === 'structure' ? ENHANCED_LOOK.ghost.structure : null;
    const opacity = g ? g.footing : 1;
    const ghost = opacity < 1;
    if (m.transparent !== ghost || m.opacity !== opacity) {
      m.transparent = ghost;
      m.opacity = opacity;
      m.depthWrite = !ghost;
      m.needsUpdate = true;
    }
  }, [viewMode, exterior, statics]);

  const showFooting = !exterior || (enhanced && layout.type === 'footers');
  // Capture framing: ignored in the exterior (the PDF framing never moves);
  // in Structure / Cutaway a capture frames the footings + anchor depth too.
  return (
    <group userData={{ captureIgnore: exterior, foundationDetails: true }}>
      {geo.footing && showFooting && <mesh geometry={geo.footing} material={statics.footingMat} renderOrder={-2} />}
      {geo.edges && !exterior && <lineSegments geometry={geo.edges} material={statics.edgeMat} renderOrder={-2} />}
      {geo.rebar && !exterior && <mesh geometry={geo.rebar} material={statics.rebarMat} />}
      {geo.above && <mesh geometry={geo.above} material={statics.steelMat} />}
      {geo.below && !exterior && <mesh geometry={geo.below} material={statics.steelMat} />}
    </group>
  );
}
