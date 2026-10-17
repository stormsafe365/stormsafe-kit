/**
 * Walls as a picture you tap (owner 10/17/26: "make this easy ... no ton of scrolling"): the building
 * seen from above with its four walls as buttons, each saying how it is now. Tap a wall, then tap how
 * it should be. The camera turns to that wall so the change shows on the model.
 */
import { useState } from 'react';
import { useWebStore } from '../store';
import { END_WALL_LABEL, SIDE_WALL_LABEL, type EndWall, type SideWall } from '../model/design';
import { END_WALLS, SIDE_WALLS } from '../model/normalize';
import { Note } from './ui';
import { cameraApi } from '../cameraFit';

type W = 'front' | 'back' | 'left' | 'right';
const NAME: Record<W, string> = { front: 'Front end', back: 'Back end', left: 'Left side', right: 'Right side' };
/** Short words for the wall buttons (the full words are on the choices below). */
const SHORT: Record<string, string> = {
  closed: 'Closed',
  open: 'Open',
  gableOnly: 'Gable only',
  halfClosed: 'Half closed',
  '1panel': '3′ from top',
  '2panel': '6′ from top',
  '3panel': '9′ from top',
  q1: '¼ closed',
  q2: '½ closed',
  q3: '¾ closed',
};

export function WallsPanel() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  const [sel, setSel] = useState<W>('front');
  const combo = d.type === 'combo';
  // the room in back of a Garage + Carport is always closed: its back end is not a choice
  const fixed = (k: W) => combo && k === 'back';
  const look = (k: W) => setTimeout(() => cameraApi.fit(k), 80);
  const pickWall = (k: W) => {
    setSel(k);
    look(k);
  };
  const isEnd = sel === 'front' || sel === 'back';
  const options: Array<{ value: string; label: string }> = isEnd
    ? (combo ? (['open', 'gableOnly'] as EndWall[]) : END_WALLS).map((v) => ({ value: v, label: END_WALL_LABEL[v] }))
    : SIDE_WALLS.filter((v) => !/^\dpanel$/.test(v) || parseInt(v, 10) * 3 < d.height).map((v) => ({ value: v, label: SIDE_WALL_LABEL[v as SideWall] }));
  const set = (v: string) => {
    update((x) => {
      if (sel === 'front' || sel === 'back') x.walls[sel] = v as EndWall;
      else x.walls[sel] = v as SideWall;
    });
    look(sel);
  };
  const hidden = d.openings.filter((o) => {
    if (combo) return false;
    const st = o.wall === 'partition' ? 'closed' : d.walls[o.wall];
    return st !== 'closed';
  }).length;

  const WallBtn = ({ k }: { k: W }) => (
    <button
      type="button"
      className={`wallbtn wall-${k}${sel === k ? ' on' : ''}${d.walls[k] === 'closed' ? ' is-closed' : ''}`}
      aria-pressed={sel === k}
      disabled={fixed(k)}
      onClick={() => pickWall(k)}
    >
      <span className="wallbtn-name">
        {NAME[k]}
        {combo && k !== 'back' ? ' (carport)' : ''}
      </span>
      <span className="wallbtn-state">{fixed(k) ? 'Closed (room)' : SHORT[d.walls[k]] ?? d.walls[k]}</span>
    </button>
  );

  return (
    <div className="panel-body">
      <div className="wallmap" role="group" aria-label="Walls, seen from above">
        <WallBtn k="back" />
        <WallBtn k="left" />
        <div className="wallmap-roof" aria-hidden="true">
          <span>Your building</span>
          <small>seen from above</small>
        </div>
        <WallBtn k="right" />
        <WallBtn k="front" />
      </div>
      <div className="field">
        <span className="field-label">{NAME[sel]}: how should it be?</span>
        <div className="picks" role="radiogroup" aria-label={NAME[sel]}>
          {options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={d.walls[sel] === o.value} aria-label={o.label} className={`pick${d.walls[sel] === o.value ? ' on' : ''}`} onClick={() => set(o.value)}>
              {SHORT[o.value] ?? o.label}
            </button>
          ))}
        </div>
      </div>
      {SHORT[d.walls[sel]] && SHORT[d.walls[sel]] !== (options.find((o) => o.value === d.walls[sel])?.label ?? '') ? (
        <p className="field-hint">{options.find((o) => o.value === d.walls[sel])?.label}</p>
      ) : null}
      {combo ? <p className="field-hint more-hint">The room in back is closed on every side, with a wall between it and the carport.</p> : null}
      {hidden > 0 && (
        <Note tone="warn">
          {hidden === 1 ? 'One door or window is' : `${hidden} doors or windows are`} on a wall that isn’t closed, so the model doesn’t show{' '}
          {hidden === 1 ? 'it' : 'them'}. Close the wall or move {hidden === 1 ? 'it' : 'them'} in Doors &amp; windows.
        </Note>
      )}
    </div>
  );
}
