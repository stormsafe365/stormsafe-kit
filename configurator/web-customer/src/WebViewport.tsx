/**
 * The customer 3D view: the shared building model in the bright "enhanced"
 * look, the capture tool, orbit / pinch controls — and only customer view
 * controls (Exterior / Structure, camera presets, dimensions). No build
 * label, no Look / Cutaway / Interior switches.
 */
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BuildingModel } from '@/three/BuildingModel';
import { CameraRig } from '@/three/CameraRig';
import { CaptureHook } from '@/three/CaptureHook';
import { EnhancedSceneRig } from '@/three/enhanced/EnhancedSceneRig';
import { useEditorStore } from '@/store/useEditorStore';
import { CameraFit, cameraApi, type FitView } from './cameraFit';

const PRESETS: Array<{ value: FitView; label: string }> = [
  { value: 'iso', label: '3D' },
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
];

function ViewBar() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const showSpacing = useEditorStore((s) => s.showSpacing);
  const setShowSpacing = useEditorStore((s) => s.setShowSpacing);
  return (
    <div className="viewbar" role="toolbar" aria-label="3D view">
      <div className="seg seg-sm" role="group" aria-label="View mode">
        {(['exterior', 'structure'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={viewMode === m} className={viewMode === m ? 'on' : ''} onClick={() => {
              setViewMode(m);
              if (m === 'structure') setTimeout(() => cameraApi.fit('structure'), 30);
            }}>
            {m === 'exterior' ? 'Exterior' : 'Structure'}
          </button>
        ))}
      </div>
      <div className="seg seg-sm cams" role="group" aria-label="Camera">
        {PRESETS.map((p) => (
          <button key={p.value} type="button" onClick={() => cameraApi.fit(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      <button type="button" className={`chip ${showSpacing ? 'on' : ''}`} aria-pressed={showSpacing} onClick={() => setShowSpacing(!showSpacing)}>
        Dimensions
      </button>
    </div>
  );
}

export function WebViewport() {
  const dragging = useEditorStore((s) => s.dragging);
  return (
    <div className="vp">
      <Canvas
        className="vp-canvas"
        shadows
        dpr={[1, 2]}
        camera={{ position: [34, 22, -38], fov: 38, near: 0.5, far: 800 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => {
          const ed = useEditorStore.getState();
          if (ed.dragging) return;
          ed.selectOpening(null);
          ed.selectLeanToOpening(null);
        }}
      >
        <EnhancedSceneRig />
        <Suspense fallback={null}>
          <BuildingModel />
        </Suspense>
        <CameraRig />
        <CaptureHook />
        <CameraFit />
        <OrbitControls
          makeDefault
          enabled={!dragging}
          enableDamping
          dampingFactor={0.08}
          minDistance={1}
          maxDistance={400}
          minPolarAngle={0.02}
          maxPolarAngle={Math.PI / 2}
          target={[0, 5, 0]}
        />
      </Canvas>
      <ViewBar />
      <p className="vp-hint" aria-hidden="true">
        Drag to turn · pinch or scroll to zoom · drag doors to move them
      </p>
    </div>
  );
}
