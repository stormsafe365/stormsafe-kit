import * as THREE from 'three';

/**
 * The box (in the mesh's own geometry space) a mesh contributes to the PDF
 * capture framing (CaptureHook): `userData.captureBox` when set, else its
 * geometry's bounding box (computed on first use, as before).
 *
 * Set by the enhanced walls (ShellMeshes shellCaptureData) on a storage
 * partition's sheet: with wainscot on it is drawn in two colours (two
 * meshes), but it frames as the ONE sheet it was before, so the partition's
 * wainscot never moves the PDF framing.
 */
export function captureBoxOf(m: THREE.Mesh): THREE.Box3 | null {
  const cb: unknown = m.userData?.captureBox;
  if (cb instanceof THREE.Box3) return cb;
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  return m.geometry.boundingBox;
}
