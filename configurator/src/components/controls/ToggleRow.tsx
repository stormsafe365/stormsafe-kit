interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Branded on/off switch row for boolean options (snow load, enclosed, …). */
export function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left"
    >
      <span>
        <span className="block font-head text-[11px] uppercase tracking-wide2 text-sub">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] text-muted">{description}</span>}
      </span>
      <span
        className={[
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-teal bg-teal/30' : 'border-border-vis bg-dark-3',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-4 w-4 rounded-full transition-all',
            checked ? 'left-[22px] bg-teal' : 'left-0.5 bg-muted',
          ].join(' ')}
        />
      </span>
    </button>
  );
}
