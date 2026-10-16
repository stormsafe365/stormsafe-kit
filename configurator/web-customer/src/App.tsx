import { useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { WebViewport } from './WebViewport';
import { useWebStore, type TabKey } from './store';
import { DEFAULT_DESIGN, hasWalkDoorOrWindow, TYPE_LABEL } from './model/design';
import { SizePanel } from './panels/SizePanel';
import { WallsPanel } from './panels/WallsPanel';
import { OpeningsPanel } from './panels/OpeningsPanel';
import { LeanTosPanel } from './panels/LeanTosPanel';
import { ColorsPanel } from './panels/ColorsPanel';
import { SendPanel } from './panels/SendPanel';
import { UpgradesPanel } from './panels/UpgradesPanel';
import { ft } from './panels/ui';
import { cameraApi } from './cameraFit';

// The steps, in order (owner 10/16/26: building type + size, components, add-ons /
// upgrades, colors, then the customer's contact + "Send to my steel building rep").
const TABS: Array<{ key: TabKey; label: string; title: string }> = [
  { key: 'size', label: 'Size', title: 'Building type, size & roof' },
  { key: 'walls', label: 'Walls', title: 'Walls' },
  { key: 'doors', label: 'Doors', title: 'Doors & windows' },
  { key: 'leantos', label: 'Lean-tos', title: 'Lean-tos' },
  { key: 'upgrades', label: 'Upgrades', title: 'Upgrades' },
  { key: 'colors', label: 'Colors', title: 'Colors' },
  { key: 'send', label: 'Send', title: 'Send to your rep' },
];

/** Inside a website frame without a rep's link the website sends the design itself: no Send step there. */
const FRAMED = typeof window !== 'undefined' && window.parent !== window;
function useSteps() {
  const token = useWebStore((s) => s.token);
  return token || !FRAMED ? TABS : TABS.filter((t) => t.key !== 'send');
}

/**
 * What each step is for, in plain words, shown at the top of the step (walkthroughs 10/16/26: "nothing
 * tells me what to do or how many steps there are"; Lean-tos and Upgrades are optional).
 */
const STEP_HELP: Record<TabKey, { text: string; optional?: boolean }> = {
  size: { text: 'Pick the kind of building and its size. You can change anything later.' },
  walls: { text: 'Choose which sides are closed in. A garage usually keeps all four closed, so you can just tap Next.' },
  doors: { text: 'Add garage doors, walk-in doors and windows: pick what, pick the wall, then tap Add.' },
  leantos: { text: 'A lean-to is an extra covered area on one side - a carport, porch or storage room. Skip it if you do not need one.', optional: true },
  upgrades: { text: 'Leave these off if you are not sure; your rep will go over them with you.', optional: true },
  colors: { text: 'Pick colors for the roof, the walls and the trim (the edges and corners).' },
  send: { text: 'Add your name and a phone number or email, then send your design to your rep. It is free.' },
};

function StepHead() {
  const tab = useWebStore((s) => s.tab);
  const steps = useSteps();
  const i = steps.findIndex((t) => t.key === tab);
  if (i < 0) return null;
  const help = STEP_HELP[tab];
  return (
    <div className="stephead">
      <div className="stephead-count">
        Step {i + 1} of {steps.length}
        {help.optional ? <span className="stephead-opt"> · optional</span> : null}
      </div>
      <h2 className="stephead-title">{steps[i].title}</h2>
      <p className="stephead-text">{help.text}</p>
    </div>
  );
}

/** Back / Next, kept at the bottom of the options on every step ("Next: Walls"). */
function StepNav() {
  const tab = useWebStore((s) => s.tab);
  const setTab = useWebStore((s) => s.setTab);
  const steps = useSteps();
  const i = steps.findIndex((t) => t.key === tab);
  const prev = i > 0 ? steps[i - 1] : null;
  const next = i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
  // an optional step with nothing added says Skip (walkthroughs 10/16/26: 'do I have to fill this in?')
  const d = useWebStore((s) => s.design);
  const skipping = (tab === 'leantos' && d.leanTos.length === 0) || (tab === 'upgrades' && !Object.values(d.upgrades || {}).some((v) => v && v !== 'none'));
  return (
    <div className="stepnav">
      {prev ? (
        <button type="button" className="btn-ghost" onClick={() => setTab(prev.key)}>
          ← Back
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button type="button" className="btn-primary" onClick={() => setTab(next.key)}>
          {skipping ? `Skip: ${next.title} →` : next.key === 'send' ? 'Next: Send to your rep →' : `Next: ${next.title} →`}
        </button>
      ) : null}
    </div>
  );
}

/** A link that is expired / turned off: say so up front (designing still works). */
function LinkBanner() {
  const link = useWebStore((s) => s.link);
  if (link !== 'expired' && link !== 'invalid') return null;
  return (
    <div className="impact" role="status">
      <strong>{link === 'expired' ? 'This design link has expired.' : 'This design link is not active.'}</strong> Call or text{' '}
      <a href="tel:+15617715555">561-771-5555</a> for a new one.
    </div>
  );
}

function ImpactBanner() {
  const impact = useWebStore((s) => s.impact);
  const county = useWebStore((s) => s.ctx.county);
  const hasRated = useWebStore((s) => hasWalkDoorOrWindow(s.design));
  if (!impact) return null;
  return (
    <div className="impact" role="status">
      <strong>Hi-Impact area.</strong> {county ? `In ${county} County, your building` : 'In your area, your building'} uses impact-rated windows
      and walk-in doors; {hasRated ? 'this design shows them.' : 'any you add here are the impact-rated ones.'}
    </div>
  );
}

function Summary() {
  const d = useWebStore((s) => s.design);
  return (
    <p className="summary" aria-live="polite">
      <span className="summary-dims">
        {ft(d.width)} W × {ft(d.length)} L × {ft(d.height)} H
      </span>
      <span className="summary-type">{TYPE_LABEL[d.type]}</span>
      {d.leanTos.length > 0 && <span className="summary-type">+ {d.leanTos.length === 1 ? '1 lean-to' : `${d.leanTos.length} lean-tos`}</span>}
    </p>
  );
}

/** Phones: the size line sits on the model (the top bar is one slim row there). Screen readers use the top bar's. */
function StageSummary() {
  const d = useWebStore((s) => s.design);
  const lean = d.leanTos.length === 0 ? '' : d.leanTos.length === 1 ? ' + 1 lean-to' : ` + ${d.leanTos.length} lean-tos`;
  return (
    <p className="vp-summary" aria-hidden="true">
      <b>
        {ft(d.width)} W × {ft(d.length)} L × {ft(d.height)} H
      </b>{' '}
      · {TYPE_LABEL[d.type]}
      {lean}
    </p>
  );
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll the panel (only the panel) so `el` is in view. scrollIntoView would also move the
 *  page itself on a phone, which then stays slid up behind overflow: hidden. */
function revealInPanel(panel: HTMLElement, el: HTMLElement) {
  const p = panel.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  let dy = 0;
  if (e.top < p.top) dy = e.top - p.top - 8;
  else if (e.bottom > p.bottom) dy = Math.min(e.bottom - p.bottom + 8, e.top - p.top - 8);
  if (dy) panel.scrollTo({ top: panel.scrollTop + dy, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

/** Scroll the step bar (only the bar) sideways so the current step shows. */
function revealInBar(bar: HTMLElement, el: HTMLElement) {
  const b = bar.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  if (e.left < b.left) bar.scrollLeft -= b.left - e.left + 12;
  else if (e.right > b.right) bar.scrollLeft += e.right - b.right + 12;
}

/** A box the person types in (a keyboard comes up) - not a switch / checkbox / slider. */
const isTextEntry = (a: Element | null): a is HTMLElement => {
  if (!a) return false;
  if (a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable) return true;
  if (a.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden'].includes((a as HTMLInputElement).type);
};
const pinchZoomed = () => {
  const vv = window.visualViewport;
  return !!vv && Math.abs(vv.scale - 1) > 0.01;
};

/**
 * Phones: if the browser ever leaves the PAGE (or the page box) scrolled - a keyboard opening and
 * closing, a field scrolled into view - put it back: only the panel scrolls. Not while a box is
 * being typed in (that would hide it under the keyboard) and not while two-finger zoomed (on an
 * iPhone a zoomed pan moves the page scroll; that is the person looking around).
 */
function usePageStaysPut() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (isTextEntry(document.activeElement) || pinchZoomed()) return;
        const se = document.scrollingElement || document.documentElement;
        if (window.scrollX || window.scrollY || se.scrollTop || se.scrollLeft || document.body.scrollTop) {
          window.scrollTo(0, 0);
          se.scrollTop = 0;
          se.scrollLeft = 0;
          document.body.scrollTop = 0;
        }
        const app = document.querySelector<HTMLElement>('.app');
        if (app && (app.scrollTop || app.scrollLeft)) {
          app.scrollTop = 0;
          app.scrollLeft = 0;
        }
      }, 250);
    };
    const vv = window.visualViewport;
    window.addEventListener('focusout', settle);
    window.addEventListener('resize', settle);
    window.addEventListener('orientationchange', settle);
    window.addEventListener('scroll', settle, { passive: true });
    vv?.addEventListener('resize', settle);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focusout', settle);
      window.removeEventListener('resize', settle);
      window.removeEventListener('orientationchange', settle);
      window.removeEventListener('scroll', settle);
      vv?.removeEventListener('resize', settle);
    };
  }, []);
}

/**
 * Phones: the page box follows the part of the screen the person can actually SEE (the "visual
 * viewport"). An Android / iPhone keyboard shrinks and shifts that area, and some phones leave it
 * shifted after the keyboard closes (owner 10/16/26: the page stayed slid up with an empty band
 * below). Following it keeps the whole design page in view either way - with the keyboard up, the
 * page fits above it and the box being typed in stays in sight. Not while the person has zoomed the
 * page with two fingers (then the browser's normal zoom applies).
 */
function useFollowVisibleArea(panelRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    let held = false;
    // while the picture of the design is being taken (Send), the 3D view must not change size: a
    // keyboard closing as "Send" is tapped waits until the picture is done
    const capturing = () => !!useWebStore.getState().busy || !!useEditorStore.getState().captureMode;
    const apply = () => {
      cancelAnimationFrame(raf);
      if (capturing()) {
        held = true;
        return;
      }
      raf = requestAnimationFrame(() => {
        if (Math.abs(vv.scale - 1) > 0.01) {
          root.style.removeProperty('--vv-top');
          root.style.removeProperty('--vv-h');
          root.classList.remove('vv-kb');
          return;
        }
        root.style.setProperty('--vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
        root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
        // a keyboard covers the lower part: the model gets smaller while typing (styles.css .vv-kb)
        root.classList.toggle('vv-kb', vv.height < window.innerHeight * 0.8);
        // the page just got shorter (keyboard): keep the box being typed in visible inside the panel
        const a = document.activeElement;
        const panel = panelRef.current;
        if (panel && isTextEntry(a) && panel.contains(a)) {
          requestAnimationFrame(() => revealInPanel(panel, a));
        }
      });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    const release = () => {
      if (held && !capturing()) {
        held = false;
        apply();
      }
    };
    const unWeb = useWebStore.subscribe(release);
    const unEd = useEditorStore.subscribe(release);
    return () => {
      cancelAnimationFrame(raf);
      unWeb();
      unEd();
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--vv-h');
      root.classList.remove('vv-kb');
    };
  }, [panelRef]);
}

/** The step bar's edge fades on screens too narrow for all 7 steps. */
function useBarEdges(bar: RefObject<HTMLElement>, count: number) {
  const [edges, setEdges] = useState({ l: false, r: false });
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const update = () => {
      const l = el.scrollLeft > 2;
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((p) => (p.l === l && p.r === r ? p : { l, r }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [bar, count]);
  return edges;
}

/** Two-step reset (no window.confirm: a sandboxed iframe may block dialogs). */
/**
 * "Start over", always in the top bar (owner 10/16/26: "there should be a clear button in case they
 * want to clear what theyve built and start from scratch"). It asks first, in a small box with two
 * plain buttons (no window.confirm: a website frame may block dialogs).
 */
function StartOver({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!asking) return;
    keepRef.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAsking(false);
        openRef.current?.focus();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [asking]);
  return (
    <>
      <button type="button" className="startover" ref={openRef} onClick={() => setAsking(true)}>
        <span aria-hidden="true">↺</span> <span className="startover-word">Start over</span>
        <span className="sr-only"> (clear the design)</span>
      </button>
      {asking ? (
        <div className="confirm-back" onClick={() => setAsking(false)}>
          <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="so-title" aria-describedby="so-text" onClick={(e) => e.stopPropagation()}>
            <h2 id="so-title">Start over?</h2>
            <p id="so-text">This clears your building - the size, doors, windows, lean-tos, upgrades and colors - so you can begin again.</p>
            <div className="confirm-actions">
              <button type="button" className="btn-ghost" ref={keepRef} onClick={() => { setAsking(false); openRef.current?.focus(); }}>
                Keep my design
              </button>
              <button type="button" className="btn-primary" onClick={() => { setAsking(false); onConfirm(); }}>
                Yes, start over
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function App() {
  const tab = useWebStore((s) => s.tab);
  const setTab = useWebStore((s) => s.setTab);
  const busy = useWebStore((s) => s.busy);
  const replace = useWebStore((s) => s.replace);
  const selMain = useEditorStore((s) => s.selectedOpeningId);
  const selLean = useEditorStore((s) => s.selectedLeanToOpeningId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const steps = useSteps();
  const edges = useBarEdges(barRef, steps.length);
  // phones: "Bigger view" on the model; the how-to line goes after the first touch on it
  const [bigView, setBigView] = useState(false);
  const [touched, setTouched] = useState(false);
  // Start over: a plain building, back on step 1, the normal outside view, and a short "done" line
  const [cleared, setCleared] = useState(false);
  const undoRef = useRef<{ design: typeof DEFAULT_DESIGN; tab: TabKey } | null>(null);
  useEffect(() => {
    if (!cleared) return;
    const t = setTimeout(() => setCleared(false), 10000);
    return () => clearTimeout(t);
  }, [cleared]);
  const startOver = () => {
    undoRef.current = { design: useWebStore.getState().design, tab };
    replace(DEFAULT_DESIGN);
    const ed = useEditorStore.getState();
    ed.selectOpening(null);
    ed.selectLeanToOpening(null);
    ed.setViewMode('exterior');
    ed.setShowSpacing(false);
    setTab('size');
    setCleared(true);
    setTimeout(() => cameraApi.fit('iso'), 200);
  };
  // the steel-frame view is a look, not a setting: a new step shows the building as it is again
  useEffect(() => {
    if (useEditorStore.getState().viewMode !== 'exterior') useEditorStore.getState().setViewMode('exterior');
    // Doors with nothing added yet: face the front, where most doors go
    if (tab === 'doors' && useWebStore.getState().design.openings.length === 0) setTimeout(() => cameraApi.fit('front'), 150);
  }, [tab]);
  usePageStaysPut();
  useFollowVisibleArea(bodyRef);
  // its own page (not inside the website's frame): no pull-to-refresh / bounce on the page itself
  useEffect(() => {
    if (!FRAMED) document.documentElement.classList.add('top-level');
  }, []);
  // a step that is not offered here (e.g. a saved draft on the Send step) falls back to the first
  useEffect(() => {
    if (!steps.some((t) => t.key === tab)) setTab('size');
  }, [steps, tab, setTab]);

  // Clicking a door on the model opens its card (desktop: the panel is beside the model).
  useEffect(() => {
    if (selMain) setTab('doors');
    else if (selLean) setTab('leantos');
  }, [selMain, selLean, setTab]);
  // A new step starts at its top.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    // phones: the step bar scrolls sideways; keep the current step in view
    const btn = document.getElementById(`tab-${tab}`);
    if (barRef.current && btn) revealInBar(barRef.current, btn);
  }, [tab]);
  useEffect(() => {
    const sel = bodyRef.current?.querySelector<HTMLElement>('.is-selected');
    if (bodyRef.current && sel) revealInPanel(bodyRef.current, sel);
  }, [tab, selMain, selLean]);

  return (
    <div className={`app${bigView ? ' big-view' : ''}${touched ? ' touched' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="wordmark" aria-label="StormSafe Steel">
            Storm<span className="wm-teal">Safe</span> Steel
          </span>
          <h1 className="title">Design your building</h1>
        </div>
        <Summary />
        <div className="topright">
          <StartOver onConfirm={startOver} />
          <a className="topphone" href="tel:+15617715555">561-771-5555</a>
        </div>
      </header>
      {cleared ? (
        <p className="cleared" role="status">
          Started over with a plain building.{' '}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              const u = undoRef.current;
              if (u) {
                replace(u.design);
                setTab(u.tab);
                setTimeout(() => cameraApi.fit('iso'), 200);
              }
              undoRef.current = null;
              setCleared(false);
            }}
          >
            Undo
          </button>
        </p>
      ) : null}
      <div className="split">
        <section className="stage" aria-label="3D model" onPointerDown={() => setTouched(true)}>
          <WebViewport />
          <div className="stage-foot">
            <StageSummary />
            <button type="button" className="vp-size" aria-pressed={bigView} onClick={() => setBigView((v) => !v)}>
              <span aria-hidden="true">{bigView ? '⤡' : '⤢'}</span> {bigView ? 'Smaller view' : 'Bigger view'}
            </button>
          </div>
        </section>
        <aside className="panel" aria-label="Building options">
          <LinkBanner />
          {tab === 'size' ? <ImpactBanner /> : null}
          <nav
            className={`tabs${edges.l ? ' more-left' : ''}${edges.r ? ' more-right' : ''}`}
            role="tablist"
            aria-label="Options"
            ref={barRef}
          >
            {steps.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="tabpanel"
                className={tab === t.key ? 'on' : ''}
                title={t.title}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="panel-scroll" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} ref={bodyRef}>
            <StepHead />
            {tab === 'size' && <SizePanel />}
            {tab === 'walls' && <WallsPanel />}
            {tab === 'doors' && <OpeningsPanel />}
            {tab === 'leantos' && <LeanTosPanel />}
            {tab === 'upgrades' && <UpgradesPanel />}
            {tab === 'colors' && <ColorsPanel />}
            {tab === 'send' && <SendPanel />}
            <StepNav />
          </div>
        </aside>
      </div>
      {busy && (
        <div className="busy" role="alert" aria-live="assertive">
          <div className="busy-card">
            <span className="spinner" aria-hidden="true" />
            {busy}
          </div>
        </div>
      )}
    </div>
  );
}
