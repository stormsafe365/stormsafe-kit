/**
 * programBridge — the 3D view box's line into the pricing program (owner 11/2/26: "I think we can utilize the 'view
 * mode' box more ... me & josh could even realistically design the building like that through that box ... & then the
 * left side panel would update based on what we select").
 *
 * The box never prices, never re-implements a rule and never writes the program's data: it PRESSES the program's own
 * controls, the same ones a rep clicks in the left panel —
 *   - a wall: Section 5's wall tile (the program picks the wall and turns the 3D to it);
 *   - an add: Section 5's "+ Roll-up door / Walk door / Window / Lean-to / Component" button (the program's own add, with
 *     its no-overlap check: an item that does not fit is refused there, with the program's own message);
 *   - a field: the card's real select / input / checkbox / button, with the events a rep's click or typing fires;
 *   - remove: the card's own ×.
 * So whatever is added or changed through the box is priced, saved and drawn exactly as if it had been done in the left
 * panel, and the left panel shows it. Everything here only exists on the build page (BuildHost hands the program's window
 * over); without it the box is today's View box.
 *
 * DOM objects come from the program's iframe (another realm): never `instanceof HTMLSelectElement` — tag names only.
 */
import { create } from 'zustand';

/** The program's wall keys (Section 5 WALLS). Left / Right = as seen from the FRONT of the building (the program's names). */
export type PWall = 'front' | 'back' | 'left' | 'right' | 'partition';

interface BridgeState {
  /** The pricing program's window (build page only). */
  win: Window | null;
  /** Bumped whenever the program may have changed (its rc() pass, the 800 ms poll, a box action). */
  tick: number;
  /** Bumped when a wall is picked on the 3D model: the box comes up on its View page, at that wall. */
  wallPickNonce: number;
  setWin: (win: Window | null) => void;
  bump: () => void;
  wallPicked: () => void;
}

export const useProgramBridge = create<BridgeState>((set) => ({
  win: null,
  tick: 0,
  wallPickNonce: 0,
  setWin: (win) => set({ win }),
  bump: () => set((s) => ({ tick: s.tick + 1 })),
  wallPicked: () => set((s) => ({ wallPickNonce: s.wallPickNonce + 1 })),
}));

/** Re-read the program now and once more after its own deferred refresh (Section 5 repaints on a 0 ms timer). */
export function bumpSoon() {
  const b = useProgramBridge.getState().bump;
  b();
  setTimeout(b, 60);
}

const tag = (el: Element | null | undefined) => (el ? el.tagName : '');
const txt = (el: Element | null | undefined) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// ─────────────────────────────── walls: the 3D model ↔ the program ───────────────────────────────

/**
 * The program wall under a click on the 3D model, or null (the roof). World axes (engine/geometry.ts): X = width
 * (-W/2..W/2), Z = length, FRONT at z = -L/2; the 3D's internal 'left' wall is at -X, which the program calls the RIGHT
 * eave (BuildHost SIDE_MAP: left / right are named as seen from the front). A hit outside the main footprint is a lean-to
 * — it picks the wall that lean-to hangs on (its card is listed there). On the footprint, the face's horizontal normal
 * says side vs end; its sign is taken from the hit point, so a face seen from either side gives the same wall.
 */
export function wallFromHit(
  p: { x: number; z: number },
  n: { x: number; y: number; z: number },
  widthFt: number,
  lengthFt: number,
): PWall | null {
  if (!(widthFt > 0) || !(lengthFt > 0)) return null;
  if (Math.abs(n.y) > 0.6) return null; // roof / overhang
  const m = 0.25;
  const outX = Math.abs(p.x) > widthFt / 2 + m;
  const outZ = Math.abs(p.z) > lengthFt / 2 + m;
  const side = outX !== outZ ? outX : Math.abs(n.x) >= Math.abs(n.z);
  if (side) return p.x < 0 ? 'right' : 'left';
  return p.z < 0 ? 'front' : 'back';
}

/** The program wall a camera preset looks at (the program's WALLS .cam, the other way round). */
export const WALL_OF_CAMERA: Partial<Record<string, PWall>> = { front: 'front', back: 'back', left: 'right', right: 'left' };

// ─────────────────────────────── Section 5: walls, adds, items ───────────────────────────────

export interface WallTile {
  k: PWall;
  label: string; // "Front gable"
  sub: string; // "Empty" / "2 roll-ups"
  picked: boolean;
}
export interface AddKind {
  kind: string; // re / we / ne / lte / ace
  label: string; // "Roll-up door"
  disabled: boolean;
  title: string;
}
export interface WallItem {
  el: HTMLElement;
  kind: string;
  kindLabel: string; // "Roll-up" / "Lean-to · free-standing"
  title: string; // "10′ × 10′ roll-up"
  sub: string;
  price: string; // "$1,850" (the program's line price), '' when it shows none
  flagged: boolean; // the card is red in the left panel (doesn't fit, not priced ...)
}

const s5 = (doc: Document) => doc.getElementById('s5-sec');

/** Section 5's wall tiles (only the ones it shows), or null when the program has no Section 5. */
export function readWalls(doc: Document): WallTile[] | null {
  const sec = s5(doc);
  if (!sec) return null;
  return Array.from(sec.querySelectorAll<HTMLElement>('.s5-tile'))
    .filter((t) => !t.hidden)
    .map((t) => ({
      k: t.dataset.wall as PWall,
      label: txt(t.querySelector('.s5-tl')),
      sub: txt(t.querySelector('.s5-ts')),
      picked: t.getAttribute('aria-checked') === 'true',
    }));
}

export function pickedWall(doc: Document): PWall | null {
  const w = readWalls(doc);
  const p = w && w.find((t) => t.picked);
  return p ? p.k : null;
}

/** Section 5's add buttons for the picked wall (a lean-to can't go on the partition: the program disables it). */
export function readAdds(doc: Document): AddKind[] {
  const sec = s5(doc);
  if (!sec) return [];
  return Array.from(sec.querySelectorAll<HTMLButtonElement>('.s5-add')).map((b) => ({
    kind: b.dataset.kind || '',
    label: txt(b).replace(/^\+\s*/, ''),
    disabled: !!b.disabled,
    title: b.title || '',
  }));
}

/** Every item the program lists on a wall, in its own order. */
export function readItems(doc: Document, wall: PWall): WallItem[] {
  const out: WallItem[] = [];
  doc.querySelectorAll<HTMLElement>('.s5-card').forEach((el) => {
    if (!el.classList.contains('s5-w-' + wall)) return;
    const h = el.querySelector(':scope > .s5-ch');
    const pr = h ? (h.querySelector('.s5-price') as HTMLElement | null) : null;
    out.push({
      el,
      kind: ((el as unknown as { __s5?: { k?: string } }).__s5 || {}).k || '',
      kindLabel: txt(h && h.querySelector('.s5-kind')),
      title: txt(h && h.querySelector('.s5-title')),
      sub: txt(h && h.querySelector('.s5-sub')),
      price: pr && !pr.hidden ? txt(pr) : '',
      flagged: el.classList.contains('s5-flag'),
    });
  });
  return out;
}

/** The card's own header, for the box's edit view. */
export function readItem(el: HTMLElement): WallItem | null {
  if (!el.isConnected) return null;
  const doc = el.ownerDocument;
  for (const w of ['front', 'back', 'left', 'right', 'partition'] as PWall[]) {
    const f = readItems(doc, w).find((i) => i.el === el);
    if (f) return f;
  }
  const h = el.querySelector(':scope > .s5-ch');
  const pr = h ? (h.querySelector('.s5-price') as HTMLElement | null) : null;
  return {
    el,
    kind: ((el as unknown as { __s5?: { k?: string } }).__s5 || {}).k || '',
    kindLabel: txt(h && h.querySelector('.s5-kind')),
    title: txt(h && h.querySelector('.s5-title')),
    sub: txt(h && h.querySelector('.s5-sub')),
    price: pr && !pr.hidden ? txt(pr) : '',
    flagged: el.classList.contains('s5-flag'),
  };
}

/** Pick a wall: Section 5's tile (the program sets its wall and turns the 3D to it). */
export function pickWall(doc: Document, k: PWall): boolean {
  const t = s5(doc)?.querySelector<HTMLElement>('.s5-tile[data-wall="' + k + '"]');
  if (!t || t.hidden) return false;
  t.click();
  bumpSoon();
  return true;
}

/**
 * Add to the picked wall: Section 5's own add button. Returns the new entry, or (when the program refused it: no room
 * on the wall) its own message from the toast it just showed.
 */
export function addKind(doc: Document, kind: string): { el: HTMLElement | null; reason: string } {
  const b = s5(doc)?.querySelector<HTMLButtonElement>('.s5-add[data-kind="' + kind + '"]');
  if (!b || b.disabled) return { el: null, reason: '' };
  const sel = '.' + kind + '.entry';
  const before = doc.querySelectorAll(sel).length;
  const t = doc.getElementById('toast');
  if (t) t.className = 'toast'; // a message still up from before is not this add's
  b.click();
  const list = doc.querySelectorAll<HTMLElement>(sel);
  bumpSoon();
  if (list.length > before) return { el: list[list.length - 1], reason: '' };
  return { el: null, reason: t && t.classList.contains('show') ? txt(t) : '' };
}

/** "Open its card": the card's own header (the program opens it, folds the others and scrolls it into view). */
export function openCard(el: HTMLElement) {
  const chb = el.querySelector<HTMLElement>(':scope > .s5-ch .s5-chb');
  if (chb && !el.classList.contains('s5-open')) chb.click();
  else el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  bumpSoon();
}

/** Remove: the card's own × (else the program's remove button). */
export function removeItem(el: HTMLElement) {
  const x = el.querySelector<HTMLElement>(':scope > .s5-ch .s5-x') || el.querySelector<HTMLElement>(':scope > .rm');
  if (x) x.click();
  bumpSoon();
}

// ─────────────────────────────── the mirror: a card's (or a section's) real fields ───────────────────────────────

export type Ctl =
  | { t: 'select'; el: HTMLSelectElement; value: string; options: { value: string; text: string; disabled: boolean }[] }
  | { t: 'input'; el: HTMLInputElement | HTMLTextAreaElement; type: string; value: string; placeholder: string; min: string; max: string; step: string }
  | { t: 'check'; el: HTMLInputElement; checked: boolean; text: string }
  | { t: 'button'; el: HTMLButtonElement; text: string; active: boolean; disabled: boolean }
  | { t: 'text'; text: string };

export type MirrorItem =
  | { t: 'row'; key: string; label: string; ctls: Ctl[] }
  | { t: 'note'; key: string; text: string; bad: boolean }
  | { t: 'head'; key: string; text: string; rm: HTMLButtonElement | null };

const ROW = '.row, .pos-row, .crow';
const NOTE = '#hi-impact-note, .enote, .anote, .ovl-warn, .lt-conn-note, .lt-price-note, .lt-stor-note, .lt-sensei-note, .fo-sf-incl-note, .lt-acc-warn, .lt-acc-pwarn, .lt-acc-fitwarn';
const NESTED = '.lt-acc-e';
// a clickable span / link (the lean-to's Open / Fully Enclosed / Custom; a note's 'reapply' link) acts as a button
const CLICKABLE = '[onclick]:not(select):not(input):not(textarea):not(button)';
const ANCHORS = 'select, input, textarea, button, .av, ' + CLICKABLE + ', ' + NESTED + ', ' + NOTE;

let keySeq = 0;
const KEYS = new WeakMap<Element, string>();
/** A steady React key for a program element. */
export const keyOf = (el: Element) => {
  let k = KEYS.get(el);
  if (!k) KEYS.set(el, (k = 'm' + ++keySeq));
  return k;
};

/** Shown inside `root` — every element between it and root (root itself excluded: a folded / filtered card is read anyway). */
function shownIn(el: Element, root: Element): boolean {
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    if ((n as HTMLElement).hidden) return false;
    if (view) {
      const cs = view.getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
  }
  return true;
}

/**
 * Read a folded Section 5 card as if it were open — and the openings folded inside a lean-to card (Section 5's
 * s5lt-acc-open) — the classes are put back before anything paints.
 */
function asOpen<T>(root: Element, fn: () => T): T {
  const fold = root.classList.contains('s5-card') && !root.classList.contains('s5-open');
  const inner = Array.from(root.querySelectorAll('.lt-acc-e.entry:not(.s5lt-acc-open)'));
  if (fold) root.classList.add('s5-open');
  inner.forEach((n) => n.classList.add('s5lt-acc-open'));
  try {
    return fn();
  } finally {
    if (fold) root.classList.remove('s5-open');
    inner.forEach((n) => n.classList.remove('s5lt-acc-open'));
  }
}

/** Section 5's own decorations (fold headers, its notes toggle, the wall proxy): not program fields. */
const isS5 = (el: Element) => Array.from(el.classList).some((c) => /^s5/.test(c));

const labelOf = (row: Element) => txt(row.querySelector(':scope > label')).replace(/:\s*$/, '');

function ctlOf(el: Element): Ctl | null {
  const t = tag(el);
  if (t === 'SELECT') {
    const s = el as HTMLSelectElement;
    const options = Array.from(s.options)
      .filter((o) => o.selected || (!o.hidden && o.style.display !== 'none'))
      .map((o) => ({ value: o.value, text: txt(o) || o.value, disabled: o.disabled }));
    return { t: 'select', el: s, value: s.value, options };
  }
  if (t === 'INPUT') {
    const i = el as HTMLInputElement;
    const type = (i.type || 'text').toLowerCase();
    if (type === 'hidden') return null;
    if (type === 'checkbox') {
      const next = i.nextElementSibling;
      return { t: 'check', el: i, checked: i.checked, text: next && tag(next) === 'SPAN' ? txt(next) : '' };
    }
    return { t: 'input', el: i, type, value: i.value, placeholder: i.placeholder || '', min: i.min || '', max: i.max || '', step: i.step || '' };
  }
  if (t === 'TEXTAREA') {
    const a = el as HTMLTextAreaElement;
    return { t: 'input', el: a, type: 'textarea', value: a.value, placeholder: a.placeholder || '', min: '', max: '', step: '' };
  }
  if (t === 'BUTTON') {
    const b = el as HTMLButtonElement;
    return { t: 'button', el: b, text: txt(b), active: b.classList.contains('active'), disabled: !!b.disabled };
  }
  if (el.matches(CLICKABLE)) {
    if (el.querySelector('select, input, textarea, button')) return null; // a clickable box of controls: its controls are listed
    // picked = the row's hidden value is the one this choice sets (the lean-to's ltWMClick(this,'open') + .lt-wm)
    const row = el.closest(ROW);
    const hid = row ? (row.querySelector('input[type="hidden"]') as HTMLInputElement | null) : null;
    const on = !!hid && !!hid.value && (el.getAttribute('onclick') || '').indexOf("'" + hid.value + "'") >= 0;
    return { t: 'button', el: el as unknown as HTMLButtonElement, text: txt(el), active: on, disabled: false };
  }
  return { t: 'text', text: txt(el) };
}

/**
 * The fields a rep sees in `root` (a Section 5 card, or a program section), in the left panel's order: one row per
 * labelled row (its controls side by side), the program's visible notes / warnings, and a heading (with its own remove)
 * for each opening inside a lean-to. `skip` = controls the caller shows its own way (e.g. the wall dropdown).
 */
export function mirror(root: Element, skip: (el: Element) => boolean = () => false): MirrorItem[] {
  return asOpen(root, () => {
    const out: MirrorItem[] = [];
    const rows = new Map<Element, Extract<MirrorItem, { t: 'row' }>>();
    let nested = 0;
    root.querySelectorAll(ANCHORS).forEach((el) => {
      if (el.closest('.s5-ch') || isS5(el)) return; // the card header (title, wall proxy, ×) / Section 5's own buttons
      if (skip(el)) return;
      if (!shownIn(el, root)) return;
      if (el.matches(NESTED)) {
        nested++;
        const ty = el.querySelector('select');
        const tyText = ty ? txt((ty as HTMLSelectElement).options[(ty as HTMLSelectElement).selectedIndex]) : '';
        const rm = el.querySelector<HTMLButtonElement>(':scope > .rm');
        out.push({ t: 'head', key: keyOf(el), text: 'Opening ' + nested + (tyText ? ' · ' + tyText : ''), rm });
        return;
      }
      if (el.matches(NOTE)) {
        if (el.querySelector('select, input, button')) return; // a box of controls, not a note
        const s = txt(el);
        if (!s) return;
        out.push({ t: 'note', key: keyOf(el), text: s.replace(/^⚠\s*/, ''), bad: /⚠/.test(s) || /warn/.test((el as HTMLElement).className) });
        return;
      }
      if (tag(el) === 'BUTTON' && (el.classList.contains('rm') || el.classList.contains('s5-layout'))) return;
      const c = ctlOf(el);
      if (!c) return;
      const row = el.closest(ROW);
      if (row && root.contains(row)) {
        let r = rows.get(row);
        if (!r) {
          r = { t: 'row', key: keyOf(row), label: labelOf(row), ctls: [] };
          rows.set(row, r);
          out.push(r);
        }
        r.ctls.push(c);
      } else {
        // no labelled row: the text beside it ("Lean-To Doors & Windows" + its "+ Add"), else its own tooltip
        const side = el.parentElement
          ? Array.from(el.parentElement.children).filter((n) => n !== el && tag(n) === 'SPAN' && !n.querySelector('select, input, button')).map(txt).join(' ')
          : '';
        out.push({ t: 'row', key: keyOf(el), label: side || (el as HTMLElement).title || el.getAttribute('aria-label') || '', ctls: [c] });
      }
    });
    return out;
  });
}

// ─────────────────────────────── writing: exactly what a rep's action fires ───────────────────────────────

/** A dropdown pick (the browser fires input + change). */
export function setSelect(el: HTMLSelectElement, value: string) {
  if (el.value === value) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  afterWrite();
}
/** Typing (input on every keystroke; change when the field is left — commitInput). */
export function typeInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  if (el.value === value) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  afterWrite();
}
export function commitInput(el: HTMLInputElement | HTMLTextAreaElement) {
  el.dispatchEvent(new Event('change', { bubbles: true }));
  afterWrite();
}
/** A checkbox / button: the program's own click. */
export function press(el: HTMLElement) {
  el.click();
  afterWrite();
}
function afterWrite() {
  try {
    const sync = (window as unknown as { __ssSync?: () => void }).__ssSync;
    if (typeof sync === 'function') sync(); // colours change without a pricing pass: draw them now
  } catch {
    /* ignore */
  }
  bumpSoon();
}

// ─────────────────────────────── colours + client: the program's own sections ───────────────────────────────

export interface ColorPick {
  id: string; // cr / cw / ct / cwn
  label: string;
  el: HTMLSelectElement;
  value: string;
  options: { value: string; name: string; code: string }[]; // value = the swatch hex (or TBD)
}

/** Section 11's colour dropdowns that are showing (the wainscot colour only once wainscot is on). */
export function readColors(doc: Document): { picks: ColorPick[]; wainscot: HTMLInputElement | null } | null {
  const first = doc.getElementById('cr');
  const sec = first && first.closest('.sec');
  if (!sec) return null;
  const picks: ColorPick[] = [];
  for (const [id, label] of [
    ['cr', 'Roof'],
    ['cw', 'Walls'],
    ['ct', 'Trim'],
    ['cwn', 'Wainscot'],
  ] as const) {
    const el = doc.getElementById(id) as HTMLSelectElement | null;
    if (!el || tag(el) !== 'SELECT' || !shownIn(el, sec)) continue;
    picks.push({
      id,
      label,
      el,
      value: el.value,
      options: Array.from(el.options)
        .filter((o) => o.value && !o.hidden && o.style.display !== 'none')
        .map((o) => {
          const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(txt(o));
          return { value: o.value, name: m ? m[1] : txt(o), code: m ? m[2] : '' };
        }),
    });
  }
  const wc = doc.getElementById('wain-cb') as HTMLInputElement | null;
  return { picks, wainscot: wc && shownIn(wc, sec) ? wc : null };
}

/** Section 1 (Client Information): the program's own rows. */
export function clientSection(doc: Document): Element | null {
  const cn = doc.getElementById('cn');
  return cn ? cn.closest('.sec') : null;
}
