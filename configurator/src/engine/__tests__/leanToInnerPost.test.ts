import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';

/**
 * Owner 11/10/26: "why did a truss randomly appear on the main building's outside wall" — a lean-to whose end misses a
 * main frame gets its own INNER post at the main wall; 15'+ at the wall that post is doubled, and the second post went
 * 0.4' OUT into the lean-to (a bare post outside the main wall, ground to the lean-to roof). It now goes INTO the main
 * building behind the sheeting (like every main leg's second post), up to the connection height. Drawing only.
 */
type Side = 'Left Eave' | 'Right Eave' | 'Front Gable' | 'Back Gable';
const build = (side: Side, lengthFt: number, lowLegHeightFt: number, openings: unknown[] = []) =>
  deriveStructure(
    resolveBuilding({
      ...DEFAULT_CONFIG,
      buildingType: 'garage',
      width: 30,
      length: 50,
      legHeight: 16,
      openings,
      leanTos: [{ id: 'lt1', type: 'attached', attachedSide: side, widthFt: 12, lengthFt, lowLegHeightFt, roofPitch: '3:12', openings: [] }],
    } as never),
  );
type S = ReturnType<typeof build>;
const legs = (s: S) => s.members.filter((m) => m.kind === 'leg' && Math.abs(m.start[1]) < 1e-6);
/** Signed distance of a vertical leg outside the main wall the lean-to is on (negative = inside the building). */
const outside = (s: S, side: Side, m: S['members'][number]) => {
  const halfW = s.width / 2;
  const halfL = s.length / 2;
  if (side === 'Left Eave') return m.start[0] - halfW;
  if (side === 'Right Eave') return -m.start[0] - halfW;
  if (side === 'Front Gable') return -m.start[2] - halfL;
  return m.start[2] - halfL;
};
/** Lean-to-attached legs hugging the main wall: within 1' either side of the framing line. */
const nearWall = (s: S, side: Side) => legs(s).filter((m) => Math.abs(outside(s, side, m)) < 1);

describe('lean-to inner post at the main wall', () => {
  it('the reported case: a 22-ft eave lean-to, 15 ft at the wall, misses a main frame -> no post outside the main wall', () => {
    const s = build('Left Eave', 22, 12);
    const lt = s.leanTos[0];
    expect(lt.peakHeightFt).toBe(15);
    expect(lt.trussOffsets).toEqual([0, 4, 8, 12, 16, 20, 22]); // the 22 end is off the 4-ft main frames
    // Nothing stands out past the sheeting (SHEET_OUTSET 0.18) anywhere along the lean-to.
    expect(nearWall(s, 'Left Eave').filter((m) => outside(s, 'Left Eave', m) > 0.05)).toEqual([]);
    // The doubled inner post: one at the framing line, its second 0.4 ft INSIDE the building, both to 15 ft.
    const z = lt.spanStart + 22;
    const atEnd = nearWall(s, 'Left Eave').filter((m) => Math.abs(m.start[2] - z) < 0.01);
    expect(atEnd.map((m) => +outside(s, 'Left Eave', m).toFixed(2)).sort()).toEqual([-0.4, 0]);
    for (const m of atEnd) expect(+m.end[1].toFixed(3)).toBe(15);
  });

  it('every side: no lean-to post stands outside the main wall (eave + gable, doubled inner posts)', () => {
    for (const side of ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable'] as const) {
      const s = build(side, side.includes('Eave') ? 30 : 30, 12);
      const out = nearWall(s, side).filter((m) => outside(s, side, m) > 0.05);
      expect({ side, out: out.length }).toEqual({ side, out: 0 });
      // and the doubled inner posts are really there (inside), not dropped
      expect(nearWall(s, side).some((m) => Math.abs(outside(s, side, m) + 0.4) < 0.01)).toBe(true);
    }
  });

  it('under 15 ft at the wall: one single inner post at the framing line, exactly as before', () => {
    const s = build('Left Eave', 22, 10); // 13 ft at the wall
    const z = s.leanTos[0].spanStart + 22;
    const atEnd = nearWall(s, 'Left Eave').filter((m) => Math.abs(m.start[2] - z) < 0.01);
    expect(atEnd.map((m) => +outside(s, 'Left Eave', m).toFixed(2))).toEqual([0]);
    expect(+atEnd[0].end[1].toFixed(3)).toBe(13);
  });

  it('outer posts unchanged: a doubled outer post still has its second post toward the building, up to the rafter', () => {
    const s = build('Left Eave', 22, 15); // 15-ft low leg -> doubled outer posts
    const halfW = s.width / 2;
    const outer = legs(s).filter((m) => Math.abs(m.start[0] - (halfW + 12 - 0.4)) < 0.01);
    expect(outer.length).toBe(s.leanTos[0].trussOffsets.length);
    for (const m of outer) expect(m.end[1]).toBeGreaterThan(15); // rises past the 15-ft post to the rafter
  });

  it('a main-wall door at that spot clears the new inside post too (same band as the main legs)', () => {
    // 'Left Eave' = 3D side 'right'; a 10-ft opening centred on the lean-to end (z = -25 + 22 = -3 -> offset 22).
    const s = build('Left Eave', 22, 12, [
      { id: 'd1', type: 'garageDoor', side: 'right', offset: 22, width: 10, height: 10, sillHeight: 0 },
    ]);
    const z = s.leanTos[0].spanStart + 22;
    const inDoor = s.members.filter(
      (m) => m.kind === 'leg' && Math.abs(m.start[2] - z) < 0.01 && Math.abs(outside(s, 'Left Eave', m)) < 1 && Math.min(m.start[1], m.end[1]) < 10 - 0.01,
    );
    expect(inDoor).toEqual([]);
  });
});
