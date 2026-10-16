/**
 * The customer 3D view: the shared building model in the bright "enhanced"
 * look, the capture tool, orbit / pinch controls — and only customer view
 * controls (Exterior / Structure, camera presets, dimensions). No build
 * label, no Look / Cutaway / Interior switches.
 */
import { Suspense, useEffect, useId, useRef, useState } from 'react';
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

/**
 * Phones: the six camera buttons do not fit across, so one "View" button opens them as a short list.
 * (Not a native picker: iPhones zoom the page into a picker with small text.) The list is drawn
 * outside the side-scrolling bar so the bar never clips it.
 */
function useViewMenu() {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!at) return;
    const inside = (t: EventTarget | null) => !!t && (!!list.current?.contains(t as Node) || !!btn.current?.contains(t as Node));
    const off = (e: PointerEvent) => {
      if (!inside(e.target)) setAt(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAt(null);
        btn.current?.focus();
      }
    };
    // keyboard / screen reader moving on (Tab) past the list closes it
    const away = (e: FocusEvent) => {
      if (e.relatedTarget && !inside(e.relatedTarget)) setAt(null);
    };
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('keydown', esc);
    list.current?.addEventListener('focusout', away);
    const el = list.current;
    list.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', off, true);
      document.removeEventListener('keydown', esc);
      el?.removeEventListener('focusout', away);
    };
  }, [at]);
  const toggle = () => {
    if (at) return setAt(null);
    const b = btn.current;
    const vp = b?.closest('.vp');
    if (!b || !vp) return;
    const r = b.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left - v.left, v.width - 160)), top: r.bottom - v.top + 6 });
  };
  // after a pick, focus goes back to the View button (screen readers / keyboards keep their place)
  const pick = () => {
    setAt(null);
    btn.current?.focus();
  };
  return { at, btn, list, id, toggle, pick };
}

function ViewBar({ menu }: { menu: ReturnType<typeof useViewMenu> }) {
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
      <button
        type="button"
        className="cams-menu-btn"
        ref={menu.btn}
        aria-expanded={!!menu.at}
        aria-controls={menu.id}
        aria-label="View: turn the camera to a side"
        onClick={menu.toggle}
      >
        View
      </button>
      <button type="button" className={`chip ${showSpacing ? 'on' : ''}`} aria-pressed={showSpacing} onClick={() => setShowSpacing(!showSpacing)}>
        Dimensions
      </button>
    </div>
  );
}

export function WebViewport() {
  const dragging = useEditorStore((s) => s.dragging);
  const menu = useViewMenu();
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
      <ViewBar menu={menu} />
      {menu.at && (
        <div className="cams-menu" id={menu.id} ref={menu.list} style={{ left: menu.at.left, top: menu.at.top }} role="group" aria-label="Camera">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                cameraApi.fit(p.value);
                menu.pick();
              }}
            >
              {p.value === 'iso' ? '3D (corner)' : p.label}
            </button>
          ))}
        </div>
      )}
      <p className="vp-hint" aria-hidden="true">
        <span className="hint-long">Drag to turn · pinch or scroll to zoom · drag doors to move them</span>
        <span className="hint-short">Drag to turn · pinch to zoom</span>
      </p>
    </div>
  );
}
