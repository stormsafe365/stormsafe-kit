import { useWebStore } from '../store';
import { END_WALL_LABEL, SIDE_WALL_LABEL, type EndWall, type SideWall } from '../model/design';
import { END_WALLS, SIDE_WALLS } from '../model/normalize';
import { Note, Select } from './ui';
import { cameraApi } from '../cameraFit';

const endOpts = END_WALLS.map((v) => ({ value: v, label: END_WALL_LABEL[v] }));
const sideOpts = (h: number) =>
  SIDE_WALLS.filter((v) => !/^\dpanel$/.test(v) || parseInt(v, 10) * 3 < h).map((v) => ({ value: v, label: SIDE_WALL_LABEL[v] }));

export function WallsPanel() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  // a change turns the camera to that wall, so the customer sees what changed (walkthroughs 10/16/26)
  const look = (k: 'front' | 'back' | 'left' | 'right') => setTimeout(() => cameraApi.fit(k), 80);
  const setEnd = (k: 'front' | 'back') => (v: EndWall) => { update((x) => void (x.walls[k] = v)); look(k); };
  const setSide = (k: 'left' | 'right') => (v: SideWall) => { update((x) => void (x.walls[k] = v)); look(k); };
  const hidden = d.openings.filter((o) => {
    if (d.type === 'combo') return false;
    const st = o.wall === 'front' || o.wall === 'back' ? d.walls[o.wall] : o.wall === 'partition' ? 'closed' : d.walls[o.wall];
    return st !== 'closed';
  }).length;

  return (
    <div className="panel-body">
      <Note>Left and right are as seen standing in front of the building, facing the front end.</Note>
      {d.type === 'combo' ? (
        <>
          <Select
            label="Front end (carport)"
            value={d.walls.front === 'gableOnly' ? 'gableOnly' : 'open'}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'gableOnly', label: 'Gable only (top triangle)' },
            ]}
            onChange={setEnd('front')}
          />
          <Select label="Left side, carport part" value={d.walls.left} options={sideOpts(d.height)} onChange={setSide('left')} />
          <Select label="Right side, carport part" value={d.walls.right} options={sideOpts(d.height)} onChange={setSide('right')} />
          <Note>The garage part is fully enclosed: back end, both sides and the divider wall between garage and carport.</Note>
        </>
      ) : (
        <>
          <Select label="Front end" value={d.walls.front} options={endOpts} onChange={setEnd('front')} />
          <Select label="Back end" value={d.walls.back} options={endOpts} onChange={setEnd('back')} />
          <Select label="Left side" value={d.walls.left} options={sideOpts(d.height)} onChange={setSide('left')} />
          <Select label="Right side" value={d.walls.right} options={sideOpts(d.height)} onChange={setSide('right')} />
        </>
      )}
      <p className="field-hint">Doors and windows go on closed walls. Panels “from the top” hang down from the roof line.</p>
      {hidden > 0 && (
        <Note tone="warn">
          {hidden === 1 ? 'One door or window is' : `${hidden} doors or windows are`} on a wall that isn’t closed, so the model doesn’t show{' '}
          {hidden === 1 ? 'it' : 'them'}. Close the wall or move {hidden === 1 ? 'it' : 'them'} in Doors &amp; Windows.
        </Note>
      )}
    </div>
  );
}
