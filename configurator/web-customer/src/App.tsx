import { useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { WebViewport } from './WebViewport';
import { useWebStore, type TabKey } from './store';
import { DEFAULT_DESIGN, hasWalkDoorOrWindow, TYPE_LABEL } from './model/design';
import { EMPTY_CONTACT } from './model/link';
import { SizePanel } from './panels/SizePanel';
import { WallsPanel } from './panels/WallsPanel';
import { OpeningsPanel } from './panels/OpeningsPanel';
import { LeanTosPanel } from './panels/LeanTosPanel';
import { ColorsPanel } from './panels/ColorsPanel';
import { SendPanel } from './panels/SendPanel';
import { UpgradesPanel } from './panels/UpgradesPanel';
import { ft } from './panels/ui';
import { cameraApi } from './cameraFit';
import { revealInPanel } from './reveal';
import { Guide } from './Guide';
import { prefillContact, startOverDesign } from './linkStart';

// The steps, in order (owner 10/16/26: building type + size, components, add-ons /
// upgrades, colors, then the customer's contact + "Send to my steel building rep").
const TABS: Array<{ key: TabKey; label: string; title: string }> = [
  { key: 'size', label: 'Size', title: 'Building type & size' },
  { key: 'walls', label: 'Walls', title: 'Walls' },
  { key: 'doors', label: 'Doors & windows', title: 'Doors & windows' },
  { key: 'leantos', label: 'Lean-tos', title: 'Lean-tos' },
  { key: 'upgrades', label: 'Upgrades', title: 'Upgrades' },
  { key: 'colors', label: 'Colors', title: 'Colors' },
  { key: 'send', label: 'Review & send', title: 'Review & send' },
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
const STEP_HELP: Record<TabKey, { text: string | ((s: ReturnType<typeof useWebStore.getState>) => string); optional?: boolean }> = {
  size: { text: (s) => (s.guideStyle ? 'Set the size. You can change it any time.' : 'Pick the kind of building and its size. You can change anything later.') },
  walls: {
    text: (s) =>
      s.design.type === 'carport'
        ? 'Tap a wall to close it in, or just tap Next.'
        : s.design.type === 'combo'
          ? 'Tap a carport wall to close it in, or just tap Next.'
          : 'Tap a wall to change it, or tap Next.',
  },
  doors: { text: 'Go wall by wall: pick a wall, then add a garage door, walk-in door, window or opening to it.' },
  leantos: { text: 'A lean-to is a lower roof on one side: open for cover, or closed in for storage. Most people skip this.', optional: true },
  upgrades: { text: 'Not sure? Leave them off; your rep goes over them with you.', optional: true },
  colors: { text: 'Tap Roof, Walls or Trim (edges and corners), then a color.' },
  send: {
    text: (s) =>
      s.sentAt ? 'Your rep has your design. Changed something? You can send it again.'
        : !s.token || s.link === 'none' || s.link === 'invalid' || s.link === 'expired' ? 'To send it, open the design link your rep texted you, or call us.'
        : 'Add your name, phone, email and ZIP code, then send your design to your rep. It is free.',
  },
};

/** "STEP 3 OF 7 · Doors & windows" on one line + one plain sentence (slim: the model keeps its room). */
function StepHead() {
  const tab = useWebStore((s) => s.tab);
  const state = useWebStore();
  const steps = useSteps();
  const i = steps.findIndex((t) => t.key === tab);
  if (i < 0) return null;
  const help = STEP_HELP[tab];
  const text = typeof help.text === 'function' ? help.text(state) : help.text;
  return (
    <div className="stephead">
      <div className="stephead-row">
        <h2 className="stephead-title">
          <span className="stephead-count">
            Step {i + 1} of {steps.length}
            {help.optional ? ' · optional' : ''}
          </span>{' '}
          {steps[i].title}
        </h2>
        <StepsMenu steps={steps} i={i} />
      </div>
      <p className="stephead-text">{text}</p>
    </div>
  );
}

/**
 * Phones: the list of steps behind one small button (the row of step names took a strip of the screen
 * and was cut off at the edge - owner 10/17/26 "no ton of scrolling"). Tap a step to go straight there.
 */
function StepsMenu({ steps, i }: { steps: Array<{ key: TabKey; title: string }>; i: number }) {
  const setTab = useWebStore((s) => s.setTab);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [i]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  return (
    <>
      <button type="button" ref={btn} className="steps-btn" aria-expanded={open} aria-controls="steps-menu" onClick={() => setOpen((v) => !v)}>
        All steps <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <ol id="steps-menu" className="steps-menu">
          {steps.map((t, j) => (
            <li key={t.key}>
              <button type="button" className={j === i ? 'on' : ''} aria-current={j === i ? 'step' : undefined} onClick={() => setTab(t.key)}>
                <span className="steps-n">{j + 1}</span>
                {t.title}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

/** Back / Next, kept at the bottom of the options on every step ("Next: Walls"). */
function StepNav() {
  const tab = useWebStore((s) => s.tab);
  const setTab = useWebStore((s) => s.setTab);
  const seeded = useWebStore((s) => !!s.seed);
  const steps = useSteps();
  const i = steps.findIndex((t) => t.key === tab);
  const prev = i > 0 ? steps[i - 1] : null;
  const next = i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
  // an optional step with nothing added says Skip (walkthroughs 10/16/26: 'do I have to fill this in?')
  const d = useWebStore((s) => s.design);
  const skipping = (tab === 'leantos' && d.leanTos.length === 0) || (tab === 'upgrades' && !Object.values(d.upgrades || {}).some((v) => v && v !== 'none'));
  // Doors with nothing added: the teal "Add" button is the one to tap, so Next is a quiet outline
  // (re-check 10/16/26: the teal Next was the only teal button on screen, so doors got skipped)
  const quietNext = tab === 'doors' && d.openings.length === 0;
  // Step 1: Back goes to the guided questions (the sizes if they came through them, else the first screen)
  const guideStyle = useWebStore((s) => s.guideStyle);
  const guideMode = useWebStore((s) => s.guideMode);
  const setGuide = useWebStore((s) => s.setGuide);
  return (
    <div className="stepnav">
      {prev ? (
        <button type="button" className="btn-ghost" onClick={() => setTab(prev.key)}>
          ← Back
        </button>
      ) : !FRAMED && !seeded ? (
        <button type="button" className="btn-ghost" onClick={() => setGuide(guideStyle ? (guideMode === 'know' ? 'style' : 'size') : 'welcome')}>
          ← Back
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button type="button" className={quietNext ? 'btn-ghost' : 'btn-primary'} onClick={() => setTab(next.key)}>
          {quietNext ? 'Skip doors →' : skipping ? `Skip: ${next.title} →` : next.key === 'send' ? 'Next: Review & send →' : `Next: ${next.title} →`}
        </button>
      ) : null}
    </div>
  );
}

/** The one-time note when the page opens on the building from the customer's quote. */
function SeedNote() {
  const setSeedNote = useWebStore((s) => s.setSeedNote);
  useEffect(() => {
    const t = setTimeout(() => setSeedNote(false), 20000);
    return () => clearTimeout(t);
  }, [setSeedNote]);
  return (
    <p className="cleared">
      This is the building from your quote. Change anything you like, then tap Send to my steel building rep.{' '}
      <button type="button" className="linkish" onClick={() => setSeedNote(false)}>
        Got it
      </button>
    </p>
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

/** While the steel-frame look is on, say so on the model with a way back (phones have no switch on the bar). */
function FramePill() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  if (viewMode !== 'structure') return null;
  return (
    <button type="button" className="frame-pill" onClick={() => setViewMode('exterior')}>
      Steel frame view · <b>Show the walls</b>
    </button>
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
          requestAnimationFrame(() => revealInPanel(a, panel));
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
function StartOver({ onConfirm, seeded }: { onConfirm: () => void; seeded: boolean }) {
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
      // Tab stays on the two buttons while the box is open
      if (e.key === 'Tab') {
        const b = [...document.querySelectorAll<HTMLButtonElement>('.confirm-card button')];
        if (!b.length) return;
        const i = b.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
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
        <div className="confirm-back" onClick={() => { setAsking(false); openRef.current?.focus(); }}>
          <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="so-title" aria-describedby="so-text" onClick={(e) => e.stopPropagation()}>
            <h2 id="so-title">Start over?</h2>
            <p id="so-text">{seeded ? 'This puts your building back the way your rep set it up.' : 'This clears your building - the size, doors, windows, lean-tos, upgrades and colors - so you can begin again.'}</p>
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
  const guide = useWebStore((s) => s.guide);
  const setGuide = useWebStore((s) => s.setGuide);
  const seed = useWebStore((s) => s.seed);
  const seedNote = useWebStore((s) => s.seedNote);
  const setGuideStyle = useWebStore((s) => s.setGuideStyle);
  const setGuideBarn = useWebStore((s) => s.setGuideBarn);
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
  const undoRef = useRef<{ design: typeof DEFAULT_DESIGN; tab: TabKey; fresh: unknown } | null>(null);
  const design = useWebStore((s) => s.design);
  // Undo only while the new plain design is untouched: once the customer starts again, Undo would wipe that work
  useEffect(() => {
    if (cleared && undoRef.current && undoRef.current.fresh !== design) {
      undoRef.current = null;
      setCleared(false);
    }
  }, [design, cleared]);
  useEffect(() => {
    // the "Go back to my building" link stays while the first screen is up; otherwise the Undo line goes after 10 s
    if (!cleared || guide) return;
    const t = setTimeout(() => setCleared(false), 10000);
    return () => clearTimeout(t);
  }, [cleared, guide]);
  const startOver = () => {
    const before = { design: useWebStore.getState().design, tab };
    replace(startOverDesign(seed));
    undoRef.current = { ...before, fresh: useWebStore.getState().design };
    // a shared link on a shared phone / computer: the next person must not inherit the last one's name, phone and email
    useWebStore.getState().setContact({ ...EMPTY_CONTACT });
    prefillContact(seed?.contact ?? null);
    if (seed?.zip) {
      useWebStore.getState().setZip(seed.zip); // the building's ZIP comes back with it
      undoRef.current = { ...before, fresh: useWebStore.getState().design }; // (setting it settled the design again)
    }
    useWebStore.getState().setSent(null);
    useWebStore.getState().setSeedNote(false);
    const ed = useEditorStore.getState();
    ed.selectOpening(null);
    ed.selectLeanToOpening(null);
    ed.setViewMode('exterior');
    ed.setShowSpacing(false);
    setTab('size');
    setCleared(true);
    setTimeout(() => cameraApi.fit('iso'), 200);
    // on its own page, starting over goes back to the first screen (the guided questions)
    // (a rep's building goes straight back to the builder: the questions would replace it)
    if (!FRAMED) {
      setGuideStyle(null);
      setGuideBarn(null);
      setGuide(seed ? null : 'welcome');
      return;
    }
    setTimeout(() => document.querySelector<HTMLButtonElement>('.cleared .linkish')?.focus(), 60);
  };
  const undo = () => {
    const u = undoRef.current;
    if (u) {
      replace(u.design);
      setTab(u.tab);
      setTimeout(() => cameraApi.fit('iso'), 200);
    }
    undoRef.current = null;
    setCleared(false);
    setGuide(null);
  };
  // the steel-frame view is a look, not a setting: a new step shows the building as it is again
  useEffect(() => {
    if (useEditorStore.getState().viewMode !== 'exterior') useEditorStore.getState().setViewMode('exterior');
    // Doors with nothing added yet: face the front, where most doors go - and bring the Add button
    // into view above the pinned bar (re-check 10/16/26: it started under the bar on a phone)
    if (tab === 'doors' && useWebStore.getState().design.openings.length === 0) {
      setTimeout(() => cameraApi.fit('front'), 150);
      setTimeout(() => {
        const add = document.querySelector<HTMLElement>('.btn-add');
        if (add) revealInPanel(add);
      }, 250);
    }
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
    if (bodyRef.current && sel) revealInPanel(sel, bodyRef.current);
  }, [tab, selMain, selLean]);

  return (
    <div className={`app${bigView ? ' big-view' : ''}${touched ? ' touched' : ''}${tab === 'doors' || tab === 'leantos' || tab === 'walls' || tab === 'upgrades' ? ' working' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="wordmark" aria-label="StormSafe Steel">
            Storm<span className="wm-teal">Safe</span> Steel
          </span>
          <h1 className="title">Design your building</h1>
        </div>
        <Summary />
        <div className="topright">
          <StartOver onConfirm={startOver} seeded={!!seed} />
          <a className="topphone" href="tel:+15617715555">561-771-5555</a>
        </div>
      </header>
      <div className="split">
        <section className="stage" aria-label="3D model" onPointerDown={() => setTouched(true)}>
          <WebViewport />
          <div className="cleared-slot" role="status">
          {cleared ? (
        <p className="cleared">
          {seed ? 'Back to the building your rep set up.' : 'Started over with a plain building.'}{' '}
          <button
            type="button"
            className="linkish"
            onClick={undo}
          >
            Undo
          </button>
        </p>
      ) : null}
          {seedNote && !cleared && !guide ? <SeedNote /> : null}
          </div>
          <FramePill />
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
      {guide ? <Guide banner={<LinkBanner />} onUndo={cleared && undoRef.current ? undo : null} onStartOver={startOver} /> : null}
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
