interface Segment<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: Segment<T>[];
  onChange: (value: T) => void;
  hint?: string;
}

/** Branded segmented toggle used for gauges, orientation, etc. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: SegmentedControlProps<T>) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="font-head text-[11px] uppercase tracking-wide2 text-sub">{label}</label>
        {hint && <span className="text-[10px] text-muted">{hint}</span>}
      </div>
      <div className="grid grid-flow-col gap-1 rounded-lg border border-border bg-dark-3 p-1">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={[
                'rounded-md px-3 py-2 text-center font-body text-[13px] font-600 transition-colors',
                active
                  ? 'bg-teal text-dark'
                  : opt.disabled
                    ? 'cursor-not-allowed text-muted/50'
                    : 'text-sub hover:bg-dark-4 hover:text-text',
              ].join(' ')}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
