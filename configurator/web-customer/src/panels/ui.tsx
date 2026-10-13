/** Small form controls shared by the panels (hand-written CSS in styles.css). */
import { useId, type ReactNode } from 'react';
import { ftIn, inchLabel } from '@/three/dimLabels';

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export interface Opt<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: Opt<T>[];
  onChange: (v: T) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        className="select"
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: Opt<T>[];
  onChange: (v: T) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? 'on' : ''}
            aria-pressed={o.value === value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

/** Number box with − / + buttons (feet). */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix = 'ft',
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const shown = Math.round(value * 100) / 100;
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="stepper">
        <button type="button" aria-label={`${label}: less`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(clamp(v));
          }}
        />
        <span className="unit">{suffix}</span>
        <button type="button" aria-label={`${label}: more`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
          +
        </button>
      </div>
    </Field>
  );
}

export function Swatches({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ key: string; name: string; hex: string; disabled?: boolean }>;
  onChange: (key: string) => void;
}) {
  const cur = options.find((o) => o.key === value);
  return (
    <div className="field">
      <span className="field-label">
        {label}
        {cur ? <span className="field-value">{cur.name}</span> : null}
      </span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={o.key === value}
            aria-label={o.name}
            title={o.name}
            disabled={o.disabled}
            className={`swatch ${o.key === value ? 'on' : ''}`}
            style={{ background: o.hex }}
            onClick={() => onChange(o.key)}
          />
        ))}
      </div>
    </div>
  );
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return <p className={`note note-${tone}`}>{children}</p>;
}

export function Toggle({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-box" aria-hidden="true" />
      <span className="toggle-text">{label}</span>
    </label>
  );
}

/** "24′", "4′2″" — feet-inches to the 1/8″ with prime glyphs (dimLabels.ftIn). */
export const ft = (v: number) => ftIn(v).replace(/'/g, '′').replace(/"/g, '″');
/** "36″" */
export const inch = (v: number) => inchLabel(v).replace(/"/g, '″');
