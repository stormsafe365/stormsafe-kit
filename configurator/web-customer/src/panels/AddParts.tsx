/**
 * "Add doors & windows" with a quantity (owner 10/16/26: Josh tried two 10×10s
 * on the front end and it was hard - "There is no quantity drop down ... you
 * should add that"). Pick what, which wall, the size (roll-ups) and HOW MANY;
 * they go on that wall spread evenly (model/addMany.ts). Only sizes and counts
 * that fit are offered, and when a count is held back the reason is said - e.g.
 * the program's rule that 2+ roll-up doors on an end wall are at most 1′
 * shorter than the walls.
 */
import { useMemo, useState } from 'react';
import { useWebStore } from '../store';
import { WALK_DOOR_H_FT, WALK_DOOR_W_FT, WINDOW_SILL_FT } from '../model/catalog';
import { WALL_LABEL, type OpeningKind, type WebDesign, type WebOpening, type WebWall } from '../model/design';
import { nextFreeId } from '../model/normalize';
import { maxQty, respaceWithSame, spreadPositions, whyNoMore } from '../model/addMany';
import { isEave, openingWalls, rollupSizes, walkDoorFitsHeight, windowFitsHeight } from '../model/rules';
import { cameraApi } from '../cameraFit';
import { Note, Segmented, Select, ft } from './ui';

const KINDS: OpeningKind[] = ['rollup', 'walk', 'window', 'frame'];
const SHORT: Record<OpeningKind, string> = { rollup: 'Garage door', walk: 'Walk-in door', window: 'Window', frame: 'Opening' };
const NOUN: Record<OpeningKind, [string, string]> = {
  rollup: ['garage door', 'garage doors'],
  walk: ['walk-in door', 'walk-in doors'],
  window: ['window', 'windows'],
  frame: ['opening', 'openings'],
};
const PREFER: Record<OpeningKind, WebWall[]> = {
  rollup: ['front', 'partition', 'back', 'left', 'right'],
  walk: ['left', 'right', 'front', 'back', 'partition'],
  window: ['left', 'right', 'back', 'front'],
  frame: ['left', 'right', 'front', 'back', 'partition'],
};
const plural = (k: OpeningKind, n: number) => NOUN[k][n === 1 ? 0 : 1];
const pick = <T extends number>(list: readonly T[], want: number): number => (list.includes(want as T) ? want : (list.filter((x) => x <= want).pop() ?? list[0] ?? 0));

/** Width × height a new part of this kind would be on that wall for `count` roll-ups there (0 × 0 = none fits). */
function partSize(d: WebDesign, kind: OpeningKind, wall: WebWall, count: number, rw: number, rh: number): { w: number; h: number } {
  if (kind === 'walk') return { w: WALK_DOOR_W_FT, h: WALK_DOOR_H_FT };
  if (kind === 'window') return { w: 2.5, h: 2.5 };
  if (kind === 'frame') return { w: 4, h: Math.min(7, d.height - 1) };
  const s = rollupSizes(d, wall, count);
  return { w: pick(fitWidths(d, wall, s.widths), rw), h: pick(s.heights, rh) };
}

/** Roll-up widths that physically fit on the wall now (e.g. a Garage + Carport side's garage part). */
function fitWidths<T extends number>(d: WebDesign, wall: WebWall, widths: readonly T[]): T[] {
  // in the free room, or by spreading out the same-size doors already there (a 10′ door in the middle
  // of a 24′ end + another 10′ one: both fit spread out)
  return widths.filter((x) => spreadPositions(d, wall, x, 1) !== null || respaceWithSame(d, wall, 'rollup', x, 1) !== null);
}

export function AddParts() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  const walls = openingWalls(d);
  const [kind, setKind] = useState<OpeningKind>('rollup');
  const [wall, setWall] = useState<WebWall | null>(null); // null = the first wall with room
  const [rw, setRw] = useState(10);
  const [rh, setRh] = useState(8);
  const [qty, setQty] = useState(1);
  // the "Added …" note, shown while the design still has exactly the doors / windows it had right after the add
  const [added, setAdded] = useState<{ text: string; count: number } | null>(null);

  const kindOk = (k: OpeningKind) => (k === 'walk' ? walkDoorFitsHeight(d.height) : k === 'window' ? windowFitsHeight(d.height, 2.5) : true);
  const thereFor = (x: WebWall) => d.openings.filter((o) => o.wall === x && o.kind === 'rollup').length;
  // walls this kind can go on at all (a roll-up needs a catalog size that fits the wall's height)
  const wallChoices = PREFER[kind].filter((x) => {
    if (!walls.includes(x) || (kind === 'window' && x === 'partition')) return false;
    if (kind !== 'rollup') return true;
    const s = rollupSizes(d, x, thereFor(x) + 1);
    return s.widths.length > 0 && s.heights.length > 0;
  });
  // the first wall that still has room for one (the starting design's front end already has a door)
  const roomy = wallChoices.find((x) => {
    const { w, h } = partSize(d, kind, x, thereFor(x) + 1, rw, rh);
    return w > 0 && h > 0 && maxQty(d, x, kind, w, h) >= 1;
  });
  const curWall = wall && wallChoices.includes(wall) ? wall : (roomy ?? wallChoices[0] ?? null);

  const rollupsThere = curWall ? thereFor(curWall) : 0;
  const first = curWall ? partSize(d, kind, curWall, rollupsThere + 1, rw, rh) : { w: 0, h: 0 };
  const most = curWall && first.w && first.h && kindOk(kind) ? maxQty(d, curWall, kind, first.w, first.h) : 0;
  const q = Math.min(qty, Math.max(1, most));
  // sizes for the count that will really be added (2+ on an end wall: 1′ shorter than the walls)
  const sizes = useMemo(() => {
    if (!curWall) return { widths: [] as number[], heights: [] as number[] };
    const s = rollupSizes(d, curWall, rollupsThere + q);
    return { widths: fitWidths(d, curWall, s.widths) as number[], heights: s.heights as number[] };
  }, [d, curWall, rollupsThere, q]);
  const { w, h } = curWall ? partSize(d, kind, curWall, rollupsThere + q, rw, rh) : first;
  const qtyOptions = Array.from({ length: Math.max(1, most) }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  // why the count stops where it does (height rule / a tall door already there / the 40 limit)
  const wallName = curWall ? WALL_LABEL[curWall].toLowerCase() : 'wall';
  const why = curWall && kindOk(kind) && w && h ? whyNoMore(d, curWall, kind, w, h, Math.max(most, 1) + (most ? 1 : 0), wallName) : null;
  const endWall = kind === 'rollup' && curWall && !isEave(curWall);
  const tallestOne = curWall && kind === 'rollup' ? Math.max(0, ...rollupSizes(d, curWall, 1).heights) : 0;
  const heightCapped = !!endWall && rollupsThere + q > 1 && tallestOne > Math.max(0, ...sizes.heights);

  const add = () => {
    if (!curWall || !most) return;
    // free room first (doors the customer placed stay put); else spread them out with the same doors there
    const free = spreadPositions(d, curWall, w, q);
    const respace = free ? null : respaceWithSame(d, curWall, kind, w, q);
    if (!free && !respace) return;
    const spots = free ?? respace!.spots.slice(respace!.existing.length);
    setWall(curWall); // keep this wall picked (it may be full now; the form does not jump to another)
    update((x) => {
      if (respace) respace.existing.forEach((id, i) => {
        const o = x.openings.find((y) => y.id === id);
        if (o) o.pos = respace.spots[i];
      });
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
    setQty(1);
    setAdded({
      text: `Added ${q} ${plural(kind, q)} to the ${WALL_LABEL[curWall].toLowerCase()}.${respace ? ' The doors there were spaced out evenly.' : ''}`,
      count: d.openings.length + spots.length,
    });
    setTimeout(() => cameraApi.fit(curWall === 'partition' ? 'front' : curWall), 60);
  };

  const addedNote = added && added.count === d.openings.length ? added.text : null;

  if (!walls.length) return <Note>Doors and windows go on closed walls — this building has none yet (Walls step).</Note>;

  let blocked: string | null = null;
  if (!kindOk(kind)) blocked = kind === 'walk' ? 'Walk-in doors need walls at least 7′ tall (Size step).' : 'Windows need walls at least 7′ tall (Size step).';
  else if (!wallChoices.length) blocked = kind === 'rollup' ? 'Garage doors need taller walls: at least 8′ on the sides, 6′ on the ends (Size step).' : 'No wall can take this one.';
  else if (kind === 'rollup' && !w) blocked = `No garage door fits on the ${wallName} right now. Pick another wall, or remove or move a door there.`;
  else if (!most) blocked = why ?? `The ${wallName} has no room for another ${kind === 'rollup' ? `${ft(w)} wide garage door` : NOUN[kind][0]}. Pick another wall, or remove or move one that is there.`;

  return (
    <div className="addparts" role="group" aria-label="Add doors and windows">
      <Segmented<OpeningKind>
        label="What do you want to add?"
        value={kind}
        options={KINDS.map((k) => ({ value: k, label: SHORT[k], disabled: !kindOk(k) }))}
        onChange={(k) => {
          setKind(k);
          setWall(null);
          setQty(1);
          setAdded(null);
        }}
      />
      {wallChoices.length ? (
        <div className="row3">
          <Select<WebWall>
            label="Wall"
            value={curWall ?? wallChoices[0]}
            options={wallChoices.map((x) => ({ value: x, label: WALL_LABEL[x] }))}
            onChange={(x) => {
              setWall(x);
              setQty(1);
              setAdded(null);
              // show that wall on the model, so "Front end" / "Left side" mean something
              setTimeout(() => cameraApi.fit(x === 'partition' ? 'front' : x), 60);
            }}
          />
          {kind === 'rollup' && !blocked ? (
            <>
              <Select<number> label="Width" value={w} options={sizes.widths.map((x) => ({ value: x, label: ft(x) }))} onChange={(x) => { setRw(x); setWall(curWall); }} />
              <Select<number> label="Height" value={h} options={sizes.heights.map((x) => ({ value: x, label: ft(x) }))} onChange={(x) => { setRh(x); setWall(curWall); }} />
            </>
          ) : null}
          {!blocked ? <Select<number> label="How many" value={q} options={qtyOptions} onChange={(x) => { setQty(x); setWall(curWall); }} /> : null}
        </div>
      ) : null}
      {blocked ? (
        addedNote ? null : <Note>{blocked}</Note>
      ) : (
        <>
          {why ? <p className="field-hint">{why}</p> : heightCapped ? <p className="field-hint">Because the {wallName} will have {rollupsThere + q} garage doors, each can be up to {ft(d.height - 1)} tall.</p> : null}
          <button type="button" className="btn-primary btn-add" onClick={add}>
            Add {q} {plural(kind, q)} to the {wallName}
          </button>
        </>
      )}
      {addedNote ? (
        <p className="field-hint added-note" role="status">
          {addedNote}
          {blocked ? (why ? ` ${why}` : ` That is all that fit on the ${wallName}; add more on another wall, or remove one below.`) : ` Need another? Tap Add again.`}
        </p>
      ) : null}
    </div>
  );
}
