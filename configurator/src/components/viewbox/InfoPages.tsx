import { clientSection, mirror, press, readColors, setSelect } from '@/build/programBridge';
import { Mirror } from './Mirror';

/** The view box's Colors and Client info pages: the program's own Section 11 and Section 1 fields (build page only). */

const LIME = '#a3e635';
const head = 'mb-1.5 font-head text-[10px] uppercase tracking-wide2 text-sub';

export function ColorsPage({ doc }: { doc: Document }) {
  const c = readColors(doc);
  if (!c) return <p className="text-[11px] text-sub">This quote program has no colour section.</p>;
  const wainOn = !!c.wainscot && c.wainscot.checked;
  return (
    <div className="flex flex-col gap-3">
      {[...c.picks.filter((p) => p.id !== 'cwn'), null, ...c.picks.filter((p) => p.id === 'cwn')].map((p) => {
        if (!p)
          return c.wainscot ? (
            <label key="wain" className="flex cursor-pointer items-center gap-2 text-[12px] text-text">
              <input type="checkbox" className="h-4 w-4 accent-teal" checked={wainOn} onChange={() => press(c.wainscot!)} />
              Add wainscot
            </label>
          ) : null;
        const cur = p.options.find((o) => o.value === p.value);
        return (
          <div key={p.id}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="font-head text-[10px] uppercase tracking-wide2 text-sub">{p.label}</span>
              <span className="truncate text-[11px] text-text">{cur ? cur.name + (cur.code && cur.code !== cur.name ? ' · ' + cur.code : '') : 'Not picked'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={p.label + ' colour'}>
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
                    className="flex h-6 items-center justify-center rounded border text-[9px] font-semibold text-sub"
                    style={{
                      background: hex || '#1a2436',
                      borderColor: on ? LIME : '#2a3d55',
                      boxShadow: on ? `0 0 0 2px ${LIME}` : undefined,
                      padding: hex ? undefined : '0 6px',
                      width: hex ? 24 : undefined,
                      minWidth: 24,
                    }}
                  >
                    {hex ? '' : o.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ClientPage({ doc }: { doc: Document }) {
  const sec = clientSection(doc);
  if (!sec) return <p className="text-[11px] text-sub">This quote program has no client section.</p>;
  return (
    <div>
      <p className={head}>Client information</p>
      <Mirror items={mirror(sec)} />
    </div>
  );
}
