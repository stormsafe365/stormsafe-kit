import { describe, expect, it } from 'vitest';
import { resolveBuilding } from '../ruleEngine';
import { deriveStructure } from '../geometry';
import { DEFAULT_CONFIG } from '@/config/constants';

describe('frame braces', () => {
  it('adds a peak collar tie per bent + 2 knee braces per bent — none on a SHEETED end frame (owner 10/14/26)', () => {
    // 24×36×10 garage, both ends closed → the two end frames carry no knee brace
    // (CCI handbook p.30: no corner braces on an enclosed end; CA-2: exclude end-walls).
    const s = deriveStructure(resolveBuilding(DEFAULT_CONFIG));
    const braces = s.members.filter((m) => m.kind === 'brace');
    expect(braces.length).toBe(s.frameCount + (s.frameCount - 2) * 2);

    const H = DEFAULT_CONFIG.legHeight;
    const knee = braces.filter((b) => b.start[1] !== b.end[1]); // diagonal
    const peak = braces.filter((b) => b.start[1] === b.end[1]); // horizontal collar tie
    expect(knee.length).toBe((s.frameCount - 2) * 2);
    expect(peak.length).toBe(s.frameCount);

    for (const b of knee) {
      expect(b.start[1]).toBeLessThan(H); // starts below the eave on the leg
      expect(b.end[1]).toBeGreaterThan(H); // ends up on the rafter
    }
    for (const b of peak) {
      expect(b.start[1]).toBeGreaterThan(H); // up near the ridge
      expect(b.length).toBeGreaterThan(0.5);
    }
  });

  it('braces appear on carport and GCH builds too (open ends keep their end-frame knee braces)', () => {
    const carport = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'carport' }));
    expect(carport.members.filter((m) => m.kind === 'brace').length).toBe(carport.frameCount * 3);
    // GCH: open carport end at the front keeps its braces, the closed back end has none.
    const gch = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'utility', openEnd: 'front' }));
    expect(gch.members.filter((m) => m.kind === 'brace').length).toBe(gch.frameCount * 3 - 2);
  });
});

// A gable-end base rail has both endpoints at the same Z (spans X); an eave
// rail has both endpoints at the same X (spans Z).
const gableRails = (s: ReturnType<typeof deriveStructure>) =>
  s.members.filter((m) => m.kind === 'baseRail' && m.start[2] === m.end[2]);

describe('gable-end base rail', () => {
  // No openings here — these assert rail PRESENCE per closed end; opening-driven
  // rail cutting (which can split a rail into multiple segments) is covered in
  // memberCut.test.ts.
  it('is present only on CLOSED gable ends', () => {
    const garage = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage', openings: [] }));
    expect(gableRails(garage).length).toBe(2); // both ends closed
  });

  it('is absent on a carport (both ends open / drive-through)', () => {
    const carport = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'carport', openings: [] }));
    expect(gableRails(carport).length).toBe(0);
  });

  it('GCH has a rail only on the closed (garage) end, not the open carport end', () => {
    const gch = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'utility', openEnd: 'front', openings: [] }));
    expect(gableRails(gch).length).toBe(1); // back closed, front open
  });
});

describe('open-bay side panels', () => {
  it('garage has no open bay', () => {
    const s = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'garage' }));
    expect(s.openBayZ).toBeNull();
  });

  it('carport open bay spans the whole length', () => {
    const s = deriveStructure(resolveBuilding({ ...DEFAULT_CONFIG, buildingType: 'carport' }));
    expect(s.openBayZ).toEqual({ start: -s.length / 2, end: s.length / 2 });
  });

  it('GCH open bay is the un-enclosed front portion, and panel heights carry through', () => {
    const s = deriveStructure(
      resolveBuilding({
        ...DEFAULT_CONFIG,
        buildingType: 'utility',
        openEnd: 'front',
        length: 40,
        enclosedLengthFt: 28,
        eavePanelFt: { left: 6, right: 0 },
      }),
    );
    expect(s.openBayZ).not.toBeNull();
    expect(s.openBayZ!.start).toBe(-s.length / 2); // open bay at the front
    expect(s.openBayZ!.end).toBeLessThan(s.length / 2); // stops at the partition
    expect(s.eavePanelFt).toEqual({ left: 6, right: 0 });
  });
});
