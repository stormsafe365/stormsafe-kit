/**
 * StormSafe panel color palette (from the official color chart).
 * `code` is the manufacturer SKU printed on the quote; `hex` is the on-screen
 * approximation for the 3D preview. `metallic` flags Galvalume.
 */
export interface ColorSwatch {
  code: string;
  name: string;
  hex: string;
  metallic?: boolean;
}

export const COLOR_SWATCHES: ColorSwatch[] = [
  // Hexes mirror the program's COLORS array (quote-builder.html) so the 3D
  // swatch matches exactly what the customer picks in the pricing program.
  { code: 'WXA0090L', name: 'Charcoal', hex: '#6B6360' },
  { code: 'WXA0095L', name: 'Light Gray', hex: '#9EA5A8' },
  { code: 'WXA0107L', name: 'Black', hex: '#1A1A1A' },
  { code: 'WXB1008L', name: 'Cocoa Brown', hex: '#5C3A2E' },
  { code: 'WXD0038L', name: 'Light Stone', hex: '#C9B99A' },
  { code: 'WXD0045L', name: 'Ivory', hex: '#EDD5C0' },
  { code: 'WXD0046L', name: 'Sahara Tan', hex: '#B8956A' },
  { code: 'WXD0047L', name: 'Clay', hex: '#9E8880' },
  { code: 'WXL0027L', name: 'Hawaiian Blue', hex: '#3A6B8A' },
  { code: 'WXR0077L', name: 'Barn Red', hex: '#7D3030' },
  { code: 'WXD0049L', name: 'Bright White', hex: '#DDDDE8' },
  { code: 'WXG0020L', name: 'Ivy Green', hex: '#1E4D3A' },
  { code: 'WXR0084', name: 'Bright Red', hex: '#BC1E2D' },
  { code: 'WXB107L', name: 'Burnished Slate', hex: '#555A4A' },
  { code: 'GALVALUME', name: 'Galvalume', hex: '#B8BDC2', metallic: true },
  { code: 'WXR0081L', name: 'Burgundy', hex: '#4A1E2A' },
  { code: 'KM2Y49352', name: 'Copper Penny', hex: '#C47F2A' },
];

const BY_CODE: Record<string, ColorSwatch> = Object.fromEntries(
  COLOR_SWATCHES.map((s) => [s.code, s]),
);

export function swatch(code: string): ColorSwatch {
  if (BY_CODE[code]) return BY_CODE[code];
  // Tolerate a raw hex (e.g. a color forwarded straight from the pricing
  // program for a manufacturer palette we don't have a code for). Galvalume
  // can't be detected from a bare hex, so it renders non-metallic — acceptable.
  if (/^#[0-9a-fA-F]{3,8}$/.test(code)) {
    return { code, name: code, hex: code };
  }
  return COLOR_SWATCHES[0];
}

export function swatchHex(code: string): string {
  return swatch(code).hex;
}

export function isMetallic(code: string): boolean {
  return !!swatch(code).metallic;
}
