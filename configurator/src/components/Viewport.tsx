import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, ContactShadows } from '@react-three/drei';
import { BuildingModel } from '@/three/BuildingModel';
import { CameraRig } from '@/three/CameraRig';
import { CaptureHook } from '@/three/CaptureHook';
import { ViewControls } from '@/components/ViewControls';
import { useEditorStore } from '@/store/useEditorStore';

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

        <Suspense fallback={null}>
          <BuildingModel />
          {/* TEST: env removed to check if it's tinting the walls directionally */}
          {/* <Environment preset="warehouse" /> */}
        </Suspense>

        <CameraRig />
        <CaptureHook />

        <ContactShadows position={[0, 0.01, 0]} opacity={0.45} scale={120} blur={2.4} far={40} />
        <Grid
          position={[0, 0, 0]}
          args={[200, 200]}
          cellSize={2}
          cellColor="#1e2d42"
          sectionSize={10}
          sectionColor="#2a3d55"
          fadeDistance={140}
          infiniteGrid
        />

        <OrbitControls
          makeDefault
          enabled={!dragging}
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
        Drag to orbit · scroll to zoom
      </p>
    </div>
  );
}
