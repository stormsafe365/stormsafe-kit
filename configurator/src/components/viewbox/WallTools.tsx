import { useState } from 'react';
import { addKind, keyOf, mirror, openCard, pickWall, readAdds, readItem, readItems, readWalls, removeItem, setSelect, type PWall, type WallTile } from '@/build/programBridge';
import { Mirror } from './Mirror';

/**
 * The View page's wall tools (build page only), in the customer design page's look (owner 11/3/26): 1 pick a wall
 * (Section 5's tiles), 2 add to it (the program's own add buttons), 3 what is on it — each item edited right here (its
 * card's real fields) or opened on the left.
 */

// Section 5 KINDS .loc: the location field of a roll-up / walk door / window / lean-to / framed opening
const LOC_FIELDS = '.rloc, .wloc, .nloc, .lts, .fo-loc';

/** A big-ish numbered step, as on the design page: "1  Pick a wall" + one plain line of help. */
function Step({ n, title, help }: { n: number; title: string; help?: string }) {
  return (
    <div className="vb-step">
      <span className="vb-step-n" aria-hidden="true">
        {n}
      </span>
      <div>
        <h3 className="vb-step-t">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        {help ? <p className="vb-step-h">{help}</p> : null}
      </div>
    </div>
  );
}

/** A tiny wall outline: a gable end (with its roof peak) or a long side (the design page's WallIcon). */
function WallIcon({ shape }: { shape: 'gable' | 'side' }) {
  return (
    <svg className="vb-wall-icon" viewBox="0 0 44 28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shape === 'gable' ? <path d="M12 26V12L22 4l10 8v14z" /> : <path d="M3 26V10h38v16z" />}
      <path d="M1 26.5h42" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

/** Line pictures for the five things the program adds (the design page's KindIcon + a lean-to). */
function KindIcon({ k }: { k: string }) {
  return (
    <svg className="vb-kind-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {k === 're' ? (
        <>
          <rect x="6" y="8" width="28" height="26" rx="1.5" />
          <path d="M6 14h28M6 19h28M6 24h28M6 29h28" />
        </>
      ) : k === 'we' ? (
        <>
          <rect x="11" y="5" width="18" height="30" rx="1.5" />
          <circle cx="25" cy="21" r="1.6" fill="currentColor" />
        </>
      ) : k === 'ne' ? (
        <>
          <rect x="7" y="9" width="26" height="22" rx="1.5" />
          <path d="M20 9v22M7 20h26" />
        </>
      ) : k === 'lte' ? (
        <>
          <path d="M4 34V17l10-8 10 8v17" />
          <path d="M24 19l12 5v10" />
          <path d="M2 34h36" />
        </>
      ) : (
        <>
          <path d="M9 35V7h22v28" />
          <path d="M5 35h30" strokeDasharray="3 3" />
        </>
      )}
    </svg>
  );
}

/** The wall's size line ("30′ end", "45′ long side") and its count line, from the program's own fields + tile. */
function wallLines(doc: Document, w: WallTile): { shape: 'gable' | 'side'; size: string; count: string; has: boolean } {
  const num = (id: string) => parseFloat(((doc.getElementById(id) as HTMLInputElement | null) || { value: '' }).value);
  const W = num('bw'), L = num('bl');
  const parts = w.sub.split(' · ');
  const count = parts[parts.length - 1] || '';
  const has = !!count && !/^empty$/i.test(count);
  const countLine = has ? count : 'nothing on it yet';
  if (w.k === 'front' || w.k === 'back') return { shape: 'gable', size: W > 0 ? `${W}′ end` : 'end wall', count: countLine, has };
  if (w.k === 'left' || w.k === 'right') return { shape: 'side', size: L > 0 ? `${L}′ long side` : 'long side', count: countLine, has };
  return { shape: 'gable', size: parts.length > 1 ? parts[0] : 'inside wall', count: countLine, has };
}

function RemoveAsk({ onYes, label }: { onYes: () => void; label: string }) {
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <button type="button" aria-label={'Remove ' + label} title="Remove" onClick={() => setAsk(true)} className="vb-x">
        ×
      </button>
    );
  return (
    <span className="vb-ask">
      Remove?
      <button type="button" className="yes" onClick={onYes}>
        Yes
      </button>
      <button type="button" className="no" onClick={() => setAsk(false)}>
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
  // the Wall dropdown below IS the location field (in the Classic layout the card also shows it as "Location")
  const items = mirror(el, (n) => !!wsel && n.matches(LOC_FIELDS));
  return (
    <div className="vb-fields">
      <button type="button" onClick={onBack} className="vb-back">
        ‹ Back to the {wallLabel.toLowerCase()}
      </button>
      <div className={`vb-card vb-head-card${it.flagged ? ' vb-item flag' : ''}`}>
        <div className="vb-item-top">
          <div className="vb-item-main">
            <span className="vb-item-kind">{it.kindLabel}</span>
            <span className="vb-item-title" style={{ whiteSpace: 'normal' }}>
              {it.title}
            </span>
          </div>
          {it.price && <span className="vb-price">{it.price}</span>}
        </div>
        {it.sub && (
          <span className="vb-item-sub" style={{ whiteSpace: 'normal' }}>
            {it.sub}
          </span>
        )}
      </div>
      {wsel && (
        <div className="vb-field-row">
          <span className="vb-field-label">Wall</span>
          <select aria-label="Wall this item is on" className="vb-select" value={wsel.value} onChange={(e) => setSelect(wsel, e.target.value)}>
            {Array.from(wsel.options).map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.text}
              </option>
            ))}
          </select>
        </div>
      )}
      <Mirror items={items} />
      <div className="vb-foot">
        <button type="button" onClick={() => openCard(el)} className="vb-ghost">
          Open its card ↗
        </button>
        <span style={{ flex: 1 }} />
        <RemoveAsk
          label={it.title}
          onYes={() => {
            removeItem(el);
            onBack();
          }}
        />
        <button type="button" onClick={onBack} className="vb-primary">
          Done
        </button>
      </div>
    </div>
  );
}

export function WallTools({ doc, editing, setEditing }: { doc: Document; editing: HTMLElement | null; setEditing: (el: HTMLElement | null) => void }) {
  const [refused, setRefused] = useState<{ label: string; reason: string } | null>(null);
  const walls = readWalls(doc);
  if (!walls || !walls.length) return null;
  const picked = walls.find((w) => w.picked) || walls[0];
  const wallName = picked.label.toLowerCase();

  if (editing && editing.isConnected) return <EditItem el={editing} wallLabel={picked.label} onBack={() => setEditing(null)} />;

  const items = readItems(doc, picked.k);
  const adds = readAdds(doc);
  const pick = (k: PWall) => {
    setRefused(null);
    pickWall(doc, k);
  };
  return (
    <>
      <Step n={1} title="Pick a wall" help="Tap the wall you want to add to, or click it on the model. The 3D turns to it." />
      <div className="vb-walls" role="radiogroup" aria-label="Pick a wall">
        {walls.map((w) => {
          const l = wallLines(doc, w);
          return (
            <button key={w.k} type="button" role="radio" aria-checked={w.picked} onClick={() => pick(w.k)} className={`vb-card vb-wall${w.picked ? ' on' : ''}`}>
              <WallIcon shape={l.shape} />
              <span className="vb-wall-name">{w.label}</span>
              <span className="vb-wall-size">{l.size}</span>
              <span className={`vb-wall-n${l.has ? ' has' : ''}`}>{l.count}</span>
            </button>
          );
        })}
      </div>

      <Step n={2} title={`Add to the ${wallName}`} />
      <div className="vb-tiles" role="group" aria-label={`Add to the ${wallName}`}>
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
            className="vb-card vb-tile"
          >
            <KindIcon k={a.kind} />
            <span className="vb-tile-name">{a.label}</span>
            {a.disabled ? <span className="vb-tile-why">Not on this wall</span> : null}
          </button>
        ))}
      </div>
      {refused && (
        <p className="vb-warn" role="status">
          ⚠ {refused.reason || refused.label + ' wasn’t added. The program’s message on the left says why.'}
        </p>
      )}

      <Step n={3} title={`On the ${wallName}${items.length ? ` (${items.length})` : ''}`} help={items.length ? 'Tap one to change it here, or open its card on the left.' : undefined} />
      {items.length ? (
        <ul className="vb-placed">
          {items.map((it) => (
            <li key={keyOf(it.el)} className={`vb-card vb-item${it.flagged ? ' flag' : ''}`}>
              <div className="vb-item-top">
                <button type="button" onClick={() => setEditing(it.el)} className="vb-item-main" title="Change it here">
                  <span className="vb-item-kind">{it.kindLabel}</span>
                  <span className="vb-item-title">{it.title}</span>
                  {it.sub && <span className="vb-item-sub">{it.sub}</span>}
                </button>
                {it.price && <span className="vb-price">{it.price}</span>}
              </div>
              <div className="vb-item-acts">
                <button type="button" onClick={() => setEditing(it.el)} className="vb-link">
                  Edit
                </button>
                <button type="button" onClick={() => openCard(it.el)} className="vb-link quiet">
                  Card ↗
                </button>
                <RemoveAsk label={it.title} onYes={() => removeItem(it.el)} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vb-empty">Nothing on the {wallName} yet.</p>
      )}
    </>
  );
}
