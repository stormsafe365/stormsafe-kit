/**
 * Customer design → the 3D BuildingConfig (the shape the shared 3D store and
 * every src/three component read). The same mapping BuildHost.syncFromBuilder
 * makes from the quote program's fields, written here from the customer's
 * choices instead. Rep-only parts of the config (framing gauge, truss
 * spacing, manufacturer look, foundation) are filled from rules.ts — the
 * customer never picks them and they are never sent out.
 */
import type { BuildingConfig, LeanTo, LeanToOpening, Opening, OpeningType, WallOverrides } from '@/types/building';
import { DEFAULT_CONFIG } from '@/config/constants';
import { gableLeanToOffset3D } from '@/build/positionMap';
import { dimQ } from '@/three/dimLabels';
import { colorByKey, FIXTURE_BLACK, rollupColor, walkDoorType, windowType } from './catalog';
import type { SideWall, WebContext, WebDesign, WebLeanToOpening, WebOpening } from './design';
import { posToOffset3D, SIDE_3D } from './positions';
import { activeWraps, framingGauge, isWideSpan, leanToConnH, leanToIsEave, leanToOpeningWalls, pitchRise, trussSpacingFt, wallTakesOpenings, WRAP_SIDES } from './rules';

const KIND_3D: Record<WebOpening['kind'], Exclude<OpeningType, 'garageDoor'>> = { rollup: 'rollUpDoor', walk: 'walkDoor', window: 'window', frame: 'frameOut' };

/** Panels hanging from the eave → band height (ft), the program's sideClosureFeet / BuildHost closureFeet. */
export function closureFeet(v: SideWall | 'closed' | 'open', h: number): number {
  if (!v || v === 'open') return 0;
  if (v === 'closed') return h;
  if (v === 'q1') return h * 0.25;
  if (v === 'q2') return h * 0.5;
  if (v === 'q3') return h * 0.75;
  const m = /^(\d)panel$/.exec(v);
  return m ? Math.min(parseInt(m[1], 10) * 3, h) : 0;
}

const colorCode = (key: string, fallback: string) => colorByKey(key)?.code ?? fallback;

/** One part's 3D look (door face, black, impact swing, roll-up color). */
function look(o: WebOpening | WebLeanToOpening): Pick<Opening, 'color' | 'doorStyle' | 'impact'> {
  if (o.kind === 'rollup') return { color: rollupColor(o.color).hex };
  if (o.kind === 'walk') {
    const t = walkDoorType(o.style) ?? walkDoorType('std')!;
    return { doorStyle: t.face, color: t.black ? FIXTURE_BLACK : undefined, impact: t.impact };
  }
  if (o.kind === 'window') return { color: windowType(o.style)?.black ? FIXTURE_BLACK : undefined };
  return {};
}

/** The 3D config for a (normalized) design. */
export function designToConfig(d: WebDesign, ctx: Pick<WebContext, 'county'>): BuildingConfig {
  const H = d.height;
  const wide = d.width >= 32;
  const buildingType = d.type === 'combo' ? 'utility' : d.type;

  // Walls — note the swap: the customer's LEFT side (seen from the front) is
  // the 3D's internal 'right' (+X) wall, like the program's Left Eave Side.
  let wallOverrides: WallOverrides = { leftOpen: false, rightOpen: false };
  let eavePanelFt = { left: 0, right: 0 };
  if (d.type === 'garage') {
    const band = (v: SideWall) => (v === 'closed' || v === 'open' ? undefined : closureFeet(v, H) || undefined);
    wallOverrides = {
      front: d.walls.front,
      back: d.walls.back,
      leftOpen: d.walls.right === 'open',
      rightOpen: d.walls.left === 'open',
      leftBandFt: band(d.walls.right),
      rightBandFt: band(d.walls.left),
    };
  } else if (d.type === 'carport') {
    wallOverrides = { front: d.walls.front, back: d.walls.back, leftOpen: false, rightOpen: false };
    eavePanelFt = { left: closureFeet(d.walls.right, H), right: closureFeet(d.walls.left, H) };
  } else {
    eavePanelFt = { left: closureFeet(d.walls.right, H), right: closureFeet(d.walls.left, H) };
  }

  const openings: Opening[] = d.openings
    .filter((o) => wallTakesOpenings(d, o.wall))
    .map((o) => ({
      id: o.id,
      type: KIND_3D[o.kind],
      side: SIDE_3D[o.wall],
      offset: posToOffset3D(d, o.wall, o.pos, o.w),
      width: dimQ(o.w),
      height: dimQ(o.h),
      sillHeight: dimQ(o.sill),
      customerSupplied: o.kind === 'frame',
      ...look(o),
    }));

  const wraps = activeWraps(d);
  const leanTos: LeanTo[] = d.leanTos.map((lt) => {
    const eave = leanToIsEave(lt.side);
    const ltWalls = leanToOpeningWalls(lt);
    const ops: LeanToOpening[] = lt.openings
      .filter((o) => ltWalls.includes(o.wall))
      .map((o) => ({
        id: o.id,
        type: KIND_3D[o.kind],
        wall: o.wall,
        widthFt: dimQ(o.w),
        heightFt: dimQ(o.h),
        sillFt: dimQ(o.sill),
        offsetFt: o.pos + o.w / 2,
        ...look(o),
      }));
    const mine = wraps.filter((k) => WRAP_SIDES[k].includes(lt.side));
    return {
      id: lt.id,
      type: 'attached',
      attachedSide: lt.side,
      widthFt: lt.width,
      lengthFt: lt.length,
      offsetFt: eave ? lt.start : gableLeanToOffset3D(lt.side, lt.start, lt.length, d.width),
      lowLegHeightFt: lt.lowLeg,
      tallLegHeightFt: leanToConnH(lt),
      roofPitch: lt.pitch,
      enclosure: lt.enclosure,
      ...(lt.enclosure === 'custom' ? { customWalls: { ...lt.walls } } : {}),
      openings: ops,
      ...(mine.length ? { wrapCorners: mine } : {}),
    };
  });

  return {
    ...DEFAULT_CONFIG,
    buildingType,
    width: d.width,
    length: d.length,
    legHeight: H,
    enclosedLengthFt: d.type === 'combo' ? d.enclosedLength : Math.min(DEFAULT_CONFIG.enclosedLengthFt, d.length),
    openEnd: 'front',
    openEndGableSheeting: d.type === 'combo' && d.walls.front === 'gableOnly',
    wallOverrides,
    eavePanelFt,
    // a 12-gauge frame / 26-gauge wall panels the customer asked for (Upgrades) show in the drawing too
    framingGauge: d.upgrades?.frame12 ? '12-gauge' : framingGauge(d, ctx.county),
    sheetingGauge: d.upgrades?.panels26 || isWideSpan(d.width) ? '26-gauge' : '29-gauge',
    panelOrientation: wide ? 'Vertical' : d.panels,
    roofOrientation: d.roofStyle === 'Vertical' ? 'Vertical' : 'Horizontal',
    roofStyle: d.roofStyle,
    roofPitch: pitchRise(d),
    roofOverhangFt: 0.5,
    manufacturer: 'CCI',
    foundation: 'concrete',
    monoDropFt: 0,
    colors: {
      roof: colorCode(d.colors.roof, 'GALVALUME'),
      walls: colorCode(d.colors.walls, '#8A8A88'),
      trim: colorCode(d.colors.trim, '#1D1E20'),
      wainscot: colorCode(d.colors.wainscot, '#57534A'),
    },
    wainscot: { enabled: d.wainscot, heightFt: 3 },
    walls: {
      preset: d.type === 'garage' ? 'enclosed' : d.type === 'carport' ? 'open' : 'custom',
      front: 'closed',
      back: 'closed',
      left: 'closed',
      right: 'closed',
      storage: { mode: 'none', lengthFt: 0 },
    },
    trussSpacingFt: d.upgrades?.oc4 ? 4 : trussSpacingFt(d, ctx.county),
    leanTos,
    openings,
  };
}
