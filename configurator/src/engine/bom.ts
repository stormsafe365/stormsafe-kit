import type { ResolvedBuilding } from './ruleEngine';
import type { Member, MemberKind, StructureModel } from './geometry';
import { FRAME_PROFILES, SHEET_SPECS } from '@/config/materials';
import { PRICING, PRICE_DISCLAIMER } from '@/config/pricing';

/**
 * LAYER 4 — Bill of Materials & CPQ generator. Pure translation of the derived
 * structure into quantities, weight, and a priced quote.
 */
export interface SteelLine {
  label: string;
  linearFt: number;
}

export interface BillOfMaterials {
  steel: { lines: SteelLine[]; totalLinearFt: number };
  sheeting: { roofSqFt: number; wallSqFt: number; openingDeductSqFt: number; netSqFt: number };
  trim: {
    ridgeCapFt: number;
    eaveTrimFt: number;
    gableRakeFt: number;
    cornerTrimFt: number;
    baseTrimFt: number;
    openingJTrimFt: number;
    totalFt: number;
  };
  weightLb: { steel: number; sheeting: number; total: number };
}

export interface Quote {
  framePrice: number;
  sheetingPrice: number;
  trimPrice: number;
  openingsPrice: number;
  wainscotPrice: number;
  windUpcharge: number;
  snowUpcharge: number;
  subtotal: number;
  total: number;
  disclaimer: string;
}

const sumByKind = (members: Member[], kinds: MemberKind[]): number =>
  members.filter((m) => kinds.includes(m.kind)).reduce((acc, m) => acc + m.length, 0);

export function generateBOM(resolved: ResolvedBuilding, structure: StructureModel): BillOfMaterials {
  const { config } = resolved;
  const { members, areas, enclosure, width: W, legHeight: H, rafterLength, length: L } = structure;

  // --- STEEL ---
  const legFt = sumByKind(members, ['leg']);
  const bowFt = sumByKind(members, ['rafter', 'ridge']);
  const railFt = sumByKind(members, ['baseRail']);
  const purlinFt = sumByKind(members, ['purlin']);
  const hatFt = sumByKind(members, ['hatChannel']);

  const lines: SteelLine[] = [
    { label: 'Bows / rafters + ridge', linearFt: round(bowFt) },
    { label: 'Legs (uprights)', linearFt: round(legFt) },
    { label: 'Base rails', linearFt: round(railFt) },
    { label: 'Roof purlins', linearFt: round(purlinFt) },
  ];
  if (hatFt > 0) lines.push({ label: 'Hat channels', linearFt: round(hatFt) });
  const totalLinearFt = legFt + bowFt + railFt + purlinFt + hatFt;

  // --- SHEETING ---
  const roofSqFt = areas.roof;
  const wallSqFt = areas.walls;
  const openingDeductSqFt = config.openings.reduce((acc, o) => acc + o.width * o.height, 0);
  const netSqFt = Math.max(0, roofSqFt + wallSqFt - openingDeductSqFt);

  // --- TRIM ---
  const endWallCount =
    (enclosure.front === 'closed' ? 1 : 0) +
    (enclosure.back === 'closed' ? 1 : 0) +
    (enclosure.partitionZ !== null ? 1 : 0);
  const sideSpan = enclosure.sideZ ? enclosure.sideZ.end - enclosure.sideZ.start : 0;

  const ridgeCapFt = L;
  const eaveTrimFt = 2 * L;
  const gableRakeFt = endWallCount * 2 * rafterLength;
  const cornerTrimFt = enclosure.sideZ ? 4 * H : 0;
  const baseTrimFt = 2 * sideSpan + endWallCount * W;
  const openingJTrimFt = config.openings.reduce((acc, o) => acc + 2 * (o.width + o.height), 0);
  const totalTrimFt = ridgeCapFt + eaveTrimFt + gableRakeFt + cornerTrimFt + baseTrimFt + openingJTrimFt;

  // --- WEIGHT ---
  const steelWeight = totalLinearFt * FRAME_PROFILES[config.framingGauge].lbPerFt;
  const sheetWeight = netSqFt * SHEET_SPECS[config.sheetingGauge].lbPerSqFt;

  return {
    steel: { lines, totalLinearFt: round(totalLinearFt) },
    sheeting: {
      roofSqFt: round(roofSqFt),
      wallSqFt: round(wallSqFt),
      openingDeductSqFt: round(openingDeductSqFt),
      netSqFt: round(netSqFt),
    },
    trim: {
      ridgeCapFt: round(ridgeCapFt),
      eaveTrimFt: round(eaveTrimFt),
      gableRakeFt: round(gableRakeFt),
      cornerTrimFt: round(cornerTrimFt),
      baseTrimFt: round(baseTrimFt),
      openingJTrimFt: round(openingJTrimFt),
      totalFt: round(totalTrimFt),
    },
    weightLb: { steel: round(steelWeight), sheeting: round(sheetWeight), total: round(steelWeight + sheetWeight) },
  };
}

export function generateQuote(resolved: ResolvedBuilding, bom: BillOfMaterials): Quote {
  const { config, loads } = resolved;

  const framePrice = bom.steel.totalLinearFt * PRICING.framePerFt[config.framingGauge];
  const sheetingPrice = bom.sheeting.netSqFt * PRICING.sheetPerSqFt[config.sheetingGauge];
  const trimPrice = bom.trim.totalFt * PRICING.trimPerFt;
  const openingsPrice = config.openings.reduce((acc, o) => acc + PRICING.openingCost[o.type], 0);
  // Wainscot adds a band along the sheeted wall run (base-trim length proxies it).
  const wainscotPrice = config.wainscot.enabled ? bom.trim.baseTrimFt * PRICING.wainscotPerFt : 0;

  const materials =
    (framePrice + sheetingPrice + trimPrice + wainscotPrice) * PRICING.typeFactor[config.buildingType];
  const raw = PRICING.baseFee + materials + openingsPrice;

  const windUpcharge = loads.highWind ? raw * PRICING.highWindUpcharge : 0;
  const snowUpcharge = loads.heavySnow ? raw * PRICING.snowUpcharge : 0;
  const subtotal = raw + windUpcharge + snowUpcharge;
  const total = subtotal * PRICING.marginMultiplier;

  return {
    framePrice: round(framePrice),
    sheetingPrice: round(sheetingPrice),
    trimPrice: round(trimPrice),
    openingsPrice: round(openingsPrice),
    wainscotPrice: round(wainscotPrice),
    windUpcharge: round(windUpcharge),
    snowUpcharge: round(snowUpcharge),
    subtotal: round(subtotal),
    total: Math.round(total / 50) * 50,
    disclaimer: PRICE_DISCLAIMER,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
