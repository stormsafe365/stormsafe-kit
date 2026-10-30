/**
 * V2 Doors & windows: one sheet to add or change a door / window / opening (owner's reviewers 10/20/26).
 *
 *   ROLL-UP DOOR · LEFT SIDE
 *   [2-D picture of that wall, the part where it will land - live]
 *   1. Choose size   preset buttons (Popular tag) + Custom size (today's full list / boxes)
 *   2. Position      Left / Center / Right (+ Advanced: today's exact position box)
 *   Add / Save
 *
 * Phones: it fills the options area under the model (a bottom sheet); desktop: the options panel.
 * The model shows the part as it will be (store.preview) while the sheet is open; nothing is
 * written to the design until Add / Save. The fit rules are the page's own: the no-overlap fit
 * (positions.fitMainPos via sheet.placeOnWall), the garage-door height rules (rules.rollupFits,
 * addMany.maxQty / whyNoMore) and the same "spread them out" add as before (addMany).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from '../store';
import { ROLLUP_COLORS, WALK_DOORS, WINDOWS, WINDOW_SILL_FT, walkDoorType, windowType } from '../model/catalog';
import { WALL_LABEL, cloneDesign, type OpeningKind, type WebDesign, type WebOpening, type WebWall } from '../model/design';
import { nextFreeId } from '../model/normalize';
import { maxQty, respaceWithSame, spreadPositions, whyNoMore } from '../model/addMany';
import { CUSTOMER_REF } from '../model/positions';
import { isEave, openingWalls, pitchRise, rollupFits, walkDoorFitsHeight, wallLength, windowFitsHeight } from '../model/rules';
import {
  defaultPreset,
  fmtFt,
  placeOnWall,
  posToChoice,
  rollupOptions,
  sizePresets,
  viewerX,
  wallEnds,
  wallInfo,
  windowStyleFor,
  type PosChoice,
  type SizePreset,
} from '../model/sheet';
import { cameraApi } from '../cameraFit';
import { Note, QtyField, Segmented, Select, Stepper, Toggle, ft } from './ui';
import { DoorAddOns } from './DoorAddOns';

export type SheetTarget = { mode: 'add'; kind: OpeningKind; wall: WebWall } | { mode: 'edit'; id: string };

export const SHEET_KIND: Record<OpeningKind, string> = { rollup: 'Roll-up door', walk: 'Walk-in door', window: 'Window', frame: 'Opening' };
const NOUN: Record<OpeningKind, [string, string]> = {
  rollup: ['garage door', 'garage doors'],
  walk: ['walk-in door', 'walk-in doors'],
  window: ['window', 'windows'],
  frame: ['opening', 'openings'],
};
const plural = (k: OpeningKind, n: number) => NOUN[k][n === 1 ? 0 : 1];
const article = (k: OpeningKind) => (/^[aeio]/.test(NOUN[k][0]) ? 'an' : 'a');
const camWall = (w: WebWall) => (w === 'partition' ? 'front' : w);
const NO_ROOM = 'There isn’t room for that on this wall (openings keep 1′ from corners and from each other).';

/** Roll-up widths that physically fit on the wall now (free room, or by spreading the same doors out) - as before. */
export function fitWidths<T extends number>(d: WebDesign, wall: WebWall, widths: readonly T[]): T[] {
  return widths.filter((x) => spreadPositions(d, wall, x, 1) !== null || respaceWithSame(d, wall, 'rollup', x, 1) !== null);
}

interface Result {
  /** The design as it will be after Add / Save (null = refused). */
  next: WebDesign | null;
  /** Ids of the part(s) being placed. */
  ids: string[];
  /** Why not (refused) - in the page's own words. */
  refused: string | null;
  /** Said under Position: the spot moved / doors spaced out. */
  info: string | null;
  /** One-tap fix: lower the garage doors there and add (as before). */
  tallFix: { lowerTo: number } | null;
  pos: number | null;
}

export function PartSheet({ target, onClose, onDone }: { target: SheetTarget; onClose: () => void; onDone: (msg: string, wall: WebWall) => void }) {
  const d = useWebStore((s) => s.design);
  const impact = useWebStore((s) => s.impact);
  const update = useWebStore((s) => s.update);
  const setPreview = useWebStore((s) => s.setPreview);
  const editing = target.mode === 'edit' ? d.openings.find((o) => o.id === target.id) ?? null : null;
  const kind: OpeningKind = target.mode === 'add' ? target.kind : editing?.kind ?? 'rollup';
  const startWall: WebWall = target.mode === 'add' ? target.wall : editing?.wall ?? 'front';

  // ── working choices ──
  const [wall, setWall] = useState<WebWall>(startWall);
  const [qty, setQty] = useState(1);
  const [sizeKey, setSizeKey] = useState<string | null>(null); // null = the default preset; 'custom' = custom
  const [custom, setCustom] = useState<{ w: number; h: number }>(() => (editing ? { w: editing.w, h: editing.h } : { w: 4, h: Math.min(7, d.height - 1) }));
  const [posMode, setPosMode] = useState<PosChoice | 'exact'>('center');
  const [exactPos, setExactPos] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [color, setColor] = useState(editing?.color ?? 'white');
  const [hoist, setHoist] = useState(editing?.hoist === true);
  const [seal, setSeal] = useState(editing?.seal === true);
  const [style, setStyle] = useState(editing?.style ?? 'std');
  const [frame, setFrame] = useState<'door' | 'window'>(editing?.frame === 'window' ? 'window' : 'door');
  const [lowerTo, setLowerTo] = useState<number | null>(null);

  // the design without the part being changed (edit), else the design
  const base: WebDesign = useMemo(() => (editing ? { ...d, openings: d.openings.filter((o) => o.id !== editing.id) } : d), [d, editing]);
  const rollupsThere = base.openings.filter((o) => o.wall === wall && o.kind === 'rollup').length;
  const n = kind === 'rollup' ? rollupsThere + qty : rollupsThere;
  const presets: SizePreset[] = useMemo(
    () => sizePresets(base, kind, wall, Math.max(1, n), kind === 'rollup' ? (w) => fitWidths(base, wall, [w]).length > 0 : undefined),
    [base, kind, wall, n],
  );
  const allRollups = useMemo(() => (kind === 'rollup' ? rollupOptions(base, wall, Math.max(1, n)).filter(([w]) => fitWidths(base, wall, [w]).length > 0) : []), [base, kind, wall, n]);

  // reopening a placed part: its size button (or Custom) and its spot (Left / Center / Right or the exact number)
  const inited = useRef(false);
  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    if (!editing) return;
    const match = presets.find((p) => Math.abs(p.w - editing.w) < 1e-6 && Math.abs(p.h - editing.h) < 1e-6);
    setSizeKey(match ? match.key : 'custom');
    const c = posToChoice(base, editing.wall, editing.w, editing.pos);
    if (c) setPosMode(c);
    else {
      setPosMode('exact');
      setExactPos(editing.pos);
      setAdvanced(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = sizeKey === 'custom' ? null : presets.find((p) => p.key === sizeKey) ?? defaultPreset(kind, presets);
  const size = preset ? { w: preset.w, h: preset.h } : custom;
  const w = size.w;
  const h = kind === 'frame' && frame === 'window' ? Math.min(size.h, 3) : size.h;
  const winStyle = kind === 'window' ? windowStyleFor(style, Math.round(h * 12)) : style;

  // ids for the new part(s): fixed while the sheet is open (the model keeps the same door while it moves)
  const newIds = useMemo(() => {
    const used = new Set([...d.openings.map((o) => o.id), ...d.leanTos.flatMap((lt) => lt.openings.map((o) => o.id))]);
    const out: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = nextFreeId('o', used);
      used.add(id);
      out.push(id);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const make = (id: string, pos: number): WebOpening => {
    const o: WebOpening = { ...(editing ?? {}), id, kind, wall, w, h, sill: kind === 'window' ? (editing?.sill ?? WINDOW_SILL_FT) : 0, pos } as WebOpening;
    if (kind === 'rollup') {
      o.color = color;
      if (hoist) o.hoist = true;
      else delete o.hoist;
      if (seal) o.seal = true;
      else delete o.seal;
    }
    if (kind === 'walk') o.style = style;
    if (kind === 'window') o.style = winStyle;
    if (kind === 'frame') o.frame = frame;
    return o;
  };

  const res: Result = useMemo(() => {
    const out: Result = { next: null, ids: [], refused: null, info: null, tallFix: null, pos: null };
    const wallName = WALL_LABEL[wall].toLowerCase();
    if (kind === 'walk' && !walkDoorFitsHeight(d.height)) return { ...out, refused: 'Walk-in doors need walls at least 7′ tall (Size step).' };
    if (kind === 'window' && !windowFitsHeight(d.height, h)) return { ...out, refused: 'Windows need walls at least 7′ tall (Size step).' };
    if (!openingWalls(d).includes(wall)) return { ...out, refused: 'This wall isn’t closed in, so nothing can go on it. Close it in the Walls step.' };
    if (!w || !h) return { ...out, refused: `No ${NOUN[kind][0]} fits on the ${wallName} right now. Pick another wall, or remove or move one there.` };
    const at: PosChoice | number = posMode === 'exact' ? exactPos : posMode;
    // an opening's custom size stays inside the limits its boxes had (wall − 2′ wide; eave walls: wall height − 1′)
    if (kind === 'frame' && (w > wallLength(d, wall) - 2 || h > (isEave(wall) ? d.height - 1 : d.height))) return { ...out, refused: 'That opening is too big for this wall.' };

    // ── change a placed part (as the card did: this door's size rule, then the no-overlap fit) ──
    if (editing) {
      if (kind === 'rollup' && !rollupFits(base, wall, w, h, rollupsThere + 1)) return { ...out, refused: 'That door size doesn’t fit this wall.' };
      const p = placeOnWall(base, wall, w, at, null);
      if (!p) return { ...out, refused: NO_ROOM };
      const next = cloneDesign(d);
      const i = next.openings.findIndex((o) => o.id === editing.id);
      next.openings[i] = make(editing.id, p.pos);
      return { ...out, next, ids: [editing.id], pos: p.pos, info: p.moved ? `That spot is taken: it goes in the nearest free spot (${ft(p.pos)} from ${CUSTOMER_REF[wall]}).` : null };
    }

    // ── add: lowered doors first when the one-tap fix was taken ──
    const start: WebDesign = lowerTo !== null ? { ...base, openings: base.openings.map((o) => (o.wall === wall && o.kind === 'rollup' && o.h > lowerTo ? { ...o, h: lowerTo } : o)) } : base;
    const most = maxQty(start, wall, kind, w, h);
    if (most < qty) {
      const why = whyNoMore(start, wall, kind, w, h, qty, wallName);
      const some = start.openings.some((o) => o.wall === wall && o.kind === kind);
      const refused =
        why ??
        `The ${wallName} has no room for ${qty > 1 ? `${qty} more` : some ? 'another' : article(kind)} ${kind === 'rollup' ? `${ft(w)} wide garage door${qty > 1 ? 's' : ''}` : plural(kind, qty)}. Pick another wall${kind === 'rollup' || kind === 'frame' ? ' or size' : ''}${qty > 1 ? ' or fewer' : ''}, or remove or move one that is there.`;
      // a garage door already on this end wall is too tall for a second one: offer to lower it (as before)
      const maxH2 = d.height - 1;
      let tallFix: Result['tallFix'] = null;
      if (kind === 'rollup' && !isEave(wall) && lowerTo === null && start.openings.some((o) => o.wall === wall && o.kind === 'rollup' && o.h > maxH2)) {
        const lowered: WebDesign = { ...start, openings: start.openings.map((o) => (o.wall === wall && o.kind === 'rollup' && o.h > maxH2 ? { ...o, h: maxH2 } : o)) };
        if (h <= maxH2 && maxQty(lowered, wall, kind, w, h) >= qty) tallFix = { lowerTo: maxH2 };
      }
      return { ...out, refused, tallFix };
    }
    const next = cloneDesign(start);
    if (qty === 1) {
      const p = placeOnWall(start, wall, w, at, null);
      if (p) {
        next.openings.push(make(newIds[0], p.pos));
        return { ...out, next, ids: [newIds[0]], pos: p.pos, info: p.moved ? `That spot is taken: it goes in the nearest free spot (${ft(p.pos)} from ${CUSTOMER_REF[wall]}).` : null };
      }
    }
    // several at once (or no free spot): spread out evenly, with the same doors already there (as before)
    const free = spreadPositions(start, wall, w, qty);
    const respace = free ? null : respaceWithSame(start, wall, kind, w, qty);
    if (!free && !respace) return { ...out, refused: NO_ROOM };
    if (respace)
      respace.existing.forEach((id, i) => {
        const o = next.openings.find((y) => y.id === id);
        if (o) o.pos = respace.spots[i];
      });
    const spots = free ?? respace!.spots.slice(respace!.existing.length);
    spots.forEach((pos, i) => next.openings.push(make(newIds[i], pos)));
    return {
      ...out,
      next,
      ids: newIds.slice(0, spots.length),
      pos: spots.length === 1 ? spots[0] : null,
      info: respace ? `The ${NOUN[kind][1]} there are spaced out evenly to make room.` : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, base, wall, kind, w, h, qty, posMode, exactPos, color, hoist, seal, style, winStyle, frame, lowerTo, editing, rollupsThere]);

  // How many: as many as really fit at this size (addMany.maxQty: the no-overlap rule + the garage-door height rule)
  const startD: WebDesign = useMemo(
    () => (lowerTo !== null ? { ...base, openings: base.openings.map((o) => (o.wall === wall && o.kind === 'rollup' && o.h > lowerTo ? { ...o, h: lowerTo } : o)) } : base),
    [base, lowerTo, wall],
  );
  const mostFit = !editing && w && h ? maxQty(startD, wall, kind, w, h) : 0;
  useEffect(() => {
    if (mostFit >= 1 && qty > mostFit) setQty(mostFit);
  }, [mostFit, qty]);
  const qtyWhy = !mostFit
    ? null
    : (whyNoMore(startD, wall, kind, w, h, mostFit + 1, WALL_LABEL[wall].toLowerCase()) ??
      (spreadPositions(startD, wall, w, mostFit + 1) !== null ? `Up to ${mostFit} at a time.` : mostFit === 1 ? 'Only 1 fits on this wall at this size.' : `Only ${mostFit} fit on this wall at this size.`));

  // the model shows it as it will be (or the design as it is, when refused)
  useEffect(() => {
    setPreview(res.next ?? (editing ? base : null));
  }, [res.next, editing, base, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);
  // the model turns to the wall
  useEffect(() => {
    const t = setTimeout(() => cameraApi.fit(camWall(wall)), 60);
    return () => clearTimeout(t);
  }, [wall]);
  // the part dragged on the model: its new spot is the exact position
  const drag = useWebStore((s) => s.previewDrag);
  const lastDrag = useRef(drag?.n ?? 0);
  useEffect(() => {
    if (!drag || drag.n === lastDrag.current) return;
    lastDrag.current = drag.n;
    if (!res.ids.includes(drag.id)) return;
    setPosMode('exact');
    setExactPos(drag.pos);
    setAdvanced(true);
  }, [drag, res.ids]);
  // Escape closes
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  // a part picked on the model is not this one any more
  useEffect(() => () => useEditorStore.getState().selectOpening(null), []);

  if (target.mode === 'edit' && !editing) return null;

  const commit = () => {
    if (!res.next) return;
    const next = res.next;
    update((x) => {
      x.openings = cloneDesign(next).openings;
    });
    setPreview(null);
    const wallName = WALL_LABEL[wall].toLowerCase();
    onDone(editing ? `Saved the ${NOUN[kind][0]} on the ${wallName}.` : `Added ${qty} ${plural(kind, qty)} to the ${wallName}.`, wall);
  };
  const remove = () => {
    if (!editing) return;
    update((x) => void (x.openings = x.openings.filter((k) => k.id !== editing.id)));
    setPreview(null);
    onDone(`Took the ${NOUN[kind][0]} off the ${WALL_LABEL[editing.wall].toLowerCase()}.`, editing.wall);
  };

  const face = wallLength(d, wall);
  const info = wallInfo(d, wall);
  const curPos = res.pos ?? (posMode === 'exact' ? exactPos : 0);
  const walls = openingWalls(d);
  const showPos = qty === 1;
  const title = `${SHEET_KIND[kind]} · ${info.name}`;
  const walkOpts = WALK_DOORS.map((t) => ({ value: t.key, label: t.name, disabled: impact && !t.impact }));
  const winOpts = WINDOWS.filter((t) => t.hIn === Math.round(h * 12)).map((t) => ({ value: t.key, label: t.name, disabled: impact && !t.impact }));

  return (
    <section className="sheet" role="dialog" aria-modal="false" aria-label={title}>
      <div className="sheet-grip" aria-hidden="true" />
      <header className="sheet-head">
        <h3 className="sheet-title">{title.toUpperCase()}</h3>
        <button type="button" className="icon-btn sheet-x" aria-label="Close without saving" onClick={onClose}>
          ×
        </button>
      </header>

      <WallPreview d={res.next ?? (editing ? d : base)} wall={wall} picked={res.ids} refused={!res.next} />
      <p className="sheet-wallline">
        {info.name} · {info.sizeLine}
      </p>
      {/* refused: said right under the picture, where it is seen first */}
      {res.refused ? (
        <div role="alert">
          <Note tone="warn">{res.refused}</Note>
        </div>
      ) : null}

      {editing ? (
        <Select<string>
          label="Wall"
          value={wall}
          options={(['front', 'back', 'left', 'right', 'partition'] as const)
            .filter((x) => walls.includes(x) || x === wall)
            .filter((x) => !(kind === 'window' && x === 'partition'))
            .map((x) => ({ value: x, label: WALL_LABEL[x], disabled: !walls.includes(x) }))}
          onChange={(v) => {
            setWall(v as WebWall);
            setPosMode('center');
          }}
        />
      ) : null}

      {/* ── 1. Choose size ── */}
      <h4 className="sheet-step">1. Choose size</h4>
      <div className="presets" role="radiogroup" aria-label="Size">
        {presets.map((p) => {
          const on = sizeKey !== 'custom' && preset?.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              className={`preset${on ? ' on' : ''}`}
              onClick={() => {
                setSizeKey(p.key);
                setLowerTo(null);
              }}
            >
              <span className="preset-size">{p.label}</span>
              {p.tag ? <span className={`preset-tag${p.tag === 'Popular' ? ' pop' : ''}`}>{p.tag}</span> : null}
            </button>
          );
        })}
        {kind === 'rollup' || kind === 'frame' ? (
          <button
            type="button"
            role="radio"
            aria-checked={sizeKey === 'custom'}
            className={`preset preset-custom${sizeKey === 'custom' ? ' on' : ''}`}
            onClick={() => {
              setSizeKey('custom');
              setCustom({ w, h });
            }}
          >
            <span className="preset-size">{kind === 'rollup' ? 'More sizes' : 'Custom size'}</span>
          </button>
        ) : null}
      </div>
      {sizeKey === 'custom' && kind === 'rollup' ? (
        <Select<string>
          label="Door size"
          value={`${w}x${h}`}
          options={(allRollups.some(([a, b]) => a === w && b === h) ? allRollups : [...allRollups, [w, h] as [number, number]]).map(([a, b]) => ({ value: `${a}x${b}`, label: `${a}′ wide × ${b}′ tall` }))}
          onChange={(v) => {
            const [a, b] = v.split('x').map(Number);
            setCustom({ w: a, h: b });
          }}
        />
      ) : null}
      {sizeKey === 'custom' && kind === 'frame' ? (
        <div className="part-grid">
          <Stepper label="Width" value={custom.w} min={1} max={Math.max(1, face - 2)} onChange={(v) => setCustom((c) => ({ ...c, w: v }))} />
          <Stepper label="Height" value={custom.h} min={1} max={Math.max(1, isEave(wall) ? d.height - 1 : d.height)} onChange={(v) => setCustom((c) => ({ ...c, h: v }))} />
        </div>
      ) : null}
      {kind === 'rollup' ? (
        <Select label="Door color" value={color} options={ROLLUP_COLORS.map((c) => ({ value: c.key, label: c.name }))} onChange={setColor} />
      ) : kind === 'walk' ? (
        <Select label="Door style" value={walkDoorType(style)?.key ?? 'std'} options={walkOpts} onChange={setStyle} />
      ) : kind === 'window' ? (
        <Select label="Window" value={windowType(winStyle)?.key ?? 'std'} options={winOpts} onChange={setStyle} />
      ) : (
        <Segmented
          label="For"
          value={frame}
          options={[
            { value: 'door', label: 'Door' },
            { value: 'window', label: 'Window' },
          ]}
          onChange={setFrame}
        />
      )}
      {kind === 'rollup' && w && h ? <DoorAddOns w={w} h={h} hoist={hoist} seal={seal} onHoist={setHoist} onSeal={setSeal} /> : null}
      {!editing && mostFit >= 1 ? <QtyField value={qty} max={mostFit} onChange={setQty} reason={qty >= mostFit ? qtyWhy : null} /> : null}

      {/* ── 2. Position ── */}
      <h4 className="sheet-step">2. Position</h4>
      {showPos ? (
        <>
          <div className="seg posseg" role="radiogroup" aria-label="Position on the wall">
            {(['left', 'center', 'right'] as PosChoice[]).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={posMode === c}
                className={posMode === c ? 'on' : ''}
                onClick={() => setPosMode(c)}
              >
                {c === 'left' ? 'Left' : c === 'center' ? 'Center' : 'Right'}
              </button>
            ))}
          </div>
          <p className="field-hint">
            As seen from outside, facing the {WALL_LABEL[wall].toLowerCase()} ({wallEnds(wall)[0]} on the left).
          </p>
          <Toggle label="Advanced position" checked={advanced} onChange={setAdvanced} />
          {advanced ? (
            <Stepper
              label={`Position: from ${CUSTOMER_REF[wall]} to the near edge`}
              value={curPos}
              min={0}
              max={Math.max(0, face - w)}
              step={0.5}
              onChange={(v) => {
                setPosMode('exact');
                setExactPos(v);
              }}
            />
          ) : null}
        </>
      ) : (
        <p className="field-hint">{qty} {plural(kind, qty)} are spread evenly along the wall. Pick 1 to choose Left / Center / Right.</p>
      )}

      {!res.refused && res.info ? (
        <p className="field-hint sheet-info" role="status">
          {res.info}
        </p>
      ) : null}
      {res.tallFix ? (
        <button type="button" className="btn-ghost btn-add" onClick={() => setLowerTo(res.tallFix!.lowerTo)}>
          Make the garage doors there {ft(res.tallFix.lowerTo)} tall and add another
        </button>
      ) : null}
      {kind === 'frame' ? <p className="field-hint">An opening is framed and ready for a door or window you supply.</p> : null}
      {impact && (kind === 'walk' || kind === 'window') ? <p className="field-hint">Impact-rated for your area.</p> : null}

      <div className="sheet-actions">
        {editing ? (
          <button type="button" className="btn-ghost sheet-remove" onClick={remove}>
            Remove
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        )}
        <button type="button" className="btn-primary btn-add" disabled={!res.next} onClick={commit}>
          {editing ? 'Save' : `Add ${qty > 1 ? `${qty} ` : ''}${qty > 1 ? plural(kind, qty) : SHEET_KIND[kind].toLowerCase()}`}
        </button>
      </div>
    </section>
  );
}

/** The wall as seen from outside: its outline, what is on it (grey) and the part being placed (lime). */
export function WallPreview({ d, wall, picked, refused }: { d: WebDesign; wall: WebWall; picked: string[]; refused?: boolean }) {
  const face = wallLength(d, wall);
  const H = d.height;
  const gable = !isEave(wall);
  const rise = gable ? ((face / 2) * pitchRise(d)) / 12 : 0;
  const pad = Math.max(1.2, face * 0.04);
  const top = H + rise;
  const vbW = face + pad * 2;
  const vbH = top + pad * 2 + face * 0.06;
  const sx = (x: number) => pad + x;
  const sy = (y: number) => pad + top - y;
  const outline = gable
    ? `${sx(0)},${sy(0)} ${sx(face)},${sy(0)} ${sx(face)},${sy(H)} ${sx(face / 2)},${sy(top)} ${sx(0)},${sy(H)}`
    : `${sx(0)},${sy(0)} ${sx(face)},${sy(0)} ${sx(face)},${sy(H)} ${sx(0)},${sy(H)}`;
  const [leftEnd, rightEnd] = wallEnds(wall);
  // Garage + Carport side: the open carport stretch (no wall) is hatched
  const blocked = d.type === 'combo' && isEave(wall) ? Math.max(0, d.length - d.enclosedLength) : 0;
  const blockedX = blocked > 0 ? (wall === 'left' ? face - blocked : 0) : null;
  const fs = Math.max(0.9, face * 0.035);
  return (
    <figure className="wallpic">
      <svg viewBox={`0 0 ${vbW} ${vbH}`} role="img" aria-label={`The ${WALL_LABEL[wall].toLowerCase()} seen from outside`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="wp-hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1.2" stroke="currentColor" strokeWidth="0.25" />
          </pattern>
        </defs>
        <line x1={0} x2={vbW} y1={sy(0)} y2={sy(0)} className="wp-ground" />
        <polygon points={outline} className="wp-wall" />
        {blockedX !== null ? <rect x={sx(blockedX)} y={sy(H)} width={blocked} height={H} className="wp-open" /> : null}
        {d.openings
          .filter((o) => o.wall === wall)
          .map((o) => {
            const on = picked.includes(o.id);
            const x = viewerX(d, wall, o.pos, o.w);
            const y0 = o.kind === 'window' ? o.sill : o.kind === 'frame' && o.frame === 'window' ? Math.max(0, Math.min(WINDOW_SILL_FT, H - o.h - 0.5)) : 0;
            const cls = `wp-part${on ? ' on' : ''}${on && refused ? ' bad' : ''}`;
            return (
              <g key={o.id} className={cls} style={{ transform: `translate(${sx(x)}px, ${sy(y0 + o.h)}px)` }}>
                <rect x={0} y={0} width={o.w} height={o.h} />
                {o.kind === 'rollup'
                  ? Array.from({ length: Math.max(1, Math.floor(o.h / 1.2)) }, (_, i) => <line key={i} x1={0} x2={o.w} y1={(i + 1) * (o.h / (Math.floor(o.h / 1.2) + 1))} y2={(i + 1) * (o.h / (Math.floor(o.h / 1.2) + 1))} />)
                  : o.kind === 'window'
                    ? <line x1={o.w / 2} x2={o.w / 2} y1={0} y2={o.h} />
                    : null}
              </g>
            );
          })}
        <text x={sx(0)} y={sy(0) + fs * 1.25} className="wp-end" fontSize={fs}>
          {leftEnd}
        </text>
        <text x={sx(face)} y={sy(0) + fs * 1.25} className="wp-end" fontSize={fs} textAnchor="end">
          {rightEnd}
        </text>
        <text x={sx(face / 2)} y={sy(0) + fs * 1.25} className="wp-len" fontSize={fs} textAnchor="middle">
          {fmtFt(face)}
        </text>
      </svg>
    </figure>
  );
}
