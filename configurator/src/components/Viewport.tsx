import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, ContactShadows } from '@react-three/drei';
import { BuildingModel } from '@/three/BuildingModel';
import { CameraRig } from '@/three/CameraRig';
import { InteriorWalk } from '@/three/InteriorWalk';
import { CaptureHook } from '@/three/CaptureHook';
import { ViewControls } from '@/components/ViewControls';
import { EnhancedSceneRig } from '@/three/enhanced/EnhancedSceneRig';
import { useEditorStore } from '@/store/useEditorStore';

/**
 * CLASSIC scene rig — today's background, fog and lights, moved here VERBATIM
 * from the Canvas body (its contact shadows + ground grid are ClassicGround,
 * right after it). This is the default look and the one client PDFs are
 * captured with: keep it pixel-identical.
 */
function ClassicSceneRig() {
  return (
    <>
      <color attach="background" args={['#08121d']} />
      <fog attach="fog" args={['#08121d', 80, 360]} />

      {/* All four vertical walls MUST read the identical shade (critical for
          client PDFs). The key light is placed PERFECTLY straight overhead
          (zero horizontal component) → N·L is the same (0) for every vertical
          wall regardless of which way it faces, so the directional adds NO
          per-wall difference. Wall shade then comes only from the uniform
          ambient + sky hemisphere, which are azimuth-independent. The roof
          (sloped) still catches the overhead light for depth. NOTE: the siding
          envMap is also zeroed (Siding.tsx) because the HDRI is directional
          and would otherwise tint one wall vs another. */}
      {/* The warehouse HDRI environment was tinting walls DIRECTIONALLY (it's
          brighter on some sides) — removed below. Walls are now lit ONLY by
          the azimuth-uniform ambient + sky hemisphere, so all four sides read
          the EXACT same shade (verified identical). The overhead key adds roof
          form; the ground keeps its soft <ContactShadows>. */}
      <hemisphereLight args={['#eef3f9', '#4a5563', 1.6]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[0, 60, 0.0001]} intensity={0.4} />
      {/* TEST: env removed to check if it's tinting the walls directionally */}
      {/* <Environment preset="warehouse" /> */}
    </>
  );
}

/**
 * CLASSIC ground — contact shadows + ground grid, verbatim, in the same scene
 * order as before (right after the classic lights).
 *
 * The ContactShadows stays MOUNTED for the page's lifetime: while enhanced it
 * is hidden and paused (frames 0 -> its per-frame shadow render never runs),
 * and its props are otherwise untouched, so its render targets are reused on
 * the way back. drei 9.122's ContactShadows never disposes its two render
 * targets or its plane geometry, so remounting it on every Look round trip
 * leaked +2 textures / +1 geometry per cycle. The Grid (disposed by R3F on
 * unmount) is only mounted in classic.
 *
 * Walk-in Interior (classic): InteriorWalk lays a light floor over the
 * footprint, and the infinite grid's huge plane z-fights up through it from
 * eye height, so the grid is HIDDEN (kept mounted, uniforms still updated)
 * while Interior is on. Outside Interior it is exactly as before.
 */
function ClassicGround({ active }: { active: boolean }) {
  const interior = useEditorStore((s) => s.interiorView);
  return (
    <>
      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.45}
        scale={120}
        blur={2.4}
        far={40}
        visible={active}
        frames={active ? Infinity : 0}
      />
      {active && (
        <Grid
          visible={!interior}
          position={[0, 0, 0]}
          args={[200, 200]}
          cellSize={2}
          cellColor="#1e2d42"
          sectionSize={10}
          sectionColor="#2a3d55"
          fadeDistance={140}
          infiniteGrid
        />
      )}
    </>
  );
}

/**
 * The ONE place the scene look branches on the view-only renderStyle flag.
 * Subscribes itself so a Look toggle re-renders only the rig, not the Canvas.
 * Sits before <BuildingModel/> / <CameraRig/> so its effects run first.
 * ENHANCED (src/three/enhanced/EnhancedSceneRig) restores everything it
 * changes on the shared renderer / scene / camera when it unmounts, so
 * switching back to Classic renders the classic look. Its ground + slab are
 * mounted by BuildingModel (outside ShellGroup), also only while enhanced.
 */
function SceneRig() {
  const enhanced = useEditorStore((s) => s.renderStyle) === 'enhanced';
  return (
    <>
      {enhanced ? <EnhancedSceneRig /> : <ClassicSceneRig />}
      <ClassicGround active={!enhanced} />
    </>
  );
}

/**
 * LAYER 3 entry — the responsive 3D viewport.
 *
 * Pure presentation: it owns the camera, lighting, ground, and controls, then
 * drops in <BuildingModel/>, which pulls live geometry from the store. Resizing
 * is handled automatically by R3F's ResizeObserver on the parent container.
 */
export function Viewport() {
  const dragging = useEditorStore((s) => s.dragging);
  const selectOpening = useEditorStore((s) => s.selectOpening);
  // Walk-in Interior view: InteriorWalk owns the camera, the orbit controls rest.
  const interior = useEditorStore((s) => s.interiorView);

  return (
    <div className="relative h-full w-full bg-dark">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [34, 22, -38], fov: 38, near: 0.5, far: 800 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => {
          if (!useEditorStore.getState().dragging) selectOpening(null);
        }}
      >
        {/* Background, fog, lights, contact shadows + ground grid (per Look). */}
        <SceneRig />

        <Suspense fallback={null}>
          <BuildingModel />
        </Suspense>

        <CameraRig />
        <InteriorWalk />
        <CaptureHook />

        <OrbitControls
          makeDefault
          enabled={!dragging && !interior}
          enableDamping
          dampingFactor={0.08}
          // Allow the camera to push right inside the shell so the interior is
          // easy to inspect (Sensei/IdeaRoom-style), not just orbit the outside.
          minDistance={0.6}
          maxDistance={400}
          // Near-full polar range so you can tilt up to the ceiling/trusses and
          // down under the building — true 360 like Sensei (was capped just past
          // horizontal, which made interior views feel stuck).
          minPolarAngle={0.02}
          maxPolarAngle={Math.PI - 0.04}
          target={[0, 5, 0]}
        />
      </Canvas>

      <ViewControls />

      {/* Viewport HUD */}
      <div className="pointer-events-none absolute left-4 top-4 select-none">
        <p className="font-head text-xs uppercase tracking-wide2 text-teal">StormSafe Steel</p>
        <p className="font-head text-[10px] uppercase tracking-brand text-sub">Live Build Preview</p>
        {/* Freshness check — bump this label each deploy so we can confirm the
            browser actually loaded the latest code. */}
        <p className="font-body text-[9px] text-muted">build · roof-overhang-A</p>
      </div>
      <p className="pointer-events-none absolute bottom-3 right-4 select-none font-body text-[11px] text-muted">
        {interior ? 'Drag to look around · scroll to zoom' : 'Drag to orbit · scroll to zoom'}
      </p>
    </div>
  );
}
