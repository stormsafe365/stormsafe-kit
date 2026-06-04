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

  // --- Engineering loads (drive the rule engine) ---
  /** Design wind speed (mph). StormSafe standard envelope is 170+. */
  windSpeedMph: number;
  exposureCategory: ExposureCategory;
  /** Ground snow load (psf). Florida ≈ 0; matters for out-of-state quotes. */
  groundSnowPsf: number;

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
  window: { width: 2.5, height: 2.5, sillHeight: 4, label: 'Window (Hi-Impact)', customerSupplied: false },
  // Framed opening only — buyer supplies their own door/window (or we frame a wall section).
  frameOut: { width: 4, height: 7, sillHeight: 0, label: 'Framed Opening', customerSupplied: true },
};
