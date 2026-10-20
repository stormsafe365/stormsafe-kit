/**
 * Colors on one screen (owner 10/17/26: "no ton of scrolling"): pick Roof, Walls or Trim at the top
 * (each shows its color now), then tap a color in ONE grid. Wainscot is a switch that adds its own button.
 */
import { useState } from 'react';
import { useWebStore } from '../store';
import { COLORS, ROLLUP_COLORS, WAINSCOT_PRINTS, colorByKey, rollupColor } from '../model/catalog';
import { hasRollupDoor } from '../model/normalize';
import { Swatches, Toggle } from './ui';

const SORTED = COLORS.slice().sort((a, b) => a.name.localeCompare(b.name));
type Part = 'roof' | 'walls' | 'trim' | 'wainscot' | 'rollup';
const NAME: Record<Part, string> = { roof: 'Roof', walls: 'Walls', trim: 'Trim', wainscot: 'Wainscot', rollup: 'Garage doors' };

export function ColorsPanel() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  const [part, setPart] = useState<Part>('roof');
  const vertical = d.panels === 'Vertical';
  const parts: Part[] = d.wainscot ? ['roof', 'walls', 'trim', 'wainscot'] : ['roof', 'walls', 'trim'];
  // garage doors: one color for all of them (each door's own color can still be changed in the Doors step)
  const rollups = d.openings.filter((o) => o.kind === 'rollup');
  if (hasRollupDoor(d)) parts.push('rollup');
  const rollupKey = rollups.length && rollups.every((o) => o.color === rollups[0].color) ? (rollups[0].color ?? 'white') : '';
  const cur: Part = parts.includes(part) ? part : 'roof';
  const set = (key: string) =>
    update((x) => {
      if (cur === 'rollup') {
        for (const o of x.openings) if (o.kind === 'rollup') o.color = key;
      } else x.colors[cur] = key;
    });
  const options = cur === 'rollup' ? ROLLUP_COLORS : cur === 'wainscot' ? [...SORTED, ...WAINSCOT_PRINTS.map((p) => ({ ...p, disabled: !vertical }))] : SORTED;
  return (
    <div className="panel-body">
      <div className="colorparts" role="group" aria-label="Which part to color">
        {parts.map((p) => (
          <button key={p} type="button" className={`colorpart${cur === p ? ' on' : ''}`} aria-pressed={cur === p} onClick={() => setPart(p)}>
            <span className="colorpart-dot" style={{ background: p === 'rollup' ? (rollupKey ? rollupColor(rollupKey).hex : '#888') : (colorByKey(d.colors[p])?.hex ?? '#888') }} aria-hidden="true" />
            <span className="colorpart-name">{NAME[p]}</span>
            <span className="colorpart-val">{p === 'rollup' ? (rollupKey ? rollupColor(rollupKey).name : 'Mixed') : (colorByKey(d.colors[p])?.name ?? '')}</span>
          </button>
        ))}
      </div>
      <Swatches label={`${NAME[cur]} color`} value={cur === 'rollup' ? rollupKey : d.colors[cur]} options={options} onChange={set} />
      {cur === 'rollup' ? <p className="field-hint">This color goes on every garage door{rollups.length > 1 ? ' (all ' + rollups.length + ')' : ''}. To color one door differently, use its card in the Doors step.</p> : null}
      <div className="field">
        <Toggle
          label="Wainscot: a contrasting band along the bottom of the walls"
          checked={d.wainscot}
          onChange={(on) => {
            update((x) => void (x.wainscot = on));
            if (on) setPart('wainscot');
          }}
        />
      </div>
      {cur === 'wainscot' && !vertical ? <p className="field-hint">Printed wood, brick and stone looks (last four) need vertical wall panels (Size step, More options).</p> : null}
      <p className="field-hint more-hint">Screen colors are close matches; real panels can look slightly different.</p>
    </div>
  );
}
