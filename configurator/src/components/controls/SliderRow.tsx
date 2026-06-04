import { useEffect, useState } from 'react';

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  /** Optional formatter for the displayed value (read-only when set). */
  format?: (value: number) => string;
}

/**
 * Labeled range input. When `format` is omitted the value is an editable number
 * field too — drag the slider OR type a size manually (committed on blur/Enter;
 * the store still snaps it to the allowed step).
 */
export function SliderRow({ label, value, min, max, step, unit = 'ft', onChange, format }: SliderRowProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = Number(text);
    if (!Number.isNaN(n)) onChange(n);
    else setText(String(value));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="font-head text-[11px] uppercase tracking-wide2 text-sub">{label}</label>
        {format ? (
          <span className="font-head text-sm font-700 text-teal">{format(value)}</span>
        ) : (
          <span className="flex items-baseline gap-0.5">
            <input
              type="number"
              value={text}
              min={min}
              max={max}
              step={step}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              aria-label={`${label} value`}
              className="w-14 rounded border border-border-vis bg-dark-3 px-1.5 py-0.5 text-right font-head text-sm font-700 text-teal"
            />
            {unit && <span className="text-[11px] text-teal">'</span>}
          </span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-dark-4 accent-teal"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>
          {min}
          {unit && `'`}
        </span>
        <span>
          {max}
          {unit && `'`}
        </span>
      </div>
    </div>
  );
}
