/**
 * postMessage bridge to the website that embeds the customizer (iframe).
 *
 * In (from the parent page only, from an allowed origin — model/origins.ts):
 *   { type: 'ss-request-design', id?, allViews? }
 *   { type: 'ss-load-design', id?, state }
 * Out (to that origin; "*" only when the parent's origin is "null"):
 *   { type: 'ss-ready', v: 1 }                                        once, on load
 *   { type: 'ss-design', v: 1, id?, state, spec, image, images?, imageSource }
 *   { type: 'ss-design-loaded', v: 1, id?, ok, error? }
 * See README.md for examples.
 */
import type { WebDesign, WebState } from './model/design';
import { originAllowed, replyTarget } from './model/origins';
import { checkState, parseMessage } from './model/validate';
import type { DesignPictures } from './capture';

export interface BridgeDeps {
  allow: readonly string[];
  /** The page that embeds us (window.parent). */
  parent: Pick<Window, 'postMessage'> | null;
  getState: () => WebState;
  getSpec: () => string;
  capture: (allViews: boolean) => Promise<DesignPictures>;
  load: (design: WebDesign) => void;
  setBusy: (msg: string | null) => void;
  warn?: (msg: string) => void;
}

export interface MessageLike {
  data: unknown;
  origin: string;
  source: unknown;
}

/** Handle one message. Resolves once the reply (if any) is posted. */
export async function handleMessage(e: MessageLike, deps: BridgeDeps): Promise<'ignored' | 'refused' | 'replied'> {
  const msg = parseMessage(e.data);
  if (!msg) return 'ignored';
  if (!deps.parent || e.source !== deps.parent) return 'ignored'; // only our own parent page
  if (!originAllowed(e.origin, deps.allow)) {
    deps.warn?.(`StormSafe customizer: ignored "${msg.type}" from ${e.origin} (not an allowed origin — see README)`);
    return 'refused';
  }
  const target = replyTarget(e.origin);
  const idPart = msg.id !== undefined ? { id: msg.id } : {};

  if (msg.type === 'ss-load-design') {
    const chk = checkState(msg.state);
    if (chk.ok) deps.load(chk.design);
    deps.parent.postMessage({ type: 'ss-design-loaded', v: 1, ...idPart, ok: chk.ok, ...(chk.ok ? {} : { error: chk.error }) }, target);
    return 'replied';
  }

  // ss-request-design: the state + spec now (before the camera moves), then the picture.
  const state = deps.getState();
  const spec = deps.getSpec();
  deps.setBusy('Preparing your picture…');
  try {
    const pics = await deps.capture(msg.allViews);
    deps.parent.postMessage(
      { type: 'ss-design', v: 1, ...idPart, state, spec, image: pics.image, ...(pics.images ? { images: pics.images } : {}), imageSource: pics.source },
      target,
    );
  } catch (err) {
    deps.parent.postMessage(
      { type: 'ss-design', v: 1, ...idPart, state, spec, image: null, error: `picture failed: ${err instanceof Error ? err.message : String(err)}` },
      target,
    );
  } finally {
    deps.setBusy(null);
  }
  return 'replied';
}

/** The origin of the page that embeds us, when the browser tells us (document.referrer). */
export function referrerOrigin(referrer: string): string | null {
  try {
    return referrer ? new URL(referrer).origin : null;
  } catch {
    return null;
  }
}

export function installBridge(deps: BridgeDeps, win: Window = window): () => void {
  const onMessage = (e: MessageEvent) => {
    void handleMessage({ data: e.data, origin: e.origin, source: e.source }, deps);
  };
  win.addEventListener('message', onMessage);
  // Tell an allowed embedding page we are ready (it may also just send a request).
  const ref = referrerOrigin(win.document.referrer);
  if (deps.parent && deps.parent !== (win as unknown) && ref && originAllowed(ref, deps.allow)) {
    deps.parent.postMessage({ type: 'ss-ready', v: 1 }, ref);
  }
  return () => win.removeEventListener('message', onMessage);
}
