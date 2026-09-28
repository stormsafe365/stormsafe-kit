import { create } from 'zustand';
import type { WallSide } from '@/types/building';

/** How the building shell is presented. */
export type ViewMode = 'exterior' | 'structure' | 'cutaway';

/**
 * Which LOOK the 3D view renders with. VIEW-ONLY: lives only in this transient
 * editor store — never persisted, never bridged to or read by the pricing
 * program, never part of the quote. 'classic' is today's look and the default
 * (client PDFs depend on it); 'enhanced' is the render-upgrade look.
 */
export type RenderStyle = 'classic' | 'enhanced';

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
  /** Selected lean-to opening (separate id space from main-building openings). */
  selectedLeanToOpeningId: string | null;
  /** True while an opening is being dragged (2D or 3D) — pauses orbit controls. */
  dragging: boolean;
  /**
   * True once the current press has actually MOVED (>= 5px). BuildHost only
   * writes a position back to the pricing program after a real drag — a plain
   * click (select / open a door) must never change the quote.
   */
  dragMoved: boolean;

  /** Presentation mode for the shell (Phase 2). */
  viewMode: ViewMode;
  /** Which wall is hidden in cutaway mode (auto-picked = the camera-facing one). */
  cutawayWall: WallSide | null;
  /**
   * Camera command channel: the CameraRig watches this and animates to the
   * preset whenever `nonce` changes (nonce lets the same preset re-fire).
   */
  cameraCmd: { preset: CameraPreset; nonce: number } | null;
  /** "Spacing" overlay: every component's size + all gaps / heights on every wall. */
  showSpacing: boolean;
  /** Components the user clicked OPEN (door swings, roll-up rolls, window slides). */
  openIds: Record<string, boolean>;
  /** View-only look switch (see RenderStyle). Default 'classic'. Never persisted. */
  renderStyle: RenderStyle;
  /**
   * True while window.__ssCapture3D() (quote / contract / approval PDF capture)
   * is running. Animations may read it to snap closed instead of easing.
   * Nothing reads it yet — capture timing is unchanged.
   */
  captureMode: boolean;

  openEditor: (wall?: WallSide) => void;
  closeEditor: () => void;
  setActiveWall: (wall: WallSide) => void;
  selectOpening: (id: string | null) => void;
  selectLeanToOpening: (id: string | null) => void;
  setDragging: (on: boolean) => void;
  setDragMoved: (on: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setCutawayWall: (wall: WallSide | null) => void;
  /** Fire a camera move to a named preset. */
  goToView: (preset: CameraPreset) => void;
  setShowSpacing: (on: boolean) => void;
  toggleOpen: (id: string) => void;
  closeAllOpenings: () => void;
  setRenderStyle: (style: RenderStyle) => void;
  setCaptureMode: (on: boolean) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  editorOpen: false,
  activeWall: 'front',
  selectedOpeningId: null,
  selectedLeanToOpeningId: null,
  dragging: false,
  dragMoved: false,
  viewMode: 'exterior',
  cutawayWall: null,
  cameraCmd: null,
  showSpacing: false,
  openIds: {},
  renderStyle: 'classic',
  captureMode: false,

  openEditor: (wall) => set((s) => ({ editorOpen: true, activeWall: wall ?? s.activeWall })),
  closeEditor: () => set({ editorOpen: false, dragging: false }),
  // NOTE: must NOT clear selectedOpeningId — onDown calls selectOpening then
  // setActiveWall, and clearing here was deselecting every click/drag (the
  // reason on-model dimensions never showed while dragging).
  setActiveWall: (wall) => set({ activeWall: wall }),
  selectOpening: (id) => set({ selectedOpeningId: id }),
  selectLeanToOpening: (id) => set({ selectedLeanToOpeningId: id }),
  // A new press starts un-moved; release keeps dragMoved so the write-back can read it.
  setDragging: (on) => set(on ? { dragging: true, dragMoved: false } : { dragging: false }),
  setDragMoved: (on) => set({ dragMoved: on }),
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
  setShowSpacing: (on) => set({ showSpacing: on }),
  toggleOpen: (id) => set((s) => ({ openIds: { ...s.openIds, [id]: !s.openIds[id] } })),
  closeAllOpenings: () => set({ openIds: {} }),
  setRenderStyle: (style) => set({ renderStyle: style }),
  setCaptureMode: (on) => set({ captureMode: on }),
}));
