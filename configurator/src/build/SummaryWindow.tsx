import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useProgramBridge } from './programBridge';

/**
 * The quote summary as a window you can move anywhere on the build page (owner 11/3/26: "I should be able to move the total
 * view around the whole page so its not obstructing a view i dont want it to").
 *
 * The program's TOTAL ▾ button (its narrow layout: the CRM's 3D Builder pane) opens this window instead of the program's
 * own drop-down, which can never leave the program's pane. The window shows a LIVE copy of the program's summary column
 * (.right: elevation drawing, client / building summary, price breakdown, PDF options, its buttons), re-copied after
 * every change. It prices nothing and keeps no data of its own: a click on a tab, an option or a button presses the
 * program's own element (the copy remembers which real element each of its nodes came from), so Save / Print PDF,
 * Generate Contract etc. run exactly as from the program — the CRM's own hooks on those buttons included. Drag it by its
 * title bar, resize it from its corner; where you leave it is remembered in this browser.
 */

interface WinState {
  open: boolean;
  setOpen: (open: boolean) => void;
}
export const useSummaryWindow = create<WinState>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const KEY = 'ss_summary_window';
interface Box { x: number; y: number; w: number; h: number }
// first time: just right of the program's form (its pane is at most 560 px wide), so it covers neither the form nor the View box
const DEFAULT_BOX = (): Box => ({ x: 576, y: 64, w: 380, h: Math.max(320, Math.round(window.innerHeight * 0.72)) });
function readBox(): Box {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (b && [b.x, b.y, b.w, b.h].every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return b;
  } catch {
    /* blocked storage: the default spot */
  }
  return DEFAULT_BOX();
}
function saveBox(b: Box) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}
/** Keep the whole window on the page (its title bar and its resize corner always reachable). */
function clamp(b: Box): Box {
  const W = window.innerWidth, H = window.innerHeight;
  const w = Math.min(Math.max(280, b.w), Math.max(280, W - 16));
  const h = Math.min(Math.max(160, b.h), Math.max(160, H - 16));
  return { w, h, x: Math.min(Math.max(8, b.x), Math.max(8, W - w - 8)), y: Math.min(Math.max(8, b.y), Math.max(8, H - h - 8)) };
}

/** Wire the program's TOTAL button to this window (BuildHost calls it once the program has loaded). */
export function hookProgramTotal(win: Window) {
  const w = win as unknown as { toggleMobileSummary?: () => void; __ssTotalHooked?: boolean };
  if (w.__ssTotalHooked || typeof w.toggleMobileSummary !== 'function') return;
  w.__ssTotalHooked = true;
  w.toggleMobileSummary = () => {
    const s = useSummaryWindow.getState();
    s.setOpen(!s.open);
  };
}

/** The program's CSS for the copy: its own <style> blocks, :root variables moved onto the window, its desktop column look. */
function programCss(doc: Document): string {
  const css = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent || '').join('\n');
  return (
    css.replace(/:root\b/g, ':host') +
    '\n.ss-sum{font-family:var(--b),Inter,Arial,sans-serif;font-size:14px;color:var(--tx);-webkit-font-smoothing:antialiased}' +
    '\n.ss-sum .right{display:block!important;max-height:none!important;overflow:visible!important;padding:12px 14px 16px;background:var(--d2);border:0}' +
    '\n.ss-sum [data-ss-crm-hidden]{display:none!important}' +
    '\n.ss-sum select{min-width:0;max-width:100%}'
  );
}

/** A deep copy of `src` + a map from every copied node back to the program's real node. */
function copyOf(src: Element, map: WeakMap<Node, Node>): Element {
  const out = src.cloneNode(true) as Element;
  const walk = (a: Node, b: Node) => {
    map.set(b, a);
    // the program's inline handlers never run on this page: they are taken off the copy (a click presses the real element)
    if (b.nodeType === 1) {
      const el = b as Element;
      for (const at of Array.from(el.attributes)) {
        if (/^on/i.test(at.name)) {
          if (at.name.toLowerCase() === 'onclick') el.setAttribute('data-ss-click', '1');
          el.removeAttribute(at.name);
        } else if (at.name === 'href' && /^\s*javascript:/i.test(at.value)) el.setAttribute('href', '#');
      }
    }
    const ac = a.childNodes, bc = b.childNodes;
    for (let i = 0; i < ac.length && i < bc.length; i++) walk(ac[i], bc[i]);
  };
  walk(src, out);
  // live state the copy does not carry: picked options, typed values, ticks; a canvas becomes its picture
  out.querySelectorAll('select, input, textarea, canvas').forEach((n) => {
    const real = map.get(n) as HTMLElement | undefined;
    if (!real) return;
    if (n.tagName === 'CANVAS') {
      try {
        const img = n.ownerDocument.createElement('img');
        img.src = (real as HTMLCanvasElement).toDataURL();
        img.style.maxWidth = '100%';
        n.replaceWith(img);
      } catch {
        /* leave the empty canvas */
      }
      return;
    }
    (n as HTMLInputElement).value = (real as HTMLInputElement).value;
    if ((n as HTMLInputElement).type === 'checkbox' || (n as HTMLInputElement).type === 'radio') (n as HTMLInputElement).checked = (real as HTMLInputElement).checked;
  });
  return out;
}

export function SummaryWindow() {
  const win = useProgramBridge((s) => s.win);
  const open = useSummaryWindow((s) => s.open);
  const setOpen = useSummaryWindow((s) => s.setOpen);
  const [box, setBox] = useState<Box>(() => clamp(readBox()));
  const [folded, setFolded] = useState(false);
  const [total, setTotal] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // the program's TOTAL button shows whether the window is open
  useEffect(() => {
    try {
      const b = win && win.document.getElementById('summary-toggle');
      if (b) {
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.classList.toggle('open', open);
      }
    } catch {
      /* ignore */
    }
  }, [win, open]);

  // the live copy
  useEffect(() => {
    if (!open || !win || !hostRef.current) return;
    let doc: Document;
    try {
      doc = win.document;
    } catch {
      return;
    }
    const src = doc.querySelector('.right');
    if (!src) return;
    const host = hostRef.current;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = programCss(doc);
    const wrap = document.createElement('div');
    wrap.className = 'ss-sum';
    root.append(style, wrap);
    let map = new WeakMap<Node, Node>();
    // re-copied at most every 60 ms after a change (a timer, not an animation frame: those stop while the tab is hidden)
    let raf = 0;
    const paint = () => {
      raf = 0;
      const sc = bodyRef.current ? bodyRef.current.scrollTop : 0;
      map = new WeakMap<Node, Node>();
      wrap.replaceChildren(document.adoptNode(copyOf(src, map)));
      if (bodyRef.current) bodyRef.current.scrollTop = sc;
      const t = doc.getElementById('mob-total') || doc.getElementById('ptot');
      setTotal(t ? (t.textContent || '').trim() : '');
    };
    const schedule = () => {
      if (!raf) raf = window.setTimeout(paint, 60);
    };
    paint();
    const mo = new MutationObserver(schedule);
    mo.observe(src, { subtree: true, childList: true, attributes: true, characterData: true });
    const tot = doc.getElementById('mob-total');
    if (tot) mo.observe(tot, { subtree: true, childList: true, characterData: true });
    // a press in the copy = the program's own element
    const real = (n: EventTarget | null): HTMLElement | null => {
      let el = n as Node | null;
      while (el && el !== wrap) {
        const r = map.get(el) as HTMLElement | undefined;
        if (r && r.isConnected) return r;
        el = el.parentNode;
      }
      return null;
    };
    const onClick = (e: Event) => {
      const t = e.target as Element;
      const hit = t.closest && t.closest('button, a, label, input[type="checkbox"], input[type="radio"], [data-ss-click]');
      if (!hit || !wrap.contains(hit)) return;
      if (hit.tagName === 'LABEL') {
        const f = hit.getAttribute('for');
        const r = f ? doc.getElementById(f) : null;
        e.preventDefault();
        if (r) r.click();
        schedule();
        return;
      }
      const r = real(hit);
      e.preventDefault();
      if (r) r.click();
      schedule();
    };
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (!t || (t.tagName !== 'SELECT' && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) return;
      if ((t as HTMLInputElement).type === 'checkbox' || (t as HTMLInputElement).type === 'radio') return; // the click did it
      const r = real(t) as HTMLInputElement | HTMLSelectElement | null;
      if (!r) return;
      r.value = t.value;
      r.dispatchEvent(new Event('input', { bubbles: true }));
      if (e.type === 'change') r.dispatchEvent(new Event('change', { bubbles: true }));
      schedule();
    };
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onChange);
    return () => {
      mo.disconnect();
      if (raf) clearTimeout(raf);
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onChange);
    };
  }, [open, win]);

  // on screen each time it opens (the page may have changed size since it was last moved)
  useEffect(() => {
    if (open) setBox((b) => clamp(b));
  }, [open]);

  // keep it on screen when the page is resized
  useEffect(() => {
    const onResize = () => setBox((b) => clamp(b));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Esc closes it (from the 3D page; the program's own Esc only folds its own drop-down)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open || !win) return null;

  const drag = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, b0 = box;
    const shield = document.createElement('div'); // the iframes would swallow the pointer otherwise
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:grabbing';
    document.body.appendChild(shield);
    const move = (ev: PointerEvent) => setBox(clamp({ ...b0, x: b0.x + ev.clientX - sx, y: b0.y + ev.clientY - sy }));
    const up = (ev: PointerEvent) => {
      shield.remove();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const nb = clamp({ ...b0, x: b0.x + ev.clientX - sx, y: b0.y + ev.clientY - sy });
      setBox(nb);
      saveBox(nb);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, b0 = box;
    const shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:nwse-resize';
    document.body.appendChild(shield);
    const at = (ev: PointerEvent) => clamp({ ...b0, w: b0.w + ev.clientX - sx, h: b0.h + ev.clientY - sy });
    const move = (ev: PointerEvent) => setBox(at(ev));
    const up = (ev: PointerEvent) => {
      shield.remove();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const nb = at(ev);
      setBox(nb);
      saveBox(nb);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudge = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 40 : 10;
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
    const v = m[e.key];
    if (!v) return;
    e.preventDefault();
    const nb = clamp({ ...box, x: box.x + v[0], y: box.y + v[1] });
    setBox(nb);
    saveBox(nb);
  };

  return (
    <div
      role="dialog"
      aria-label="Quote summary"
      style={{
        position: 'fixed',
        left: box.x,
        top: box.y,
        width: box.w,
        height: folded ? undefined : box.h,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1820',
        border: '1.5px solid #22d3c8',
        borderRadius: 10,
        boxShadow: '0 18px 50px rgba(0,0,0,.6)',
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        onPointerDown={drag}
        onKeyDown={nudge}
        tabIndex={0}
        title="Drag to move it anywhere (arrow keys nudge it)"
        aria-label="Move the quote summary"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 12px', background: '#081b24', borderBottom: folded ? 'none' : '1px solid #1e2d42', cursor: 'grab', userSelect: 'none', flex: 'none' }}
      >
        <span aria-hidden="true" style={{ color: '#64748b', fontSize: 14, letterSpacing: -2 }}>⋮⋮</span>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', color: '#22d3c8' }}>TOTAL</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{total || '—'}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setFolded(!folded)} aria-label={folded ? 'Show the summary' : 'Fold the summary to its title bar'} title={folded ? 'Show' : 'Fold'} style={btn}>
          {folded ? '▾' : '▴'}
        </button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the quote summary" title="Close (Esc)" style={btn}>
          ×
        </button>
      </div>
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', display: folded ? 'none' : 'block' }}>
        <div ref={hostRef} />
      </div>
      {!folded && (
        <div
          onPointerDown={resize}
          aria-hidden="true"
          title="Drag to resize"
          style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, #22d3c8 50%)', opacity: 0.7 }}
        />
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #2a3d55',
  borderRadius: 6,
  background: '#1a2436',
  color: '#94a3b8',
  fontSize: 15,
  lineHeight: 1,
  cursor: 'pointer',
};
