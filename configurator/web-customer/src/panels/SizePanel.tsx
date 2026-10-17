import { useWebStore } from '../store';
import type { WebBuildingType, WebDesign } from '../model/design';
import { COMBO_MIN_PART, heightOptions, isWideSpan, LENGTH_MAX, LENGTH_MIN, panelsLocked, pitchRise, roofStyleLocked, ROOF_VERTICAL_OVER_LENGTH, widthOptions, wallTakesOpenings } from '../model/rules';
import { Note, Segmented, Select, Stepper, ft } from './ui';
import { LocationField } from './LocationField';
import { BARNS, STYLES } from '../model/guide';

const TYPES: Array<{ value: WebBuildingType; label: string; blurb: string }> = [
  { value: 'garage', label: 'Garage', blurb: 'Closed on all sides' },
  { value: 'carport', label: 'Carport', blurb: 'A roof with open sides' },
  // a storage room in back is this one (walkthrough 10/16/26: 'carport for my RV with a storage room in back')
  { value: 'combo', label: 'Garage + Carport', blurb: 'Closed room in back, open carport in front' },
];

/** Switching the building type resets the walls the way the quote does. */
export function applyType(d: WebDesign, t: WebBuildingType) {
  if (d.type === t) return;
  const from = d.type;
  d.type = t;
  if (t === 'garage') d.walls = { front: 'closed', back: 'closed', left: 'closed', right: 'closed' };
  if (t === 'carport') d.walls = { front: 'open', back: 'open', left: 'open', right: 'open' };
  if (t === 'combo') {
    d.walls = { front: 'open', back: 'closed', left: 'open', right: 'open' };
    d.enclosedLength = Math.max(COMBO_MIN_PART, Math.min(d.length - COMBO_MIN_PART, Math.round(d.length * 0.6)));
    // The front end becomes the open carport: its doors move to the divider wall.
    for (const o of d.openings) if (o.wall === 'front') o.wall = 'partition';
  }
  if (from === 'combo') for (const o of d.openings) if (o.wall === 'partition') o.wall = 'front';
  // Doors on walls that are now open go away with the type change.
  d.openings = d.openings.filter((o) => wallTakesOpenings(d, o.wall));
  if (!isWideSpan(d.width) || t === 'garage') return;
  d.width = 30; // wide span is a garage only
}

export function SizePanel() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  const roofLocked = roofStyleLocked(d);
  // a style picked in the guided questions is not asked again here: it is shown, with a way to change it
  const guideStyle = useWebStore((s) => s.guideStyle);
  const guideBarn = useWebStore((s) => s.guideBarn);
  const setGuide = useWebStore((s) => s.setGuide);
  const chosen = STYLES.find((x) => x.key === guideStyle) ?? null;
  const chosenName = chosen ? (chosen.leanTos && guideBarn ? BARNS.find((b) => b.key === guideBarn)?.title ?? chosen.title : chosen.title) : '';
  const rise = d.width > 31 ? 2 : 3;
  return (
    <div className="panel-body">
      {chosen ? (
        <div className="field">
          <span className="field-label">Your building style</span>
          <div className="chosen-style">
            <strong>{chosenName}</strong>
            <button type="button" className="btn-ghost" onClick={() => setGuide('style')}>
              Change
            </button>
          </div>
        </div>
      ) : (
      <div className="field">
        <span className="field-label">Building type</span>
        <div className="cards" role="group" aria-label="Building type">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`card ${d.type === t.value ? 'on' : ''}`}
              aria-pressed={d.type === t.value}
              onClick={() => update((x) => applyType(x, t.value))}
            >
              <span className="card-title">{t.label}</span>
              <span className="card-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      )}

      <div className="row3">
        <Select
          label="Width"
          value={d.width}
          options={widthOptions(d.type).map((w) => ({ value: w, label: `${w}′${isWideSpan(w) ? ' (wide span)' : ''}` }))}
          onChange={(w) => update((x) => void (x.width = w))}
        />
        <Stepper label={d.type === 'combo' ? 'Total length (carport + room)' : 'Length'} value={d.length} min={LENGTH_MIN} max={LENGTH_MAX} onChange={(l) => update((x) => void (x.length = Math.round(l)))} />
        <Select
          label="Height (side walls)"
          value={d.height}
          options={heightOptions(d.width).map((h) => ({ value: h, label: `${h}′` }))}
          onChange={(h) => update((x) => void (x.height = h))}
        />
      </div>
      <p className="dims-line">
        {ft(d.width)} W × {ft(d.length)} L × {ft(d.height)} H <span className="muted">· width × length × side-wall height</span>
      </p>

      {/* after the size (walkthroughs 10/16/26: a ZIP box first read as "must fill this in now") */}
      <LocationField label="ZIP code where it will go (optional)" />

      {d.type === 'combo' && (
        <Stepper
          label="Closed room length (in back)"
          value={d.enclosedLength}
          min={COMBO_MIN_PART}
          max={d.length - COMBO_MIN_PART}
          onChange={(v) => update((x) => void (x.enclosedLength = Math.round(v)))}
          hint={`Open carport in front: ${ft(d.length - d.enclosedLength)}`}
        />
      )}

      {/* expert choices, folded away: most people keep them as they are (walkthroughs 10/16/26) */}
      <details className="more">
        <summary>More options: roof style, roof pitch, wall panels <span className="muted">(most people keep these)</span></summary>
        <div className="more-body">
      <Segmented
        label="Roof style"
        value={d.roofStyle}
        options={[
          { value: 'Vertical', label: 'Vertical' },
          { value: 'Boxed Eave', label: 'Boxed eave', disabled: roofLocked },
          { value: 'Regular', label: 'Regular', disabled: roofLocked },
        ]}
        onChange={(v) => update((x) => void (x.roofStyle = v))}
        hint={
          roofLocked
            ? isWideSpan(d.width)
              ? 'Wide-span buildings use a vertical roof.'
              : `Buildings over ${ROOF_VERTICAL_OVER_LENGTH}′ long use a vertical roof.`
            : 'Vertical roof panels shed water best; boxed-eave and regular roofs run the panels lengthwise.'
        }
      />

      <Select
        label="Roof pitch"
        value={d.pitch}
        options={[
          { value: 'standard', label: `Standard ${rise}:12` },
          { value: '4:12', label: '4:12 (steeper)' },
          { value: '5:12', label: '5:12 (steeper)' },
        ]}
        onChange={(v) => update((x) => void (x.pitch = v))}
        hint={`Roof rises ${pitchRise(d)}″ for every 12″ across.`}
      />

      <Segmented
        label="Wall panels"
        value={d.panels}
        options={[
          { value: 'Horizontal', label: 'Horizontal', disabled: panelsLocked(d) },
          { value: 'Vertical', label: 'Vertical' },
        ]}
        onChange={(v) => update((x) => void (x.panels = v))}
        hint={panelsLocked(d) ? 'Wide-span buildings use vertical wall panels.' : undefined}
      />
        </div>
      </details>

      {isWideSpan(d.width) && <Note>Wide span (32′ and wider): vertical roof and vertical wall panels, eave height 8′ to 20′.</Note>}
    </div>
  );
}
