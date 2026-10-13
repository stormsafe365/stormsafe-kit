/**
 * CUSTOMER catalog for the web customizer — names, sizes and looks only.
 *
 * Every list mirrors the option lists the quote program offers today
 * (public/quote-builder.html) so a design made here can be typed straight into
 * the program by a rep. NOTHING here is a price, and no manufacturer is named:
 * the customer page shows the parts, the program prices them later.
 */

/** A building color the customer can pick (17 colors, alphabetical in the UI). */
export interface WebColor {
  key: string;
  name: string;
  hex: string;
  /** Code handed to the 3D: 'GALVALUME' renders metallic, every other color its hex. */
  code: string;
}

export const COLORS: WebColor[] = [
  { key: 'white', name: 'White', hex: '#F2F1EA', code: '#F2F1EA' },
  { key: 'galvalume', name: 'Galvalume', hex: '#B9BCBB', code: 'GALVALUME' },
  { key: 'black', name: 'Black', hex: '#1D1E20', code: '#1D1E20' },
  { key: 'quaker-gray', name: 'Quaker Gray', hex: '#57534A', code: '#57534A' },
  { key: 'pewter-gray', name: 'Pewter Gray', hex: '#8A8A88', code: '#8A8A88' },
  { key: 'earth-brown', name: 'Earth Brown', hex: '#74472A', code: '#74472A' },
  { key: 'evergreen', name: 'Evergreen', hex: '#2C5745', code: '#2C5745' },
  { key: 'slate-blue', name: 'Slate Blue', hex: '#4A7191', code: '#4A7191' },
  { key: 'king-blue', name: 'King Blue', hex: '#2591CE', code: '#2591CE' },
  { key: 'cardinal-red', name: 'Cardinal Red', hex: '#D8291D', code: '#D8291D' },
  { key: 'barn-red', name: 'Barn Red', hex: '#A63A20', code: '#A63A20' },
  { key: 'merlot', name: 'Merlot', hex: '#5C2320', code: '#5C2320' },
  { key: 'burgundy', name: 'Burgundy', hex: '#46201F', code: '#46201F' },
  { key: 'tan', name: 'Tan', hex: '#B18F6C', code: '#B18F6C' },
  { key: 'clay', name: 'Clay', hex: '#A8977E', code: '#A8977E' },
  { key: 'sandstone', name: 'Sandstone', hex: '#D2C4A0', code: '#D2C4A0' },
  { key: 'pebble-beige', name: 'Pebble Beige', hex: '#DBD1B0', code: '#DBD1B0' },
];

/** Printed wainscot panels (wood / brick / stone look). Vertical wall panels only. */
export const WAINSCOT_PRINTS: WebColor[] = [
  { key: 'print-blackwood', name: 'Black Wood print', hex: '#46443F', code: 'PRINT-BLACKWOOD' },
  { key: 'print-richwood', name: 'Rich Wood print', hex: '#B0A183', code: 'PRINT-RICHWOOD' },
  { key: 'print-rusticbrick', name: 'Rustic Brick print', hex: '#7A6046', code: 'PRINT-RUSTICBRICK' },
  { key: 'print-stonewall', name: 'Stone Wall print', hex: '#A8A69E', code: 'PRINT-STONEWALL' },
];

const COLOR_BY_KEY = new Map([...COLORS, ...WAINSCOT_PRINTS].map((c) => [c.key, c]));
export const colorByKey = (key: string): WebColor | undefined => COLOR_BY_KEY.get(key);
export const isPrintKey = (key: string): boolean => key.startsWith('print-') && COLOR_BY_KEY.has(key);

/** Roll-up door sizes (ft): every width × height the program sells. */
export const ROLLUP_WIDTHS = [6, 8, 9, 10, 12, 14, 16] as const;
export const ROLLUP_HEIGHTS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

/** Roll-up door colors (white is standard). */
export const ROLLUP_COLORS: Array<{ key: string; name: string; hex: string }> = [
  { key: 'white', name: 'White', hex: '#F4F1EC' },
  { key: 'earthBrown', name: 'Earth Brown', hex: '#4F3A2E' },
  { key: 'evergreen', name: 'Evergreen', hex: '#1F4231' },
  { key: 'pewterGray', name: 'Pewter Gray', hex: '#7A7D7F' },
  { key: 'barnRed', name: 'Barn Red', hex: '#A2392B' },
  { key: 'pebbleBeige', name: 'Pebble Beige', hex: '#D6C8A5' },
  { key: 'black', name: 'Black', hex: '#1A1A1A' },
  { key: 'kingBlue', name: 'King Blue', hex: '#1B7AB4' },
  { key: 'cardinalRed', name: 'Cardinal Red', hex: '#D62A1F' },
  { key: 'burgundy', name: 'True Burgundy', hex: '#4B1A23' },
  { key: 'clay', name: 'Clay', hex: '#A99172' },
  { key: 'tan', name: 'Tan', hex: '#B7986A' },
  { key: 'sandstone', name: 'Sandstone', hex: '#CCBC9D' },
  { key: 'slateBlue', name: 'Slate Blue', hex: '#3A5E7A' },
  { key: 'quakerGray', name: 'Quaker Gray', hex: '#52524F' },
  { key: 'merlot', name: 'Vintage Burgundy', hex: '#5D2A2E' },
];
export const rollupColor = (key: string | undefined) => ROLLUP_COLORS.find((c) => c.key === key) ?? ROLLUP_COLORS[0];

export type DoorFace = 'std' | '6panel' | '9lite' | 'diamond';

/** Walk-in doors (all 36″ × 80″). `impact` = the impact-rated (hi-wind) door. */
export interface WalkDoorType {
  key: string;
  name: string;
  face: DoorFace;
  black: boolean;
  impact: boolean;
}
export const WALK_DOORS: WalkDoorType[] = [
  { key: 'std', name: 'Standard, white', face: 'std', black: false, impact: false },
  { key: 'std_blk', name: 'Standard, black', face: 'std', black: true, impact: false },
  { key: '6panel', name: '6-panel, white', face: '6panel', black: false, impact: false },
  { key: '6panel_blk', name: '6-panel, black', face: '6panel', black: true, impact: false },
  { key: '9lite', name: '9-lite (glass), white', face: '9lite', black: false, impact: false },
  { key: '9lite_blk', name: '9-lite (glass), black', face: '9lite', black: true, impact: false },
  { key: 'diamond', name: 'Diamond window, white', face: 'diamond', black: false, impact: false },
  { key: 'hiwind', name: 'Impact-rated (hi-wind), white', face: 'std', black: false, impact: true },
];
export const walkDoorType = (key: string | undefined) => WALK_DOORS.find((t) => t.key === key);

/** Windows (inches). `impact` = impact-rated glass. */
export interface WindowType {
  key: string;
  name: string;
  wIn: number;
  hIn: number;
  black: boolean;
  impact: boolean;
}
export const WINDOWS: WindowType[] = [
  { key: 'std', name: 'White', wIn: 30, hIn: 30, black: false, impact: false },
  { key: 'w3036', name: 'White', wIn: 30, hIn: 36, black: false, impact: false },
  { key: 'b3030', name: 'Black', wIn: 30, hIn: 30, black: true, impact: false },
  { key: 'b3036', name: 'Black', wIn: 30, hIn: 36, black: true, impact: false },
  { key: 'hw', name: 'High-wind rated', wIn: 30, hIn: 30, black: false, impact: false },
  { key: 'hi', name: 'Impact-rated', wIn: 30, hIn: 30, black: false, impact: true },
  { key: 'hi3036', name: 'Impact-rated', wIn: 30, hIn: 36, black: false, impact: true },
];
export const windowType = (key: string | undefined) => WINDOWS.find((t) => t.key === key);

/** Impact areas: the only walk door / windows allowed (roll-up doors are already certified). */
export const IMPACT_WALK_DOOR = 'hiwind';
export const IMPACT_WINDOW_FOR = (key: string | undefined): string => (/3036$/.test(key ?? '') ? 'hi3036' : 'hi');

/** Standard window sill: 4′2″ (50″). */
export const WINDOW_SILL_FT = 50 / 12;
/** Walk-in door: 36″ × 80″. */
export const WALK_DOOR_W_FT = 3;
export const WALK_DOOR_H_FT = 80 / 12;

/** Black hex the 3D uses for black walk doors / window frames. */
export const FIXTURE_BLACK = '#1f1f1f';

/** Lean-to option lists (program lean-to rows). */
export const LEANTO_WIDTHS = [8, 10, 12, 14, 16, 20] as const;
export const LEANTO_LOW_LEGS = [6, 7, 8, 9, 10, 12] as const;
export const LEANTO_PITCHES = ['2:12', '3:12'] as const;

/** Florida's 67 counties (official spelling — "St. Lucie", "Miami-Dade", "DeSoto"). */
export const FL_COUNTIES = [
  'Alachua', 'Baker', 'Bay', 'Bradford', 'Brevard', 'Broward', 'Calhoun', 'Charlotte', 'Citrus', 'Clay',
  'Collier', 'Columbia', 'DeSoto', 'Dixie', 'Duval', 'Escambia', 'Flagler', 'Franklin', 'Gadsden', 'Gilchrist',
  'Glades', 'Gulf', 'Hamilton', 'Hardee', 'Hendry', 'Hernando', 'Highlands', 'Hillsborough', 'Holmes', 'Indian River',
  'Jackson', 'Jefferson', 'Lafayette', 'Lake', 'Lee', 'Leon', 'Levy', 'Liberty', 'Madison', 'Manatee',
  'Marion', 'Martin', 'Miami-Dade', 'Monroe', 'Nassau', 'Okaloosa', 'Okeechobee', 'Orange', 'Osceola', 'Palm Beach',
  'Pasco', 'Pinellas', 'Polk', 'Putnam', 'St. Johns', 'St. Lucie', 'Santa Rosa', 'Sarasota', 'Seminole', 'Sumter',
  'Suwannee', 'Taylor', 'Union', 'Volusia', 'Wakulla', 'Walton', 'Washington',
] as const;

/**
 * Counties where the quote LOCKS impact-rated windows + hi-wind walk doors (the
 * program's permitting rule). Okaloosa / Okeechobee only over 720 sq ft.
 */
export const IMPACT_LOCK_COUNTIES = ['Charlotte', 'Collier', 'Hillsborough', 'Indian River', 'Lee', 'Palm Beach', 'Sarasota', 'St. Lucie', 'Volusia'];
export const IMPACT_LOCK_SIZE_COUNTIES = ['Okaloosa', 'Okeechobee'];
export const IMPACT_LOCK_MIN_SQFT = 720;

/** Hi-wind counties (the program's HW list): 12-gauge framing on buildings over 24′ wide. */
export const HIGH_WIND_COUNTIES = ['Charlotte', 'Collier', 'Duval', 'Flagler', 'Indian River', 'Lake', 'Lee', 'Martin', 'Palm Beach', 'Pinellas', 'Sarasota', 'Seminole', 'St. Lucie'];
