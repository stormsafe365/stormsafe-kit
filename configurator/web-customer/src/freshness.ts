/**
 * A phone keeps a page open for days; a customer (or the owner, 10/16/26) who comes back to an old
 * tab would still see an old version of this page. When the page is shown again, it checks whether
 * a newer version is on the site and, if so, reloads - the design in progress is saved on the phone
 * first (draft.ts) and comes straight back. Never while sending or while a box is being typed in.
 */
export function installFreshness(opts: { busy: () => boolean; save: () => void }) {
  const mine = (document.querySelector('script[type="module"][src*="assets/index-"]') as HTMLScriptElement | null)?.src;
  if (!mine) return; // the dev server (no built bundle): nothing to compare
  let last = 0;
  let checking = false;
  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((a as HTMLInputElement).type)));
  };
  const check = async () => {
    if (checking || document.visibilityState !== 'visible' || Date.now() - last < 30_000) return;
    checking = true;
    last = Date.now();
    try {
      const res = await fetch(new URL('./', window.location.href).href, { cache: 'no-store' });
      if (!res.ok) return;
      const m = /src="([^"]*assets\/index-[^"]+\.js)"/.exec(await res.text());
      if (!m) return;
      const latest = new URL(m[1], window.location.href).href;
      if (latest === mine || opts.busy() || typing()) return;
      opts.save();
      window.location.reload();
    } catch {
      /* offline / blocked: keep the page as it is */
    } finally {
      checking = false;
    }
  };
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('focus', () => void check());
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) void check();
  });
}
