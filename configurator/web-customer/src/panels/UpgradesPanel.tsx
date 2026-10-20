/**
 * Upgrades (owner 10/16/26: "building type, building size, components,
 * add-ons/upgrades & colors"). A wish list — no prices; the rep confirms what
 * fits the building and prices it in the quote. The options are the quote
 * program's own. A frame gauge / leg spacing the customer's width or county
 * already needs shows as already in the design (rules.ts), not as a choice.
 */
import { useWebStore } from '../store';
import { framingGauge, isWideSpan, trussSpacingFt } from '../model/rules';
import { hasRollupDoor } from '../model/normalize';
import type { Insulation } from '../model/design';
import { Note, Segmented, Toggle } from './ui';

export function UpgradesPanel() {
  const d = useWebStore((s) => s.design);
  const county = useWebStore((s) => s.ctx.county);
  const update = useWebStore((s) => s.update);
  const u = d.upgrades;
  const frameNeeded = framingGauge(d, county) === '12-gauge';
  const ocNeeded = trussSpacingFt(d, county) === 4;
  const ocByWidth = d.width > 24;
  const wide = isWideSpan(d.width); // wide span comes with 26-gauge wall panels (the program's rule)
  const vertical = d.roofStyle === 'Vertical';
  const rollups = hasRollupDoor(d);
  const set = (k: 'frame12' | 'oc4' | 'panels26' | 'colorScrews' | 'openers' | 'angle45') => (on: boolean) => update((x) => void (x.upgrades[k] = on));

  return (
    <div className="panel-body">
      <Segmented<Insulation>
        label="Insulation"
        value={u.insulation}
        options={[
          { value: 'none', label: 'None' },
          { value: 'roof', label: 'Roof', disabled: !vertical },
          { value: 'roofWalls', label: 'Roof + walls', disabled: !vertical },
        ]}
        onChange={(v) => update((x) => void (x.upgrades.insulation = v))}
        hint={vertical ? undefined : 'Insulation goes with a vertical roof (Size step).'}
      />

      <div className="field">
        <Toggle
          label="12-gauge frame (heavier steel)"
          checked={u.frame12 || frameNeeded}
          disabled={frameNeeded}
          onChange={set('frame12')}
        />
        {frameNeeded ? <p className="field-hint">In your area, buildings this size usually get a 12-gauge frame, so it is already in your design. Your rep confirms it.</p> : null}
      </div>

      <div className="field">
        <Toggle label="Legs and trusses every 4′ (not 5′)" checked={u.oc4 || ocNeeded} disabled={ocNeeded} onChange={set('oc4')} />
        {ocNeeded ? (
          <p className="field-hint">
            {ocByWidth
              ? 'Buildings this wide have legs and trusses every 4′, so it is already in your design.'
              : 'In your area, buildings usually have legs and trusses every 4′, so it is already in your design. Your rep confirms it.'}
          </p>
        ) : null}
      </div>

      <div className="field">
        <Toggle label="Thicker 26-gauge wall panels" checked={u.panels26 || wide} disabled={wide} onChange={set('panels26')} />
        {wide ? <p className="field-hint">Wide-span buildings come with 26-gauge wall panels.</p> : null}
      </div>

      <div className="field">
        <Toggle label="Color-matched screws" checked={u.colorScrews} onChange={set('colorScrews')} />
      </div>

      <div className="field">
        <Toggle label="Electric garage door openers" checked={u.openers} disabled={!rollups} onChange={set('openers')} />
        {!rollups ? <p className="field-hint">Add a garage door first (Doors step).</p> : null}
      </div>

      <div className="field">
        <Toggle label="45° angle cut on the garage doors" checked={u.angle45} disabled={!rollups} onChange={set('angle45')} />
        {!rollups ? <p className="field-hint">Add a garage door first (Doors step).</p> : <p className="field-hint">Applies to every garage door on your building.</p>}
      </div>

      <p className="field-hint more-hint">Wall panel direction and roof pitch are in the Size step (More options); wainscot is in Colors.</p>
    </div>
  );
}
