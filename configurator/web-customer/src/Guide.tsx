/**
 * The guided start (owner 10/17/26, from the usability PDF): a first-time visitor is asked what kind
 * of building they want (picture cards) and how much room they need, instead of landing on seven tabs.
 * "I know what I want" goes straight to the builder. Everything they pick lands in the same builder,
 * where it can all be changed, and Back in the builder returns here. Shown only on the design page's
 * own screen (never inside the website's frame).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore, type GuideStep } from './store';
import { applyStyle, BARNS, STYLES, type BarnStyle, type GuideStyle, type SizePreset } from './model/guide';
import { cameraApi } from './cameraFit';
import { TYPE_LABEL } from './model/design';
import { ft } from './panels/ui';

// Pictures made from our own 3D model (tools/make-guide-pictures.mjs).
const PICTURE = (k: string) => new URL(`./assets/guide/${k}.jpg`, import.meta.url).href;

const dims = (p: SizePreset) => `${p.w}′ W × ${p.l}′ L × ${p.h}′ H`;

export function Guide({ banner, onUndo, onStartOver }: { banner?: ReactNode; onUndo?: (() => void) | null; onStartOver?: () => void }) {
  const step = useWebStore((s) => s.guide) as GuideStep;
  const setGuide = useWebStore((s) => s.setGuide);
  const style = useWebStore((s) => s.guideStyle);
  const setStyle = useWebStore((s) => s.setGuideStyle);
  const mode = useWebStore((s) => s.guideMode);
  const setMode = useWebStore((s) => s.setGuideMode);
  const barn = useWebStore((s) => s.guideBarn);
  const setBarn = useWebStore((s) => s.setGuideBarn);
  const update = useWebStore((s) => s.update);
  const design = useWebStore((s) => s.design);
  const sentAt = useWebStore((s) => s.sentAt);
  const setTab = useWebStore((s) => s.setTab);
  const headRef = useRef<HTMLHeadingElement>(null);
  const st = STYLES.find((x) => x.key === style) ?? null;

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
  // A size screen needs a style: a way in without one (should not happen) asks the style first.
  useEffect(() => {
    if ((step === 'size' || step === 'barn') && !st) setGuide('style');
    else if (step === 'size' && st?.leanTos && !barn) setGuide('barn');
  }, [step, st, barn, setGuide]);

  const toBuilder = () => {
    setTab('size');
    setGuide(null);
    const ed = useEditorStore.getState();
    ed.selectOpening(null);
    ed.selectLeanToOpening(null);
    setTimeout(() => cameraApi.fit('iso'), 250);
    setTimeout(() => document.getElementById('tab-size')?.focus({ preventScroll: true }), 60);
  };
  const chooseSize = (size: SizePreset) => {
    if (!st) return;
    update((d) => applyStyle(d, st.key, size, barn ?? 'standard'));
    toBuilder();
  };
  // own size: the kind of building is kept (its walls and lean-tos too), the size boxes are theirs
  const chooseOwn = () => {
    if (!st) return;
    update((d) => applyStyle(d, st.key, { label: '', w: d.width, l: d.length, h: d.height }));
    toBuilder();
  };
  // "I know what I want": the style (and barn style) is picked here, the exact size is typed in the builder
  const finishKnow = (style: GuideStyle, b: BarnStyle) => {
    update((d) => applyStyle(d, style, { label: '', w: d.width, l: d.length, h: d.height }, b));
    toBuilder();
  };
  const back = () => setGuide(step === 'size' ? (st?.leanTos ? 'barn' : 'style') : step === 'barn' ? 'style' : 'welcome');

  return (
    <section className="guide" aria-label="Guided start">
      <div className="guide-in">
        <span className="wordmark guide-mark" aria-label="StormSafe Steel">
          Storm<span className="wm-teal">Safe</span> Steel
        </span>
        {banner}

        {step === 'resume' && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>Welcome back!</h1>
            <p className="guide-p">Your building is saved on this device:</p>
            <p className="resume-card">
              <strong>{st ? (st.leanTos && barn ? BARNS.find((b) => b.key === barn)?.title ?? st.title : st.title) : TYPE_LABEL[design.type]}</strong>
              <span>
                {ft(design.width)} W × {ft(design.length)} L × {ft(design.height)} H
                {design.openings.length ? ` · ${design.openings.length} door${design.openings.length === 1 ? '' : 's'} / window${design.openings.length === 1 ? '' : 's'}` : ''}
                {design.leanTos.length ? ` · ${design.leanTos.length} lean-to${design.leanTos.length === 1 ? '' : 's'}` : ''}
              </span>
              {sentAt ? <span className="resume-sent">Sent to your rep</span> : null}
            </p>
            <button
              type="button"
              className="btn-primary guide-btn"
              onClick={() => {
                setGuide(null);
                setTimeout(() => cameraApi.fit('iso'), 250);
              }}
            >
              Keep going with this design
            </button>
            <button type="button" className="btn-ghost guide-btn guide-btn-2" onClick={() => onStartOver?.()}>
              Start a new design
            </button>
            <p className="guide-small">Questions? <a href="tel:+15617715555">561-771-5555</a></p>
          </>
        )}

        {step === 'welcome' && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>Let’s design your building!</h1>
            <p className="guide-p">Not sure what you need? No problem. A few easy questions, and you’ll see your building in 3D.</p>
            <button
              type="button"
              className="btn-primary guide-btn"
              onClick={() => {
                setMode('help');
                setGuide('style');
              }}
            >
              Help me design my building
            </button>
            <button
              type="button"
              className="btn-ghost guide-btn guide-btn-2"
              onClick={() => {
                setMode('know');
                setGuide('style');
              }}
            >
              I know what I want
            </button>
            {onUndo ? (
              <p className="guide-small">
                Started over by mistake?{' '}
                <button type="button" className="linkish" onClick={onUndo}>
                  Go back to my building
                </button>
              </p>
            ) : null}
            <p className="guide-small">No building knowledge needed. Questions? <a href="tel:+15617715555">561-771-5555</a></p>
          </>
        )}

        {step === 'style' && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>{mode === 'know' ? 'Choose your building style' : 'What do you want to build?'}</h1>
            <p className="guide-p">
              {mode === 'know' ? 'Pick the closest style. You will set the exact size next.' : 'Choose the closest match. You can change everything later.'}
            </p>
            <div className="guide-list">
              {STYLES.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  className="guide-card"
                  onClick={() => {
                    setStyle(x.key);
                    if (x.leanTos) setGuide('barn');
                    else if (mode === 'know') finishKnow(x.key, 'standard');
                    else setGuide('size');
                  }}
                >
                  <img className="guide-pic" src={PICTURE(x.key)} alt="" width="120" height="75" loading="lazy" decoding="async" />
                  <span className="guide-card-text">
                    <span className="guide-card-title">{x.title}</span>
                    <span className="guide-card-blurb">{x.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'barn' && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>Which barn style?</h1>
            <p className="guide-p">Each has a lean-to roof on both sides of a center building. You can change the details later.</p>
            <div className="guide-list">
              {BARNS.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  className="guide-card"
                  onClick={() => {
                    setBarn(x.key);
                    if (mode === 'know' && st) finishKnow(st.key, x.key);
                    else setGuide('size');
                  }}
                >
                  <img className="guide-pic" src={PICTURE('barn-' + x.key)} alt="" width="120" height="75" loading="lazy" decoding="async" />
                  <span className="guide-card-text">
                    <span className="guide-card-title">{x.title}</span>
                    <span className="guide-card-blurb">{x.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'size' && st && (
          <>
            <h1 className="guide-h" tabIndex={-1} ref={headRef}>How much room?</h1>
            <p className="guide-p">
              {st.title}: pick a starting size. You can change it on the next screen.
              {st.leanTos ? ' The size is the center building; the lean-tos are added on each side of it.' : ''}
            </p>
            <div className="guide-list">
              {st.sizes.map((s) => (
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

        {step !== 'welcome' && step !== 'resume' && (
          <div className="guide-foot">
            <button type="button" className="btn-ghost" onClick={back}>← Back</button>
            <button type="button" className="linkish" onClick={() => toBuilder()}>Skip the questions</button>
          </div>
        )}
      </div>
    </section>
  );
}
