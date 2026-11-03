import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/3/26 (Laura Rincon, CCI 40x60x20, Palm Beach):
 *  - the lift: CCI Price Book 2 p5 "Customer must provide TELESCOPIC FORKLIFT ... reach 10' beyond the building height"
 *    (the quote said a 26' reach for every building; the contract said nothing);
 *  - the contract's balance: CCI's half at scheduling / half after install (the contract showed it all "at scheduling");
 *  - CCI freight 3% on a building of $60,000 or more before discounts (CCI by phone to the owner, 11/3/26).
 * Runs the program's own functions in a vm.
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
const ctx: Record<string, unknown> = { ACTIVE_MFR: 'CCI', __f: {}, __rlift: [] };
vm.createContext(ctx);
vm.runInContext(
  ['liftReachFt', 'liftNeeded', 'liftText', 'liftContractLine', 'balSplit', 'contractBalanceSplit', 'cciFreightOn', 'cciFreightLabel', 'fD'].map(grabFn).join('') +
    'var CCI_FREIGHT_AT=60000;\n' +
    'function G(id){ return (id in __f) ? { value: __f[id] } : null; }\n' +
    'function _delivOnly(){ return __f["delivery-type"]==="delivered" || __f["delivery-type"]==="pickup"; }\n' +
    'function _pickupOnly(){ return __f["delivery-type"]==="pickup"; }\n' +
    'function cciWideOn(w){ return ACTIVE_MFR==="CCI" && w>=62 && w<=100; }\n' +
    'var document = { querySelectorAll: function(){ return __rlift; } };\n',
  ctx,
);
const run = (js: string, f: Record<string, string>, mfr = 'CCI', rlift: unknown[] = []) => {
  ctx.__rlift = rlift;
  return vm.runInContext(`ACTIVE_MFR='${mfr}'; __f=${JSON.stringify(f)}; ${js}`, ctx) as unknown;
};

describe('the lift the buyer provides (CCI: 10 ft beyond the building height)', () => {
  it('reach = side height + 10, at least 20', () => {
    expect(run('liftReachFt()', { bh: '20' })).toBe(30);
    expect(run('liftReachFt()', { bh: '16' })).toBe(26);
    expect(run('liftReachFt()', { bh: '8' })).toBe(20);
    expect(run('liftReachFt()', { bh: '24' })).toBe(34);
  });
  it('needed on a wide span, over 14 ft tall, or for a door that needs one', () => {
    expect(run('liftNeeded()', { bh: '12', btype: 'widespan' })).toBe(true);
    expect(run('liftNeeded()', { bh: '15', btype: 'standard' })).toBe(true);
    expect(run('liftNeeded()', { bh: '14', btype: 'standard' })).toBe(false);
    expect(run('liftNeeded()', { bh: '12', btype: 'standard' }, 'CCI', [{ style: { display: '' } }])).toBe(true);
    expect(run('liftNeeded()', { bh: '12', btype: 'standard' }, 'CCI', [{ style: { display: 'none' } }])).toBe(false);
  });
  it('quote PDF: CCI names the reach for this height; CA keeps its old sentence word for word', () => {
    expect(run('liftText()', { bh: '20' })).toBe("Buyer must provide a telescopic forklift (6,000 lb, 30′+ reach) on site. Rental fees are buyer's responsibility.");
    expect(run('liftText()', { bh: '20' }, 'CA')).toBe("Buyer must provide a Reach Lift (6,000 lb, 26' reach) on site. Rental fees are buyer's responsibility.");
  });
  it('contract: the lift sentence in Buyer Responsibilities only when a lift is needed and the unit is installed', () => {
    expect(run('liftContractLine()', { bh: '20', btype: 'widespan' })).toContain('at least 30′ reach');
    expect(run('liftContractLine()', { bh: '20', btype: 'widespan' })).toContain('by 7am on installation day');
    expect(run('liftContractLine()', { bh: '12', btype: 'standard' })).toBe('');
    expect(run('liftContractLine()', { bh: '20', btype: 'widespan', 'delivery-type': 'delivered' })).toBe('');
    expect(run('liftContractLine()', { bh: '20', btype: 'widespan' }, 'CA')).toContain('26′ reach');
  });
  it('one rule for the screen, the quote PDF and the contract', () => {
    expect(html).toContain('  var needsLift=liftNeeded();');
    expect(html).toContain('  liftText()+');
    expect(html).toContain("responsibility.'+liftContractLine()+");
    expect(html).not.toContain("'Buyer must provide a Reach Lift (6,000 lb, 26\\' reach) on site. Rental fees are buyer\\'s responsibility.'+");
  });
});

describe("the contract's balance: half at scheduling, the rest (+ freight) after install", () => {
  it('splits the balance like the quote PDF; the freight joins the after-install payment', () => {
    expect(run('JSON.stringify(balSplit(46164, 0))', {})).toBe('{"sched":23082,"after":23082}');
    expect(run('JSON.stringify(balSplit(46164, 1934.25))', {})).toBe('{"sched":23082,"after":25016.25}');
    const h = run('contractBalanceSplit(46164, 1934.25)', {}) as string;
    expect(h).toContain('Remaining Balance</span><span class="v">$46,164.00');
    expect(h).toContain('½ Due When Installation Is Scheduled</span><span class="v">$23,082.00');
    expect(h).toContain('½ + Freight Due After Installation</span><span class="v">$25,016.25');
    expect(run('contractBalanceSplit(1000, 0)', {})).toContain('½ Due After Installation');
    expect(run('contractBalanceSplit(1000, 0)', { 'delivery-type': 'delivered' })).toContain('½ Due at Delivery');
    expect(run('contractBalanceSplit(1000, 0)', { 'delivery-type': 'pickup' })).toContain('½ Due When Pickup Is Scheduled');
  });
  it('used only when the payment is split, never on a revised contract', () => {
    expect(html).toContain('((!_rvBalC && paySplitOn(ad,bal))?contractBalanceSplit(bal, +T.freightP||0):');
  });
});

describe('CCI freight: 3% at $60,000+ before discounts (62-100 always) - a separate charge', () => {
  it('CCI from $60,000 (62-100 wide always); CA never', () => {
    expect(run('cciFreightOn(40, 64475)', {})).toBe(true);
    expect(run('cciFreightOn(40, 60000)', {})).toBe(true);
    expect(run('cciFreightOn(40, 59999.99)', {})).toBe(false);
    expect(run('cciFreightOn(70, 30000)', {})).toBe(true);
    expect(run('cciFreightOn(40, 90000)', {}, 'CA')).toBe(false);
    expect(run('cciFreightLabel()', {})).toBe('Freight — 3% (not taxed, due at installation)');
  });
  it('never in the building price: not discounted, not taxed, not in the deposit', () => {
    expect(html).toContain('  var freightP=cciFreightOn(w,sub)?Math.round(sub*3)/100:0;');
    expect(html).not.toContain('  sub+=freightP;');
    expect(html).toContain('      var rest=(+r0.anchorP||0)+(+r0.adjP||0); // (freight is not in sub since 11/3/26)');
    expect(html).toContain('Total with Freight');
  });
  it('the price lock: the snapshot keeps the freight; a locked reopen shows it as saved; older 62-100 saves name it', () => {
    expect(html).toContain('return { v:_snapV, frt:r2(+r.freightP||0), pricedAt:');
    expect(html).toContain('lean12ga:1, frtSep:1,');
    // an older save: sold = $0, a CCI 62-100 save = $0 (freight inside its saved price), any other = today's rule (owner 11/3/26)
    expect(html).toContain("root._frtHold=(pr && pr.frt!=null)?+pr.frt:((data.overrides && data.overrides.frtSep)?null:((st.sold || (typeof root.cciWideOn==='function' && root.cciWideOn(parseInt(((root.G && root.G('bw'))||{}).value)||0)))?0:null));");
    expect(html).toContain('  if(window._frtHold!=null && window.PriceLock && PriceLock.on) freightP=window._frtHold;');
    expect(html).toContain("label:'Freight (as originally quoted)', amt:fIn, rules:['cci-freight-sep']");
    expect(html).toContain("'cci-freight-sep': { commit:'11-03'");
  });
});
