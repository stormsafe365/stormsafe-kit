/**
 * The picked wall's add area: the four things to add. V2 (owner's reviewers 10/20/26): tapping one
 * opens the size / position sheet (PartSheet.tsx) instead of the old add form; the sheet keeps the
 * quantity (owner 10/16/26: Josh's two 10×10s), the "spread them out" add and the one-tap
 * "lower the doors there and add" fix.
 */
import { useWebStore } from '../store';
import type { OpeningKind, WebWall } from '../model/design';
import { openingWalls, rollupSizes, walkDoorFitsHeight, windowFitsHeight } from '../model/rules';
import { Note } from './ui';

const KINDS: OpeningKind[] = ['rollup', 'walk', 'window', 'frame'];
const SHORT: Record<OpeningKind, string> = { rollup: 'Garage / roll-up door', walk: 'Walk-in door', window: 'Window', frame: 'Opening' };

export function AddParts({ wall, onPick, toast }: { wall: WebWall; onPick: (k: OpeningKind) => void; toast?: string | null }) {
  const d = useWebStore((s) => s.design);
  const setTab = useWebStore((s) => s.setTab);
  const walls = openingWalls(d);
  const kindOk = (k: OpeningKind) => (k === 'walk' ? walkDoorFitsHeight(d.height) : k === 'window' ? windowFitsHeight(d.height, 2.5) : true);
  const thereFor = (x: WebWall) => d.openings.filter((o) => o.wall === x && o.kind === 'rollup').length;
  // can this kind go on the picked wall at all (a roll-up needs a catalog size that fits the wall's height)
  const hereOk = (k: OpeningKind) => {
    if (!kindOk(k)) return false;
    if (k === 'window' && wall === 'partition') return false;
    if (k !== 'rollup') return true;
    const s = rollupSizes(d, wall, thereFor(wall) + 1);
    return s.widths.length > 0 && s.heights.length > 0;
  };

  if (!walls.length) {
    // a carport open on every side: say what to do, with the two ways forward
    return (
      <div className="addparts">
        <Note>Your building is open on every side, so there is no wall for a door or window yet.</Note>
        <div className="quick-row">
          <button type="button" className="btn-ghost" onClick={() => setTab('walls')}>
            Close in a wall
          </button>
          <button type="button" className="btn-ghost" onClick={() => setTab('leantos')}>
            Add a storage room (lean-to)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="addhub" role="group" aria-label="Add doors and windows">
      <div className="tiles">
        {KINDS.map((k) => (
          <button key={k} type="button" className="tile" disabled={!hereOk(k)} onClick={() => onPick(k)}>
            <KindIcon k={k} />
            <span className="tile-name">{SHORT[k]}</span>
            {!hereOk(k) ? <span className="tile-why">{!kindOk(k) ? 'Needs walls 7′+' : k === 'window' ? 'Not on this wall' : 'Too short here'}</span> : null}
          </button>
        ))}
      </div>
      {toast ? (
        <p className="toast" role="status">
          <span aria-hidden="true">✓</span> {toast}
        </p>
      ) : null}
    </div>
  );
}

/** Simple line pictures for the four things (lime on the dark card). */
export function KindIcon({ k }: { k: OpeningKind }) {
  return (
    <svg className="kind-icon" viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {k === 'rollup' ? (
        <>
          <rect x="6" y="8" width="28" height="26" rx="1.5" />
          <path d="M6 14h28M6 19h28M6 24h28M6 29h28" />
        </>
      ) : k === 'walk' ? (
        <>
          <rect x="11" y="5" width="18" height="30" rx="1.5" />
          <circle cx="25" cy="21" r="1.6" fill="currentColor" />
        </>
      ) : k === 'window' ? (
        <>
          <rect x="7" y="9" width="26" height="22" rx="1.5" />
          <path d="M20 9v22M7 20h26" />
        </>
      ) : (
        <>
          <path d="M9 35V7h22v28" />
          <path d="M5 35h30" strokeDasharray="3 3" />
        </>
      )}
    </svg>
  );
}
