/**
 * Customer web customizer entry (stormsafesteel.com/customize).
 * Built by vite.web.config.ts only — the desktop / CRM builds never see it.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installSync } from './sync';
import { installBridge } from './bridge';
import { captureDesign } from './capture';
import { parseParams } from './model/params';
import { parseAllowList } from './model/origins';
import { buildSpec } from './model/spec';
import { currentState, useWebStore } from './store';
import { parseToken } from './model/link';
import { checkLink } from './send';
import { keepDraft, restoreDraft, saveDraftNow } from './draft';
import { installFreshness } from './freshness';
import './styles.css';

// Where the visitor is: ?zip=…&county=…&impact=1
useWebStore.getState().setCtx(parseParams(window.location.search));
{
  const { zip, county } = useWebStore.getState().ctx;
  // The ZIP box shows the website's ZIP; a ZIP without a county finds its county (and impact rule).
  if (zip && !county) useWebStore.getState().setZip(zip);
  else if (zip) useWebStore.getState().setContact({ zip });
}

// The rep's personal design link (?t=…): check it now, so an expired link is
// said up front, not after the customer has designed the whole building.
const token = parseToken(window.location.search);
// Work in progress survives a reload / closed tab (this browser only).
restoreDraft(token);
keepDraft(token);
// An old tab coming back to the screen picks up a newer version of this page (the draft comes back).
installFreshness({ busy: () => !!useWebStore.getState().busy, save: () => saveDraftNow(token) });
// The page going to the background (the phone number tapped, the app switched): save now, not 400 ms later.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveDraftNow(token);
});
window.addEventListener('pagehide', () => saveDraftNow(token));
if (token) {
  useWebStore.getState().setLink(token, 'checking');
  void checkLink(token).then((status) => useWebStore.getState().setLink(token, status));
}

// Design → 3D (and 3D drags → design).
installSync();

// Touch: a cancelled pointer (scroll / gesture takeover) must still end a door
// drag — the 3D drag code listens for pointerup only.
window.addEventListener('pointercancel', (e) => {
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY }));
});

const allow = parseAllowList(import.meta.env.VITE_SS_ALLOWED_ORIGINS as string | undefined);
installBridge({
  allow,
  parent: window.parent !== window ? window.parent : null,
  getState: currentState,
  getSpec: () => {
    const { design, ctx, impact } = useWebStore.getState();
    return buildSpec(design, { zip: ctx.zip, county: ctx.county, impact });
  },
  capture: captureDesign,
  load: (design) => useWebStore.getState().replace(design),
  setBusy: (m) => useWebStore.getState().setBusy(m),
  warn: (m) => console.warn(m),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
