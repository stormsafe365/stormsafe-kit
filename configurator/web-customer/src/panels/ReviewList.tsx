/**
 * "Your design" - everything picked, in plain words, one row per step with a Change button that goes
 * back to that step (owner 10/17/26: "very difficult to go back & look at their selections and make
 * adjustments"). Shown at the top of the last step, above the send form. Words only; no prices.
 */
import { useWebStore, type TabKey } from '../store';
import { colorByKey } from '../model/catalog';
import { LEANTO_SIDE_LABEL, TYPE_LABEL, WALL_LABEL, type WebDesign } from '../model/design';
import { upgradeLines } from '../model/spec';
import { addOnText, partTitle } from './PartEditor';
import { ft } from './ui';

const colorName = (key: string) => colorByKey(key)?.name ?? key;

export interface ReviewRow {
  key: TabKey;
  label: string;
  lines: string[];
}

/** The rows, in step order (pure: tested). */
export function reviewRows(d: WebDesign): ReviewRow[] {
  const building = `${TYPE_LABEL[d.type]}${d.width >= 32 ? ' (wide span)' : ''}: ${ft(d.width)} W × ${ft(d.length)} L × ${ft(d.height)} H`;
  const sizeLines = [building];
  if (d.type === 'combo') sizeLines.push(`Closed room ${ft(d.enclosedLength)} long in back, open carport ${ft(d.length - d.enclosedLength)} in front`);
  const parts = d.openings.map((o) => `${partTitle(o)}${addOnText(o)} · ${WALL_LABEL[o.wall]}`);
  const lean = d.leanTos.map(
    (lt) =>
      `${LEANTO_SIDE_LABEL[lt.side]}: ${ft(lt.width)} wide, ${lt.enclosure === 'open' ? 'open' : lt.enclosure === 'enclosed' ? 'closed in' : 'some walls closed'}${lt.openings.length ? `, ${lt.openings.length} door${lt.openings.length === 1 ? '' : 's'} / window${lt.openings.length === 1 ? '' : 's'}` : ''}`,
  );
  const ups = upgradeLines(d);
  return [
    { key: 'size', label: 'Building', lines: sizeLines },
    { key: 'doors', label: 'Doors & windows', lines: parts.length ? parts : ['None yet'] },
    { key: 'leantos', label: 'Lean-tos', lines: lean.length ? lean : ['None'] },
    { key: 'upgrades', label: 'Upgrades', lines: ups.length ? ups : ['None'] },
    { key: 'colors', label: 'Colors', lines: [`Roof ${colorName(d.colors.roof)} · Walls ${colorName(d.colors.walls)} · Trim ${colorName(d.colors.trim)}`] },
  ];
}

export function ReviewList() {
  const d = useWebStore((s) => s.design);
  const setTab = useWebStore((s) => s.setTab);
  return (
    <section className="review" aria-label="Your design">
      <h3 className="review-h">Your design</h3>
      <p className="field-hint">Look it over. Tap Change to fix anything.</p>
      <ul className="review-list">
        {reviewRows(d).map((r) => (
          <li key={r.key} className="review-row">
            <div className="review-main">
              <span className="review-k">{r.label}</span>
              {r.lines.map((t, i) => (
                <span key={i} className="review-v">
                  {t}
                </span>
              ))}
            </div>
            <button type="button" className="btn-ghost review-change" onClick={() => setTab(r.key)} aria-label={`Change ${r.label.toLowerCase()}`}>
              Change
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
