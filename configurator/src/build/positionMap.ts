/**
 * ONE definition of an opening's position (owner 10/5/26) — the bridge between
 * the program's typed positions and the 3D, both ways.
 *
 * The program (public/quote-builder.html, posRefName / getPosItems): the number
 * a rep types = feet from the named end of the wall to the NEAR edge of the
 * opening. getPosItems turns it into x, measured from the end the wall's LEFT
 * position button names:
 *   Right Eave Side  x from the FRONT gable
 *   Left Eave Side   x from the BACK gable   (its buttons are flipped: "From Front Gable" = right)
 *   Front Gable End  x from the LEFT EAVE corner  (your left standing outside, facing the front)
 *   Partition Wall   x from the LEFT EAVE corner  (seen from the front, like the front gable)
 *   Back Gable End   x from the RIGHT EAVE corner (your left standing outside, facing the back)
 *
 * The 3D (engine/geometry openingWorldTransform): `offset` = centerline along
 * the wall measured from
 *   eaves ('left' = program Right Eave at −X, 'right' = program Left Eave at +X): the FRONT (−Z)
 *   'front' / 'partition': the −X corner = the program's RIGHT eave
 *   'back': the +X corner = the program's LEFT eave
 * (program Left Eave = 3D +X, BuildHost SIDE_MAP.)
 *
 * So every wall except the Right Eave is mirrored between the two frames.
 * Before 10/5/26 only the Left Eave and Back gable were — the 6/7/26 eave
 * swap (ac721e3) moved the Left Eave to +X without flipping the front gable /
 * partition, so those drew mirrored in the 3D (a door typed 4' From Left
 * showed 4' from the RIGHT eave corner).
 */
export type ProgramLoc = 'Front Gable End' | 'Back Gable End' | 'Left Eave Side' | 'Right Eave Side' | 'Partition Wall';

/** Does this program wall run the opposite way to its 3D wall's offset axis? */
export function mirrorsTo3D(loc: string): boolean {
  return loc !== 'Right Eave Side';
}

/** Program item (getPosItems x + width) on a wall of length `face` → 3D centerline offset. */
export function programXTo3DOffset(loc: string, x: number, w: number, face: number): number {
  const c = x + w / 2;
  return mirrorsTo3D(loc) ? face - c : c;
}

/** 3D centerline offset → the program's getPosItems x (exact inverse of programXTo3DOffset). */
export function offset3DToProgramX(loc: string, offset: number, w: number, face: number): number {
  const c = mirrorsTo3D(loc) ? face - offset : offset;
  return c - w / 2;
}

/**
 * The number to type in a position row for getPosItems x, keeping the row's
 * chosen button (`side`). getPosItems' own inverse: the Left Eave flips its
 * buttons; 'right' measures from the far end.
 */
export function programXToTyped(loc: string, x: number, w: number, face: number, side: 'left' | 'right'): number {
  const eff = loc === 'Left Eave Side' ? (side === 'left' ? 'right' : 'left') : side;
  return eff === 'right' ? face - x - w : x;
}

/**
 * The text a 3D drag writes into a position box: the 1/8" grid every
 * dimension lives on (owner 10/6/26), never negative, 4 decimals — enough
 * that the program reads it back to the exact 1/8" (1/8" = 0.0104 ft):
 * 4'4" -> "4.3333", 60'7¾" -> "60.6458", 9' -> "9".
 */
export function typedValueText(ft: number): string {
  const v = Math.max(0, Math.round(ft * 96) / 96);
  return String(Number(v.toFixed(4)));
}

/**
 * A gable lean-to's "Starts At" (program .ltoff) → the 3D's start offset along
 * the gable, which the engine measures from the −X (program Right Eave) corner.
 * The program measures a FRONT-gable lean-to from the left eave corner (your
 * left facing the front) — mirrored; a BACK-gable one from the right eave
 * corner (your left facing the back) — the 3D's own corner. Same clamps as
 * the engine (run ≤ wall, start inside the wall).
 */
export function gableLeanToOffset3D(side: string, offFt: number, lengthFt: number, wallW: number): number {
  const run = Math.min(lengthFt, wallW);
  const off = Math.max(0, Math.min(offFt || 0, wallW - run));
  return side === 'Front Gable' ? wallW - run - off : off;
}
