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
  { code: 'WXA0090L', name: 'Charcoal', hex: '#5c5b58' },
  { code: 'WXA0095L', name: 'Light Gray', hex: '#9b9ea3' },
  { code: 'WXA0107L', name: 'Black', hex: '#1b1b1d' },
  { code: 'WXB1008L', name: 'Cocoa Brown', hex: '#5a3f36' },
  { code: 'WXD0038L', name: 'Light Stone', hex: '#cab89f' },
  { code: 'WXD0045L', name: 'Ivory', hex: '#ecd1bd' },
  { code: 'WXD0046L', name: 'Sahara Tan', hex: '#b58e6c' },
  { code: 'WXD0047L', name: 'Clay', hex: '#8c7269' },
  { code: 'WXL0027L', name: 'Hawaiian Blue', hex: '#3b6a84' },
  { code: 'WXR0077L', name: 'Barn Red', hex: '#9d3a31' },
  { code: 'WXD0049L', name: 'Bright White', hex: '#e7e9ed' },
  { code: 'WXG0020L', name: 'Ivy Green', hex: '#1f4d3f' },
  { code: 'WXR0084', name: 'Bright Red', hex: '#b3282b' },
  { code: 'WXB107L', name: 'Burnished Slate', hex: '#4b4842' },
  { code: 'GALVALUME', name: 'Galvalume', hex: '#b9bcc0', metallic: true },
  { code: 'WXR0081L', name: 'Burgundy', hex: '#5e2730' },
  { code: 'KM2Y49352', name: 'Copper Penny', hex: '#c2782c' },
];

const BY_CODE: Record<string, ColorSwatch> = Object.fromEntries(
  COLOR_SWATCHES.map((s) => [s.code, s]),
);

export function swatch(code: string): ColorSwatch {
  return BY_CODE[code] ?? COLOR_SWATCHES[0];
}

export function swatchHex(code: string): string {
  return swatch(code).hex;
}

export function isMetallic(code: string): boolean {
  return !!swatch(code).metallic;
}
