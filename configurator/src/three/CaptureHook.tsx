import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useEditorStore } from '@/store/useEditorStore';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exposes window.__ssCapture3D() — used by the pricing program's PDF export to
 * embed the live 3D modeler. Cycles the camera through ISO + the four
 * elevations, lets each framing settle, and snapshots the canvas as a PNG data
 * URL (the Canvas is created with preserveDrawingBuffer, so toDataURL works).
 * Restores the ISO view afterward. Returns { iso, front, back, left, right }.
 */
export function CaptureHook() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const w = window as unknown as {
      __ssCapture3D?: () => Promise<Record<string, string>>;
      __ssSetViewInstant?: (p: string) => void;
    };
    w.__ssCapture3D = async () => {
      const setView = w.__ssSetViewInstant;
      const goToView = useEditorStore.getState().goToView;
      const views = ['iso', 'front', 'back', 'left', 'right'] as const;
      const out: Record<string, string> = {};
      for (const v of views) {
        if (setView) setView(v);
        else goToView(v);
        await sleep(140); // a couple frames for R3F to render the new camera
        gl.render(scene, camera); // guarantee the freshest frame is in the buffer
        out[v] = gl.domElement.toDataURL('image/png');
      }
      if (setView) setView('iso');
      else goToView('iso');
      return out;
    };
    return () => {
      delete w.__ssCapture3D;
    };
  }, [gl, scene, camera]);

  return null;
}
