import { useState } from 'react';
import { COLOR_SWATCHES, swatch } from '@/config/colors';

interface ColorPickerProps {
  label: string;
  value: string; // swatch code
  onChange: (code: string) => void;
}

/** Compact swatch field: shows the current color; click to open the palette. */
export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const current = swatch(value);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-dark-3 px-3 py-2 transition-colors hover:border-teal"
      >
        <span className="font-head text-[11px] uppercase tracking-wide2 text-sub">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text">{current.name}</span>
          <span
            className="h-5 w-5 rounded border border-border-vis"
            style={{ background: current.hex }}
          />
        </span>
      </button>

      {open && (
        <div className="mt-2 grid grid-cols-6 gap-1.5 rounded-lg border border-border bg-dark-3 p-2">
          {COLOR_SWATCHES.map((s) => {
            const active = s.code === value;
            return (
              <button
                key={s.code}
                type="button"
                title={`${s.name} · ${s.code}`}
                onClick={() => {
                  onChange(s.code);
                  setOpen(false);
                }}
                className={[
                  'h-7 w-full rounded border transition-transform hover:scale-110',
                  active ? 'border-teal ring-1 ring-teal' : 'border-border-vis',
                ].join(' ')}
                style={{ background: s.hex }}
                aria-label={s.name}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
