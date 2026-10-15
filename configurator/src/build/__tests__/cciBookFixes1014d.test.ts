import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * 10-14d - CCI pricing corrections from the 10/14/26 combination audit, BOOK-BACKED ONLY (owner 10/14/26), plus the
 * owner's revert of the two Sensei-calibrated lean-to items of release 10-14 ("A2" gable / Triple Wide connection fee,
 * "A3" Triple Wide lean-to premium - see cciLeanToWrap.test.ts). Every expected value below is a Price Book 2 / Dealer
 * Handbook / Permitting Requirements / CCI memo 3/9/26 figure (page cited) or the Sensei reading it reproduces.
 * Runs the program's own functions (public/quote-builder.html) in a node vm with a DOM-ish G().
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function matchEnd(from: number): number {
  let depth = 0;
  let inStr: string | null = null;
  let j = html.indexOf('{', from);
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && html[j + 1] === '/') { j = html.indexOf('\n', j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return j;
}
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  return html.slice(m.index + 1, matchEnd(m.index + 1) + 1) + '\n';
}
function grabVar(name: string): string {
  const m = new RegExp('\\nvar ' + name + '\\s*=\\s*\\{').exec(html);
  if (!m) throw new Error('no var ' + name);
  const i = html.indexOf('{', m.index);
  return 'var ' + name + '=' + html.slice(i, matchEnd(i) + 1) + ';\n';
}
function grabArr(name: string): string {
  const m = new RegExp('\\nvar ' + name + '\\s*=\\s*(\\[[^\\]]*\\])').exec(html);
  if (!m) throw new Error('no array ' + name);
  return 'var ' + name + '=' + m[1] + ';\n';
}

const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(
  [
    'gLeg', 'cciUnits', 'cciUnitSum', 'cciColUp', 'cciWideOn', 'cciWideUnits', 'cciWideUnitSum', 'cciWideHeight', 'cci12GA',
    'halfClosedCost', 'gableOnlyCost', 'ecLookup', 'eBkt', 'gAnchors', 'gAnchorLegs', 'acUnitPrice', 'ltFrameoutPrice',
    'ltAccFoUnitPrice', 'isEaveSide', 'vertEndUpcharge', 'vertSideUpcharge', 'gVertUpgrade', 'eaveVal', 'gAddEndWall', 'gInsul',
    'cciPanelTiers', 'cpJTrim', 'gSidePanels', 'sideClosurePrice', 'sidePanelLength', 'ropUnit', 'cciPBRule', 'cci170OcRule',
    'connFeeFor',
  ].map(grabFn).join('') +
    grabVar('EXT_SH') + grabVar('EC') + grabVar('VERT_SIDE') + grabArr('EXT_L') + grabArr('LENGTHS') + grabArr('CCI_GA12_L') + grabArr('CCI_GA12_V') +
    'var VERT_SIDE_EXT={high:[[60,1680]]}; var ANCHOR_UNIT=70; var INSUL_RATE=1.50;\n' +
    'var VERT_END={12:150,14:210,16:240,18:270,20:300,22:330,24:360,26:450,28:510,30:570};\n' +
    'var HW=["Charlotte","Collier","Duval","Flagler","Indian River","Lake","Lee","Martin","Palm Beach","Pinellas","Sarasota","Seminole","St Lucie","St. Lucie"];\n' +
    'var HU_N=new Proxy({},{get:function(){ return [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]; }}); var HU_M=HU_N; var HU=HU_N;\n' +
    'var AC_PRICES={"Framed Opening — Garage Door (6\'-10\' Wide)":150,"Framed Opening — Garage Door (12\' Wide)":200,"Framed Opening — Garage Door (14\' Wide)":250,"Framed Opening — Garage Door (16\' Wide)":300,"Framed Opening — Side Opening, No Door (6\'-10\' Wide)":250,"Framed Opening — Side Opening, No Door (12\' Wide)":300};\n' +
    'var _TI=0; function getTrussInfo(){ return _TI?{count:_TI}:null; }\n' +
    'function lrStorageLookup(){ return -1; }\n' +
    'function cciWideEC(w,h){ return -1; }\n' +
    'function _ltsInterp(){ return 0; }\n' +
    'var LTS_CONN=[];\n' +
    'var SP={ full:{21:110,26:130,31:155,36:175}, halfTrim:{21:220,26:260,31:310,36:350}, tiers:[21,26,31,36] };\n' +
    'function MFR(){ return { shExtThresh:52, shIndexByLength:true, gableOnlyPrice:300, halfGablePrice:900, vertSideCombined:true, sidePanels:SP, panelTier:function(l){ for(var i=0;i<SP.tiers.length;i++){ if(SP.tiers[i]>=l) return SP.tiers[i]; } return 36; } }; }\n' +
    // DOM-ish G(): __f holds field values (county / pt via textContent / value), .fo-loc etc. via el objects
    'function G(id){ if(!(id in __f)) return null; return { id:id, value:__f[id], textContent:__f[id], checked:__f[id]===true, style:{}, dataset:{} }; }\n' +
    'function el(o){ return { querySelector:function(s){ var k=s.replace(/^\\./,""); return (k in o)?{ value:o[k] }:null; } }; }\n',
  ctx,
);
const run = (js: string, f: Record<string, unknown> = {}, mfr = 'CCI') =>
  vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; ${js}`, ctx) as unknown;
const SHC = [20, 24, 28, 32, 36, 40, 44, 48, 52];
const SHT: Record<number, number[]> = { // Price Book 2 p6 SIDE HEIGHT
  18: [3360, 3840, 4320, 4800, 5280, 5760, 6240, 6720, 7200],
  20: [3790, 4470, 5115, 5830, 6510, 7190, 7865, 8545, 9225],
};
const shAt = (h: number, l: number) => SHT[h][SHC.findIndex((c) => c >= l)];
const legs = (w: number, l: number, h: number) => run('gLeg()', { btype: 'standard', bw: String(w), bl: String(l), bh: String(h) }) as number;

describe('F06 - CCI 12\'-30\' legs at 17\'-20\', 53\'-100\' long = the 12W-30W combinations (Dealer Handbook p6)', () => {
  it('Sensei 30x55x18 $9,120 (30+25 -> 32\' + 28\' columns) and 30x60x20 $11,660 (30+30)', () => {
    expect(legs(30, 55, 18)).toBe(4800 + 4320);
    expect(legs(30, 60, 20)).toBe(5830 + 5830);
    expect(legs(30, 53, 18)).toBe(9120); // 53 builds as 55
    for (let l = 56; l <= 60; l++) expect(legs(30, l, 18)).toBe(9600);
  });
  it('every 12\'-30\' width the same (legs are width-independent on the commercial chart)', () => {
    for (const w of [12, 18, 20, 24, 26, 28, 30]) { expect(legs(w, 55, 18)).toBe(9120); expect(legs(w, 60, 20)).toBe(11660); }
  });
  it('61\'-100\' = EXT_SH exactly (the Sensei-sampled extended rows already follow the 12W-30W split)', () => {
    const ext = vm.runInContext('EXT_SH', ctx) as Record<number, number[]>;
    const EL = [45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
    for (const h of [18, 20]) for (let l = 61; l <= 100; l++) expect(legs(30, l, h), `${l}x${h}`).toBe(ext[h][EL.findIndex((c) => c >= l)]);
  });
  it('20\'-52\' (one chart column) and past 100\' (EXT_SH line) unchanged', () => {
    for (const h of [18, 20]) for (let l = 20; l <= 52; l++) expect(legs(30, l, h)).toBe(shAt(h, l));
    const ext = vm.runInContext('EXT_SH[18]', ctx) as number[];
    expect(legs(30, 110, 18)).toBe(Math.round(ext[11] + ((ext[11] - ext[10]) / 5) * 10));
  });
});

describe('F09 - CCI ground (mobile home) anchors included with a certified structure (Dealer Handbook p8)', () => {
  it('$0 for CCI on the ground; the count stays for the "included" line', () => {
    vm.runInContext('_TI=16', ctx);
    expect(run('gAnchors()', { foundation: 'ground' })).toBe(0);
    expect(run('gAnchorLegs()', { foundation: 'ground' })).toBe(32);
    vm.runInContext('_TI=0', ctx);
    expect(html).toContain("rows+=row('Mobile Home Anchors — Ground Install (included with certification)',anchorLegsQ,null,0);");
    expect(html).toContain("row('Mobile Home Anchors — Ground Install (included with certification)',anchorLegsQ,null,0);");
  });
});

describe('F15 - CCI half closed end = half the end wall at every width (Dealer Handbook p24)', () => {
  it('Sensei commercial Half End 40x12 $1,797.50 / 50x12 $2,097.50 / 60x12 $2,397.50; 22x13 = the old $900 point', () => {
    expect(run('halfClosedCost()', { bw: '40', bh: '12' })).toBe(1797.5);
    expect(run('halfClosedCost()', { bw: '50', bh: '12' })).toBe(2097.5);
    expect(run('halfClosedCost()', { bw: '60', bh: '12' })).toBe(2397.5);
    expect(run('halfClosedCost()', { bw: '22', bh: '13' })).toBe(900);
    expect(run('halfClosedCost()', { bw: '12', bh: '8' })).toBe(342.5);
    expect(run('halfClosedCost()', { bw: '30', bh: '16' })).toBe(1465);
    expect(run('halfClosedCost()', { bw: '24', bh: '18' })).toBe(1880); // 17'+: half the program's tall end ($3,760)
    expect(run('halfClosedCost()', { bw: '40', bh: '12' }, 'CA')).toBe(900); // CA: its flat price (MFR stub), unchanged
  });
});

describe('F17 - CCI garage-door frame-out on a GABLE end = $150 (Price Book 2 p2/p4/p6, Dealer Handbook p22)', () => {
  const fo = (comp: string, loc: string, bw: string) => run(`acUnitPrice(${JSON.stringify(comp)}, el({"fo-loc":${JSON.stringify(loc)}}))`, { bw });
  it('12\' / 14\' / 16\' doors on a gable: $150; on an eave: the With-Garage-Door header rows', () => {
    for (const w of ["6'-10'", "12'", "14'", "16'"]) {
      expect(fo(`Framed Opening — Garage Door (${w} Wide)`, 'Back Gable End', '24')).toBe(150);
      expect(fo(`Framed Opening — Garage Door (${w} Wide)`, 'Front Gable End', '40')).toBe(150);
    }
    expect(fo("Framed Opening — Garage Door (12' Wide)", 'Left Eave Side', '24')).toBe(200);
    expect(fo("Framed Opening — Garage Door (16' Wide)", 'Right Eave Side', '24')).toBe(300);
    expect(fo("Framed Opening — Garage Door (12' Wide)", 'Left Eave Side', '40')).toBe(325); // 32-60 eave: p6 Side Openings, unchanged
    expect(fo("Framed Opening — Side Opening, No Door (12' Wide)", 'Back Gable End', '24')).toBe(300); // not a garage-door frame-out: unchanged
    expect(fo("Framed Opening — Garage Door (12' Wide)", 'Back Gable End', '70')).toBe(200); // 62-100: unchanged
  });
  it('lean-to END openings: $150; the outer (eave) wall keeps the Side Openings chart', () => {
    expect(run('ltFrameoutPrice(12, "front")')).toBe(150);
    expect(run('ltFrameoutPrice(10, "back")')).toBe(150);
    expect(run('ltFrameoutPrice(12, "outer")')).toBe(300);
    const ae = (type: string) => `el({"lt-acc-fo-w":"12","lt-acc-fo-h":"10","lt-acc-fo-type":${JSON.stringify(type)}})`;
    expect(run(`ltAccFoUnitPrice(${ae("Framed Opening — Garage Door (12' Wide)")}, "front")`)).toBe(150);
    expect(run(`ltAccFoUnitPrice(${ae("Framed Opening — Garage Door (12' Wide)")}, "outer")`)).toBe(200);
  });
});

describe('F18 / F19 / F37 - vertical adds (Price Book 2 p2/p4)', () => {
  const gch = { btype: 'gch', bw: '24', bl: '40', bh: '12', ws: 'Vertical', wfg: 'Open', wbg: 'Closed', wre: 'Open', wle: 'Open', 'gch-enc': '20', 'gch-left': 'open', 'gch-right': 'open' };
  it('F18 GCH 24x40x12, 20\' room, vertical: back end $360 + room sides $480 + divider $360 = $1,200 (Sensei: +$360 and +$840)', () => {
    expect(run('gVertUpgrade()', gch)).toBe(360 + 480 + 360);
    expect(run('gVertUpgrade()', { ...gch, ws: 'Horizontal' })).toBe(0);
    expect(run('gVertUpgrade()', gch, 'CA')).toBe(360); // CA unchanged
  });
  it('F19 End Storage partition, vertical: + the vertical end (Sensei 20x40x10 $1,130 -> $1,430); horizontal / 17\'+ / CA unchanged', () => {
    const b = { btype: 'standard', bw: '20', bl: '40', bh: '10', ws: 'Vertical', 'add-end-wall': 'yes' };
    expect(run('gAddEndWall()', b)).toBe(1430);
    expect(run('gAddEndWall()', { ...b, ws: 'Horizontal' })).toBe(1130);
    expect(run('gAddEndWall()', { ...b, bh: '18' })).toBe(3760);
    expect(run('gAddEndWall()', b, 'CA')).toBe(1130);
  });
  it('F37 13\'-17\' wide (and 7\'/8\' lean-tos at 2W): the 18\' column $270 (14\' read $210, 16\' $240)', () => {
    for (const w of [13, 14, 15, 16, 17, 18]) expect(run(`vertEndUpcharge(${w})`)).toBe(270);
    expect(run('vertEndUpcharge(12)')).toBe(150);
    expect(run('vertEndUpcharge(14)', {}, 'CA')).toBe(210); // CA unchanged
  });
});

describe('F29 - CCI 26\'-30\' 12 gauge past 100\' per connected unit (Dealer Handbook p6)', () => {
  it('Sensei 30x125 $2,720 (35+30+30+30); 100\' and below unchanged', () => {
    expect(run('cci12GA(125)')).toBe(770 + 650 + 650 + 650);
    expect(run('cci12GA(100)')).toBe(2190);
    for (const l of [105, 110, 115, 120]) expect(run(`cci12GA(${l})`)).toBe(2190 + 24 * (l - 100)); // the old line agreed here
    expect(run('cci12GA(160)')).toBe(4 * 890);
  });
});

describe('F31 - CCI insulation end walls on 32\'-60\' (Dealer Handbook p22: + 3\' / + 4\')', () => {
  it('Sensei 40x60x14 Roof & Walls $8,340; 12\'-30\' unchanged (+ 2\')', () => {
    expect(run('gInsul()', { 'insul-sel': 'roof-walls', btype: 'widespan', bw: '40', bl: '60', bh: '14' })).toBe(8340);
    expect(run('gInsul()', { 'insul-sel': 'roof-walls', btype: 'widespan', bw: '52', bl: '40', bh: '12' })).toBe(Math.round(54 * 40 * 1.5) + Math.round(40 * 12 * 2 * 1.5) + Math.round(52 * 16 * 2 * 1.5));
    expect(run('gInsul()', { 'insul-sel': 'roof-walls', btype: 'standard', bw: '20', bl: '25', bh: '9' })).toBe(2160); // Dealer Handbook p22 example
  });
});

describe('F32 - CCI generic plans $250 on 32\'-60\' (Permitting Requirements p1)', () => {
  it('the plan fee', () => {
    expect(html).toContain("if(planType==='Generic Plans'){ var _gpW=parseInt((G('bw')||{}).value)||0; if(_gpW%2===1) _gpW++; return (_gpW>=32 && _gpW<=60) ? 250 : 175; }");
  });
});

describe('F33 - CCI side panels per unit + J-trim on garage partial sides (Price Book 2 p2, Dealer Handbook p15/p21)', () => {
  const g = { btype: 'standard', bw: '24', bl: '40', bh: '12', wle: 'Closed', wre: '2panel', 'w-jtrim': true };
  it('Sensei 24x40x12 Right "2 Panel" $440 + Side J-Trim $110', () => {
    expect(run('gSidePanels()', g)).toBe(440 + 110);
    expect(run('gSidePanels()', { ...g, 'w-jtrim': false })).toBe(440);
    expect(run('cpJTrim(true)', { ...g, 'w-jtrim': false })).toBe(110);
    expect(run('gSidePanels()', { ...g, wre: 'Closed' })).toBe(0);
    expect(run('gSidePanels()', { ...g, bl: '35' })).toBe(2 * 175 + 95); // one 36' panel per row, J-trim 35' col
    expect(run('gSidePanels()', { ...g, bw: '40', btype: 'widespan' })).toBe(350); // 32'+: unchanged, no J-trim
    expect(run('gSidePanels()', g, 'CA')).toBe(350); // CA: no J-trim, its single tier (MFR stub)
  });
});

describe('F36 - CCI opener by door WIDTH (memo 3/9/26)', () => {
  it('$1,100 under 12\' wide, $1,200 12\'+ wide', () => {
    for (const s of ['8x8', '9x8', '10x10', '10x12', '10x14', '8x12']) expect(run(`ropUnit('${s}')`)).toBe(1100);
    for (const s of ['12x8', '12x12', '14x14', '16x16']) expect(run(`ropUnit('${s}')`)).toBe(1200);
  });
});

describe('F10 / F11 - CCI up to 170 MPH on 24\' and narrower = 4\' OC (Price Book 2 p1/p2, Dealer Handbook p30)', () => {
  const r = (f: Record<string, unknown>, w = 24, bt = 'standard', mfr = 'CCI') => run(`cci170OcRule(${w}, '${bt}')`, f, mfr);
  it('hi-wind county or Commercial / Risk Cat 2 property; never Palm Beach (own rule), 26\'+, wide span, free-standing, CA', () => {
    expect(r({ county: 'Lee', pt: 'res' })).toBe('hw');
    expect(r({ county: 'Collier', pt: '' }, 24, 'carport')).toBe('hw');
    expect(r({ county: 'Polk', pt: 'com' }, 22)).toBe('com');
    expect(r({ county: 'Polk', pt: 'rc2r' }, 12, 'gch')).toBe('com');
    expect(r({ county: 'Polk', pt: 'res' })).toBe('');
    expect(r({ county: 'Palm Beach', pt: 'res' })).toBe('');
    expect(r({ county: 'Lee', pt: 'res' }, 26)).toBe('');
    expect(r({ county: 'Lee', pt: 'res' }, 24, 'widespan')).toBe('');
    expect(r({ county: 'Lee', pt: 'res' }, 12, 'fslean')).toBe('');
    expect(r({ county: 'Lee', pt: 'com' }, 24, 'standard', 'CA')).toBe('');
  });
  it('wired into the Palm Beach 4\' OC lock, its override and the price lock', () => {
    expect(html).toContain("var lock=((cciPBRule() && w>0 && w<=24 && bt!=='widespan') || !!cci170OcRule(w, bt)) && !window._fu14Ovr;");
    expect(html).toContain("var _oc170N=cci170OcRule(w, G('btype').value);");
    expect(html).toContain("if(opts.lock && !ov.fu14 && c.oc170 && (f['oc-spacing']||'5oc')!=='4oc' && !ov.oc170Rule){ root._fu14Ovr=true; gf.fu14=true; }");
    expect(html).toContain('pbRule:1, cpOnce:1, book1012:1, oc170Rule:1,');
  });
});

describe('F35 - impact counties per the CCI memo 3/9/26 p3', () => {
  it('windows + Hi-Wind doors / windows only', () => {
    expect(html).toContain("var _pImpCo=['Charlotte','Collier','Hillsborough','Indian River','Lee','Manatee','Palm Beach','Sarasota','St. Lucie'];");
    expect(html).toContain("var _pImpWinCo=['Duval','Orange','Pasco','Pinellas','Volusia'];");
    expect(html).toContain("var IMPACT_CO = ['Charlotte','Collier','Hillsborough','Indian River','Lee','Manatee','Palm Beach','Sarasota','St. Lucie'];");
    expect(html).toContain("var IMPACT_WIN_CO = ['Duval','Orange','Pasco','Pinellas','Volusia'];");
  });
});

describe('F16 - CCI gable-only 32\'-60\' (Price Book 2 p6) is in cciBook1012.test.ts; owner reverts A2 / A3 in cciLeanToWrap.test.ts', () => {
  it('A2: a gable lean-to on a 12\'-30\' main = the pre-10-14 rule; a side lean-to = the book side fee on every 12\'-30\' main', () => {
    expect(run("connFeeFor('Front Gable', 24)", { bw: '24', btype: 'standard' })).toBe(725);
    expect(run("connFeeFor('Left Eave', 50)", { bw: '30', btype: 'standard' })).toBe(250);
    expect(run("connFeeFor('Left Eave', 40)", { bw: '24', btype: 'standard' })).toBe(200);
  });
});
