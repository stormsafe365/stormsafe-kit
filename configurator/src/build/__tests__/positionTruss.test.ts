import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  gableLeanToOffset3D,
  mirrorsTo3D,
  offset3DToProgramX,
  programXTo3DOffset,
  programXToTyped,
  typedValueText,
} from '../positionMap';
import { resolveBuilding } from '@/engine/ruleEngine';
import { deriveStructure, openingWorldTransform } from '@/engine/geometry';
import { checkCollision } from '@/engine/layout';
import { DEFAULT_CONFIG } from '@/config/constants';
import type { WallSide } from '@/types/building';

/**
 * Owner 10/5/26: "I have the walk door frame out at 9', but the layout ...
 * shows less than 9' away from the back gable endwall ... a truss doesn't
 * appear from the back gable end towards the front for 8'".
 *
 * ONE definition everywhere: the number typed = feet from the named end of
 * the wall to the NEAR edge of the opening; the program (getPosItems,
 * runTrussChecks, every drawing) and the 3D (positionMap → the engine's
 * openingWorldTransform) put it at the same physical spot, on every wall, for
 * both buttons; the 3D frame lines sit at the program's getTrussPositions.
 * The program's OWN functions run here in a node vm (public/quote-builder.html).
 */

const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  const i = m.index + 1;
  let j = html.indexOf('{', i);
  let depth = 0;
  let inStr: string | null = null;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && html[j + 1] === '/') { j = html.indexOf('\n', j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(i, j + 1) + '\n';
}

const fields: Record<string, string> = { bw: '30', bl: '80', btype: 'standard', 'oc-spacing': '4oc' };
const ctx = vm.createContext({});
vm.runInContext(
  ['getPosItems', 'posRefName', 'posRefLabel', 'posDescribe', '_dimFtIn', 'getTrussOC', 'getTrussPositions', 'checkTrussHitFromFront'].map(grabFn).join('') +
    'function MFR(){ return { wtdTypes: [], winTypes: [] }; }\n' +
    'var __f = {}; function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n',
  ctx,
);
const P = ctx as unknown as {
  __f: Record<string, string>;
  getPosItems: (entry: unknown, qty: number, itemW: number, faceW: number, itemH: number, type: string) => Array<{ x: number; w: number }>;
  posRefName: (loc: string, side: string) => string;
  posRefLabel: (loc: string, side: string) => string;
  posDescribe: (loc: string, val: string | number, side: string) => string;
  getTrussPositions: (L: number) => number[];
  checkTrussHitFromFront: (distFromFront: number, itemW: number, L: number) => number[];
};
const setFields = (f: Record<string, string>) => {
  vm.runInContext('__f = ' + JSON.stringify({ ...fields, ...f }) + ';', ctx);
};

type Side = 'left' | 'right';
/** The slice of an entry's DOM getPosItems reads (location + one pos row). */
function entry(loc: string, val: string, side: Side) {
  const row = { querySelector: (s: string) => (s === 'input' ? { value: val } : s === '.pos-toggle button.active' ? { dataset: { side } } : null) };
  return {
    querySelector: (s: string) => {
      if (s === '.pos-section') return { querySelectorAll: (q: string) => (q === '.pos-row' ? [row] : []) };
      if (s === '.wloc, .nloc, .rloc, .fo-loc') return { value: loc };
      return null;
    },
  };
}

const SIDE_3D: Record<string, WallSide> = {
  'Front Gable End': 'front',
  'Back Gable End': 'back',
  'Left Eave Side': 'right', // program Left Eave = 3D +X (BuildHost SIDE_MAP)
  'Right Eave Side': 'left',
  'Partition Wall': 'partition',
};
const isEave = (loc: string) => loc === 'Left Eave Side' || loc === 'Right Eave Side';

/**
 * Where the typed number SAYS the opening's centre is, in world coords
 * (Left Eave = +X, Right Eave = −X, Front = −Z, Back = +Z), from the reference
 * the button names (posRefName) — independent of every mapping under test.
 */
function expectedCentre(loc: string, side: Side, v: number, w: number, W: number, L: number): number {
  const ref = P.posRefName(loc, side);
  if (isEave(loc)) return ref === 'front gable' ? -L / 2 + v + w / 2 : L / 2 - v - w / 2; // world z
  return ref === 'left eave corner' ? W / 2 - v - w / 2 : -W / 2 + v + w / 2; // world x
}

function structure(W: number, L: number, over: Partial<typeof DEFAULT_CONFIG> = {}) {
  return deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', openings: [], width: W, length: L, legHeight: 16, ...over }));
}

const LOCS = ['Front Gable End', 'Back Gable End', 'Left Eave Side', 'Right Eave Side'] as const;

describe('the typed number means the same spot in the program and the 3D, on every wall and both buttons', () => {
  const W = 30, L = 80;
  const st = structure(W, L);
  for (const loc of LOCS) {
    for (const side of ['left', 'right'] as const) {
      it(`${loc} · ${P.posRefLabel(loc, side)}`, () => {
        const face = isEave(loc) ? L : W;
        for (const [v, w] of [[9, 3], [0, 3], [4.5, 2.5], [12.75, 3], [2, 8], [1.25, 3.0208333]] as const) {
          const [it] = P.getPosItems(entry(loc, String(v), side), 1, w, face, 6.67, 'fo');
          const off = programXTo3DOffset(loc, it.x, it.w, face);
          const pos = openingWorldTransform(SIDE_3D[loc], off, 3, st).pos;
          const got = isEave(loc) ? pos[2] : pos[0];
          expect(got).toBeCloseTo(expectedCentre(loc, side, v, w, W, L), 9);
          // the wall it lands on: Left Eave +X, Right Eave −X, front −Z, back +Z
          if (loc === 'Left Eave Side') expect(pos[0]).toBeGreaterThan(W / 2);
          if (loc === 'Right Eave Side') expect(pos[0]).toBeLessThan(-W / 2);
          if (loc === 'Front Gable End') expect(pos[2]).toBeLessThan(-L / 2);
          if (loc === 'Back Gable End') expect(pos[2]).toBeGreaterThan(L / 2);
        }
      });
    }
  }
  it('the partition is measured like the front gable (seen from the front: from the left eave corner)', () => {
    expect(P.posRefName('Partition Wall', 'left')).toBe('left eave corner');
    expect(mirrorsTo3D('Partition Wall')).toBe(true);
    const [it] = P.getPosItems(entry('Partition Wall', '4', 'left'), 1, 3, W, 6.67, 'wtd');
    const off = programXTo3DOffset('Partition Wall', it.x, it.w, W);
    expect(-W / 2 + off).toBeCloseTo(W / 2 - 4 - 1.5, 9); // partition world x = −W/2 + offset
  });
  it('only the Right Eave runs the same way in both frames', () => {
    expect(LOCS.filter((l) => !mirrorsTo3D(l))).toEqual(['Right Eave Side']);
  });
});

describe('labels say exactly what the number means', () => {
  it('buttons', () => {
    expect([P.posRefLabel('Left Eave Side', 'left'), P.posRefLabel('Left Eave Side', 'right')]).toEqual(['From Front Gable', 'From Back Gable']);
    expect([P.posRefLabel('Right Eave Side', 'left'), P.posRefLabel('Right Eave Side', 'right')]).toEqual(['From Front Gable', 'From Back Gable']);
    expect([P.posRefLabel('Front Gable End', 'left'), P.posRefLabel('Front Gable End', 'right')]).toEqual(['From Left Eave', 'From Right Eave']);
    expect([P.posRefLabel('Back Gable End', 'left'), P.posRefLabel('Back Gable End', 'right')]).toEqual(['From Right Eave', 'From Left Eave']);
    expect([P.posRefLabel('Partition Wall', 'left'), P.posRefLabel('Partition Wall', 'right')]).toEqual(['From Left Eave', 'From Right Eave']);
  });
  it('card / schedule text', () => {
    expect(P.posDescribe('Left Eave Side', '9', 'right')).toBe("9' from the back gable to its near edge");
    expect(P.posDescribe('Back Gable End', '4.5', 'left')).toBe('4\'6" from the right eave corner to its near edge');
    expect(P.posDescribe('Front Gable End', '', 'left')).toBe('');
  });
});

describe('3D drag write-back is the exact inverse and keeps the rep\'s button', () => {
  for (const loc of LOCS) {
    for (const side of ['left', 'right'] as const) {
      it(`${loc} · ${side}`, () => {
        const face = isEave(loc) ? 80 : 30, w = 3;
        for (let off = w / 2 + 0.3; off <= face - w / 2 - 0.3; off += 0.917) {
          const x = offset3DToProgramX(loc, off, w, face);
          const typed = typedValueText(programXToTyped(loc, x, w, face, side));
          const [it] = P.getPosItems(entry(loc, typed, side), 1, w, face, 6.67, 'wtd');
          expect(Math.abs(programXTo3DOffset(loc, it.x, it.w, face) - off)).toBeLessThanOrEqual(1 / 24 + 1e-9); // nearest inch
        }
      });
    }
  }
  it('the owner\'s door: 9\' From Back Gable on the Left Eave of an 80\' building, dragged 0 → still "9" From Back Gable', () => {
    const [it] = P.getPosItems(entry('Left Eave Side', '9', 'right'), 1, 3, 80, 6.67, 'fo');
    const off = programXTo3DOffset('Left Eave Side', it.x, 3, 80);
    expect(off).toBe(69.5); // 3D: centre 69.5' from the front = near edge 9' from the back
    expect(typedValueText(programXToTyped('Left Eave Side', offset3DToProgramX('Left Eave Side', off, 3, 80), 3, 80, 'right'))).toBe('9');
  });
});

describe('gable lean-to "Starts At" (from your-left corner facing that gable)', () => {
  it('front gable mirrored onto the engine (−X start), back gable unchanged, full width unaffected', () => {
    expect(gableLeanToOffset3D('Front Gable', 2, 12, 30)).toBe(16);
    expect(gableLeanToOffset3D('Back Gable', 2, 12, 30)).toBe(2);
    expect(gableLeanToOffset3D('Front Gable', 0, 30, 30)).toBe(0);
    expect(gableLeanToOffset3D('Front Gable', 25, 12, 30)).toBe(0); // clamped like the engine (start ≤ W − run)
  });
});

describe('3D frame lines = the program\'s truss positions (every frame, both ends)', () => {
  const cases: Array<[number, number, string, string]> = [
    [30, 80, '4oc', 'standard'],
    [24, 80, '5oc', 'standard'],
    [24, 41, '5oc', 'standard'],
    [30, 41, '4oc', 'standard'],
    [30, 50, '4oc', 'standard'],
    [24, 23, '5oc', 'standard'],
    [20, 23, '4oc', 'standard'],
  ];
  for (const [W, L, oc, bt] of cases) {
    it(`${W}x${L} ${oc}`, () => {
      setFields({ bw: String(W), bl: String(L), 'oc-spacing': oc, btype: bt });
      const prog = P.getTrussPositions(L); // from the FRONT gable
      const spacing = prog.length ? prog[0] : 0;
      const st = structure(W, L, { trussSpacingFt: spacing });
      for (const side of ['left', 'right'] as const) {
        const interior = st.walls[side].trussLines.map((t) => t.posFt).filter((p) => p > 0.05 && p < L - 0.05);
        expect(interior).toEqual(prog);
      }
      // the bents themselves (−L/2 = front)
      expect(st.framePositionsZ.map((z) => Math.round((z + L / 2) * 1000) / 1000)).toEqual([0, ...prog, L]);
    });
  }
  it('GCH with the open bay in front: eave frame lines still run from the FRONT (were a whole bay off)', () => {
    setFields({ bw: '24', bl: '40', 'oc-spacing': '5oc', btype: 'gch' });
    const prog = P.getTrussPositions(40);
    const st = structure(24, 40, { buildingType: 'utility', enclosedLengthFt: 20, openEnd: 'front', trussSpacingFt: 5 });
    const interior = st.walls.left.trussLines.map((t) => t.posFt).filter((p) => p > 0.05 && p < 39.95);
    expect(interior).toEqual(prog);
  });
});

describe('the owner\'s case: the 9\' frame-out lands on a truss — program and 3D agree', () => {
  it('80x30, 4\' OC, walk-door frame-out 9\' From Back Gable on the Left Eave', () => {
    setFields({ bw: '30', bl: '80', 'oc-spacing': '4oc', btype: 'standard' });
    // runTrussChecks: data-side right on an eave → distFromFront = L − pos − w
    const hits = P.checkTrussHitFromFront(80 - 9 - 3, 3, 80);
    expect(hits).toEqual([68]); // the frame 12' from the back gable sits on the door's front jamb
    const st = structure(30, 80, { trussSpacingFt: 4 });
    const off = programXTo3DOffset('Left Eave Side', 9, 3, 80);
    const c = checkCollision(off, 3, st.walls.right);
    expect(c.hit).toBe(true);
    expect(c.legPosFt).toBe(68);
  });
  it('at 4\'6" (what the mouse wheel made of the typed 9) no frame is within the 2" jamb clearance — the side frame came off', () => {
    expect(P.checkTrussHitFromFront(80 - 4.5 - 3, 3, 80)).toEqual([]);
  });
});
