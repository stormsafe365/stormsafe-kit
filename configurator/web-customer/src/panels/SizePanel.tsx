import { useWebStore } from '../store';
import type { WebBuildingType, WebDesign } from '../model/design';
import { COMBO_MIN_PART, heightOptions, isWideSpan, LENGTH_MAX, LENGTH_MIN, panelsLocked, pitchRise, roofStyleLocked, ROOF_VERTICAL_OVER_LENGTH, widthOptions, wallTakesOpenings } from '../model/rules';
import { Note, Segmented, Select, SpecTile, ft } from './ui';

/** Every whole foot from a to b, as drop-down choices (owner 10/18/26: length a drop-down like width). */
const feet = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => ({ value: a + i, label: `${a + i}′` }));
import { BARNS, STYLES } from '../model/guide';

/** Pictures made from our own 3D model (the guided questions' cards). */
const PICTURE = (k: string) => new URL(`../assets/guide/${k}.jpg`, import.meta.url).href;
const TYPE_PIC: Record<WebBuildingType, string> = { garage: 'garage', carport: 'carport', combo: 'utility' };

/** Small line icons for the size tiles. */
function DimIcon({ k }: { k: 'w' | 'l' | 'h' }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {k === 'w' ? <path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3" /> : k === 'l' ? <path d="M5 19L19 5M8 19H5v-3M16 5h3v3" /> : <path d="M12 3v18M9 6l3-3 3 3M9 18l3 3 3-3" />}
    </svg>
  );
}

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
  if (!isWideSpan(d.width) || t !== 'combo') return;
  d.width = 30; // a garage + carport (the quote's GCH) is 12′–30′ wide; a garage or carport keeps its wide span
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
        // one short line (owner 10/18/26: the boxed "Your building style" took too much room)
        <div className="stylecard">
          <img className="stylecard-pic" src={PICTURE(chosen.leanTos && guideBarn ? `barn-${guideBarn}` : chosen.key)} alt="" width="96" height="60" decoding="async" />
          <div className="stylecard-text">
            <span className="stylecard-k">Your style</span>
            <strong className="stylecard-name">{chosenName}</strong>
          </div>
          <button type="button" className="btn-ghost stylecard-btn" onClick={() => setGuide('style')}>
            Change
          </button>
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
              <img className="card-pic" src={PICTURE(TYPE_PIC[t.value])} alt="" width="96" height="60" decoding="async" />
              <span className="card-title">{t.label}</span>
              <span className="card-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      )}

      {/* V2 round 3: the size as three spec tiles (tap one: the same choices as before) + a live readout */}
      <div className="specs" role="group" aria-label="Size">
        <SpecTile
          label="Width"
          icon={<DimIcon k="w" />}
          value={d.width}
          display={ft(d.width)}
          note={isWideSpan(d.width) ? 'Wide span' : undefined}
          options={widthOptions(d.type).map((w) => ({ value: w, label: `${w}′${isWideSpan(w) ? ' (wide span)' : ''}` }))}
          onChange={(w) => update((x) => void (x.width = w))}
        />
        <SpecTile
          label={d.type === 'combo' ? 'Total length' : 'Length'}
          icon={<DimIcon k="l" />}
          value={d.length}
          display={ft(d.length)}
          options={feet(LENGTH_MIN, LENGTH_MAX)}
          onChange={(l) => update((x) => void (x.length = l))}
        />
        <SpecTile
          label="Wall height"
          icon={<DimIcon k="h" />}
          value={d.height}
          display={ft(d.height)}
          options={heightOptions(d.width).map((h) => ({ value: h, label: `${h}′` }))}
          onChange={(h) => update((x) => void (x.height = h))}
        />
      </div>
      <p className="readout" aria-live="polite">
        <span className="readout-k">Your building</span>
        <span className="readout-v">
          <b>{ft(d.width)}</b> W <i>×</i> <b>{ft(d.length)}</b> L <i>×</i> <b>{ft(d.height)}</b> H
        </span>
      </p>

      {/* the ZIP box is on the last step only (owner 10/17/26: one thing at a time, no long screens) */}

      {d.type === 'combo' && (
        <Select
          label="Closed room length (in back)"
          value={d.enclosedLength}
          options={feet(COMBO_MIN_PART, d.length - COMBO_MIN_PART)}
          onChange={(v) => update((x) => void (x.enclosedLength = v))}
          hint={`Open carport in front: ${ft(d.length - d.enclosedLength)}`}
        />
      )}

      {/* expert choices, folded away: most people keep them as they are (walkthroughs 10/16/26) */}
      <details className="more">
        <summary>More options: roof &amp; wall panels <span className="muted">(most keep these)</span></summary>
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
          { value: '6:12', label: '6:12 (steepest)' },
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
