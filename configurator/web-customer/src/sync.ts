/**
 * Design → 3D (every change), and 3D drag → design (on drag end).
 *
 * The shared 3D store is written ONLY here. A drag in the 3D moves an opening
 * in that store live (src/three Openings / LeanToSiding, no-overlap clamp
 * included); when the drag ends its new spot is read back into the design as
 * the customer / program position number.
 */
import { useBuildingStore } from '@/store/useBuildingStore';
import { useEditorStore } from '@/store/useEditorStore';
import { designToConfig } from './model/toConfig';
import { offset3DToPos, q8 } from './model/positions';
import { useWebStore } from './store';

let lastSig = '';

function applyToScene() {
  const { design, preview, ctx } = useWebStore.getState();
  // V2: while the Doors & windows sheet is open the model shows the part being placed (preview)
  const config = designToConfig(preview ?? design, ctx);
  const sig = JSON.stringify(config);
  if (sig === lastSig) return;
  lastSig = sig;
  useBuildingStore.setState(config);
}

/** Read every dragged spot back from the 3D store into the design. */
function readBackDrags() {
  // The scene now differs from the last config written: always re-apply after this.
  lastSig = '';
  const st = useBuildingStore.getState();
  const byId = new Map(st.openings.map((o) => [o.id, o.offset]));
  const ltById = new Map(st.leanTos.flatMap((lt) => (lt.openings ?? []).map((o) => [o.id, o.offsetFt] as const)));
  const { design, update, preview } = useWebStore.getState();
  if (preview) {
    // the sheet is open: a drag moves the part being placed (the sheet takes the new spot); the design waits for Add / Save
    const moved = preview.openings.find((o) => {
      const off = byId.get(o.id);
      return off !== undefined && Math.abs(offset3DToPos(preview, o.wall, off, o.w) - o.pos) > 1e-6;
    });
    if (moved) {
      const pos = offset3DToPos(preview, moved.wall, byId.get(moved.id)!, moved.w);
      const n = (useWebStore.getState().previewDrag?.n ?? 0) + 1;
      useWebStore.setState({ previewDrag: { id: moved.id, pos, n } });
    }
    applyToScene();
    return;
  }
  const mainMoved = design.openings.some((o) => {
    const off = byId.get(o.id);
    return off !== undefined && Math.abs(offset3DToPos(design, o.wall, off, o.w) - o.pos) > 1e-6;
  });
  const leanMoved = design.leanTos.some((lt) =>
    lt.openings.some((o) => {
      const off = ltById.get(o.id);
      return off !== undefined && Math.abs(q8(off - o.w / 2) - o.pos) > 1e-6;
    }),
  );
  if (!mainMoved && !leanMoved) return;
  update((d) => {
    for (const o of d.openings) {
      const off = byId.get(o.id);
      if (off !== undefined) o.pos = offset3DToPos(d, o.wall, off, o.w);
    }
    for (const lt of d.leanTos) for (const o of lt.openings) {
      const off = ltById.get(o.id);
      if (off !== undefined) o.pos = q8(off - o.w / 2);
    }
  });
}

export function installSync(): () => void {
  applyToScene();
  const unDesign = useWebStore.subscribe((s, prev) => {
    if (s.design !== prev.design || s.ctx !== prev.ctx || s.preview !== prev.preview) applyToScene();
  });
  const unDrag = useEditorStore.subscribe((s, prev) => {
    // Only after a REAL drag (moved >= 5px); a click just opens / closes a door.
    if (prev.dragging && !s.dragging && prev.dragMoved) readBackDrags();
  });
  return () => {
    unDesign();
    unDrag();
  };
}
