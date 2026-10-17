// "Your design" list on the last step (owner 10/17/26): every step's choices in plain words, one row per step.
import { describe, expect, it } from 'vitest';
import { cloneDesign, DEFAULT_DESIGN } from '../src/model/design';
import { reviewRows } from '../src/panels/ReviewList';
import { applyStyle, STYLES } from '../src/model/guide';
import { SAMPLE_DESIGN } from './sample';

describe('your design list', () => {
  it('a plain building: size, nothing added, default colors', () => {
    const rows = reviewRows(cloneDesign(DEFAULT_DESIGN));
    expect(rows.map((r) => r.key)).toEqual(['size', 'doors', 'leantos', 'upgrades', 'colors']);
    expect(rows[0].lines[0]).toBe('Garage: 24′ W × 30′ L × 10′ H');
    expect(rows[1].lines).toEqual(['None yet']);
    expect(rows[2].lines).toEqual(['None']);
    expect(rows[3].lines).toEqual(['None']);
    expect(rows[4].lines[0]).toBe('Roof Galvalume · Walls Pewter Gray · Trim Black');
  });
  it('doors and windows are listed one per line with their wall', () => {
    const rows = reviewRows(cloneDesign(SAMPLE_DESIGN));
    expect(rows[1].lines.length).toBe(SAMPLE_DESIGN.openings.length);
    for (const line of rows[1].lines) expect(line).toMatch(/ · (Front end|Back end|Left side|Right side|Divider wall)/i);
  });
  it('an ag barn lists its two lean-tos', () => {
    const d = cloneDesign(DEFAULT_DESIGN);
    const ag = STYLES.find((s) => s.key === 'ag')!;
    applyStyle(d, 'ag', ag.sizes[0], 'standard');
    const rows = reviewRows(d);
    expect(rows[2].lines).toHaveLength(2);
    expect(rows[2].lines.some((l) => /closed in/.test(l))).toBe(true);
    expect(rows[2].lines.some((l) => /open/.test(l))).toBe(true);
  });
});
