import { useThree, type RootState } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { useBuildingStore } from '@/store/useBuildingStore';
import { useEditorStore } from '@/store/useEditorStore';
import { pickWall, pickedWall, useProgramBridge, wallFromHit } from '@/build/programBridge';

/**
 * Click a wall on the 3D model to pick it (build page only; owner 11/2/26 — walls are picked "both" ways: the view box's
 * Wall tiles and the model). Runs from the Canvas's onPointerMissed, i.e. only for a plain click that hit nothing
 * clickable (no door / window / lean-to opening, no drag): exactly the clicks that already just deselect, so every
 * existing click keeps doing what it did. The wall is then picked through Section 5's own tile (the program turns the 3D
 * to it), and the view box comes up on that wall.
 */

export const BUILDING_GROUP_NAME = 'ss-building';

let three: Pick<RootState, 'camera' | 'scene' | 'gl'> | null = null;

/** Inside the Canvas: hands the camera / scene / canvas to pickWallAt. */
export function WallPickRig() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  three = { camera, scene, gl };
  return null;
}

const shown = (o: Object3D | null) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};

const ray = new Raycaster();
const ndc = new Vector2();
const nrm = new Vector3();

export function pickWallAt(e: MouseEvent) {
  const win = useProgramBridge.getState().win;
  if (!win || !three) return;
  const ed = useEditorStore.getState();
  if (ed.interiorView || ed.dragging) return;
  const building = three.scene.getObjectByName(BUILDING_GROUP_NAME);
  if (!building) return;
  const r = three.gl.domElement.getBoundingClientRect();
  if (!r.width || !r.height) return;
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, three.camera);
  const hit = ray.intersectObject(building, true).find((h) => h.face && shown(h.object));
  if (!hit || !hit.face) return;
  nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  const { width, length } = useBuildingStore.getState();
  const wall = wallFromHit(hit.point, nrm, width, length);
  if (!wall) return;
  let doc: Document | null = null;
  try {
    doc = win.document;
  } catch {
    return;
  }
  if (pickedWall(doc) !== wall && !pickWall(doc, wall)) return;
  useProgramBridge.getState().wallPicked();
}
