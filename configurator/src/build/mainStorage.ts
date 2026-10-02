import type { StorageMode } from '@/types/building';

/**
 * Main-building storage room (program "Storage / Add'l End Wall", owner
 * 10/1/26) → the 3D store's VIEW-ONLY `walls.storage`.
 *
 * The program owns the rules: its aewSpec() says whether a storage partition
 * is on and where (End Storage depth + which end, or Left/Right width). The
 * bridge only maps it into the 3D's coordinates — it never prices anything,
 * and the program's price (gAddEndWall) never reads the position.
 *
 * Left/Right are named as seen from the FRONT of the building, and the 3D
 * draws its internal 'right' (+X) wall on the viewer's left (SIDE_MAP in
 * BuildHost) — so program "Left Storage" is internal 'right' and vice versa.
 */
export interface MainStorage {
  mode: StorageMode;
  lengthFt: number;
}

export const NO_STORAGE: MainStorage = { mode: 'none', lengthFt: 0 };

interface AewSpec {
  on?: boolean;
  kind?: string;
  end?: string;
  depthFt?: number;
  widthFt?: number;
}

/** Map the program's aewSpec() result to the 3D storage (pure; exported for tests). */
export function storageFromSpec(sp: AewSpec | null | undefined): MainStorage {
  if (!sp || !sp.on) return NO_STORAGE;
  if (sp.kind === 'end') {
    const d = Number(sp.depthFt);
    if (!(d > 0)) return NO_STORAGE;
    return { mode: sp.end === 'front' ? 'end' : 'endBack', lengthFt: d };
  }
  if (sp.kind === 'left' || sp.kind === 'right') {
    const w = Number(sp.widthFt);
    if (!(w > 0)) return NO_STORAGE;
    return { mode: sp.kind === 'left' ? 'right' : 'left', lengthFt: w };
  }
  return NO_STORAGE;
}

/** Read the program's storage partition (NO_STORAGE when the program has no aewSpec, e.g. an older copy). */
export function readMainStorage(win: unknown): MainStorage {
  const fn = (win as { aewSpec?: () => AewSpec }).aewSpec;
  if (typeof fn !== 'function') return NO_STORAGE;
  try {
    return storageFromSpec(fn());
  } catch {
    return NO_STORAGE;
  }
}

/**
 * May the roll-up / walk-door / window / framed-opening location lists offer
 * "Partition Wall"? A GCH (its divider) — and, since 10/1/26, any other build
 * with End Storage on. Same location, same program pricing: a non-eave
 * location = gable-end door price, no eave header, no side frame. Left/Right
 * lengthwise storage never gets it (no pricing rule for a door there).
 */
export function partitionLocationAllowed(btype: string, addEndWall: string): boolean {
  return btype === 'gch' || addEndWall === 'yes';
}
