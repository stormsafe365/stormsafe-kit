// The tests' sample design: the page's plain starting building plus the three parts every design
// started with before 10/16/26 (a 10×8 roll-up on the front end, a walk door and a window on the
// left side). The start itself is now a plain building (owner 10/16/26); the tests that check how
// doors / windows are described, drawn and saved keep using these three.
import { DEFAULT_DESIGN, OLD_STARTER_OPENINGS, type WebDesign } from '../src/model/design';

export const SAMPLE_DESIGN: WebDesign = { ...DEFAULT_DESIGN, openings: OLD_STARTER_OPENINGS.map((o) => ({ ...o })) };
