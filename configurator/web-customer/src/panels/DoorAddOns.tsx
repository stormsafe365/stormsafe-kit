/**
 * Roll-up door add-ons (owner 10/30/26): a chain hoist and a brush seal, as two checkboxes in lime so they
 * stand out ("most people want both on their doors"). A size that comes with a chain hoist
 * (rules.hoistIncluded, CCI's chart) shows it as included instead of a box to tick. No prices: the rep quotes them.
 * The hidden checkbox sits inside its own row (position: relative), like .toggle: a box that lands
 * elsewhere makes a phone scroll the whole page to it.
 */
import { hoistIncluded } from '../model/rules';

export function DoorAddOns({ w, h, hoist, seal, onHoist, onSeal }: { w: number; h: number; hoist: boolean; seal: boolean; onHoist: (v: boolean) => void; onSeal: (v: boolean) => void }) {
  const incl = hoistIncluded(w, h);
  return (
    <div className="addons" role="group" aria-label="Garage door add-ons">
      {incl ? (
        <div className="addon on is-included">
          <span className="addon-box" aria-hidden="true" />
          <span className="addon-text">
            <span className="addon-name">Chain hoist</span>
            <span className="addon-sub">Comes with this door size.</span>
          </span>
          <span className="addon-tag">Included</span>
        </div>
      ) : (
        <label className={`addon${hoist ? ' on' : ''}`}>
          <input type="checkbox" checked={hoist} onChange={(e) => onHoist(e.target.checked)} />
          <span className="addon-box" aria-hidden="true" />
          <span className="addon-text">
            <span className="addon-name">Add a chain hoist</span>
            <span className="addon-sub">A chain to raise and lower the door by hand.</span>
          </span>
        </label>
      )}
      <label className={`addon${seal ? ' on' : ''}`}>
        <input type="checkbox" checked={seal} onChange={(e) => onSeal(e.target.checked)} />
        <span className="addon-box" aria-hidden="true" />
        <span className="addon-text">
          <span className="addon-name">Add a brush seal</span>
          <span className="addon-sub">Brush strips on the top and sides keep out rain, dust and bugs.</span>
        </span>
      </label>
      {incl ? null : <p className="field-hint addon-hint">Most customers add both.</p>}
    </div>
  );
}
