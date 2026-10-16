/**
 * The design picture: the existing capture tool (src/three/CaptureHook —
 * window.__ssCapture3D) on the light theme (light background, bright even
 * lighting, silhouette outline), the ISO view downscaled to a JPEG small
 * enough to post to the website and attach to a lead.
 *
 * The full capture renders five 3200 px views; on a phone that can fail for
 * memory. Then the live canvas is used instead (same ISO framing, the page's
 * own background) so a request never comes back without a picture.
 */
import { useEditorStore } from '@/store/useEditorStore';

type CaptureFn = (opts?: { theme?: 'dark' | 'light' }) => Promise<Record<string, string>>;

export const IMAGE_MAX_W = 1600;
export const VIEW_MAX_W = 1200;
export const JPEG_QUALITY = 0.85;
const CAPTURE_TIMEOUT_MS = 45000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('capture timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Load a data URL and redraw it as a JPEG no wider than maxW. */
export async function toJpeg(src: string, maxW: number, quality = JPEG_QUALITY): Promise<string> {
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
  const k = Math.min(1, maxW / (img.naturalWidth || maxW));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  ctx.fillStyle = '#f3f6f8'; // the light capture background (JPEG has no transparency)
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const out = c.toDataURL('image/jpeg', quality);
  c.width = c.height = 0;
  return out;
}

export interface DesignPictures {
  image: string;
  images?: Record<'iso' | 'front' | 'back' | 'left' | 'right', string>;
  /** 'capture' = the capture tool; 'live' = the live-canvas fallback. */
  source: 'capture' | 'live';
}

async function liveFallback(): Promise<DesignPictures> {
  const setView = (window as unknown as { __ssSetViewInstant?: (p: string) => void }).__ssSetViewInstant;
  if (setView) setView('iso');
  else useEditorStore.getState().goToView('iso');
  await sleep(250);
  const canvas = document.querySelector<HTMLCanvasElement>('.vp canvas') ?? document.querySelector('canvas');
  if (!canvas) throw new Error('3D view not ready');
  return { image: await toJpeg(canvas.toDataURL('image/png'), IMAGE_MAX_W), source: 'live' };
}

/**
 * A picture with nothing in it (one flat color, or a tiny default-size canvas):
 * the 3D did not draw (a page in the background, a lost graphics context).
 */
export async function isBlankImage(src: string): Promise<boolean> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
  if (img.naturalWidth < 400 || img.naturalHeight < 200) return true;
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 24;
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo < 8;
}

let inFlight: Promise<DesignPictures> | null = null;

/** One capture at a time: a second request while one runs gets the same pictures. */
export function captureDesign(allViews: boolean): Promise<DesignPictures> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const ed = useEditorStore.getState();
    ed.selectOpening(null);
    ed.selectLeanToOpening(null);
    const cap = (window as unknown as { __ssCapture3D?: CaptureFn }).__ssCapture3D;
    try {
      if (!cap) throw new Error('capture tool not ready');
      const shots = await withTimeout(cap({ theme: 'light' }), CAPTURE_TIMEOUT_MS);
      if (!shots.iso) throw new Error('no picture');
      const image = await toJpeg(shots.iso, IMAGE_MAX_W);
      if (!allViews) return { image, source: 'capture' as const };
      const images = { iso: image } as NonNullable<DesignPictures['images']>;
      // The capture's 'left' view looks at the 3D −X wall = the customer's RIGHT
      // side (left / right are named from the front, like the program) — swap.
      const SRC = { front: 'front', back: 'back', left: 'right', right: 'left' } as const;
      for (const v of ['front', 'back', 'left', 'right'] as const) if (shots[SRC[v]]) images[v] = await toJpeg(shots[SRC[v]], VIEW_MAX_W);
      return { image, images, source: 'capture' as const };
    } catch {
      return liveFallback();
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
