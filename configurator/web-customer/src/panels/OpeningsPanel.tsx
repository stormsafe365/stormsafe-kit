import { useState } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from '../store';
import { WALK_DOOR_H_FT, WALK_DOOR_W_FT, WINDOW_SILL_FT } from '../model/catalog';
import { WALL_LABEL, type OpeningKind, type WebDesign, type WebOpening, type WebWall } from '../model/design';
import { nextFreeId } from '../model/normalize';
import { CUSTOMER_REF, fitMainPos, freeMainPos, mainSpotOk } from '../model/positions';
import { isEave, openingWalls, rollupFits, rollupSizes, wallLength, walkDoorFitsHeight, windowFitsHeight } from '../model/rules';
import { KIND_LABEL, PartEditor } from './PartEditor';
import { cameraApi } from '../cameraFit';
import { Note } from './ui';

const PREFER: Record<OpeningKind, WebWall[]> = {
  rollup: ['front', 'partition', 'back', 'left', 'right'],
  walk: ['left', 'right', 'front', 'back', 'partition'],
  window: ['left', 'right', 'back', 'front'],
  frame: ['left', 'right', 'front', 'back', 'partition'],
};

/** Can this kind go on that wall at all (height rules)? */
function kindFits(d: WebDesign, kind: OpeningKind, wall: WebWall, impact: boolean): boolean {
  if (kind === 'walk') return walkDoorFitsHeight(d.height);
  if (kind === 'window') return windowFitsHeight(d.height, 2.5);
  if (kind === 'rollup') return rollupFits(d, wall, 6, 6, 1);
  void impact;
  return true;
}

/** A new part of `kind` on the first wall with room. null = nowhere fits. */
export function newOpening(d: WebDesign, kind: OpeningKind, impact: boolean): WebOpening | null {
  const walls = PREFER[kind].filter((w) => openingWalls(d).includes(w) && kindFits(d, kind, w, impact));
  const used = new Set([...d.openings.map((o) => o.id), ...d.leanTos.flatMap((lt) => lt.openings.map((o) => o.id))]);
  for (const wall of walls) {
    let w = 3;
    let h = 7;
    let sill = 0;
    const extra: Partial<WebOpening> = {};
    if (kind === 'rollup') {
      const onWall = d.openings.filter((o) => o.wall === wall && o.kind === 'rollup').length + 1;
      const s = rollupSizes(d, wall, onWall);
      w = s.widths.filter((x) => x <= 10).pop() ?? s.widths[0];
      h = s.heights.filter((x) => x <= 8).pop() ?? s.heights[0];
      if (!w || !h) continue;
      extra.color = 'white';
    } else if (kind === 'walk') {
      w = WALK_DOOR_W_FT;
      h = WALK_DOOR_H_FT;
      extra.style = 'std'; // an impact area shows the rated door (normalize) and gives this back after
    } else if (kind === 'window') {
      w = 2.5;
      h = 2.5;
      sill = WINDOW_SILL_FT;
      extra.style = 'std';
    } else {
      w = 4;
      h = Math.min(7, d.height - 1);
      extra.frame = 'door';
    }
    const pos = freeMainPos(d, wall, w);
    if (pos === null) continue;
    return { id: nextFreeId('o', used), kind, wall, w, h, sill, pos, ...extra };
  }
  return null;
}

export function OpeningsPanel() {
  const d = useWebStore((s) => s.design);
  const impact = useWebStore((s) => s.impact);
  const update = useWebStore((s) => s.update);
  const selectedId = useEditorStore((s) => s.selectedOpeningId);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const walls = openingWalls(d);

  const add = (kind: OpeningKind) => {
    const o = newOpening(d, kind, impact);
    if (!o) {
      setAddMsg(walls.length ? `No room for another ${KIND_LABEL[kind].toLowerCase()} on the closed walls.` : 'Close a wall first (Walls tab).');
      return;
    }
    setAddMsg(null);
    update((x) => void x.openings.push(o));
    // Turn the model to the wall it went on (the divider wall is seen through the open carport end).
    setTimeout(() => cameraApi.fit(o.wall === 'partition' ? 'front' : o.wall), 60);
  };

  /** Apply a change to one opening if it still fits; returns a message when it doesn't. */
  const change = (id: string, edit: (o: WebOpening, d: WebDesign) => void): string | null => {
    let err: string | null = null;
    update((x) => {
      const o = x.openings.find((k) => k.id === id);
      if (!o) return;
      const before = { ...o };
      edit(o, x);
      if (o.kind === 'rollup' && !rollupFits(x, o.wall, o.w, o.h, x.openings.filter((k) => k.wall === o.wall && k.kind === 'rollup').length)) {
        Object.assign(o, before);
        err = 'That door size doesn’t fit this wall.';
        return;
      }
      const pos = fitMainPos(x, o.wall, o.w, o.pos, o.id);
      if (pos === null) {
        Object.assign(o, before);
        err = 'There isn’t room for that on this wall (openings keep 1′ from corners and from each other).';
        return;
      }
      o.pos = pos;
    });
    return err;
  };

  return (
    <div className="panel-body">
      <div className="add-row" role="group" aria-label="Add a door or window">
        {(['rollup', 'walk', 'window', 'frame'] as const).map((k) => (
          <button key={k} type="button" className="add-btn" onClick={() => add(k)} disabled={!walls.length}>
            + {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {impact && <Note tone="warn">Your area uses impact-rated walk-in doors and windows, so those are the ones offered here. Roll-up doors stay as they are.</Note>}
      {addMsg && <Note tone="warn">{addMsg}</Note>}
      {!walls.length && <Note>Doors and windows go on closed walls — this building has none yet.</Note>}
      {d.openings.length === 0 && walls.length > 0 && <p className="empty">No doors or windows yet. Add one above, then drag it on the model or type its position.</p>}
      {d.openings.map((o, i) => {
        const face = wallLength(d, o.wall);
        const onClosed = walls.includes(o.wall);
        const onWall = d.openings.filter((k) => k.wall === o.wall && k.kind === 'rollup').length;
        const problem = !onClosed
          ? 'This wall isn’t closed, so the model doesn’t show this. Pick a closed wall.'
          : !mainSpotOk(d, o)
            ? 'This overlaps another opening or sits too close to a corner. Move it.'
            : o.kind === 'rollup' && !rollupFits(d, o.wall, o.w, o.h, onWall)
              ? `Too tall for this wall (max ${isEave(o.wall) ? d.height - 2 : onWall > 1 ? d.height - 1 : d.height}′ here).`
              : null;
        return (
          <PartEditor
            key={o.id}
            label={String(i + 1)}
            o={o}
            wallOptions={(['front', 'back', 'left', 'right', 'partition'] as const)
              .filter((w) => walls.includes(w) || w === o.wall)
              .map((w) => ({ value: w, label: WALL_LABEL[w], disabled: !walls.includes(w) }))}
            sizes={rollupSizes(d, o.wall, Math.max(1, onWall))}
            maxFrameW={face - 2}
            maxFrameH={isEave(o.wall) ? d.height - 1 : d.height}
            posFrom={CUSTOMER_REF[o.wall]}
            posMax={face - o.w}
            impact={impact}
            selected={selectedId === o.id}
            problem={problem}
            onWall={(wall) =>
              change(o.id, (k, x) => {
                k.wall = wall as WebWall;
                const p = freeMainPos({ ...x, openings: x.openings.filter((q) => q.id !== k.id) }, k.wall, k.w);
                if (p !== null) k.pos = p;
              })
            }
            onPatch={(patch) => change(o.id, (k) => void Object.assign(k, patch))}
            onPos={(pos) => change(o.id, (k) => void (k.pos = pos))}
            onRemove={() => update((x) => void (x.openings = x.openings.filter((k) => k.id !== o.id)))}
          />
        );
      })}
    </div>
  );
}
