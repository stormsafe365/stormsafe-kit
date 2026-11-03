import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Owner 11/3/26: "I never dont include a brush seal or chain hoist on a roll up door so make it automatically add those two
 * onto any door size if not already included, and i can switch it to none if i want". A NEW roll-up (main building or a
 * lean-to's) starts with a chain hoist + brush seal on every door; a size that includes the hoist keeps "Included"; a
 * number the rep picks stays; a restored (saved) quote keeps exactly its saved values. Runs the program's own functions.
 */
const html = readFileSync(fileURLToPath(new URL('../../../public/quote-builder.html', import.meta.url)), 'utf8');
function grabFn(name: string): string {
  const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('no function ' + name);
  let depth = 0;
  let j = html.indexOf('{', m.index);
  for (; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}' && --depth === 0) break;
  }
  return html.slice(m.index + 1, j + 1) + '\n';
}

// a tiny stand-in for a door entry: its quantity + hoist / seal dropdowns
function sel(opts: string[], value: string, auto: string, extra: { disabled?: boolean; hidden?: boolean } = {}) {
  return {
    value,
    disabled: !!extra.disabled,
    options: opts.map((v) => ({ value: v })),
    getAttribute: (a: string) => (a === 'data-auto' ? auto : null),
    closest: () => ({ style: { display: extra.hidden ? 'none' : '' } }),
  };
}
function entry(qty: string, ch: ReturnType<typeof sel> | null, sl: ReturnType<typeof sel> | null, lt = false) {
  const q = { value: qty };
  return {
    querySelector: (s: string) =>
      ({ '.rqt': lt ? null : q, '.lt-acc-qty': lt ? q : null, '.rch': lt ? null : ch, '.lt-acc-ch': lt ? ch : null, '.rsl': lt ? null : sl, '.lt-acc-sl': lt ? sl : null } as Record<string, unknown>)[s] ?? null,
  };
}
const ctx: Record<string, unknown> = { _ovlRestoring: 0 };
vm.createContext(ctx);
vm.runInContext(grabFn('rudAddonsAuto') + grabFn('_rudAuto'), ctx);
const auto = ctx.rudAddonsAuto as (e: unknown) => void;
const rudAuto = ctx._rudAuto as () => string;

describe('roll-up chain hoist + brush seal on by default', () => {
  it('a new door gets one of each per door', () => {
    const ch = sel(['0', '1', '2'], '0', '1'), sl = sel(['0', '1', '2'], '0', '1');
    auto(entry('2', ch, sl));
    expect([ch.value, sl.value]).toEqual(['2', '2']);
  });
  it('a size that includes the hoist keeps "Included" (no number to pick); the seal is still added', () => {
    const ch = sel(['0'], '0', '1', { disabled: true }), sl = sel(['0', '1'], '0', '1');
    auto(entry('1', ch, sl));
    expect([ch.value, sl.value]).toEqual(['0', '1']);
  });
  it('a number the rep picked (None too) stays', () => {
    const ch = sel(['0', '1', '2'], '0', '0'), sl = sel(['0', '1', '2'], '1', '0');
    auto(entry('2', ch, sl));
    expect([ch.value, sl.value]).toEqual(['0', '1']);
  });
  it('a hidden row (a door line with no hoist) is left alone', () => {
    const ch = sel(['0', '1'], '0', '1', { hidden: true }), sl = sel(['0', '1'], '0', '1');
    auto(entry('1', ch, sl));
    expect([ch.value, sl.value]).toEqual(['0', '1']);
  });
  it('a lean-to roll-up too', () => {
    const ch = sel(['0', '1', '2', '3'], '0', '1'), sl = sel(['0', '1', '2', '3'], '0', '1');
    auto(entry('3', ch, sl, true));
    expect([ch.value, sl.value]).toEqual(['3', '3']);
  });
  it('new = on, restoring a saved quote = off', () => {
    ctx._ovlRestoring = 0;
    expect(rudAuto()).toBe('1');
    ctx._ovlRestoring = 1;
    expect(rudAuto()).toBe('0');
    ctx._ovlRestoring = 0;
  });
});

describe('wired into the program', () => {
  it('new main-building and lean-to roll-ups start with it on; picking a number turns it off', () => {
    for (const c of ['rch', 'rsl', 'lt-acc-ch', 'lt-acc-sl'])
      expect(html).toContain(`'<select class="${c}" data-auto="'+_auto+'" onchange="this.setAttribute(\\'data-auto\\',\\'0\\');rc()">'+`);
    expect(html).toMatch(/function aRUD\(\)\{\r?\n {2}var _auto=_rudAuto\(\);/);
    expect(html).toMatch(/function addLTAcc\(entry\)\{\r?\n {2}var _auto=_rudAuto\(\);/);
  });
  it('every rebuild of those dropdowns puts the default back (size, quantity, lean-to size / type)', () => {
    expect(grabFn('chkDoorLift').trimEnd()).toMatch(/rudAddonsAuto\(entry\);[^\n]*\r?\n {2}rc\(\);\r?\n\}$/);
    expect(grabFn('syncQtyOpts').trimEnd()).toMatch(/rudAddonsAuto\(entry\);[^\n]*\r?\n {2}rc\(\);\r?\n\}$/);
    expect(grabFn('refreshLTAccChSl').trimEnd()).toMatch(/rudAddonsAuto\(e\);[^\n]*\r?\n\}$/);
  });
  it('the restore runs inside _ovlRestoring (so a saved door keeps its saved hoist / seal)', () => {
    expect(grabFn('restoreQuoteData')).toMatch(/_ovlRestoring\+\+;[\s\S]*_restoreQuoteDataImpl\(data, opts\)[\s\S]*_ovlRestoring--;/);
  });
});
