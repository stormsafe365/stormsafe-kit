import { useState } from 'react';
import { commitInput, press, setSelect, typeInput, type Ctl, type MirrorItem } from '@/build/programBridge';

/**
 * The program's own fields, drawn small for the view box. Every change goes straight into the real field with the
 * events a rep's click / typing fires (programBridge), so the program prices and saves it exactly as from the left panel.
 */

const LIME = '#a3e635';
const ORANGE = '#f0883e';

export const fieldCls =
  'w-full min-w-0 rounded-md border border-border-vis bg-dark-3 px-2 py-1 text-[12px] text-text outline-none focus:border-teal';

/** A typed field: keeps your own text while you type (the program reformats it after you leave the field). */
function ProxyInput({ c }: { c: Extract<Ctl, { t: 'input' }> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? c.value;
  const props = {
    value,
    placeholder: c.placeholder,
    'aria-label': c.placeholder || undefined,
    className: fieldCls,
    onFocus: () => setDraft(c.value),
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      typeInput(c.el, e.target.value);
    },
    onBlur: () => {
      commitInput(c.el);
      setDraft(null);
    },
  };
  if (c.type === 'textarea') return <textarea rows={2} {...props} />;
  return (
    <input
      {...props}
      type={c.type === 'number' ? 'number' : c.type === 'email' ? 'email' : 'text'}
      inputMode={c.type === 'number' ? 'decimal' : undefined}
      min={c.min || undefined}
      max={c.max || undefined}
      step={c.step || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Control({ c, label }: { c: Ctl; label: string }) {
  if (c.t === 'select')
    return (
      <select aria-label={label || undefined} className={fieldCls} value={c.value} onChange={(e) => setSelect(c.el, e.target.value)}>
        {c.options.map((o) => (
          <option key={o.value + '|' + o.text} value={o.value} disabled={o.disabled}>
            {o.text}
          </option>
        ))}
      </select>
    );
  if (c.t === 'input') return <ProxyInput c={c} />;
  if (c.t === 'check')
    return (
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text">
        <input type="checkbox" className="h-4 w-4 accent-teal" checked={c.checked} onChange={() => press(c.el)} />
        {c.text || label}
      </label>
    );
  if (c.t === 'button')
    return (
      <button
        type="button"
        disabled={c.disabled}
        aria-pressed={c.active || undefined}
        onClick={() => press(c.el)}
        className="rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40"
        style={c.active ? { borderColor: LIME, color: LIME } : { borderColor: '#2a3d55', color: '#94a3b8' }}
      >
        {c.text}
      </button>
    );
  return <span className="text-[12px] text-text">{c.text || '—'}</span>;
}

export function Mirror({ items }: { items: MirrorItem[] }) {
  const [rmAsk, setRmAsk] = useState<string | null>(null);
  if (!items.length) return <p className="text-[11px] text-sub">Nothing to set here.</p>;
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => {
        if (it.t === 'note')
          return (
            <p key={it.key} className="text-[11px] leading-snug" style={{ color: it.bad ? ORANGE : '#94a3b8' }}>
              {it.bad ? '⚠ ' : ''}
              {it.text}
            </p>
          );
        if (it.t === 'head')
          return (
            <div key={it.key} className="mt-1 flex items-center justify-between border-t border-border pt-2">
              <span className="font-head text-[10px] uppercase tracking-wide2 text-teal">{it.text}</span>
              {it.rm &&
                (rmAsk === it.key ? (
                  <span className="flex items-center gap-1 text-[11px]">
                    <span className="text-sub">Remove?</span>
                    <button type="button" className="rounded px-1.5 py-0.5 font-semibold" style={{ color: ORANGE }} onClick={() => { press(it.rm!); setRmAsk(null); }}>
                      Yes
                    </button>
                    <button type="button" className="rounded px-1.5 py-0.5 text-sub hover:text-text" onClick={() => setRmAsk(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" aria-label={'Remove ' + it.text} title="Remove" className="px-1 text-[14px] leading-none text-muted hover:text-text" onClick={() => setRmAsk(it.key)}>
                    ×
                  </button>
                ))}
            </div>
          );
        return (
          <div key={it.key} className="flex flex-col gap-1">
            {it.label && <span className="text-[10px] font-semibold uppercase tracking-wide text-sub">{it.label}</span>}
            <div className={it.ctls.length > 1 ? 'flex flex-wrap items-center gap-1.5 [&>input]:flex-1 [&>select]:flex-1' : 'flex'}>
              {it.ctls.map((c, i) => (
                <Control key={i} c={c} label={it.label} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
