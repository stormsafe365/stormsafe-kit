import { useState } from 'react';
import { addKind, keyOf, mirror, openCard, pickWall, readAdds, readItem, readItems, readWalls, removeItem, setSelect, type PWall } from '@/build/programBridge';
import { Mirror, fieldCls } from './Mirror';

/**
 * The View page's wall tools (build page only): pick a wall (Section 5's tiles), see what is on it, add to it with the
 * program's own add buttons, and edit an item right here (its card's real fields) or jump to its card on the left.
 */

const LIME = '#a3e635';
const ORANGE = '#f0883e';
const head = 'mb-1.5 font-head text-[10px] uppercase tracking-wide2 text-sub';
// Section 5 KINDS .loc: the location field of a roll-up / walk door / window / lean-to / framed opening
const LOC_FIELDS = '.rloc, .wloc, .nloc, .lts, .fo-loc';

function RemoveAsk({ onYes, label }: { onYes: () => void; label: string }) {
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <button type="button" aria-label={'Remove ' + label} title="Remove" onClick={() => setAsk(true)} className="px-1 text-[15px] leading-none text-muted hover:text-text">
        ×
      </button>
    );
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span className="text-sub">Remove?</span>
      <button type="button" className="rounded px-1.5 py-0.5 font-semibold" style={{ color: ORANGE }} onClick={onYes}>
        Yes
      </button>
      <button type="button" className="rounded px-1.5 py-0.5 text-sub hover:text-text" onClick={() => setAsk(false)}>
        No
      </button>
    </span>
  );
}

/** The item being edited: its card header (title, price, flags), the wall it is on, then its real fields. */
function EditItem({ el, wallLabel, onBack }: { el: HTMLElement; wallLabel: string; onBack: () => void }) {
  const it = readItem(el);
  if (!it) return null;
  // The card header's own wall dropdown (Section 5 moves the item with it, exactly as from the left panel).
  const ws = el.querySelector<HTMLSelectElement>(':scope > .s5-ch .s5-wsel');
  const wsel = ws && !ws.hidden ? ws : null;
  // the Wall dropdown above IS the location field (in the Classic layout the card also shows it as "Location")
  const items = mirror(el, (n) => !!wsel && n.matches(LOC_FIELDS));
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={onBack} className="self-start text-[11px] font-semibold text-teal hover:text-teal-dim">
        ‹ Back to {wallLabel.toLowerCase()}
      </button>
      <div className="rounded-lg border bg-dark p-2" style={{ borderColor: it.flagged ? ORANGE : '#2a3d55' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-sub">{it.kindLabel}</p>
            <p className="text-[13px] font-semibold leading-tight text-text">{it.title}</p>
          </div>
          {it.price && <span className="shrink-0 text-[12px] font-semibold tabular-nums text-text">{it.price}</span>}
        </div>
        {it.sub && (
          <p className="mt-1 text-[11px] leading-snug" style={{ color: it.flagged ? ORANGE : '#94a3b8' }}>
            {it.sub}
          </p>
        )}
      </div>
      {wsel && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-sub">Wall</span>
          <select aria-label="Wall this item is on" className={fieldCls} value={wsel.value} onChange={(e) => setSelect(wsel, e.target.value)}>
            {Array.from(wsel.options).map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.text}
              </option>
            ))}
          </select>
        </div>
      )}
      <Mirror items={items} />
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2">
        <button type="button" onClick={() => openCard(el)} className="rounded-md border border-border-vis px-2 py-1 text-[11px] font-semibold text-sub hover:border-teal hover:text-teal">
          Open its card ↗
        </button>
        <span className="flex items-center gap-2">
          <RemoveAsk
            label={it.title}
            onYes={() => {
              removeItem(el);
              onBack();
            }}
          />
          <button type="button" onClick={onBack} className="rounded-md bg-teal px-3 py-1 text-[11px] font-bold text-dark hover:bg-teal-dim">
            Done
          </button>
        </span>
      </div>
    </div>
  );
}

export function WallTools({ doc, editing, setEditing }: { doc: Document; editing: HTMLElement | null; setEditing: (el: HTMLElement | null) => void }) {
  const [refused, setRefused] = useState<{ label: string; reason: string } | null>(null);
  const walls = readWalls(doc);
  if (!walls || !walls.length) return null;
  const picked = walls.find((w) => w.picked) || walls[0];

  if (editing && editing.isConnected) return <EditItem el={editing} wallLabel={picked.label} onBack={() => setEditing(null)} />;

  const items = readItems(doc, picked.k);
  const adds = readAdds(doc);
  const pick = (k: PWall) => {
    setRefused(null);
    pickWall(doc, k);
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className={head}>Wall</p>
        <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Wall">
          {walls.map((w) => (
            <button
              key={w.k}
              type="button"
              role="radio"
              aria-checked={w.picked}
              onClick={() => pick(w.k)}
              className="flex flex-col items-start rounded-md border bg-dark-3 px-2 py-1 text-left transition-colors hover:border-teal"
              style={w.picked ? { borderColor: LIME, boxShadow: `inset 0 0 0 1px ${LIME}` } : { borderColor: '#2a3d55' }}
            >
              <span className="text-[11px] font-semibold" style={{ color: w.picked ? LIME : '#e2e8f0' }}>
                {w.label}
              </span>
              <span className="text-[10px] text-muted">{w.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className={head}>On the {picked.label.toLowerCase()}</p>
        {items.length ? (
          <ul className="flex flex-col gap-1">
            {items.map((it) => (
              <li key={keyOf(it.el)} className="rounded-md border bg-dark px-2 py-1.5" style={{ borderColor: it.flagged ? ORANGE : '#1e2d42' }}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setEditing(it.el)} className="min-w-0 flex-1 text-left" title="Edit it here">
                    <span className="block truncate text-[12px] font-semibold text-text">{it.title}</span>
                    {it.sub && (
                      <span className="block truncate text-[10.5px]" style={{ color: it.flagged ? ORANGE : '#64748b' }}>
                        {it.sub}
                      </span>
                    )}
                  </button>
                  {it.price && <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-sub">{it.price}</span>}
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <button type="button" onClick={() => setEditing(it.el)} className="text-[11px] font-semibold text-teal hover:text-teal-dim">
                    Edit
                  </button>
                  <button type="button" onClick={() => openCard(it.el)} className="text-[11px] font-semibold text-sub hover:text-teal">
                    Card ↗
                  </button>
                  <span className="ml-auto">
                    <RemoveAsk label={it.title} onYes={() => removeItem(it.el)} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted">Nothing on this wall yet.</p>
        )}
      </div>

      <div>
        <p className={head}>Add to the {picked.label.toLowerCase()}</p>
        <div className="grid grid-cols-2 gap-1">
          {adds.map((a) => (
            <button
              key={a.kind}
              type="button"
              disabled={a.disabled}
              title={a.title || undefined}
              onClick={() => {
                setRefused(null);
                const r = addKind(doc, a.kind);
                if (r.el) setEditing(r.el);
                else setRefused({ label: a.label, reason: r.reason });
              }}
              className="rounded-md border border-dashed border-teal/60 px-2 py-1.5 text-left text-[11px] font-semibold text-teal transition-colors hover:bg-teal-glow disabled:cursor-not-allowed disabled:border-border-vis disabled:text-muted"
            >
              + {a.label}
            </button>
          ))}
        </div>
        {refused && (
          <p className="mt-1.5 text-[11px] leading-snug" style={{ color: ORANGE }} role="status">
            ⚠ {refused.reason || refused.label + ' wasn’t added. The program’s message on the left says why.'}
          </p>
        )}
      </div>
    </div>
  );
}
