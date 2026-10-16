/**
 * Upgrades (owner 10/16/26: "building type, building size, components,
 * add-ons/upgrades & colors"). A wish list — no prices; the rep confirms what
 * fits the building and prices it in the quote. The options are the quote
 * program's own. A frame gauge / leg spacing the customer's width or county
 * already needs shows as already in the design (rules.ts), not as a choice.
 */
import { useWebStore } from '../store';
import { framingGauge, trussSpacingFt } from '../model/rules';
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
  const vertical = d.roofStyle === 'Vertical';
  const rollups = hasRollupDoor(d);
  const set = (k: 'frame12' | 'oc4' | 'panels26' | 'colorScrews' | 'openers') => (on: boolean) => update((x) => void (x.upgrades[k] = on));

  return (
    <div className="panel-body">
      <p className="send-lede">Pick any upgrades you would like. Your rep confirms what fits your building and puts them in your quote.</p>

      <Segmented<Insulation>
        label="Insulation"
        value={u.insulation}
        options={[
          { value: 'none', label: 'None' },
          { value: 'roof', label: 'Roof', disabled: !vertical },
          { value: 'roofWalls', label: 'Roof + walls', disabled: !vertical },
        ]}
        onChange={(v) => update((x) => void (x.upgrades.insulation = v))}
        hint={vertical ? 'Insulation for the roof, or for the roof and the walls.' : 'Insulation goes with a vertical roof (Size step).'}
      />

      <div className="field">
        <Toggle
          label="12-gauge frame: heavier steel tubing for the legs and trusses"
          checked={u.frame12 || frameNeeded}
          disabled={frameNeeded}
          onChange={set('frame12')}
        />
        {frameNeeded ? <p className="field-hint">Your area needs a 12-gauge frame for this building, so it is already in your design.</p> : null}
      </div>

      <div className="field">
        <Toggle label="Legs and roof trusses every 4′ (instead of every 5′)" checked={u.oc4 || ocNeeded} disabled={ocNeeded} onChange={set('oc4')} />
        {ocNeeded ? <p className="field-hint">Your building’s width or your area needs them every 4′, so it is already in your design.</p> : null}
      </div>

      <div className="field">
        <Toggle label="Thicker 26-gauge wall panels" checked={u.panels26} onChange={set('panels26')} />
      </div>

      <div className="field">
        <Toggle label="Color-matched screws" checked={u.colorScrews} onChange={set('colorScrews')} />
      </div>

      <div className="field">
        <Toggle label="Electric openers on the roll-up doors" checked={u.openers} disabled={!rollups} onChange={set('openers')} />
        {!rollups ? <p className="field-hint">Add a roll-up door first (Doors step).</p> : null}
      </div>

      <Note>Wall panel direction and roof pitch are in the Size step; wainscot is in the Colors step.</Note>
    </div>
  );
}
