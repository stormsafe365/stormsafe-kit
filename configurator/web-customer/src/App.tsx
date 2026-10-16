import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { WebViewport } from './WebViewport';
import { useWebStore, type TabKey } from './store';
import { DEFAULT_DESIGN, TYPE_LABEL } from './model/design';
import { SizePanel } from './panels/SizePanel';
import { WallsPanel } from './panels/WallsPanel';
import { OpeningsPanel } from './panels/OpeningsPanel';
import { LeanTosPanel } from './panels/LeanTosPanel';
import { ColorsPanel } from './panels/ColorsPanel';
import { SendPanel } from './panels/SendPanel';
import { ft } from './panels/ui';

// The steps, in order (owner 10/16/26: type + size, walls, doors / windows,
// lean-tos, colors, then the customer's contact + "Send to my steel building rep").
const TABS: Array<{ key: TabKey; label: string; title: string }> = [
  { key: 'size', label: 'Size', title: 'Building type, size & roof' },
  { key: 'walls', label: 'Walls', title: 'Walls' },
  { key: 'doors', label: 'Doors', title: 'Doors & windows' },
  { key: 'leantos', label: 'Lean-tos', title: 'Lean-tos' },
  { key: 'colors', label: 'Colors', title: 'Colors' },
  { key: 'send', label: 'Send', title: 'Send to your rep' },
];

/** Back / Next under each step ("Next: Walls"). */
function StepNav() {
  const tab = useWebStore((s) => s.tab);
  const setTab = useWebStore((s) => s.setTab);
  const i = TABS.findIndex((t) => t.key === tab);
  const prev = i > 0 ? TABS[i - 1] : null;
  const next = i >= 0 && i < TABS.length - 1 ? TABS[i + 1] : null;
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
          {next.key === 'send' ? 'Next: Send to your rep →' : `Next: ${next.title} →`}
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
  if (!impact) return null;
  return (
    <div className="impact" role="status">
      <strong>Hi-Impact area.</strong> {county ? `${county} County` : 'Your area'} requires impact-rated windows and walk-in doors; this design
      uses them.
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

/** Two-step reset (no window.confirm: a sandboxed iframe may block dialogs). */
function StartOver({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn-ghost ${armed ? 'confirm' : ''}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? 'Tap again to start over' : 'Start over'}
    </button>
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

  // Clicking a door on the model opens its card (desktop: the panel is beside the model).
  useEffect(() => {
    if (selMain) setTab('doors');
    else if (selLean) setTab('leantos');
  }, [selMain, selLean, setTab]);
  // A new step starts at its top.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [tab]);
  useEffect(() => {
    bodyRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tab, selMain, selLean]);

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="title">Design your building</h1>
        <Summary />
      </header>
      <div className="split">
        <section className="stage" aria-label="3D model">
          <WebViewport />
        </section>
        <aside className="panel" aria-label="Building options">
          <LinkBanner />
          <ImpactBanner />
          <nav className="tabs" role="tablist" aria-label="Options">
            {TABS.map((t, i) => (
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
                <span className="tab-n" aria-hidden="true">
                  {i + 1}
                </span>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="panel-scroll" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} ref={bodyRef}>
            {tab === 'size' && <SizePanel />}
            {tab === 'walls' && <WallsPanel />}
            {tab === 'doors' && <OpeningsPanel />}
            {tab === 'leantos' && <LeanTosPanel />}
            {tab === 'colors' && <ColorsPanel />}
            {tab === 'send' && <SendPanel />}
            <StepNav />
            {tab !== 'send' && (
              <div className="panel-foot">
                <StartOver onConfirm={() => replace(DEFAULT_DESIGN)} />
              </div>
            )}
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
