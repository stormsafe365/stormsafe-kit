import type { Opening, OpeningType, WallSide } from '@/types/building';
import { OPENING_DEFAULTS } from '@/types/building';
import { useBuildingStore } from '@/store/useBuildingStore';
import { useEditorStore } from '@/store/useEditorStore';
import { useResolvedBuilding } from '@/engine/useResolvedBuilding';
import { clampOffset } from '@/engine/layout';
import type { WallLayout } from '@/engine/geometry';
import {
  BUILDING_TYPES,
  LEG_HEIGHT_RANGE,
  LENGTH_RANGE,
  SNOW_RANGE,
  WAINSCOT_RANGE,
  WIDTH_RANGE,
  WIND_RANGE,
} from '@/config/constants';
import { Section } from './controls/Section';
import { SliderRow } from './controls/SliderRow';
import { SegmentedControl } from './controls/SegmentedControl';
import { ColorPicker } from './controls/ColorPicker';
import { ToggleRow } from './controls/ToggleRow';

const ADD_TYPES: OpeningType[] = ['rollUpDoor', 'garageDoor', 'walkDoor', 'window', 'frameOut'];

/** Bare steel thickness behind each framing gauge (in). */
const GAUGE_THICKNESS: Record<string, string> = {
  '14-gauge': '.075"',
  '12-gauge': '.105"',
};

export function Sidebar() {
  const store = useBuildingStore();
  const { resolved, structure } = useResolvedBuilding();
  const { requiresHatChannels, legSpacing, frameCount, notes } = resolved;

  const { activeWall, setActiveWall, selectOpening, selectedOpeningId } = useEditorStore();
  const selectedOpening = store.openings.find((o) => o.id === selectedOpeningId);
  const availableWalls = (Object.keys(structure.walls) as WallSide[]).filter(
    (w) => structure.walls[w].available,
  );
  const targetWall: WallSide | undefined = availableWalls.includes(activeWall)
    ? activeWall
    : availableWalls[0];

  const addOpening = (type: OpeningType) => {
    if (!targetWall) return;
    const id = store.addOpening(type, targetWall);
    setActiveWall(targetWall);
    selectOpening(id); // drops it on the 3D model, selected & ready to drag
  };

  return (
    <aside className="scroll-thin flex h-full w-full flex-col overflow-y-auto border-r border-border bg-dark-2">
      <header className="border-b border-border px-5 py-4">
        <p className="font-head text-base font-800 uppercase tracking-brand text-text">
          Storm<span className="text-teal">Safe</span> Steel
        </p>
        <p className="mt-0.5 font-head text-[10px] uppercase tracking-wide2 text-sub">
          Hurricane-Rated Build Configurator
        </p>
      </header>

      {/* BUILDING TYPE + DIMENSIONS */}
      <Section eyebrow="01 · Building">
        <SegmentedControl
          label="Type"
          value={store.buildingType}
          onChange={store.setBuildingType}
          options={BUILDING_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
        <SliderRow label="Width" value={store.width} min={WIDTH_RANGE.min} max={WIDTH_RANGE.max} step={WIDTH_RANGE.step} onChange={store.setWidth} />
        <SliderRow label="Length" value={store.length} min={LENGTH_RANGE.min} max={LENGTH_RANGE.max} step={LENGTH_RANGE.step} onChange={store.setLength} />
        <SliderRow label="Leg Height" value={store.legHeight} min={LEG_HEIGHT_RANGE.min} max={LEG_HEIGHT_RANGE.max} step={LEG_HEIGHT_RANGE.step} onChange={store.setLegHeight} />
        <SliderRow label="Roof Pitch" value={store.roofPitch} min={0} max={6} step={1} unit="" onChange={store.setRoofPitch} format={(v) => `${v}:12`} />
        <SegmentedControl
          label="Roof Overhang"
          value={store.roofOverhangFt === 1 ? '12' : '6'}
          onChange={(v) => store.setRoofOverhang(v === '12' ? 1 : 0.5)}
          options={[
            { value: '6', label: '6"' },
            { value: '12', label: '12" (upgrade)' },
          ]}
        />
        {store.buildingType === 'utility' && (
          <>
            <SliderRow
              label="Enclosed Length"
              value={store.enclosedLengthFt}
              min={4}
              max={store.length}
              step={2}
              onChange={store.setEnclosedLength}
            />
            <SegmentedControl
              label="Open Bay End"
              value={store.openEnd}
              onChange={store.setOpenEnd}
              options={[
                { value: 'front', label: 'Front' },
                { value: 'back', label: 'Back' },
              ]}
            />
          </>
        )}
        {(store.buildingType === 'utility' || store.buildingType === 'carport') && (
          <ToggleRow
            label="Gable-End Sheeting"
            description="Sheet the gable triangle over the open end (RV-shelter style)"
            checked={store.openEndGableSheeting}
            onChange={store.setOpenEndGableSheeting}
          />
        )}
      </Section>

      {/* STEEL SPEC */}
      <Section eyebrow="02 · Steel & Framing">
        <SegmentedControl
          label="Framing Gauge"
          value={resolved.config.framingGauge}
          onChange={store.setFramingGauge}
          options={[
            { value: '14-gauge', label: '14ga · .075"' },
            { value: '12-gauge', label: '12ga · .105"' },
          ]}
        />
        <SegmentedControl
          label="Sheeting Gauge"
          value={store.sheetingGauge}
          onChange={store.setSheetingGauge}
          options={[
            { value: '29-gauge', label: '29-gauge' },
            { value: '26-gauge', label: '26-gauge' },
          ]}
        />
        <SegmentedControl
          label="Wall Orientation"
          value={store.panelOrientation}
          hint={requiresHatChannels ? 'Hat channels on' : undefined}
          onChange={store.setPanelOrientation}
          options={[
            { value: 'Horizontal', label: 'Horizontal' },
            { value: 'Vertical', label: 'Vertical' },
          ]}
        />
        <SegmentedControl
          label="Roof Style"
          value={store.roofOrientation}
          onChange={store.setRoofOrientation}
          options={[
            { value: 'Horizontal', label: 'Horizontal' },
            { value: 'Vertical', label: 'Vertical' },
          ]}
        />
      </Section>

      {/* COLORS & FINISH */}
      <Section eyebrow="03 · Colors & Finish">
        <ColorPicker label="Roof" value={store.colors.roof} onChange={(c) => store.setColor('roof', c)} />
        <ColorPicker label="Walls" value={store.colors.walls} onChange={(c) => store.setColor('walls', c)} />
        <ColorPicker label="Trim" value={store.colors.trim} onChange={(c) => store.setColor('trim', c)} />
        <ToggleRow
          label="Wainscot"
          description="Contrasting band along the bottom of the walls"
          checked={store.wainscot.enabled}
          onChange={store.setWainscotEnabled}
        />
        {store.wainscot.enabled && (
          <>
            <ColorPicker label="Wainscot Color" value={store.colors.wainscot} onChange={(c) => store.setColor('wainscot', c)} />
            <SliderRow
              label="Wainscot Height"
              value={store.wainscot.heightFt}
              min={WAINSCOT_RANGE.min}
              max={WAINSCOT_RANGE.max}
              step={WAINSCOT_RANGE.step}
              onChange={store.setWainscotHeight}
            />
          </>
        )}
      </Section>

      {/* ENGINEERING LOADS */}
      <Section eyebrow="04 · Wind & Snow Loads">
        <SliderRow label="Wind Certification" value={store.windSpeedMph} min={WIND_RANGE.min} max={WIND_RANGE.max} step={WIND_RANGE.step} unit="" onChange={store.setWindSpeed} format={(v) => `${v} mph`} />
        <SliderRow label="Ground Snow" value={store.groundSnowPsf} min={SNOW_RANGE.min} max={SNOW_RANGE.max} step={SNOW_RANGE.step} unit="" onChange={store.setGroundSnow} format={(v) => `${v} psf`} />
      </Section>

      {/* OPENINGS */}
      <Section eyebrow="05 · Doors, Windows & Layout">
        {targetWall ? (
          <>
            {/* Pick which wall to add to */}
            <div className="flex flex-wrap gap-1.5">
              {availableWalls.map((w) => (
                <button
                  key={w}
                  onClick={() => setActiveWall(w)}
                  className={[
                    'rounded-md px-2.5 py-1 font-head text-[10px] uppercase tracking-brand transition-colors',
                    w === targetWall ? 'bg-teal text-dark' : 'bg-dark-3 text-sub hover:text-text',
                  ].join(' ')}
                >
                  {wallLabel(w)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-sub">
              Add to <span className="font-600 text-teal">{wallLabel(targetWall)}</span>, then{' '}
              <span className="text-text">click &amp; drag it on the 3D model</span> to position.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ADD_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => addOpening(t)}
                  className="rounded-lg border border-border-vis bg-dark-3 px-2 py-2 text-left text-[11px] text-text transition-colors hover:border-teal"
                >
                  + {OPENING_DEFAULTS[t].label}
                </button>
              ))}
            </div>
            {store.openings.filter((o) => o.side === targetWall).length >= 1 && (
              <button
                onClick={() => store.distributeOpenings(targetWall, structure.walls[targetWall].spanFt)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-teal/60 bg-teal-glow py-2 font-head text-[11px] uppercase tracking-wide2 text-teal transition-colors hover:bg-teal hover:text-dark"
              >
                ⇿ Space Evenly · {wallLabel(targetWall)}
              </button>
            )}

            {/* All placed components — click to select, 🗑 to remove */}
            {store.openings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-brand text-sub">
                  Components ({store.openings.length})
                </p>
                {store.openings.map((o) => {
                  const active = o.id === selectedOpeningId;
                  return (
                    <div
                      key={o.id}
                      className={[
                        'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5',
                        active ? 'border-teal bg-dark-4' : 'border-border bg-dark-3',
                      ].join(' ')}
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setActiveWall(o.side);
                          selectOpening(o.id);
                        }}
                      >
                        <span className="block truncate text-[11px] text-text">{OPENING_DEFAULTS[o.type].label}</span>
                        <span className="text-[10px] text-muted">
                          {wallLabel(o.side)} · {o.width}×{o.height}
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          store.removeOpening(o.id);
                          if (selectedOpeningId === o.id) selectOpening(null);
                        }}
                        className="shrink-0 rounded border border-border-vis px-1.5 py-1 text-muted hover:border-danger hover:text-danger"
                        aria-label="Delete component"
                        title="Delete"
                      >
                        🗑
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selected component — size/placement edited here; positioned on the 3D model */}
            {selectedOpening ? (
              <SelectedPanel
                opening={selectedOpening}
                wall={structure.walls[selectedOpening.side]}
                availableWalls={availableWalls}
                onUpdate={store.updateOpening}
                onChangeWall={(side) => {
                  const newWall = structure.walls[side];
                  if (!newWall) return;
                  store.updateOpening(selectedOpening.id, {
                    side,
                    offset: clampOffset(selectedOpening.offset, selectedOpening.width, newWall),
                  });
                  setActiveWall(side);
                }}
                onRemove={(id) => {
                  store.removeOpening(id);
                  selectOpening(null);
                }}
              />
            ) : (
              <p className="text-[10px] text-muted">Click a component on the building to edit its size.</p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-sub">
            Carports are open — switch to Garage or Utility to add doors, windows, and frame-outs.
          </p>
        )}
      </Section>

      {/* READOUT */}
      <Section eyebrow="Engineering Readout">
        <dl className="grid grid-cols-2 gap-3">
          <Spec label="Total Sq Footage" value={`${(store.width * store.length).toLocaleString()} sq ft`} />
          <Spec label="Truss Spacing" value={`${legSpacing} ft o.c.`} />
          <Spec label="Number of Trusses" value={`${frameCount}`} />
          <Spec
            label="Framing Gauge"
            value={`${store.framingGauge.replace('-gauge', 'ga')} · ${GAUGE_THICKNESS[store.framingGauge]}`}
          />
        </dl>
        {notes.length > 0 && (
          <ul className="space-y-1.5 rounded-lg border border-border bg-dark-3 p-3">
            {notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-snug text-sub">
                <span className="text-teal">▸</span>
                {n}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={store.reset}
          className="w-full rounded-lg border border-border-vis py-2 font-head text-[11px] uppercase tracking-wide2 text-sub transition-colors hover:border-teal hover:text-teal"
        >
          Reset Build
        </button>
      </Section>
    </aside>
  );
}

function wallLabel(w: WallSide): string {
  return { front: 'Front', back: 'Back', left: 'Left Eave', right: 'Right Eave', partition: 'Partition' }[w];
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function SelectedPanel({
  opening,
  wall,
  availableWalls,
  onUpdate,
  onChangeWall,
  onRemove,
}: {
  opening: Opening;
  wall: WallLayout;
  availableWalls: WallSide[];
  onUpdate: (id: string, patch: Partial<Opening>) => void;
  onChangeWall: (side: WallSide) => void;
  onRemove: (id: string) => void;
}) {
  const maxH = wall.eaveHeightFt;
  return (
    <div className="space-y-2.5 rounded-lg border border-teal/50 bg-dark-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-head text-[11px] uppercase tracking-brand text-teal">
            {OPENING_DEFAULTS[opening.type].label}
          </p>
          <p className="text-[10px] text-muted">drag it on the 3D model to move</p>
        </div>
        <button
          onClick={() => onRemove(opening.id)}
          className="shrink-0 rounded border border-border-vis px-2 py-1 text-[12px] text-muted hover:border-danger hover:text-danger"
          aria-label="Delete component"
          title="Delete"
        >
          🗑
        </button>
      </div>

      {/* Move to a different wall without deleting */}
      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-brand text-muted">Wall</span>
        <div className="flex flex-wrap gap-1">
          {availableWalls.map((w) => (
            <button
              key={w}
              onClick={() => onChangeWall(w)}
              className={[
                'rounded px-2 py-1 text-[10px] uppercase tracking-brand transition-colors',
                w === opening.side ? 'bg-teal text-dark' : 'bg-dark-2 text-sub hover:text-text',
              ].join(' ')}
            >
              {wallLabel(w)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Width" value={opening.width} onChange={(v) => onUpdate(opening.id, { width: clamp(v, 0.5, wall.spanFt) })} />
        <NumberField label="Height" value={opening.height} onChange={(v) => onUpdate(opening.id, { height: clamp(v, 0.5, maxH - opening.sillHeight) })} />
        <NumberField label="Sill" value={opening.sillHeight} onChange={(v) => onUpdate(opening.id, { sillHeight: clamp(v, 0, maxH - opening.height) })} />
        <NumberField label="Offset" value={opening.offset} onChange={(v) => onUpdate(opening.id, { offset: clampOffset(v, opening.width, wall) })} />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-brand text-muted">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={0.5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded border border-border-vis bg-dark-2 px-2 py-1 text-[12px] text-text"
        />
        <span className="text-[10px] text-muted">ft</span>
      </div>
    </label>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-dark-3 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-brand text-muted">{label}</dt>
      <dd className="mt-0.5 font-head text-sm font-700 text-text">{value}</dd>
    </div>
  );
}
