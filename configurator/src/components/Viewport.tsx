import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Grid, OrbitControls, ContactShadows } from '@react-three/drei';
import { BuildingModel } from '@/three/BuildingModel';
import { CameraRig } from '@/three/CameraRig';
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
        camera={{ position: [34, 22, 38], fov: 38, near: 0.5, far: 400 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => {
          if (!useEditorStore.getState().dragging) selectOpening(null);
        }}
      >
        <color attach="background" args={['#08121d']} />
        <fog attach="fog" args={['#08121d', 80, 200]} />

        {/* Soft, diffuse lighting for powder-coated steel (no glossy hot-spots) */}
        <hemisphereLight args={['#dfe7f0', '#3a4250', 0.7]} />
        <ambientLight intensity={0.3} />
        <directionalLight
          position={[28, 38, 22]}
          intensity={0.95}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-camera-left={-60}
          shadow-camera-right={60}
          shadow-camera-top={60}
          shadow-camera-bottom={-60}
        />
        {/* Cool fill from the opposite side to round out shadows */}
        <directionalLight position={[-26, 18, -22]} intensity={0.35} color="#cdd8e6" />

        <Suspense fallback={null}>
          <BuildingModel />
          <Environment preset="warehouse" />
        </Suspense>

        <CameraRig />

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
          minDistance={12}
          maxDistance={120}
          maxPolarAngle={Math.PI / 2.05}
          target={[0, 5, 0]}
        />
      </Canvas>

      <ViewControls />

      {/* Viewport HUD */}
      <div className="pointer-events-none absolute left-4 top-4 select-none">
        <p className="font-head text-xs uppercase tracking-wide2 text-teal">StormSafe Steel</p>
        <p className="font-head text-[10px] uppercase tracking-brand text-sub">Live Build Preview</p>
      </div>
      <p className="pointer-events-none absolute bottom-3 right-4 select-none font-body text-[11px] text-muted">
        Drag to orbit · scroll to zoom
      </p>
    </div>
  );
}
