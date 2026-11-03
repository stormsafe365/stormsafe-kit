import { useState } from 'react';
import { commitInput, press, setSelect, typeInput, type Ctl, type MirrorItem } from '@/build/programBridge';

/**
 * The program's own fields, drawn for the view box (viewbox.css, the design page's look). Every change goes straight into
 * the real field with the events a rep's click / typing fires (programBridge), so the program prices and saves it exactly
 * as from the left panel.
 */

/** A typed field: keeps your own text while you type (the program reformats it after you leave the field). */
function ProxyInput({ c }: { c: Extract<Ctl, { t: 'input' }> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? c.value;
  const props = {
    value,
    placeholder: c.placeholder,
    'aria-label': c.placeholder || undefined,
    className: 'vb-input',
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
      <select aria-label={label || undefined} className="vb-select" value={c.value} onChange={(e) => setSelect(c.el, e.target.value)}>
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
      <label className="vb-check">
        <input type="checkbox" checked={c.checked} onChange={() => press(c.el)} />
        {c.text || label}
      </label>
    );
  if (c.t === 'button')
    return (
      <button type="button" disabled={c.disabled} aria-pressed={c.active || undefined} onClick={() => press(c.el)} className={`vb-toggle${c.active ? ' on' : ''}`}>
        {c.text}
      </button>
    );
  return <span className="vb-text">{c.text || '—'}</span>;
}

export function Mirror({ items }: { items: MirrorItem[] }) {
  const [rmAsk, setRmAsk] = useState<string | null>(null);
  if (!items.length) return <p className="vb-empty">Nothing to set here.</p>;
  return (
    <div className="vb-fields">
      {items.map((it) => {
        if (it.t === 'note')
          return (
            <p key={it.key} className={`vb-note${it.bad ? ' bad' : ''}`}>
              {it.bad ? '⚠ ' : ''}
              {it.text}
            </p>
          );
        if (it.t === 'head')
          return (
            <div key={it.key} className="vb-sub-head">
              <span>{it.text}</span>
              {it.rm &&
                (rmAsk === it.key ? (
                  <span className="vb-ask">
                    Remove?
                    <button type="button" className="yes" onClick={() => { press(it.rm!); setRmAsk(null); }}>
                      Yes
                    </button>
                    <button type="button" className="no" onClick={() => setRmAsk(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" aria-label={'Remove ' + it.text} title="Remove" className="vb-x" onClick={() => setRmAsk(it.key)}>
                    ×
                  </button>
                ))}
            </div>
          );
        return (
          <div key={it.key} className="vb-field-row">
            {it.label && <span className="vb-field-label">{it.label}</span>}
            <div className="vb-ctls">
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
