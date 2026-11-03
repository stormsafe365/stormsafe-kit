import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WALL_OF_CAMERA, wallFromHit } from '../programBridge';

/**
 * The view box (owner 11/2/26): a click on the 3D model picks the program's wall. The 3D's axes (engine/geometry.ts):
 * front at z = -L/2, the 3D's internal 'left' wall at -X — which the program calls the RIGHT eave (left / right are named
 * as seen from the front: BuildHost SIDE_MAP, Section 5 WALLS .cam).
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');

describe('wallFromHit (30 W x 50 L)', () => {
  const W = 30, L = 50;
  it('the four main walls, from outside', () => {
    expect(wallFromHit({ x: 3, z: -25 }, { x: 0, y: 0, z: -1 }, W, L)).toBe('front');
    expect(wallFromHit({ x: -3, z: 25 }, { x: 0, y: 0, z: 1 }, W, L)).toBe('back');
    expect(wallFromHit({ x: 15, z: 4 }, { x: 1, y: 0, z: 0 }, W, L)).toBe('left'); // +X = the program's LEFT eave
    expect(wallFromHit({ x: -15, z: 4 }, { x: -1, y: 0, z: 0 }, W, L)).toBe('right');
  });
  it('a face whose normal points the other way gives the same wall (the side comes from where it was hit)', () => {
    expect(wallFromHit({ x: 15, z: 4 }, { x: -1, y: 0, z: 0 }, W, L)).toBe('left');
    expect(wallFromHit({ x: 3, z: -25 }, { x: 0, y: 0, z: 1 }, W, L)).toBe('front');
  });
  it('the roof picks nothing', () => {
    expect(wallFromHit({ x: 2, z: 0 }, { x: 0.2, y: 0.97, z: 0 }, W, L)).toBeNull();
    expect(wallFromHit({ x: 2, z: 0 }, { x: 0, y: -1, z: 0 }, W, L)).toBeNull();
  });
  it('a lean-to picks the wall it hangs on (its card is listed there)', () => {
    // a 12'-wide lean-to on the +X eave: its outer wall and its front end wall
    expect(wallFromHit({ x: 27, z: 0 }, { x: 1, y: 0, z: 0 }, W, L)).toBe('left');
    expect(wallFromHit({ x: 21, z: -25 }, { x: 0, y: 0, z: -1 }, W, L)).toBe('left');
    // a lean-to on the back gable: its end walls
    expect(wallFromHit({ x: -15, z: 31 }, { x: -1, y: 0, z: 0 }, W, L)).toBe('back');
  });
  it('no building, no wall', () => {
    expect(wallFromHit({ x: 0, z: -25 }, { x: 0, y: 0, z: -1 }, 0, L)).toBeNull();
  });
});

describe('camera presets <-> program walls', () => {
  it('is the program\'s own WALLS .cam table, the other way round', () => {
    const m = /var WALLS=\[([\s\S]*?)\n\];/.exec(html);
    expect(m).not.toBeNull();
    const cams: Record<string, string> = {};
    for (const r of m![1].matchAll(/\{k:'(\w+)'[^}]*cam:'(\w+)'\}/g)) cams[r[2]] = r[1];
    expect(cams).toEqual({ front: 'front', back: 'back', right: 'left', left: 'right' });
    for (const [cam, wall] of Object.entries(cams)) expect(WALL_OF_CAMERA[cam]).toBe(wall);
  });
  it('the program controls the box presses are still there (Section 5 tiles, add buttons, card header)', () => {
    expect(html).toMatch(/class="s5-tile s5-w-'\+w\.k\+'" role="radio" aria-checked="false" data-wall="'\+w\.k\+'"/);
    expect(html).toMatch(/class="s5-add" data-kind="'\+k\+'"/);
    expect(html).toMatch(/var tile=t\.closest\('\.s5-tile'\); if\(tile\)\{ S\.wall=tile\.dataset\.wall; refresh\(\); turn3D\(S\.wall\); return; \}/);
    expect(html).toMatch(/var add=t\.closest\('\.s5-add'\); if\(add\)\{ if\(!add\.disabled\) addItem\(add\.dataset\.kind\); return; \}/);
    expect(html).toMatch(/<button type="button" class="s5-x" aria-label="Remove this item"/);
    expect(html).toMatch(/<select id="cr" onchange="setSwatch\('cr','swr'\)">/);
    expect(html).toMatch(/<input type="checkbox" id="wain-cb" onchange="wainToggle\(\)"/);
    expect(html).toMatch(/<input id="cn" placeholder="Full name" oninput="sy\(\)">/);
  });
});
