/**
 * One door / window / framed opening (main building or lean-to): its wall,
 * size, look and position. The caller does the fitting (no-overlap rule) and
 * the writing; this only shows the choices that fit.
 */
import { useState } from 'react';
import { ROLLUP_COLORS, WALK_DOORS, WINDOWS, windowType, walkDoorType } from '../model/catalog';
import type { OpeningKind, WebLeanToOpening, WebOpening } from '../model/design';
import { Note, Select, Stepper, Segmented, ft, inch } from './ui';

export const KIND_LABEL: Record<OpeningKind, string> = {
  rollup: 'Roll-up door',
  walk: 'Walk-in door',
  window: 'Window',
  frame: 'Framed opening',
};

export function partTitle(o: WebOpening | WebLeanToOpening): string {
  if (o.kind === 'rollup') return `Roll-up door ${ft(o.w)} × ${ft(o.h)}`;
  if (o.kind === 'walk') return `Walk-in door ${inch(o.w)} × ${inch(o.h)}`;
  if (o.kind === 'window') return `Window ${inch(o.w)} × ${inch(o.h)}`;
  return `Framed opening ${ft(o.w)} × ${ft(o.h)}`;
}

export interface PartEditorProps {
  label: string;
  o: WebOpening | WebLeanToOpening;
  wallOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  sizes: { widths: number[]; heights: number[] };
  maxFrameW: number;
  maxFrameH: number;
  /** "the front end" — what the position number is measured from. */
  posFrom: string;
  posMax: number;
  impact: boolean;
  selected: boolean;
  problem?: string | null;
  /** Each returns an error message when the change cannot be made (no room), else null. */
  onWall: (wall: string) => string | null;
  onPatch: (patch: Partial<WebOpening>) => string | null;
  onPos: (pos: number) => string | null;
  onRemove: () => void;
}

export function PartEditor(p: PartEditorProps) {
  const { o } = p;
  const [msg, setMsg] = useState<string | null>(null);
  const run = (r: string | null) => setMsg(r);
  const walkOpts = WALK_DOORS.map((t) => ({ value: t.key, label: t.name, disabled: p.impact && !t.impact }));
  const winOpts = WINDOWS.map((t) => ({ value: t.key, label: `${t.name} ${t.wIn}″ × ${t.hIn}″`, disabled: p.impact && !t.impact }));
  return (
    <section className={`part ${p.selected ? 'is-selected' : ''}`} aria-label={`${p.label} ${KIND_LABEL[o.kind]}`}>
      <header className="part-head">
        <span className="part-num">{p.label}</span>
        <span className="part-title">{partTitle(o)}</span>
        <button type="button" className="icon-btn" aria-label={`Remove ${KIND_LABEL[o.kind].toLowerCase()} ${p.label}`} onClick={p.onRemove}>
          ×
        </button>
      </header>
      <div className="part-grid">
        <Select label="Wall" value={o.wall as string} options={p.wallOptions} onChange={(w) => run(p.onWall(w))} />
        {o.kind === 'rollup' && (
          <>
            <Select
              label="Width"
              value={o.w}
              options={(p.sizes.widths.includes(o.w) ? p.sizes.widths : [...p.sizes.widths, o.w].sort((a, b) => a - b)).map((w) => ({ value: w, label: `${w}′` }))}
              onChange={(w) => run(p.onPatch({ w }))}
            />
            <Select
              label="Height"
              value={o.h}
              options={(p.sizes.heights.includes(o.h) ? p.sizes.heights : [...p.sizes.heights, o.h].sort((a, b) => a - b)).map((h) => ({ value: h, label: `${h}′` }))}
              onChange={(h) => run(p.onPatch({ h }))}
            />
            <Select
              label="Door color"
              value={o.color ?? 'white'}
              options={ROLLUP_COLORS.map((c) => ({ value: c.key, label: c.name }))}
              onChange={(color) => run(p.onPatch({ color }))}
            />
          </>
        )}
        {o.kind === 'walk' && (
          <Select label="Door style" value={walkDoorType(o.style)?.key ?? 'std'} options={walkOpts} onChange={(style) => run(p.onPatch({ style }))} />
        )}
        {o.kind === 'window' && (
          <Select
            label="Window"
            value={windowType(o.style)?.key ?? 'std'}
            options={winOpts}
            onChange={(style) => {
              const t = windowType(style)!;
              run(p.onPatch({ style, w: t.wIn / 12, h: t.hIn / 12 }));
            }}
          />
        )}
        {o.kind === 'frame' && (
          <>
            <Segmented
              label="For"
              value={o.frame === 'window' ? 'window' : 'door'}
              options={[
                { value: 'door', label: 'Door' },
                { value: 'window', label: 'Window' },
              ]}
              onChange={(frame) => run(p.onPatch({ frame, ...(frame === 'window' ? { h: Math.min(o.h, 3) } : {}) }))}
            />
            <Stepper label="Width" value={o.w} min={1} max={Math.max(1, p.maxFrameW)} onChange={(w) => run(p.onPatch({ w }))} />
            <Stepper label="Height" value={o.h} min={1} max={Math.max(1, p.maxFrameH)} onChange={(h) => run(p.onPatch({ h }))} />
          </>
        )}
      </div>
      <Stepper
        label={`Position: from ${p.posFrom} to the near edge`}
        value={o.pos}
        min={0}
        max={Math.max(0, p.posMax)}
        step={0.5}
        onChange={(v) => run(p.onPos(v))}
      />
      {o.kind === 'frame' && <p className="field-hint">A framed opening is ready for a door or window you supply.</p>}
      {p.impact && (o.kind === 'walk' || o.kind === 'window') && <p className="field-hint">Impact-rated for your area.</p>}
      {p.problem ? <Note tone="warn">{p.problem}</Note> : null}
      {msg ? <Note tone="warn">{msg}</Note> : null}
    </section>
  );
}
