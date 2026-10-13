import { useWebStore } from '../store';
import { COLORS, WAINSCOT_PRINTS } from '../model/catalog';
import { Swatches, Toggle } from './ui';

const SORTED = COLORS.slice().sort((a, b) => a.name.localeCompare(b.name));

export function ColorsPanel() {
  const d = useWebStore((s) => s.design);
  const update = useWebStore((s) => s.update);
  const vertical = d.panels === 'Vertical';
  const set = (k: 'roof' | 'walls' | 'trim' | 'wainscot') => (key: string) => update((x) => void (x.colors[k] = key));
  return (
    <div className="panel-body">
      <Swatches label="Roof" value={d.colors.roof} options={SORTED} onChange={set('roof')} />
      <Swatches label="Walls" value={d.colors.walls} options={SORTED} onChange={set('walls')} />
      <Swatches label="Trim" value={d.colors.trim} options={SORTED} onChange={set('trim')} />
      <div className="field">
        <Toggle label="Wainscot: a contrasting band along the bottom of the walls" checked={d.wainscot} onChange={(on) => update((x) => void (x.wainscot = on))} />
      </div>
      {d.wainscot && (
        <>
          <Swatches
            label="Wainscot"
            value={d.colors.wainscot}
            options={[...SORTED, ...WAINSCOT_PRINTS.map((p) => ({ ...p, disabled: !vertical }))]}
            onChange={set('wainscot')}
          />
          <p className="field-hint">
            {vertical
              ? 'The last four are printed wood, brick and stone looks.'
              : 'Printed wood, brick and stone wainscot (last four) needs vertical wall panels (Size & Roof tab).'}
          </p>
        </>
      )}
      <p className="field-hint">Screen colors are close matches; real panels can look slightly different.</p>
    </div>
  );
}
