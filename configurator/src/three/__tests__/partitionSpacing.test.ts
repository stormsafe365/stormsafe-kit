import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { partitionSpacingVisible } from '../spacingVisibility';

// Spacing overlay on the End Storage / GCH partition (owner 10/3/26, with its
// doors draggable inside): the chain is drawn only where that interior wall
// can be seen — never floating over the front gable from outside in Exterior.
describe('partition Spacing chain visibility', () => {
  const s = { width: 26, length: 50, peakHeight: 15.25 };
  const ext = { viewMode: 'exterior', interiorView: false };
  it('Interior: always (the camera stands in the main room)', () => {
    expect(partitionSpacingVisible({ x: 0, y: 5.5, z: -20 }, s, { viewMode: 'exterior', interiorView: true })).toBe(true);
  });
  it('Cutaway / Structure: always (the shell is ghosted)', () => {
    expect(partitionSpacingVisible({ x: 40, y: 25, z: -45 }, s, { viewMode: 'cutaway', interiorView: false })).toBe(true);
    expect(partitionSpacingVisible({ x: 40, y: 25, z: -45 }, s, { viewMode: 'structure', interiorView: false })).toBe(true);
  });
  it('Exterior from outside: hidden behind the wall, so no labels', () => {
    expect(partitionSpacingVisible({ x: 34, y: 22, z: -38 }, s, ext)).toBe(false);
    expect(partitionSpacingVisible({ x: 0, y: 8, z: -40 }, s, ext)).toBe(false); // in front of the front gable
    expect(partitionSpacingVisible({ x: 0, y: 40, z: 0 }, s, ext)).toBe(false); // above the roof
  });
  it('Exterior with the orbit camera pushed inside the footprint: shown', () => {
    expect(partitionSpacingVisible({ x: 2, y: 6, z: -10 }, s, ext)).toBe(true);
  });
  it('SpacingOverlay lists the partition and applies the rule plus the viewer-side facing test', () => {
    const code = readFileSync(fileURLToPath(new URL('../Openings.tsx', import.meta.url)), 'utf8');
    expect(code).toMatch(/const SPACING_SIDES: WallSide\[\] = \['front', 'back', 'left', 'right', 'partition'\];/);
    expect(code).toMatch(/if \(side === 'partition'\) \{\s*if \(structure\.enclosure\.partitionZ === null\) return false;\s*if \(!partitionSpacingVisible\(camera\.position, structure, useEditorStore\.getState\(\)\)\) return false;/);
    expect(code).toMatch(/const o = pushOut\(c, side, 1, partFaces\(structure\)\);/);
  });
});
