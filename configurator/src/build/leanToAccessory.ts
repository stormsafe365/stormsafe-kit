/**
 * VIEW-ONLY details of a lean-to walk door / window read from the pricing
 * program's own lean-to accessory selects (.lt-acc-wtd-hi / .lt-acc-win-hi)
 * and its active manufacturer's type tables (MFR().wtdTypes / winTypes). They
 * only change how the 3D DRAWS the part (door face, black color, hi-impact
 * swing, window size); nothing is written back and no price reads them.
 *
 * Mirrors the main building: readOpenings takes the walk-door style / color
 * from the program's getPosItems (built from the same wtdTypes table) and
 * flags impact with /^(hi|hiwind)$/ on the type value (CA 'hi', CCI 'hiwind').
 */

/** One row of the program's MFR().wtdTypes / winTypes tables (only the fields read here). */
export interface ProgramTypeRow {
  v: string;
  style?: string;
  color?: string;
  /** Window width / height in inches. */
  fw?: number;
  fh?: number;
}

/** Black hex shared by black walk doors and black window frames (same as readOpenings). */
export const LEAN_TO_BLACK = '#1f1f1f';

const DOOR_STYLES = ['std', '6panel', '9lite', 'diamond'] as const;
type DoorStyle = (typeof DOOR_STYLES)[number];

/** Hi-impact / hi-wind walk-door type value (same test as the main building's .whi). */
export const isImpactWalkDoorType = (v: string | undefined): boolean => /^(hi|hiwind)$/.test(v ?? '');

/** Lean-to walk door: impact flag, face style and black color from the program's walk-door type. */
export function leanToWalkDoorLook(
  typeValue: string | undefined,
  wtdTypes: ProgramTypeRow[] | undefined,
): { impact: boolean; doorStyle: DoorStyle; color?: string } {
  const row = wtdTypes?.find((t) => t.v === typeValue);
  const style = (DOOR_STYLES as readonly string[]).includes(row?.style ?? '') ? (row!.style as DoorStyle) : 'std';
  return {
    impact: isImpactWalkDoorType(typeValue),
    doorStyle: style,
    color: row?.color === 'black' ? LEAN_TO_BLACK : undefined,
  };
}

/**
 * Lean-to window: size (ft) and black frame color from the program's window
 * type (e.g. CCI 'w3036' / 'hi3036' = 30x36). Falls back to the classic 30x30
 * when the type or its size is unknown.
 */
export function leanToWindowLook(
  typeValue: string | undefined,
  winTypes: ProgramTypeRow[] | undefined,
): { widthFt: number; heightFt: number; color?: string } {
  const row = winTypes?.find((t) => t.v === typeValue);
  const ft = (inches: number | undefined, d: number) => (Number.isFinite(inches) && (inches as number) > 0 ? (inches as number) / 12 : d);
  return {
    widthFt: ft(row?.fw, 2.5),
    heightFt: ft(row?.fh, 2.5),
    color: row?.color === 'black' ? LEAN_TO_BLACK : undefined,
  };
}
