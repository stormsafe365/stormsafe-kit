/**
 * Add-ons: the partition wall (owner 10/31/26: "where are the partition walls ???? ... like on the customize page") - a
 * wall across the inside making a separate room at one end. The website's card (stormsafe-site builder-src
 * UpgradesPanel PartitionWallCard, owner 10/29/26), plus the program's own check that the wall does not run through a door
 * or window on a side wall (aewEaveConflicts). The CRM prices it as the program's End Storage (designShape.storageOf).
 */
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from '../store';
import { builtSpacingFt, storageAllowed, storageCrossings, storageDefaultDepth, storageDepthOptions } from '../model/rules';
import type { WebOpening } from '../model/design';
import { AddonPick } from './AddonPick';
import { Note, Segmented, Select, ft } from './ui';

const PART_NOUN: Record<WebOpening['kind'], string> = { rollup: 'garage door', walk: 'walk-in door', window: 'window', frame: 'framed opening' };
const sideName = (o: WebOpening) => (o.wall === 'left' ? 'left side' : 'right side');

export function PartitionWallCard() {
  const d = useWebStore((s) => s.design);
  const county = useWebStore((s) => s.ctx.county);
  const update = useWebStore((s) => s.update);
  const spacing = builtSpacingFt(d, county);
  const depths = storageAllowed(d) ? storageDepthOptions(d.length, spacing, d.storage.end) : [];
  const onWall = d.openings.filter((o) => o.wall === 'partition').length;
  const [confirm, setConfirm] = useState(false);
  // the room is inside the building: show it (the "See inside" view) when it is added or changed
  const room = d.storage.on ? `${d.storage.end}:${d.storage.depth}` : '';
  const lastRoom = useRef(room);
  useEffect(() => {
    if (room && room !== lastRoom.current) useEditorStore.getState().setViewMode('cutaway');
    else if (!room && lastRoom.current && useEditorStore.getState().viewMode === 'cutaway') useEditorStore.getState().setViewMode('exterior');
    lastRoom.current = room;
  }, [room]);

  const setOn = (on: boolean) => {
    setConfirm(false);
    update((x) => {
      x.storage.on = on;
      if (on && !(x.storage.depth > 0)) x.storage.depth = storageDefaultDepth(depths) ?? 10;
    });
  };
  // a side door / window the wall would run through (the program flags these: "move the opening or pick another depth")
  const crossing = d.storage.on ? storageCrossings(d, d.storage) : [];
  const crossText = (v: number) => (storageCrossings(d, { end: d.storage.end, depth: v }).length ? ' · runs through a side door or window' : '');

  return (
    <AddonPick
      pic="partition"
      title="Partition wall"
      text="A wall inside your building that makes a separate room at one end: storage, a shop or an office."
      added={
        d.storage.on ? (
          <span className="addon-added">
            ✓ Added{' '}
            {confirm ? (
              <button type="button" className="addon-remove" onClick={() => setOn(false)}>
                Remove it and the {onWall === 1 ? 'door' : `${onWall} doors`} on it
              </button>
            ) : (
              <button type="button" className="addon-remove" onClick={() => (onWall ? setConfirm(true) : setOn(false))}>
                Remove
              </button>
            )}
          </span>
        ) : undefined
      }
    >
      {storageAllowed(d) ? (
        depths.length ? (
          <>
            {!d.storage.on && (
              <button type="button" className="btn-primary addon-add" onClick={() => setOn(true)}>
                + Add a partition wall
              </button>
            )}
            {d.storage.on && (
              <div className="upg-row">
                <Segmented
                  label="Which end"
                  value={d.storage.end}
                  options={[
                    { value: 'front', label: 'Front end' },
                    { value: 'back', label: 'Back end' },
                  ]}
                  onChange={(end) => update((x) => void (x.storage.end = end))}
                />
                <Select
                  label="Room depth"
                  value={d.storage.depth}
                  options={depths.map((v) => ({ value: v, label: `${ft(v)} deep · ${ft(d.length - v)} main room${crossText(v)}` }))}
                  onChange={(v) => update((x) => void (x.storage.depth = Number(v)))}
                  hint={`The wall sits on a frame line (${spacing}′ apart). Tap “See inside” on the model to look at it.`}
                />
              </div>
            )}
            {crossing.length > 0 && (
              <Note tone="warn">
                This wall runs through the {crossing.map((o) => `${PART_NOUN[o.kind]} on the ${sideName(o)}`).join(' and the ')}. Pick another room depth,
                or move {crossing.length === 1 ? 'it' : 'them'} in Doors &amp; windows.
              </Note>
            )}
            {d.storage.on && (
              <button
                type="button"
                className="btn-ghost addon-doors"
                onClick={() => {
                  useWebStore.getState().setDoorWall('partition');
                  useWebStore.getState().setTab('doors');
                }}
              >
                + Add a door, walk-in door or roll-up door to this wall
              </button>
            )}
          </>
        ) : (
          <p className="field-hint">Make the building longer to add a partition wall.</p>
        )
      ) : (
        <p className="field-hint">A Garage + Carport already has its divider wall between the garage and the carport. Doors go on it in Doors &amp; windows.</p>
      )}
    </AddonPick>
  );
}
