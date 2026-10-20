import { useEffect, useState } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from '../store';
import { WALK_DOOR_H_FT, WALK_DOOR_W_FT, WINDOW_SILL_FT } from '../model/catalog';
import { WALL_LABEL, type OpeningKind, type WebDesign, type WebOpening, type WebWall } from '../model/design';
import { nextFreeId } from '../model/normalize';
import { freeMainPos, mainSpotOk } from '../model/positions';
import { isEave, openingWalls, rollupFits, rollupSizes, walkDoorFitsHeight, windowFitsHeight } from '../model/rules';
import { posToChoice, wallCountLine, wallInfo } from '../model/sheet';
import { partTitle } from './PartEditor';
import { Note, ft } from './ui';
import { AddParts, KindIcon } from './AddParts';
import { PartSheet, type SheetTarget } from './PartSheet';
import { cameraApi } from '../cameraFit';
import { revealInPanel } from '../reveal';

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

/** The walls that can hold parts, in the order a person walks around the building. */
const WALL_ORDER: WebWall[] = ['front', 'left', 'right', 'back', 'partition'];

/** A big numbered step: "1  Pick a wall" + one plain line of help. */
function BigStep({ n, title, help, dim }: { n: number; title: string; help?: string; dim?: boolean }) {
  return (
    <div className={`bigstep${dim ? ' dim' : ''}`}>
      <span className="bigstep-n" aria-hidden="true">
        {n}
      </span>
      <div>
        <h3 className="bigstep-t">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        {help ? <p className="bigstep-h">{help}</p> : null}
      </div>
    </div>
  );
}

/** A tiny wall outline: a gable end (with its roof peak) or a long side. */
function WallIcon({ shape }: { shape: 'gable' | 'side' }) {
  return (
    <svg className="wall-icon" viewBox="0 0 44 28" width="44" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shape === 'gable' ? <path d="M12 26V12L22 4l10 8v14z" /> : <path d="M3 26V10h38v16z" />}
      <path d="M1 26.5h42" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

const camWall = (w: WebWall) => (w === 'partition' ? 'front' : w);

/** Where a placed part sits, in the sheet's words. */
function spotWord(d: WebDesign, o: WebOpening): string {
  const c = posToChoice(d, o.wall, o.w, o.pos);
  return c === 'left' ? 'left' : c === 'right' ? 'right' : c === 'center' ? 'center' : `${ft(o.pos)} in`;
}

export function OpeningsPanel() {
  const d = useWebStore((s) => s.design);
  const impact = useWebStore((s) => s.impact);
  const update = useWebStore((s) => s.update);
  const setTab = useWebStore((s) => s.setTab);
  const selectedId = useEditorStore((s) => s.selectedOpeningId);
  const walls = openingWalls(d);
  // step 1: the wall picked (null = none yet)
  const [wallSel, setWallSel] = useState<WebWall | null>(null);
  // V2: the size / position sheet (null = closed)
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  // the short "Added ..." line, shown while the design still has the doors / windows it had right after
  const [toast, setToast] = useState<{ text: string; count: number } | null>(null);
  const shown = WALL_ORDER.filter((w) => (d.type === 'combo' ? true : w !== 'partition') && (walls.includes(w) || d.openings.some((o) => o.wall === w)));
  const combo = d.type === 'combo';
  const openWalls = combo ? [] : WALL_ORDER.filter((w) => w !== 'partition' && !walls.includes(w) && !shown.includes(w));
  // a part tapped on the model: its wall is picked and its sheet opens
  useEffect(() => {
    const o = selectedId ? d.openings.find((k) => k.id === selectedId) : null;
    if (!o) return;
    setWallSel(o.wall);
    setSheet((s) => (s && s.mode === 'edit' && s.id === o.id ? s : s && s.mode === 'add' ? s : { mode: 'edit', id: o.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  // the wall picked is gone (walls changed): pick again
  useEffect(() => {
    if (wallSel && !shown.includes(wallSel)) setWallSel(null);
  }, [wallSel, shown]);
  const pickWall = (w: WebWall) => {
    setWallSel(w);
    setSheet(null);
    setToast(null);
    // let go of a part picked on the model, so tapping it there again picks its wall again
    useEditorStore.getState().selectOpening(null);
    // the model turns to that wall, so "Front end" / "Left side" mean something
    setTimeout(() => cameraApi.fit(camWall(w)), 60);
  };
  const closeSheet = () => {
    setSheet(null);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.wallcards');
      if (el) revealInPanel(el);
    }, 60);
  };
  const done = (msg: string, wall: WebWall) => {
    setSheet(null);
    setWallSel(wall);
    setToast({ text: msg, count: useWebStore.getState().design.openings.length });
    setTimeout(() => cameraApi.fit(camWall(wall)), 60);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.addhub');
      if (el) revealInPanel(el);
    }, 120);
  };

  const onThisWall = wallSel ? d.openings.filter((o) => o.wall === wallSel) : [];
  const wallName = wallSel ? WALL_LABEL[wallSel].toLowerCase() : '';
  const toastText = toast && toast.count === d.openings.length ? toast.text : null;

  // ── the sheet: one thing at a time (the list comes back after Add / Save / Cancel) ──
  if (sheet) {
    return (
      <div className="panel-body">
        <PartSheet key={sheet.mode === 'edit' ? sheet.id : `${sheet.kind}:${sheet.wall}`} target={sheet} onClose={closeSheet} onDone={done} />
      </div>
    );
  }

  return (
    <div className="panel-body">
      {impact && <Note tone="warn">Your area uses impact-rated walk-in doors and windows, so those are the ones offered here. Garage doors stay as they are.</Note>}

      {/* ── Step 1: pick a wall ── */}
      <BigStep n={1} title="Pick a wall" help="Tap the wall you want to add a door or window to. The model turns to it." />
      {shown.length ? (
        <div className="wallcards" role="radiogroup" aria-label="Pick a wall">
          {shown.map((w) => {
            const parts = d.openings.filter((o) => o.wall === w);
            const closed = walls.includes(w);
            const info = wallInfo(d, w);
            return (
              <button key={w} type="button" role="radio" aria-checked={wallSel === w} className={`wallcard${wallSel === w ? ' on' : ''}`} onClick={() => pickWall(w)}>
                <WallIcon shape={info.shape} />
                <span className="wallcard-name">{WALL_LABEL[w]}</span>
                <span className="wallcard-size">{info.sizeLine}</span>
                <span className="wallcard-n">{parts.length ? wallCountLine(parts) : 'nothing on it yet'}</span>
                {!closed ? <span className="wallcard-warn">wall not closed</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {combo ? (
        <p className="field-hint">The front end is the open carport end, so it has no wall. Doors go on the divider wall between the garage and the carport, the back end and the sides.</p>
      ) : null}
      {openWalls.length ? (
        <p className="field-hint">
          Open (no wall yet): {openWalls.map((w) => WALL_LABEL[w].toLowerCase()).join(', ')}.{' '}
          <button type="button" className="linkish" onClick={() => setTab('walls')}>
            Close a wall in the Walls step
          </button>{' '}
          to add to it.
        </p>
      ) : null}

      {/* ── Step 2: add to that wall ── */}
      <BigStep n={2} title={wallSel ? `Add to the ${wallName}` : 'Then add a door or window'} help={wallSel ? undefined : 'Pick a wall above first.'} dim={!wallSel} />
      {!walls.length ? (
        <AddParts wall="front" onPick={() => {}} />
      ) : wallSel && walls.includes(wallSel) ? (
        <AddParts
          wall={wallSel}
          toast={toastText}
          onPick={(kind) => {
            setToast(null);
            useEditorStore.getState().selectOpening(null);
            setSheet({ mode: 'add', kind, wall: wallSel });
          }}
        />
      ) : wallSel ? (
        <Note>This wall isn’t closed in, so nothing can go on it. Close it in the Walls step, or fix or move what is on it below.</Note>
      ) : null}

      {/* ── Step 3: what is on that wall ── */}
      {wallSel && onThisWall.length > 0 ? (
        <>
          <BigStep n={3} title={`On the ${wallName} (${onThisWall.length})`} help="Tap one to change its size or place, or × to take it off." />
          {/* owner 10/18/26: "some people will not know they can click and drag windows and doors" */}
          <p className="drag-tip">
            <span aria-hidden="true">☝</span> To move a door or window, press it on the model and slide it along the wall.
          </p>
          <ul className="placed">
            {onThisWall.map((o, i) => {
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
                <li key={o.id} className={`placed-row${selectedId === o.id ? ' is-selected' : ''}`}>
                  <button type="button" className="placed-main" onClick={() => setSheet({ mode: 'edit', id: o.id })} aria-label={`Change ${partTitle(o)} (${i + 1})`}>
                    <span className="placed-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <KindIcon k={o.kind} />
                    <span className="placed-text">
                      <span className="placed-title">{partTitle(o)}</span>
                      <span className="placed-sub">{spotWord(d, o)} · tap to change</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${partTitle(o).toLowerCase()} (${i + 1})`}
                    onClick={() => update((x) => void (x.openings = x.openings.filter((k) => k.id !== o.id)))}
                  >
                    ×
                  </button>
                  {problem ? <Note tone="warn">{problem}</Note> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {wallSel && onThisWall.length === 0 && walls.includes(wallSel) ? <p className="field-hint wall-empty">Nothing on the {wallName} yet.</p> : null}
    </div>
  );
}
