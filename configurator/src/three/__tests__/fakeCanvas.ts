import { vi } from 'vitest';

/**
 * Minimal stand-in for document.createElement('canvas') + its 2D context, for
 * tests of code that builds CanvasTextures from raw pixels (the test
 * environment is plain node: no DOM, no canvas). Only what
 * enhanced/normalMaps.ts uses: createImageData + putImageData. The pixels a
 * texture was built from can be read back with pixelsOf(texture.image).
 * Undo with vi.unstubAllGlobals().
 */
export function installFakeCanvas() {
  let count = 0;
  const store = new WeakMap<object, Uint8ClampedArray>();
  const createElement = (tag: string) => {
    if (tag !== 'canvas') throw new Error('fake document: only <canvas> is supported, got ' + tag);
    count++;
    const canvas = { width: 0, height: 0, getContext: (_kind: string) => ctx };
    const ctx = {
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        store.set(canvas, img.data);
      },
    };
    return canvas;
  };
  vi.stubGlobal('document', { createElement });
  return {
    /** Canvases created so far. */
    created: () => count,
    /** The pixels last put into a fake canvas. */
    pixelsOf: (canvas: unknown) => {
      const p = store.get(canvas as object);
      if (!p) throw new Error('not a fake canvas with pixels');
      return p;
    },
  };
}
