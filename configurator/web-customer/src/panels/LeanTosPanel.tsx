import { useState } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from '../store';
import { LEANTO_WIDTHS, WALK_DOOR_H_FT, WALK_DOOR_W_FT, WINDOW_SILL_FT } from '../model/catalog';
import {
  LEANTO_END_LABEL,
  LEANTO_SIDE_LABEL,
  LEANTO_SIDE_WALL_LABEL,
  LEANTO_WALL_LABEL,
  WRAP_LABEL,
  type LeanToSide,
  type LeanToWall,
  type OpeningKind,
  type WebDesign,
  type WebLeanTo,
  type WebLeanToOpening,
} from '../model/design';
import { LEANTO_ENDS, LEANTO_SIDE_WALLS, LEANTO_SIDES, MAX_LEANTO_OPENINGS, nextFreeId } from '../model/normalize';
import { fitLeanToPos, freeLeanToPos, leanToSpotOk } from '../model/positions';
import {
  leanToHost,
  leanToIsEave,
  leanToLowLegOptions,
  leanToOpeningWalls,
  leanToRollupFits,
  leanToRollupSizes,
  leanToWallLength,
  WRAP_KEYS,
  wrapStatus,
} from '../model/rules';
import { KIND_LABEL, PartEditor } from './PartEditor';
import { Note, Segmented, Select, Stepper, Toggle } from './ui';
import { cameraApi, type FitView } from '../cameraFit';

/** The camera view that faces a lean-to's side (customer's left = left view). */
const SIDE_VIEW: Record<string, FitView> = { 'Left Eave': 'left', 'Right Eave': 'right', 'Front Gable': 'front', 'Back Gable': 'back' };

const startFrom = (side: LeanToSide) => (leanToIsEave(side) ? 'the front end' : side === 'Front Gable' ? 'the front-left corner' : 'the back-right corner');

/** A new lean-to on `side`: full length of that wall, the tallest low leg up to 8′ that fits under the eave. */
export function newLeanTo(d: WebDesign, side: LeanToSide): WebLeanTo {
  const width = 12;
  const legs = leanToLowLegOptions(d, { width, pitch: '2:12' });
  return {
    id: nextFreeId('lt', new Set(d.leanTos.map((l) => l.id))),
    side,
    width,
    length: leanToHost(d, side),
    start: 0,
    lowLeg: legs.filter((h) => h <= 8).pop() ?? legs[0] ?? 6,
    pitch: '2:12',
    enclosure: 'open',
    walls: { front: 'open', back: 'open', side: 'open' },
    openings: [],
  };
}

function newLeanToOpening(d: WebDesign, lt: WebLeanTo, kind: OpeningKind): WebLeanToOpening | null {
  const used = new Set([...d.openings.map((o) => o.id), ...d.leanTos.flatMap((l) => l.openings.map((o) => o.id))]);
  const walls = leanToOpeningWalls(lt);
  for (const wall of walls) {
    const run = leanToWallLength(d, lt, wall);
    let w = 3;
    let h = 6;
    let sill = 0;
    const extra: Partial<WebLeanToOpening> = {};
    if (kind === 'rollup') {
      const s = leanToRollupSizes(lt, wall, run);
      w = s.widths.filter((x) => x <= 8).pop() ?? 0;
      h = s.heights.filter((x) => x <= 7).pop() ?? 0;
      if (!w || !h) continue;
      extra.color = 'white';
    } else if (kind === 'walk') {
      if (lt.lowLeg < 7) continue;
      w = WALK_DOOR_W_FT;
      h = WALK_DOOR_H_FT;
      extra.style = 'std'; // an impact area shows the rated door (normalize) and gives this back after
    } else if (kind === 'window') {
      if (lt.lowLeg < 7) continue;
      w = 2.5;
      h = 2.5;
      sill = WINDOW_SILL_FT;
      extra.style = 'std';
    } else {
      w = Math.min(4, run - 2);
      h = Math.max(1, Math.min(6, lt.lowLeg - 1));
      extra.frame = 'door';
    }
    const pos = freeLeanToPos(d, lt, wall, w);
    if (pos === null) continue;
    return { id: nextFreeId('lo', used), kind, wall, w, h, sill, pos, ...extra };
  }
  return null;
}

function LeanToCard({ lt, index }: { lt: WebLeanTo; index: number }) {
  const d = useWebStore((s) => s.design);
  const impact = useWebStore((s) => s.impact);
  const update = useWebStore((s) => s.update);
  const selectedId = useEditorStore((s) => s.selectedLeanToOpeningId);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const host = leanToHost(d, lt.side);
  const legs = leanToLowLegOptions(d, lt);
  const oWalls = leanToOpeningWalls(lt);
  const edit = (fn: (l: WebLeanTo, x: WebDesign) => void) =>
    update((x) => {
      const l = x.leanTos.find((k) => k.id === lt.id);
      if (l) fn(l, x);
    });

  const change = (id: string, fn: (o: WebLeanToOpening, l: WebLeanTo, x: WebDesign) => void): string | null => {
    let err: string | null = null;
    edit((l, x) => {
      const o = l.openings.find((k) => k.id === id);
      if (!o) return;
      const before = { ...o };
      fn(o, l, x);
      if (o.kind === 'rollup' && !leanToRollupFits(l, o.wall, o.w, o.h)) {
        Object.assign(o, before);
        err = 'That door size doesn’t fit this lean-to wall.';
        return;
      }
      const pos = fitLeanToPos(x, l, o.wall, o.w, o.pos, o.id);
      if (pos === null) {
        Object.assign(o, before);
        err = 'There isn’t room for that on this wall (openings keep 1′ from corners and from each other).';
        return;
      }
      o.pos = pos;
    });
    return err;
  };

  const addPart = (kind: OpeningKind) => {
    if (lt.openings.length >= MAX_LEANTO_OPENINGS) return setAddMsg(`A lean-to holds up to ${MAX_LEANTO_OPENINGS} doors and windows here.`);
    const o = newLeanToOpening(d, lt, kind);
    if (!o) return setAddMsg(`No room for a ${KIND_LABEL[kind].toLowerCase()} on this lean-to’s closed walls${kind === 'walk' || kind === 'window' ? ' (needs a 7′ or taller low leg)' : ''}.`);
    setAddMsg(null);
    edit((l) => void l.openings.push(o));
  };

  return (
    <section className="lt-card" aria-label={`${LEANTO_SIDE_LABEL[lt.side]} lean-to`}>
      <header className="part-head">
        <span className="part-num">{index + 1}</span>
        <span className="part-title">{LEANTO_SIDE_LABEL[lt.side]} lean-to</span>
        <button type="button" className="icon-btn" aria-label={`Remove the ${LEANTO_SIDE_LABEL[lt.side].toLowerCase()} lean-to`} onClick={() => update((x) => void (x.leanTos = x.leanTos.filter((k) => k.id !== lt.id)))}>
          ×
        </button>
      </header>
      <div className="part-grid">
        <Select label="Width" value={lt.width} options={LEANTO_WIDTHS.map((w) => ({ value: w, label: `${w}′` }))} onChange={(w) => edit((l) => void (l.width = w))} />
        <Stepper label="Length" value={lt.length} min={Math.min(10, host)} max={host} onChange={(v) => edit((l) => void (l.length = Math.round(v)))} />
        <Select
          label="Height at the outer edge"
          value={lt.lowLeg}
          options={(legs.length ? legs : [lt.lowLeg]).map((h) => ({ value: h, label: `${h}′` }))}
          onChange={(h) => edit((l) => void (l.lowLeg = h))}
        />
        <Segmented
          label="Roof pitch"
          value={lt.pitch}
          options={[
            { value: '2:12', label: '2:12' },
            { value: '3:12', label: '3:12' },
          ]}
          onChange={(v) => edit((l) => void (l.pitch = v))}
        />
      </div>
      {lt.length < host && (
        <Stepper
          label={`Starts at: from ${startFrom(lt.side)}`}
          value={lt.start}
          min={0}
          max={host - lt.length}
          onChange={(v) => edit((l) => void (l.start = Math.round(v)))}
        />
      )}
      {!legs.length && <Note tone="warn">This lean-to’s roof would meet the building above its eave. Raise the building height or pick a narrower lean-to.</Note>}
      <Segmented
        label="Sides & ends"
        value={lt.enclosure}
        options={[
          { value: 'open', label: 'Open (roof only)' },
          { value: 'enclosed', label: 'Closed in' },
          { value: 'custom', label: 'Mix (pick each wall)' },
        ]}
        onChange={(v) => edit((l) => void (l.enclosure = v))}
      />
      {lt.enclosure === 'custom' && (
        <div className="part-grid">
          <Select label="Outer side" value={lt.walls.side} options={LEANTO_SIDE_WALLS.map((v) => ({ value: v, label: LEANTO_SIDE_WALL_LABEL[v] }))} onChange={(v) => edit((l) => void (l.walls.side = v))} />
          <Select label="Front end" value={lt.walls.front} options={LEANTO_ENDS.map((v) => ({ value: v, label: LEANTO_END_LABEL[v] }))} onChange={(v) => edit((l) => void (l.walls.front = v))} />
          <Select label="Back end" value={lt.walls.back} options={LEANTO_ENDS.map((v) => ({ value: v, label: LEANTO_END_LABEL[v] }))} onChange={(v) => edit((l) => void (l.walls.back = v))} />
        </div>
      )}
      <div className="sub-head">Doors &amp; windows on this lean-to</div>
      {oWalls.length ? (
        <div className="add-row add-row-sm" role="group" aria-label="Add to this lean-to">
          {(['rollup', 'walk', 'window', 'frame'] as const).map((k) => (
            <button key={k} type="button" className="add-btn" onClick={() => addPart(k)}>
              + {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      ) : (
        <p className="field-hint">Close a lean-to wall (Enclosed, or Custom → Closed) to add doors or windows.</p>
      )}
      {addMsg && <Note tone="warn">{addMsg}</Note>}
      {lt.openings.map((o, j) => {
        const run = leanToWallLength(d, lt, o.wall);
        const onClosed = oWalls.includes(o.wall);
        const problem = !onClosed
          ? 'This wall isn’t closed, so the model doesn’t show this.'
          : !leanToSpotOk(d, lt, o)
            ? 'This overlaps another opening or sits too close to a corner. Move it.'
            : o.kind === 'rollup' && !leanToRollupFits(lt, o.wall, o.w, o.h)
              ? 'This door is too big for this lean-to wall.'
              : null;
        return (
          <PartEditor
            key={o.id}
            label={String.fromCharCode(97 + j)}
            o={o}
            wallOptions={(['outer', 'front', 'back'] as const)
              .filter((w) => oWalls.includes(w) || w === o.wall)
              .map((w) => ({ value: w, label: LEANTO_WALL_LABEL[w], disabled: !oWalls.includes(w) }))}
            sizes={leanToRollupSizes(lt, o.wall, run)}
            maxFrameW={run - 2}
            maxFrameH={lt.lowLeg - 1}
            posFrom="the left end of the wall"
            posMax={run - o.w}
            impact={impact}
            selected={selectedId === o.id}
            problem={problem}
            onWall={(wall) =>
              change(o.id, (k, l, x) => {
                k.wall = wall as LeanToWall;
                const p = freeLeanToPos(x, { ...l, openings: l.openings.filter((q) => q.id !== k.id) }, k.wall, k.w);
                if (p !== null) k.pos = p;
              })
            }
            onPatch={(patch) => change(o.id, (k) => void Object.assign(k, { ...patch, wall: k.wall }))}
            onPos={(pos) => change(o.id, (k) => void (k.pos = pos))}
            onRemove={() => edit((l) => void (l.openings = l.openings.filter((k) => k.id !== o.id)))}
          />
        );
      })}
    </section>
  );
}

export function LeanTosPanel() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  const free = LEANTO_SIDES.filter((s) => !d.leanTos.some((l) => l.side === s));
  const [side, setSide] = useState<LeanToSide>(free[0] ?? 'Left Eave');
  const pick = free.includes(side) ? side : free[0];
  const wraps = wrapStatus(d);
  const offered = WRAP_KEYS.filter((k) => wraps[k].offered);

  return (
    <div className="panel-body">
      <p className="field-hint">A lean-to is a lower roof added to one side or end. Leave it open for extra cover (a carport or porch), or close it in to make a storage room.</p>
      {free.length > 0 && (
        <div className="add-lt">
          <Select label="Which side?" value={pick} options={free.map((s) => ({ value: s, label: LEANTO_SIDE_LABEL[s] }))} onChange={setSide} />
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              update((x) => void x.leanTos.push(newLeanTo(x, pick)));
              // show it: the camera turns to that side
              setTimeout(() => cameraApi.fit(SIDE_VIEW[pick]), 250);
            }}
          >
            + Add lean-to
          </button>
        </div>
      )}
      {d.leanTos.length === 0 && <p className="empty">No lean-tos yet.</p>}
      {d.leanTos.map((lt, i) => (
        <LeanToCard key={lt.id} lt={lt} index={i} />
      ))}
      {offered.length > 0 && (
        <section className="wraps" aria-label="Wrap-around corners">
          <div className="sub-head">Wrap-around corners</div>
          <p className="field-hint">Where a side lean-to meets an end lean-to, the roofs can wrap around the corner.</p>
          {offered.map((k) => (
            <div key={k} className="wrap-row">
              <Toggle
                label={`Wrap the ${WRAP_LABEL[k]}`}
                checked={d.wraps.includes(k) && wraps[k].ok}
                disabled={!wraps[k].ok}
                onChange={(on) => update((x) => void (x.wraps = on ? [...x.wraps.filter((w) => w !== k), k] : x.wraps.filter((w) => w !== k)))}
              />
              {!wraps[k].ok && <p className="field-hint">Not available: {wraps[k].why}.</p>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
