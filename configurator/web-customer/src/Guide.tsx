/**
 * The guided start (owner 10/17/26, from the usability PDF): a first-time visitor is asked what the
 * building is for and how much room they need, instead of landing on seven tabs. "I know what I want"
 * goes straight to the builder. Everything they pick lands in the same builder, where it can all be
 * changed. Shown only on the design page's own screen (never inside the website's frame).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore, type GuideStep } from './store';
import { applyPreset, PURPOSES, SIDE_CHOICES, type Purpose, type SizePreset } from './model/guide';
import type { WebBuildingType } from './model/design';
import { cameraApi } from './cameraFit';
import { applyType } from './panels/SizePanel';

const ICONS: Record<Purpose, ReactNode> = {
  garage: (
    <>
      <path d="M6 20 24 8l18 12v20H6Z" />
      <rect x="14" y="24" width="20" height="16" />
      <path d="M14 29h20M14 34h20" />
    </>
  ),
  parking: (
    <>
      <path d="M4 20 24 10l20 10" />
      <path d="M9 19v21M39 19v21M4 40h40" />
    </>
  ),
  workshop: (
    <>
      <path d="M6 40V20L24 9l18 11v20Z" />
      <rect x="11" y="24" width="8" height="8" />
      <rect x="29" y="26" width="8" height="14" />
    </>
  ),
  rv: (
    <>
      <rect x="4" y="14" width="34" height="20" rx="3" />
      <rect x="24" y="18" width="10" height="7" />
      <path d="M38 22h4l2 4v8h-6" />
      <circle cx="13" cy="36" r="3.5" />
      <circle cx="31" cy="36" r="3.5" />
    </>
  ),
  farm: (
    <>
      <path d="M6 40V22l6-10h24l6 10v18Z" />
      <rect x="17" y="24" width="14" height="16" />
      <path d="m17 24 14 16M31 24 17 40" />
    </>
  ),
  other: (
    <>
      <circle cx="24" cy="24" r="16" />
      <path d="M24 15v18M15 24h18" />
    </>
  ),
};

function Icon({ k }: { k: Purpose }) {
  return (
    <svg className="guide-icon" viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[k]}
    </svg>
  );
}

const dims = (p: SizePreset) => `${p.w}′ W × ${p.l}′ L × ${p.h}′ H`;

export function Guide({ banner }: { banner?: ReactNode }) {
  const step = useWebStore((s) => s.guide) as GuideStep;
  const setGuide = useWebStore((s) => s.setGuide);
  const update = useWebStore((s) => s.update);
  const setTab = useWebStore((s) => s.setTab);
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [sides, setSides] = useState<WebBuildingType | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const p = PURPOSES.find((x) => x.key === purpose) ?? null;

  // The builder behind is out of reach (keyboard and screen reader) while the questions are up.
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.app > .topbar, .app > .split')];
    els.forEach((e) => e.setAttribute('inert', ''));
    return () => els.forEach((e) => e.removeAttribute('inert'));
  }, []);
  // Each question starts at its top, with its heading read out.
  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    document.querySelector('.guide')?.scrollTo({ top: 0 });
  }, [step]);

  const toBuilder = () => {
    setTab('size');
    setGuide(null);
    const ed = useEditorStore.getState();
    ed.selectOpening(null);
    ed.selectLeanToOpening(null);
    setTimeout(() => cameraApi.fit('iso'), 250);
    setTimeout(() => document.getElementById('tab-size')?.focus({ preventScroll: true }), 60);
  };
  const choosePurpose = (k: Purpose) => {
    setPurpose(k);
    setSides(null);
    setGuide(PURPOSES.find((x) => x.key === k)!.type === null ? 'sides' : 'size');
  };
  const chooseSize = (size: SizePreset) => {
    if (!p) return;
    const type = p.type ?? sides ?? 'garage';
    update((d) => applyPreset(d, type, size));
    toBuilder();
  };
  // own size: the kind of building is kept, the size boxes are theirs
  const chooseOwn = () => {
    if (!p) return;
    const type = p.type ?? sides ?? 'garage';
    update((d) => applyType(d, type));
    toBuilder();
  };
  const back = () => {
    if (step === 'size') setGuide(p && p.type === null ? 'sides' : 'purpose');
    else if (step === 'sides') setGuide('purpose');
    else setGuide('welcome');
  };

  return (
    <section className="guide" aria-label="Guided start">
      <div className="guide-in">
        <span className="wordmark guide-mark" aria-label="StormSafe Steel">
          Storm<span className="wm-teal">Safe</span> Steel
        </span>
        {banner}

        {step === 'welcome' && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>Let’s design your building!</h1>
            <p className="guide-p">Not sure what you need? No problem. A few easy questions, and you’ll see your building in 3D.</p>
            <button type="button" className="btn-primary guide-btn" onClick={() => setGuide('purpose')}>
              Help me design my building
            </button>
            <button type="button" className="btn-ghost guide-btn guide-btn-2" onClick={() => toBuilder()}>
              I know what I want
            </button>
            <p className="guide-small">No building knowledge needed. Questions? <a href="tel:+15617715555">561-771-5555</a></p>
          </>
        )}

        {step === 'purpose' && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>What will you use it for?</h1>
            <p className="guide-p">Choose the closest match. You can change everything later.</p>
            <div className="guide-list">
              {PURPOSES.map((x) => (
                <button key={x.key} type="button" className="guide-card" onClick={() => choosePurpose(x.key)}>
                  <Icon k={x.key} />
                  <span className="guide-card-text">
                    <span className="guide-card-title">{x.title}</span>
                    <span className="guide-card-blurb">{x.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'sides' && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>How should the sides be?</h1>
            <p className="guide-p">Pick the closest. You can close in or open up any wall later.</p>
            <div className="guide-list">
              {SIDE_CHOICES.map((x) => (
                <button
                  key={x.type}
                  type="button"
                  className="guide-card guide-card-plain"
                  onClick={() => {
                    setSides(x.type);
                    setGuide('size');
                  }}
                >
                  <span className="guide-card-text">
                    <span className="guide-card-title">{x.title}</span>
                    <span className="guide-card-blurb">{x.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'size' && p && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>How much room?</h1>
            <p className="guide-p">Pick a starting size. You can change it on the next screen.</p>
            <div className="guide-list">
              {p.sizes.map((s) => (
                <button key={s.label} type="button" className="guide-card guide-card-plain" onClick={() => chooseSize(s)}>
                  <span className="guide-card-text">
                    <span className="guide-card-title">{s.label}</span>
                    <span className="guide-card-blurb">{dims(s)}</span>
                  </span>
                </button>
              ))}
              <button type="button" className="guide-card guide-card-plain guide-card-own" onClick={chooseOwn}>
                <span className="guide-card-text">
                  <span className="guide-card-title">I’ll choose my own size</span>
                  <span className="guide-card-blurb">Pick the width, length and height yourself</span>
                </span>
              </button>
            </div>
            <p className="guide-small">These are common sizes, not a promise that your vehicles or equipment will fit. Your rep will go over the exact fit with you.</p>
          </>
        )}

        {step !== 'welcome' && (
          <div className="guide-foot">
            <button type="button" className="btn-ghost" onClick={back}>← Back</button>
            <button type="button" className="linkish" onClick={() => toBuilder()}>Skip the questions</button>
          </div>
        )}
      </div>
    </section>
  );
}
