import { clientSection, mirror, press, readColors, setSelect } from '@/build/programBridge';
import { Mirror } from './Mirror';

/** The view box's Colors and Client info pages: the program's own Section 11 and Section 1 fields (build page only). */

export function ColorsPage({ doc }: { doc: Document }) {
  const c = readColors(doc);
  if (!c) return <p className="vb-empty">This quote program has no colour section.</p>;
  const wainOn = !!c.wainscot && c.wainscot.checked;
  return (
    <>
      <p className="vb-step-h" style={{ marginTop: 0 }}>
        Tap a colour. The 3D and the left panel change with it.
      </p>
      {[...c.picks.filter((p) => p.id !== 'cwn'), null, ...c.picks.filter((p) => p.id === 'cwn')].map((p) => {
        if (!p)
          return c.wainscot ? (
            <label key="wain" className="vb-card vb-color vb-check">
              <input type="checkbox" checked={wainOn} onChange={() => press(c.wainscot!)} />
              Add wainscot
            </label>
          ) : null;
        const cur = p.options.find((o) => o.value === p.value);
        return (
          <div key={p.id} className="vb-card vb-color">
            <div className="vb-color-head">
              <span className="vb-label" style={{ margin: 0 }}>
                {p.label}
              </span>
              <span className="vb-color-name">{cur ? cur.name + (cur.code && cur.code !== cur.name ? ' · ' + cur.code : '') : 'Not picked'}</span>
            </div>
            <div className="vb-swatches" role="radiogroup" aria-label={p.label + ' colour'}>
              {p.options.map((o) => {
                const on = o.value === p.value;
                const hex = /^#[0-9a-f]{3,8}$/i.test(o.value) ? o.value : '';
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={o.name}
                    title={o.name + (o.code ? ' (' + o.code + ')' : '')}
                    onClick={() => setSelect(p.el, o.value)}
                    className={`vb-swatch${hex ? '' : ' word'}${on ? ' on' : ''}`}
                    style={hex ? { background: hex } : undefined}
                  >
                    {hex ? '' : o.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function ClientPage({ doc }: { doc: Document }) {
  const sec = clientSection(doc);
  if (!sec) return <p className="vb-empty">This quote program has no client section.</p>;
  return (
    <>
      <p className="vb-step-h" style={{ marginTop: 0 }}>
        The same fields as the top of the left panel. Type in either one.
      </p>
      <div className="vb-card" style={{ padding: '12px' }}>
        <Mirror items={mirror(sec)} />
      </div>
    </>
  );
}
