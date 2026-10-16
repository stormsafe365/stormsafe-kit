/**
 * "Add doors & windows" with a quantity (owner 10/16/26: Josh tried two 10×10s
 * on the front end and it was hard - "There is no quantity drop down ... you
 * should add that"). Pick what, which wall, the size (roll-ups) and HOW MANY;
 * they go on that wall spread evenly (model/addMany.ts). Only sizes and counts
 * that fit are offered - including the program's rule that 2+ roll-up doors on
 * an end wall are at most 1′ shorter than the walls.
 */
import { useEffect, useMemo, useState } from 'react';
import { useWebStore } from '../store';
import { WALK_DOOR_H_FT, WALK_DOOR_W_FT, WINDOW_SILL_FT } from '../model/catalog';
import { WALL_LABEL, type OpeningKind, type WebOpening, type WebWall } from '../model/design';
import { nextFreeId } from '../model/normalize';
import { maxQty, spreadPositions } from '../model/addMany';
import { isEave, openingWalls, rollupSizes, walkDoorFitsHeight, windowFitsHeight } from '../model/rules';
import { KIND_LABEL } from './PartEditor';
import { cameraApi } from '../cameraFit';
import { Note, Segmented, Select, ft } from './ui';

const KINDS: OpeningKind[] = ['rollup', 'walk', 'window', 'frame'];
const SHORT: Record<OpeningKind, string> = { rollup: 'Roll-up', walk: 'Walk-in', window: 'Window', frame: 'Framed' };
const PREFER: Record<OpeningKind, WebWall[]> = {
  rollup: ['front', 'partition', 'back', 'left', 'right'],
  walk: ['left', 'right', 'front', 'back', 'partition'],
  window: ['left', 'right', 'back', 'front'],
  frame: ['left', 'right', 'front', 'back', 'partition'],
};
const plural = (k: OpeningKind, n: number) => `${KIND_LABEL[k].toLowerCase()}${n === 1 ? '' : 's'}`;

export function AddParts() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  const walls = openingWalls(d);
  const [kind, setKind] = useState<OpeningKind>('rollup');
  const kindOk = (k: OpeningKind) => (k === 'walk' ? walkDoorFitsHeight(d.height) : k === 'window' ? windowFitsHeight(d.height, 2.5) : true);
  const wallChoices = PREFER[kind].filter((w) => walls.includes(w) && (kind !== 'window' || w !== 'partition'));
  const [wall, setWall] = useState<WebWall | null>(wallChoices[0] ?? null);
  const [rw, setRw] = useState(10);
  const [rh, setRh] = useState(8);
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  // the wall must stay one this kind can go on
  const curWall = wall && wallChoices.includes(wall) ? wall : (wallChoices[0] ?? null);
  useEffect(() => {
    if (curWall !== wall) setWall(curWall);
  }, [curWall, wall]);

  const rollupsThere = curWall ? d.openings.filter((o) => o.wall === curWall && o.kind === 'rollup').length : 0;
  const sizes = useMemo(() => (curWall ? rollupSizes(d, curWall, rollupsThere + qty) : { widths: [], heights: [] }), [d, curWall, rollupsThere, qty]);
  // keep the roll-up size inside what fits for this many doors
  const w = kind === 'rollup' ? (sizes.widths.includes(rw as never) ? rw : (sizes.widths.filter((x) => x <= rw).pop() ?? sizes.widths[0] ?? 0)) : kind === 'walk' ? WALK_DOOR_W_FT : kind === 'window' ? 2.5 : 4;
  const h = kind === 'rollup' ? (sizes.heights.includes(rh as never) ? rh : (sizes.heights.filter((x) => x <= rh).pop() ?? sizes.heights[0] ?? 0)) : kind === 'walk' ? WALK_DOOR_H_FT : kind === 'window' ? 2.5 : Math.min(7, d.height - 1);
  const most = curWall && w && h && kindOk(kind) ? maxQty(d, curWall, kind, w, h) : 0;
  const q = Math.min(qty, Math.max(1, most));
  const qtyOptions = Array.from({ length: Math.max(1, most) }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  // with 2+ roll-ups on an end wall the doors can be 1′ shorter than the walls at most (the program's rule)
  const endLimit = kind === 'rollup' && curWall && !isEave(curWall) && rollupsThere + qty > 1;

  const add = () => {
    if (!curWall || !most) return;
    const spots = spreadPositions(d, curWall, w, q);
    if (!spots) {
      setMsg(`Only ${most} fit${most === 1 ? 's' : ''} there.`);
      return;
    }
    update((x) => {
      const used = new Set([...x.openings.map((o) => o.id), ...x.leanTos.flatMap((lt) => lt.openings.map((o) => o.id))]);
      for (const pos of spots) {
        const id = nextFreeId('o', used);
        used.add(id);
        const o: WebOpening = { id, kind, wall: curWall, w, h, sill: kind === 'window' ? WINDOW_SILL_FT : 0, pos };
        if (kind === 'rollup') o.color = 'white';
        if (kind === 'walk' || kind === 'window') o.style = 'std'; // an impact area shows the rated ones (normalize)
        if (kind === 'frame') o.frame = 'door';
        x.openings.push(o);
      }
    });
    setMsg(`Added ${q} ${plural(kind, q)} to the ${WALL_LABEL[curWall].toLowerCase()}.`);
    setQty(1);
    setTimeout(() => cameraApi.fit(curWall === 'partition' ? 'front' : curWall), 60);
  };

  if (!walls.length) return <Note>Doors and windows go on closed walls — this building has none yet (Walls step).</Note>;

  return (
    <div className="addparts" role="group" aria-label="Add doors and windows">
      <Segmented<OpeningKind>
        label="Add"
        value={kind}
        options={KINDS.map((k) => ({ value: k, label: SHORT[k], disabled: !kindOk(k) }))}
        onChange={(k) => {
          setKind(k);
          setQty(1);
          setMsg(null);
        }}
      />
      <div className="row3">
        <Select<WebWall>
          label="Wall"
          value={curWall ?? wallChoices[0]}
          options={wallChoices.map((x) => ({ value: x, label: WALL_LABEL[x] }))}
          onChange={(x) => {
            setWall(x);
            setQty(1);
            setMsg(null);
          }}
        />
        {kind === 'rollup' ? (
          <>
            <Select<number> label="Width" value={w} options={sizes.widths.map((x) => ({ value: x, label: ft(x) }))} onChange={(x) => setRw(x)} />
            <Select<number> label="Height" value={h} options={sizes.heights.map((x) => ({ value: x, label: ft(x) }))} onChange={(x) => setRh(x)} />
          </>
        ) : null}
        <Select<number> label="How many" value={q} options={qtyOptions} onChange={(x) => setQty(x)} />
      </div>
      {endLimit ? <p className="field-hint">With 2 or more roll-up doors on an end wall, each can be up to {ft(d.height - 1)} tall on this building.</p> : null}
      {!most ? (
        <Note tone="warn">
          No room for {kind === 'rollup' ? `a ${ft(w)} wide door` : `another ${KIND_LABEL[kind].toLowerCase()}`} on the {curWall ? WALL_LABEL[curWall].toLowerCase() : 'walls'}. Remove or move a door there, or pick another wall.
        </Note>
      ) : (
        <button type="button" className="btn-primary btn-add" onClick={add}>
          Add {q} {plural(kind, q)}
        </button>
      )}
      {msg ? <p className="field-hint" role="status">{msg}</p> : null}
    </div>
  );
}
