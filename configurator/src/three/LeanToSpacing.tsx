import { useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { LeanToStructure, Vec3 } from '@/engine/geometry';
import { rendersLeanToFixture } from '@/engine/leanToFixtures';
import type { LeanToOpening } from '@/types/building';
import { useEditorStore } from '@/store/useEditorStore';
import { endWallPlane, eaveSurfaces, gableSurfaces, resolveWalls, type SurfaceSet } from './LeanToSiding';
import { Chip3D, Measure, ftIn } from './Openings';

/**
 * "Spacing" overlay for LEAN-TO walls (render-upgrade Phase 7; owner rule:
 * the Spacing button shows all sizes / gaps / heights on the walls facing the
 * camera). The main building's SpacingOverlay / WallSpacing in Openings.tsx
 * are untouched; this adds, on every lean-to wall that carries a drawn
 * opening AND faces the camera:
 *   - each opening's size chip (walk doors / windows in inches, others ft-in),
 *   - the spacing chain corner -> opening -> opening -> corner along the wall,
 *   - sill heights for openings up the wall.
 * Positions use the lean-to fixture placement math (LeanToSiding
 * openingPlacement / LeanToOpeningGuides): outer wall = run start + offset,
 * end walls = the lower world across-coordinate + offset. A storage section's
 * PARTITION wall is an end-type wall facing the open part of the lean-to; its
 * chain shows while it can be seen through an open / partial wall of that
 * open part (never through a fully enclosed lean-to). Read-only: nothing here
 * moves, selects or writes back anything.
 */

type LeanToWall = LeanToOpening['wall'];

/** Where a lean-to wall is in the world, in the lean-to fixture frame. */
export interface LeanToWallFrame {
  /** World point `d` ft proud of the wall, `off` ft along it from its start edge, at height y. */
  pt: (off: number, y: number, d?: number) => Vec3;
  /** Wall run length (offsets go 0..len). */
  len: number;
  /** Outward unit normal (world). */
  n: Vec3;
  /** Sheeted wall height at an along-wall offset (outer wall: the low leg; ends: sloped). */
  heightAt: (off: number) => number;
}

/** Mirrors LeanToSiding openingPlacement / dragInfo / LeanToOpeningGuides. */
export function leanToWallFrame(geo: SurfaceSet, wall: LeanToWall): LeanToWallFrame {
  const g = geo.gable;
  if (wall === 'outer') {
    const { axis, plane, a, b } = geo.wall;
    const outward = Math.sign(plane) || 1;
    return {
      pt: (off, y, d = 0) => (axis === 'z' ? [plane + outward * d, y, a + off] : [a + off, y, plane + outward * d]),
      len: b - a,
      n: axis === 'z' ? [outward, 0, 0] : [0, 0, outward],
      heightAt: () => g.lh,
    };
  }
  const ep = endWallPlane(g, wall) ?? { plane: g.backPlane, outward: 1 };
  const plane = ep.plane;
  const outward = ep.outward;
  const minA = Math.min(g.innerAcross, g.outerAcross);
  const span = g.innerAcross - g.outerAcross;
  return {
    pt: (off, y, d = 0) => (g.kind === 'eave' ? [minA + off, y, plane + outward * d] : [plane + outward * d, y, minA + off]),
    len: Math.abs(span),
    n: g.kind === 'eave' ? [0, 0, outward] : [outward, 0, 0],
    heightAt: (off) => {
      const f = Math.abs(span) > 1e-6 ? (minA + off - g.outerAcross) / span : 0;
      return g.lh + Math.max(0, Math.min(1, f)) * (g.connH - g.lh);
    },
  };
}

/**
 * Can the storage partition be seen from outside? Only through the OPEN part
 * of the lean-to: its outer wall or its far end is not fully closed. (A fully
 * enclosed lean-to hides the partition — its labels would float on the end
 * wall in front of it.)
 */
export function partitionVisible(walls: { side: string; front: string; back: string; storage?: { end: 'front' | 'back' } }): boolean {
  if (!walls.storage) return false;
  const openEnd = walls.storage.end === 'front' ? walls.back : walls.front;
  return walls.side !== 'closed' || openEnd !== 'closed';
}

/** Size chip text (same rule as the main building): walk doors + windows in inches, big doors in ft-in. */
export function leanToSizeLabel(o: Pick<LeanToOpening, 'type' | 'widthFt' | 'heightFt'>): string {
  if (o.type === 'walkDoor' || o.type === 'window') return `${Math.round(o.widthFt * 12)}"x${Math.round(o.heightFt * 12)}"`;
  return `${ftIn(o.widthFt)}x${ftIn(o.heightFt)}`;
}

/** Gaps along a wall: every stretch between the corners and the opening edges that is not an opening. */
export function leanToGaps(len: number, openings: Array<Pick<LeanToOpening, 'offsetFt' | 'widthFt'>>): Array<[number, number]> {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const stops = Array.from(new Set([0, r3(len), ...openings.flatMap((o) => [r3(o.offsetFt - o.widthFt / 2), r3(o.offsetFt + o.widthFt / 2)])])).sort((a, b) => a - b);
  const isOpening = (a: number, b: number) =>
    openings.some((o) => Math.abs(o.offsetFt - o.widthFt / 2 - a) < 0.02 && Math.abs(o.offsetFt + o.widthFt / 2 - b) < 0.02);
  const gaps: Array<[number, number]> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (b - a > 0.05 && !isOpening(a, b)) gaps.push([a, b]);
  }
  return gaps;
}

interface WallEntry {
  key: string;
  frame: LeanToWallFrame;
  openings: LeanToOpening[];
}

export function LeanToSpacingOverlay({ leanTos, overhangFt }: { leanTos: LeanToStructure[]; overhangFt: number }) {
  const showSpacing = useEditorStore((s) => s.showSpacing);
  if (!showSpacing || !leanTos.length) return null;
  return <LeanToSpacingWalls leanTos={leanTos} overhangFt={overhangFt} />;
}

function LeanToSpacingWalls({ leanTos, overhangFt }: { leanTos: LeanToStructure[]; overhangFt: number }) {
  const camera = useThree((s) => s.camera);
  const entries = useMemo(() => {
    const out: WallEntry[] = [];
    for (const lt of leanTos) {
      const walls = resolveWalls(lt);
      const geo = lt.attachedSide.includes('Eave') ? eaveSurfaces(lt, overhangFt, walls) : gableSurfaces(lt, overhangFt, walls);
      for (const wall of ['outer', 'front', 'back', 'partition'] as const) {
        const openings = lt.openings.filter((o) => o.wall === wall && rendersLeanToFixture(o, walls));
        if (!openings.length) continue;
        if (wall === 'partition' && !partitionVisible(walls)) continue;
        out.push({ key: `${lt.id}:${wall}`, frame: leanToWallFrame(geo, wall), openings });
      }
    }
    return out;
  }, [leanTos, overhangFt]);

  // Walls facing the camera (same test as the main building's SpacingOverlay).
  const [facing, setFacing] = useState('');
  useFrame(() => {
    const f = entries
      .filter(({ frame }) => {
        const c = frame.pt(frame.len / 2, frame.heightAt(frame.len / 2) / 2);
        const [nx, ny, nz] = frame.n;
        return (camera.position.x - c[0]) * nx + (camera.position.y - c[1]) * ny + (camera.position.z - c[2]) * nz > 0;
      })
      .map((e) => e.key)
      .join(',');
    if (f !== facing) setFacing(f);
  });
  const on = new Set(facing.split(',').filter(Boolean));
  return (
    <group name="lean-to-spacing">
      {entries
        .filter((e) => on.has(e.key))
        .map((e) => (
          <LeanToWallSpacing key={e.key} frame={e.frame} openings={e.openings} />
        ))}
    </group>
  );
}

function LeanToWallSpacing({ frame, openings }: { frame: LeanToWallFrame; openings: LeanToOpening[] }) {
  const PROUD = 0.25; // just in front of the wall (LeanToOpeningGuides' offset)
  const pt = (off: number, y: number) => frame.pt(off, y, PROUD);
  const minH = Math.min(frame.heightAt(0), frame.heightAt(frame.len));
  // Lower than the main walls' chain (1.3 ft) so the two never stack in one line on screen.
  const gapY = Math.min(0.8, minH * 0.2);
  const gaps = leanToGaps(frame.len, openings);
  return (
    <group>
      {gaps.map(([a, b], i) => (
        <Measure key={`g${i}`} a={pt(a, gapY)} b={pt(b, gapY)} mid={pt((a + b) / 2, gapY)} label={ftIn(b - a)} />
      ))}
      {openings.map((o) => {
        const top = o.sillFt + o.heightFt;
        const chipY = Math.min(frame.heightAt(o.offsetFt) - 0.35, top + 0.6);
        const L = o.offsetFt - o.widthFt / 2;
        return (
          <group key={o.id}>
            <Chip3D at={pt(o.offsetFt, chipY)} label={leanToSizeLabel(o)} />
            {o.sillFt > 0.1 && (
              <Measure a={pt(L - 0.2, 0)} b={pt(L - 0.2, o.sillFt)} mid={pt(L - 0.2, o.sillFt / 2)} label={`sill ${ftIn(o.sillFt)}`} vertical />
            )}
          </group>
        );
      })}
    </group>
  );
}
