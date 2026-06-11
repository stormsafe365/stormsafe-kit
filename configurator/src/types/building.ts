/**
 * LAYER 1 — Configuration State (data model)
 * The canonical shape of a StormSafe tube-frame building.
 * Every other layer (rules, loads, geometry, BOM) is a pure function of this.
 */

export type FramingGauge = '14-gauge' | '12-gauge';
export type SheetingGauge = '29-gauge' | '26-gauge';
export type PanelOrientation = 'Horizontal' | 'Vertical';
export type ExposureCategory = 'B' | 'C' | 'D';

/**
 * Quote-able building families:
 *  - carport: fully open (posts + roof, no sheeted walls)
 *  - garage:  fully enclosed on all four sides
 *  - utility: hybrid — an enclosed garage portion + an open carport portion
 *             along the length (a.k.a. "utility carport")
 * (barn w/ lean-tos is the next family — modeled but not built this pass)
 */
export type BuildingType = 'carport' | 'garage' | 'utility';

/** For a utility/hybrid build, which end is the open (carport) bay. */
export type OpenEnd = 'front' | 'back';

/** How a gable end is sheeted. */
export type EndSheeting = 'closed' | 'open' | 'gableOnly';

/**
 * Per-wall state (Sensei "Custom" walls):
 *  - open:   no sheeting (posts only)
 *  - closed: fully sheeted
 *  - gable:  sheet only the gable triangle above the eave (end walls only)
 */
export type WallState = 'open' | 'closed' | 'gable';

/** Wall preset selector — maps the building family to per-wall states. */
export type WallPreset = 'open' | 'enclosed' | 'custom';

/** Enclosed "Storage" section of a utility carport, and where it sits. */
export type StorageMode = 'none' | 'end' | 'endBack' | 'left' | 'right';

/** Single-slope shed roof attached to or free-standing from the main building. */
export type LeanToType = 'attached' | 'freestanding';
export type LeanToSide = 'Left Eave' | 'Right Eave' | 'Front Gable' | 'Back Gable';
export type LeanToEnclosure = 'open' | 'enclosed' | 'custom';

/** A door/window/roll-up placed on one of a lean-to's walls. */
export interface LeanToOpening {
  /** Stable id (deterministic from its source accessory entry) for drag + writeback. */
  id: string;
  type: 'rollUpDoor' | 'walkDoor' | 'window' | 'frameOut';
  /** Which lean-to wall: outer long side, or front/back gable end. */
  wall: 'outer' | 'front' | 'back';
  widthFt: number;
  heightFt: number;
  sillFt: number;
  /** Center position measured (ft) from the wall's left edge (start of the run). */
  offsetFt: number;
  /** Explicit panel color (hex) — e.g. a CA/CCI colored roll-up door. */
  color?: string;
}

export interface LeanTo {
  id: string;
  type: LeanToType;
  /** Which side of the main building (only when type === 'attached'). */
  attachedSide?: LeanToSide;
  /** Width of the lean-to (ft) — the depth when attached to eave, width when attached to gable. */
  widthFt: number;
  /** Length of the lean-to (ft) — runs along the attachment wall. */
  lengthFt: number;
  /** Height of the low post (ft) — the short side. */
  lowLegHeightFt: number;
  /** Height of the tall post (ft) — the high side (only for sloped roofs). */
  tallLegHeightFt?: number;
  /** Roof pitch rise:run, e.g. "2:12" or "3:12". */
  roofPitch: string;
  /** Enclosure preset: open (roof only) / enclosed (walls) / custom (per-wall). */
  enclosure: LeanToEnclosure;
  /** Custom wall settings — only used when enclosure === 'custom'. */
  customWalls?: {
    front: 'open' | 'gable' | 'closed'; // gable = triangle only
    back: 'open' | 'gable' | 'closed';
    side: 'open' | '1panel' | '2panel' | '3panel' | 'q1' | 'q2' | 'q3' | 'closed'; // q1 = 1/4, q2 = 1/2, q3 = 3/4
  };
  /** Doors / windows / roll-ups placed on the lean-to's walls. */
  openings?: LeanToOpening[];
}

/** The full wall/enclosure model (mirrors Sensei's Walls panel). */
export interface WallsConfig {
  preset: WallPreset;
  /** Per-wall states (used when preset === 'custom'). */
  front: WallState;
  back: WallState;
  left: WallState;
  right: WallState;
  /** Enclosed storage bay: which part of the building is walled-in. */
  storage: { mode: StorageMode; lengthFt: number };
}

export type WallSide = 'front' | 'back' | 'left' | 'right' | 'partition';

export type OpeningType = 'rollUpDoor' | 'garageDoor' | 'walkDoor' | 'window' | 'frameOut';

/** A single placed component on a wall (the Component Layout tracker). */
export interface Opening {
  id: string;
  type: OpeningType;
  side: WallSide;
  /** Distance (ft) from the wall's left edge to the opening's centerline. */
  offset: number;
  width: number; // ft
  height: number; // ft
  /** Bottom of the opening off the slab (ft) — windows/frame-outs sit up the wall. */
  sillHeight: number;
  /**
   * Customer-supplied unit (we frame the opening only, no door/window).
   * Always true for `frameOut`; optional on doors/windows the buyer provides.
   */
  customerSupplied?: boolean;
  /**
   * Explicit panel color (hex) for the unit itself — e.g. a CCI colored roll-up
   * door, which is ordered in its own color independent of the wall. When unset
   * the fixture falls back to its default (door = trim/neutral).
   */
  color?: string;
  /**
   * Walk-through door face style (CCI offers std / 6-panel / 9-lite / diamond).
   * Drives which door-face texture the 3D draws. Unset → 'std'.
   */
  doorStyle?: 'std' | '6panel' | '9lite' | 'diamond';
}

/** Color targets — each can take any swatch code from config/colors. */
export interface BuildingColors {
  roof: string;
  walls: string;
  trim: string;
  wainscot: string;
}

/** Optional contrasting band along the bottom of the walls. */
export interface Wainscot {
  enabled: boolean;
  heightFt: number;
}

export interface BuildingConfig {
  buildingType: BuildingType;

  /** ft — 12..30 in 2ft steps. */
  width: number;
  /** ft — 20..51 in 4/5ft steps. */
  length: number;
  /** ft — 6..16 in 1ft steps (eave/leg height). */
  legHeight: number;

  /** For `utility`: ft of the length that is enclosed; rest is the open bay. */
  enclosedLengthFt: number;
  /** For `utility`: which end is the open carport bay. */
  openEnd: OpenEnd;
  /** Sheet the gable triangle over an open end (e.g. RV-shelter "gable-only" front). */
  openEndGableSheeting: boolean;

  framingGauge: FramingGauge;
  sheetingGauge: SheetingGauge;
  /** Wall sheeting orientation. */
  panelOrientation: PanelOrientation;
  /** Roof sheeting orientation (independent of walls — see real quotes). */
  roofOrientation: PanelOrientation;
  /** Roof rise per 12 of run. 0 = flat. */
  roofPitch: number;
  /** Roof overhang past the wall plane on all sides (ft). 0.5 = 6", 1 = 12". */
  roofOverhangFt: number;

  colors: BuildingColors;
  wainscot: Wainscot;

  /**
   * Partial side-panel sheeting on the OPEN eave portion (carport / GCH open
   * bay), as a band height in ft measured up from the slab (0 = open,
   * legHeight = fully closed). The enclosed portion's sides are always fully
   * sheeted. (Top-band / fractional variants are a future addition.)
   */
  eavePanelFt: { left: number; right: number };

  /**
   * Per-wall enclosure model (Sensei "Walls" panel). The building-type buttons
   * set `preset`; 'custom' unlocks independent per-wall states + storage.
   * `deriveEnclosure` reads this to build the geometry.
   */
  walls: WallsConfig;

  // --- Lean-tos (single-slope sheds) ---
  leanTos: LeanTo[];

  // --- Engineering loads (drive the rule engine) ---
  /** Design wind speed (mph). StormSafe standard envelope is 170+. */
  windSpeedMph: number;
  exposureCategory: ExposureCategory;
  /** Ground snow load (psf). Florida ≈ 0; matters for out-of-state quotes. */
  groundSnowPsf: number;

  /**
   * Truss/frame spacing (ft on center) forced by the pricing program. When set
   * (> 0) it OVERRIDES the load engine's computed spacing so the 3D trusses
   * exactly match the quote (e.g. the program's 5' OC standard vs. 4' OC
   * upgrade, and the collision warnings keyed off it). Undefined/0 → the load
   * engine decides (standalone 3D use without the pricing program).
   */
  trussSpacingFt?: number;

  openings: Opening[];
}

/** Default geometry for a freshly added opening of each type (ft). */
export const OPENING_DEFAULTS: Record<
  OpeningType,
  { width: number; height: number; sillHeight: number; label: string; customerSupplied: boolean }
> = {
  rollUpDoor: { width: 10, height: 10, sillHeight: 0, label: 'Roll-Up Door', customerSupplied: false },
  garageDoor: { width: 9, height: 8, sillHeight: 0, label: 'Garage Door', customerSupplied: false },
  walkDoor: { width: 3, height: 6.7, sillHeight: 0, label: 'Walk-In Door (Hi-Impact)', customerSupplied: false },
  window: { width: 2.5, height: 2.5, sillHeight: 4.16667, label: 'Window (Hi-Impact)', customerSupplied: false }, // sill 4'-2"
  // Framed opening only — buyer supplies their own door/window (or we frame a wall section).
  frameOut: { width: 4, height: 7, sillHeight: 0, label: 'Framed Opening', customerSupplied: true },
};
