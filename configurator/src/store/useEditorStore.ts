import { create } from 'zustand';
import type { WallSide } from '@/types/building';

/** How the building shell is presented. */
export type ViewMode = 'exterior' | 'structure' | 'cutaway';

/** Named camera framings. 'interior' drops the camera inside looking out. */
export type CameraPreset =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'iso'
  | 'interior'
  | 'structure';

/**
 * Transient UI state for the layout editor — kept separate from the building
 * config so selecting/dragging never pollutes the quotable model.
 */
interface EditorStore {
  editorOpen: boolean;
  activeWall: WallSide;
  selectedOpeningId: string | null;
  /** True while an opening is being dragged (2D or 3D) — pauses orbit controls. */
  dragging: boolean;

  /** Presentation mode for the shell (Phase 2). */
  viewMode: ViewMode;
  /** Which wall is hidden in cutaway mode (auto-picked = the camera-facing one). */
  cutawayWall: WallSide | null;
  /**
   * Camera command channel: the CameraRig watches this and animates to the
   * preset whenever `nonce` changes (nonce lets the same preset re-fire).
   */
  cameraCmd: { preset: CameraPreset; nonce: number } | null;

  openEditor: (wall?: WallSide) => void;
  closeEditor: () => void;
  setActiveWall: (wall: WallSide) => void;
  selectOpening: (id: string | null) => void;
  setDragging: (on: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setCutawayWall: (wall: WallSide | null) => void;
  /** Fire a camera move to a named preset. */
  goToView: (preset: CameraPreset) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  editorOpen: false,
  activeWall: 'front',
  selectedOpeningId: null,
  dragging: false,
  viewMode: 'exterior',
  cutawayWall: null,
  cameraCmd: null,

  openEditor: (wall) => set((s) => ({ editorOpen: true, activeWall: wall ?? s.activeWall })),
  closeEditor: () => set({ editorOpen: false, dragging: false }),
  // NOTE: must NOT clear selectedOpeningId — onDown calls selectOpening then
  // setActiveWall, and clearing here was deselecting every click/drag (the
  // reason on-model dimensions never showed while dragging).
  setActiveWall: (wall) => set({ activeWall: wall }),
  selectOpening: (id) => set({ selectedOpeningId: id }),
  setDragging: (on) => set({ dragging: on }),
  setViewMode: (mode) =>
    set((s) => ({
      viewMode: mode,
      // Entering structure mode auto-fires the structure framing.
      cameraCmd:
        mode === 'structure'
          ? { preset: 'structure', nonce: (s.cameraCmd?.nonce ?? 0) + 1 }
          : s.cameraCmd,
    })),
  setCutawayWall: (wall) => set({ cutawayWall: wall }),
  goToView: (preset) =>
    set((s) => ({ cameraCmd: { preset, nonce: (s.cameraCmd?.nonce ?? 0) + 1 } })),
}));
