/**
 * The plain-text spec sent with a design (ss-design `spec`). Written so a rep
 * can type it straight into the quote program: sizes W × L × H, every door /
 * window with its wall, size and position in the program's own words ("9' from
 * the front gable to its near edge"), lean-tos with Starts At and walls.
 *
 * Copy rules: no prices, no manufacturer names, no wind numbers.
 */
import { ftIn, inchLabel } from '@/three/dimLabels';
import { colorByKey, rollupColor, walkDoorType, windowType } from './catalog';
import {
  END_WALL_LABEL,
  LEANTO_END_LABEL,
  LEANTO_SIDE_LABEL,
  LEANTO_SIDE_WALL_LABEL,
  LEANTO_WALL_LABEL,
  SIDE_WALL_LABEL,
  TYPE_LABEL,
  WALL_LABEL,
  WRAP_LABEL,
  type WebDesign,
  type WebLeanTo,
  type WebLeanToOpening,
  type WebOpening,
} from './design';
import { PROGRAM_REF } from './positions';
import { activeWraps, leanToIsEave, leanToOpeningWalls, pitchRise, wallTakesOpenings, WRAP_SIDES } from './rules';

export interface SpecContext {
  zip: string | null;
  county: string | null;
  impact: boolean;
}

const dims3 = (w: number, l: number, h: number) => `${ftIn(w)} W × ${ftIn(l)} L × ${ftIn(h)} H`;
const colorName = (key: string) => colorByKey(key)?.name ?? key;

/** "Roll-up door 10' W × 8' H, White" / "Walk-in door 36" × 80", 6-panel, white" … */
export function partText(o: WebOpening | WebLeanToOpening): string {
  if (o.kind === 'rollup') return `Roll-up door ${ftIn(o.w)} W × ${ftIn(o.h)} H, ${rollupColor(o.color).name}`;
  if (o.kind === 'walk') return `Walk-in door ${inchLabel(o.w)} × ${inchLabel(o.h)}, ${walkDoorType(o.style)?.name ?? 'Standard, white'}`;
  if (o.kind === 'window') return `Window ${inchLabel(o.w)} × ${inchLabel(o.h)}, ${windowType(o.style)?.name ?? 'White'}`;
  return `Framed opening (${o.frame === 'window' ? 'window' : 'door'}) ${ftIn(o.w)} W × ${ftIn(o.h)} H, customer-supplied unit`;
}

const sillText = (o: WebOpening | WebLeanToOpening) => (o.sill > 0.05 ? `, sill ${ftIn(o.sill)}` : '');

export function mainOpeningLine(d: WebDesign, o: WebOpening): string {
  const where = `${WALL_LABEL[o.wall]}, ${ftIn(o.pos)} from the ${PROGRAM_REF[o.wall]} to its near edge`;
  const note = wallTakesOpenings(d, o.wall) ? '' : ' (this wall is not closed: not shown on the model)';
  return `${partText(o)} — ${where}${sillText(o)}${note}`;
}

export function leanToOpeningLine(lt: WebLeanTo, o: WebLeanToOpening): string {
  const note = leanToOpeningWalls(lt).includes(o.wall) ? '' : ' (this wall is not closed: not shown on the model)';
  return `${partText(o)} — ${LEANTO_WALL_LABEL[o.wall].toLowerCase()}, ${ftIn(o.pos)} from the left end to its near edge${sillText(o)}${note}`;
}

function leanToWallsText(lt: WebLeanTo): string {
  if (lt.enclosure === 'open') return 'Open';
  if (lt.enclosure === 'enclosed') return 'Fully enclosed';
  return `Front end ${LEANTO_END_LABEL[lt.walls.front]}; Back end ${LEANTO_END_LABEL[lt.walls.back]}; Outer side ${LEANTO_SIDE_WALL_LABEL[lt.walls.side]}`;
}

function leanToStartText(lt: WebLeanTo): string {
  const from = leanToIsEave(lt.side) ? 'the front end' : lt.side === 'Front Gable' ? 'the front-left corner' : 'the back-right corner';
  return `starts ${ftIn(lt.start)} from ${from}`;
}

/** Overall footprint with the attached lean-tos (the program's ltOverall). */
export function overallFootprint(d: WebDesign): { w: number; l: number } {
  const ext = { 'Left Eave': 0, 'Right Eave': 0, 'Front Gable': 0, 'Back Gable': 0 };
  for (const lt of d.leanTos) ext[lt.side] = Math.max(ext[lt.side], lt.width);
  return { w: d.width + ext['Left Eave'] + ext['Right Eave'], l: d.length + ext['Front Gable'] + ext['Back Gable'] };
}

export function buildSpec(d: WebDesign, ctx: SpecContext): string {
  const L: string[] = [];
  L.push('StormSafe Steel — building design request (not a quote)');
  L.push('');
  let size = `Building: ${TYPE_LABEL[d.type]} — ${dims3(d.width, d.length, d.height)}`;
  if (d.type === 'combo') {
    size += ` (enclosed garage ${ftIn(d.enclosedLength)} at the back, open carport ${ftIn(d.length - d.enclosedLength)} at the front)`;
  }
  L.push(size);
  if (d.leanTos.length) {
    const o = overallFootprint(d);
    L.push(`Overall with lean-tos: ${ftIn(o.w)} W × ${ftIn(o.l)} L`);
  }
  const roof = d.roofStyle === 'Boxed Eave' ? 'Boxed-eave roof' : d.roofStyle === 'Regular' ? 'Regular (rounded) roof' : 'Vertical roof';
  L.push(`Roof: ${roof}, ${pitchRise(d)}:12 pitch${d.pitch === 'standard' ? ' (standard)' : ''}`);
  L.push(`Wall panels: ${d.panels}`);
  L.push('');
  L.push('Walls (left / right as seen standing in front of the building, facing the front end):');
  if (d.type === 'combo') {
    L.push(`- Front end (carport): ${d.walls.front === 'gableOnly' ? 'Gable only (top triangle)' : 'Open'}`);
    L.push('- Back end: Closed');
    L.push(`- Left side, carport part: ${SIDE_WALL_LABEL[d.walls.left]} (garage part closed)`);
    L.push(`- Right side, carport part: ${SIDE_WALL_LABEL[d.walls.right]} (garage part closed)`);
    L.push('- Divider wall between garage and carport: Closed');
  } else {
    L.push(`- Front end: ${END_WALL_LABEL[d.walls.front]}`);
    L.push(`- Back end: ${END_WALL_LABEL[d.walls.back]}`);
    L.push(`- Left side: ${SIDE_WALL_LABEL[d.walls.left]}`);
    L.push(`- Right side: ${SIDE_WALL_LABEL[d.walls.right]}`);
  }
  L.push('');
  L.push(`Colors: Roof ${colorName(d.colors.roof)}, Walls ${colorName(d.colors.walls)}, Trim ${colorName(d.colors.trim)}`);
  L.push(`Wainscot: ${d.wainscot ? `${colorName(d.colors.wainscot)}, 3' band along the bottom of the walls` : 'None'}`);
  L.push('');
  if (d.openings.length) {
    L.push('Doors, windows and framed openings (position = distance from the named end or corner to the near edge):');
    d.openings.forEach((o, i) => L.push(`${i + 1}. ${mainOpeningLine(d, o)}`));
  } else {
    L.push('Doors, windows and framed openings: None');
  }
  L.push('');
  if (d.leanTos.length) {
    const wraps = activeWraps(d);
    L.push('Lean-tos:');
    d.leanTos.forEach((lt, i) => {
      L.push(
        `${i + 1}. ${LEANTO_SIDE_LABEL[lt.side]} lean-to ${ftIn(lt.width)} W × ${ftIn(lt.length)} L, low leg ${ftIn(lt.lowLeg)}, ${lt.pitch} pitch, ${leanToStartText(lt)} — walls: ${leanToWallsText(lt)}`,
      );
      const mine = wraps.filter((k) => WRAP_SIDES[k].includes(lt.side));
      if (mine.length) L.push(`   Wraps around the ${mine.map((k) => WRAP_LABEL[k]).join(' and the ')}`);
      lt.openings.forEach((o, j) => L.push(`   ${String.fromCharCode(97 + j)}. ${leanToOpeningLine(lt, o)}`));
    });
  } else {
    L.push('Lean-tos: None');
  }
  L.push('');
  const loc: string[] = [];
  if (ctx.zip) loc.push(`ZIP ${ctx.zip}`);
  if (ctx.county) loc.push(`${ctx.county} County, FL`);
  L.push(`Location: ${loc.length ? loc.join(', ') : 'Not given'}`);
  if (ctx.impact) L.push('Impact area: impact-rated windows and walk-in doors (shown in this design)');
  return L.join('\n');
}
