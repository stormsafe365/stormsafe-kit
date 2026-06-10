/**
 * BuildHost — the side-by-side "price + 3D" shell for the merge.
 *
 * LEFT:  your validated quote-builder program, untouched, in an iframe. It stays
 *        the single source of truth for price, notes, rules, and PDFs.
 * RIGHT: the live 3D model, driven from what you configure on the left.
 *
 * The bridge READS the program's input fields (same-origin, same approach the
 * CRM already uses) and drives the 3D store. It does NOT modify the program or
 * its pricing — it only listens. We hook the program's `rc()` recalc so the 3D
 * updates the instant anything changes, with a slow poll as a safety net.
 *
 * A fresh quote starts with a BARE building (no doors/windows) — components are
 * drawn in as you add them on the left.
 */

import { useEffect, useRef } from 'react';
import { Viewport } from '@/components/Viewport';
import { useBuildingStore } from '@/store/useBuildingStore';
import { useEditorStore } from '@/store/useEditorStore';
import type { BuildingType, OpeningType, WallSide } from '@/types/building';

/** Map the program's btype → the 3D building family. */
const TYPE_MAP: Record<string, BuildingType> = {
  carport: 'carport',
  gch: 'utility',
  standard: 'garage',
  widespan: 'garage',
};

/**
 * Program's location dropdown → 3D wall side.
 * Left/Right are defined as viewed from the FRONT of the building. The 3D
 * convention renders the internal 'left' wall on screen-RIGHT (-X) and 'right'
 * on screen-LEFT (+X) in the front view, so a program "Left Eave Side" must map
 * to the internal 'right' wall to actually appear on the viewer's left — and
 * vice versa. (This matches the Left/Right-eave lean-to convention.)
 */
const SIDE_MAP: Record<string, WallSide> = {
  'Front Gable End': 'front',
  'Back Gable End': 'back',
  'Left Eave Side': 'right',
  'Right Eave Side': 'left',
  'Partition Wall': 'partition',
};

/**
 * Inject a "Partition Wall" location option into the component dropdowns for GCH
 * builds — done at runtime from the bridge so the program file is untouched. A
 * partition door prices like a gable-end door (the program adds no eave header
 * for a non-eave location), and the 3D renders it on the divider plane. Removed
 * (and any selection reset) when the build isn't a GCH.
 */
function ensurePartitionOption(win: BuilderWindow) {
  const G = win.G;
  if (typeof G !== 'function') return;
  const isGCH = (G('btype')?.value || '') === 'gch';
  win.document.querySelectorAll('.rloc, .wloc, .nloc, .fo-loc').forEach((node) => {
    const sel = node as HTMLSelectElement;
    const existing = Array.from(sel.options).find((o) => o.value === 'Partition Wall');
    if (isGCH && !existing) {
      const opt = win.document.createElement('option');
      opt.value = 'Partition Wall';
      opt.textContent = 'Partition Wall';
      sel.appendChild(opt);
    } else if (!isGCH && existing) {
      const wasSelected = sel.value === 'Partition Wall';
      existing.remove();
      if (wasSelected) {
        sel.value = sel.options[0]?.value || 'Front Gable End';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
}

/** getPosItems item.type → 3D opening type. */
const OTYPE_MAP: Record<string, OpeningType> = {
  rollup: 'rollUpDoor',
  wtd: 'walkDoor',
  win: 'window',
  fo: 'frameOut',
};

interface DesiredOpening {
  type: OpeningType;
  side: WallSide;
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  /** Panel color (hex) for the unit — e.g. a CCI colored roll-up door. */
  color?: string;
  /** Source program entry + item index — lets a 3D drag write back to the program. */
  entry: Element;
  itemIndex: number;
}

/**
 * Read the program's doors/windows and compute their 3D placement by calling
 * the program's OWN positioning function (getPosItems) — so the 3D mirrors
 * exactly where the program puts them. Eave sides use building length as the
 * face width; gable ends use building width.
 */
function readOpenings(
  win: Window & {
    G?: (id: string) => HTMLInputElement | null;
    getPosItems?: (el: Element, qty: number, itemW: number, faceW: number, itemH: number, type: string, extraH?: number) => Array<{ x: number; w: number; h: number; yo?: number }>;
    /** Active manufacturer config — used to resolve a roll-up door color key → hex. */
    MFR?: () => { rudColors?: Array<{ v: string; hex: string }> };
    document: Document;
  },
  W: number,
  L: number,
): DesiredOpening[] {
  const getPos = win.getPosItems;
  if (typeof getPos !== 'function' || !W || !L) return [];
  const out: DesiredOpening[] = [];
  const faceFor = (loc: string) => (loc === 'Left Eave Side' || loc === 'Right Eave Side' ? L : W);
  const qv = (el: Element, sel: string, d: number) => {
    const e = el.querySelector(sel) as HTMLInputElement | null;
    const n = e ? parseInt(e.value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const lv = (el: Element, sel: string) => {
    const e = el.querySelector(sel) as HTMLInputElement | null;
    return e ? String(e.value || '') : '';
  };

  const push = (el: Element, loc: string, qty: number, itemW: number, itemH: number, type: string, extraH?: number, color?: string) => {
    const side = SIDE_MAP[loc];
    if (!side) return;
    const face = faceFor(loc);
    const items = getPos(el, qty, itemW, face, itemH, type, extraH);
    items.forEach((it, i) => {
      const center = it.x + it.w / 2; // centerline from the program's frame edge
      // The LEFT eave and BACK gable are the "far" walls — viewed from the
      // opposite side, so their position-along-the-wall is mirrored vs the
      // program's frame. This is about the OFFSET (length axis), independent of
      // which X-side wall, so key it off the program LOCATION — not `side`,
      // which is now swapped above for the screen left/right convention.
      const mirror = loc === 'Left Eave Side' || loc === 'Back Gable End';
      const offset = mirror ? face - center : center;
      out.push({
        type: OTYPE_MAP[type] ?? 'frameOut',
        side,
        offset,
        width: it.w,
        height: it.h,
        sillHeight: it.yo ?? 0,
        color,
        entry: el,
        itemIndex: i,
      });
    });
  };

  // Resolve a roll-up door's color key (.rco, CCI only) to its hex via the
  // program's own MFR().rudColors table — so the 3D door matches the quote's
  // chosen color instead of defaulting to the building/wall color.
  const rudHex = (el: Element): string | undefined => {
    const key = lv(el, '.rco');
    if (!key) return undefined;
    const table = win.MFR ? win.MFR().rudColors : undefined;
    const found = table?.find((c) => c.v === key);
    return found?.hex;
  };

  win.document.querySelectorAll('.re').forEach((el) => {
    const sz = (lv(el, '.rsz') || '10x8').split('x');
    push(el, lv(el, '.rloc'), qv(el, '.rqt', 1), parseFloat(sz[0]) || 10, parseFloat(sz[1]) || 8, 'rollup', undefined, rudHex(el));
  });
  win.document.querySelectorAll('.we').forEach((el) => {
    push(el, lv(el, '.wloc'), qv(el, '.wqt', 1), 3, 6.67, 'wtd');
  });
  win.document.querySelectorAll('.ne').forEach((el) => {
    push(el, lv(el, '.nloc'), qv(el, '.nqt', 1), 2.5, 2.5, 'win', 4.16667); // window sill 4'-2"
  });

  // Framed openings (in "Additional Components" / .ace): only entries whose
  // component is a "Framed Opening" with a visible wall-location row. Size +
  // sill mirror the program's own logic (builder lines 6075–6096).
  const fnum = (el: Element, sel: string) => {
    const e = el.querySelector(sel) as HTMLInputElement | null;
    const n = e ? parseFloat(e.value) : NaN;
    return Number.isFinite(n) ? n : NaN;
  };
  win.document.querySelectorAll('.ace').forEach((el) => {
    const comp = lv(el, '.act');
    if (comp.indexOf('Framed Opening') < 0) return;
    const locRow = el.querySelector('.fo-loc-row');
    if (!locRow || locRow.classList.contains('hidden')) return;
    const loc = lv(el, '.fo-loc');
    const qty = qv(el, '.acq', 1);
    let foW = 2.5;
    let foH = 2.5;
    let foYo = 4.16667; // window sill 4'-2"
    if (comp.indexOf('(Custom Size)') >= 0) {
      foW = fnum(el, '.fo-cw') || 10;
      foH = fnum(el, '.fo-ch') || 8;
      foYo = comp.indexOf('Window') >= 0 ? 4.16667 : 0;
    } else if (comp.indexOf('Garage Door') >= 0 || comp.indexOf('Side Opening') >= 0) {
      const m = comp.match(/(\d+)' Wide/);
      foW = m ? parseInt(m[1], 10) : 10;
      foH = 8;
      foYo = 0;
    } else if (comp.indexOf('Double Door') >= 0) {
      foW = 6;
      foH = 6.67;
      foYo = 0;
    } else if (comp.indexOf('Walk-Through') >= 0) {
      foW = 3;
      foH = 6.67;
      foYo = 0;
    }
    push(el, loc, qty, foW, foH, 'fo', foYo);
  });

  return out;
}

const TYPE_LABEL: Record<BuildingType, string> = {
  garage: 'Garage',
  carport: 'Carport',
  utility: 'Garage-Carport Hybrid',
};

type BuilderWindow = Window & {
  G?: (id: string) => HTMLInputElement | null;
  getPosItems?: (el: Element, qty: number, itemW: number, faceW: number, itemH: number, type: string, extraH?: number) => Array<{ x: number; w: number; h: number; yo?: number }>;
  /** Program's authoritative truss spacing/count (so the 3D mirrors the quote exactly). */
  getTrussInfo?: () => { spacing: number; count: number } | null;
  rc?: (...a: unknown[]) => unknown;
  updatePosSection?: (entry: Element, qty: number, label?: string) => void;
  __ssWrapped?: boolean;
  __ssViewHooked?: boolean;
  __ssOpenSig?: string;
  __ssOpenMap?: Record<string, { entry: Element; itemIndex: number; side: WallSide; width: number }>;
  __ssLeanToSig?: string;
  /** Lean-to opening id → its source accessory entry + item index, for drag writeback. */
  __ssLeanToOpenMap?: Record<string, { entry: Element; itemIndex: number; width: number }>;
};

/**
 * Write a 3D drag back into the program: convert the opening's 3D centerline to
 * the program's "from-edge" position and set the entry's position inputs + side
 * toggles. The reverse of readOpenings' mapping → round-trips exactly:
 *   program pos = centerline − width/2 ; side = 'right' on back gable, else 'left'.
 *
 * To keep multi-quantity rows stable, ALL items in the dragged entry are frozen
 * to their current 3D positions (written explicitly) — so moving one no longer
 * re-auto-spaces its siblings. Positions snap to the nearest inch (exact enough
 * for a quote; matches what the drag shows).
 */
function writeBackDrag(win: BuilderWindow, id: string | null) {
  const map = win.__ssOpenMap;
  if (!id || !map || !map[id]) return;
  const { entry, side } = map[id];

  // Every opening sourced from this same entry (one row may hold several items).
  const siblings = Object.keys(map)
    .map((oid) => ({ oid, ...map[oid] }))
    .filter((m) => m.entry === entry)
    .sort((a, b) => a.itemIndex - b.itemIndex);
  if (!siblings.length) return;

  let rows = entry.querySelectorAll('.pos-section .pos-row');
  if (rows.length < siblings.length && typeof win.updatePosSection === 'function') {
    win.updatePosSection(entry, siblings.length);
    rows = entry.querySelectorAll('.pos-section .pos-row');
  }

  const openings = useBuildingStore.getState().openings;
  const targetSide = side === 'back' ? 'right' : 'left'; // uniform per wall
  let wrote = false;
  for (const sib of siblings) {
    const op = openings.find((o) => o.id === sib.oid);
    const row = rows[sib.itemIndex];
    if (!op || !row) continue;
    const pos = Math.max(0, Math.round((op.offset - op.width / 2) * 12) / 12); // nearest inch
    const input = row.querySelector('input') as HTMLInputElement | null;
    if (input) input.value = String(Number(pos.toFixed(3))); // tidy "4.333" not "4.33333333"
    row.querySelectorAll('.pos-toggle button').forEach((b) => {
      const btn = b as HTMLElement;
      btn.classList.toggle('active', btn.dataset.side === targetSide);
    });
    wrote = true;
  }
  if (wrote && typeof win.rc === 'function') win.rc();
}

/**
 * Write a lean-to opening 3D drag back into the program. Switches the source
 * accessory row to explicit "Custom offset" mode and freezes ALL its items to
 * their current 3D positions (so a multi-qty row doesn't re-auto-space), then
 * reprices. Program offset = centerline − width/2 (round-trips readLeanTos).
 */
function writeBackLeanToOpening(win: BuilderWindow, id: string | null) {
  const map = win.__ssLeanToOpenMap;
  if (!id || !map || !map[id]) return;
  const { entry } = map[id];

  const siblings = Object.keys(map)
    .map((oid) => ({ oid, ...map[oid] }))
    .filter((m) => m.entry === entry)
    .sort((a, b) => a.itemIndex - b.itemIndex);
  if (!siblings.length) return;

  const allOpenings = useBuildingStore.getState().leanTos.flatMap((lt) => lt.openings ?? []);
  const fns = win as unknown as { updLTAccPos?: (el: Element) => void; rebuildLTAccOffsets?: (el: Element) => void };

  // Switch the row to explicit custom offsets and (re)build the per-item inputs.
  const posEl = entry.querySelector('.lt-acc-pos') as HTMLSelectElement | null;
  if (posEl && posEl.value !== 'offset') {
    posEl.value = 'offset';
    if (typeof fns.updLTAccPos === 'function') fns.updLTAccPos(posEl);
  }
  if (typeof fns.rebuildLTAccOffsets === 'function') fns.rebuildLTAccOffsets(entry);
  const offEls = Array.from(entry.querySelectorAll('.lt-acc-off')) as HTMLInputElement[];

  let wrote = false;
  for (const sib of siblings) {
    const op = allOpenings.find((o) => o.id === sib.oid);
    const input = offEls[sib.itemIndex];
    if (!op || !input) continue;
    const pos = Math.max(0, Math.round((op.offsetFt - op.widthFt / 2) * 12) / 12); // nearest inch
    input.value = String(Number(pos.toFixed(3)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    wrote = true;
  }
  if (wrote && typeof win.rc === 'function') win.rc();
}

/**
 * Read the program's lean-to entries and sync them to the 3D store.
 * Lean-to entries have class `.lte` and contain:
 *   - `.lt-type` = type (attached/freestanding)
 *   - `.lt-side` = attached side (Left Eave, Right Eave, Front Gable, Back Gable)
 *   - `.ltw` = width (ft)
 *   - `.ltl2` = length (ft)
 *   - `.lth` = low leg height (ft, for attached)
 *   - `.lt-tall-h` = tall leg height (ft, for attached slope)
 *   - `.ltp` = roof pitch (e.g., "2:12", "3:12")
 *   - `.lt-wm` = wall mode / enclosure (open/enclosed/custom)
 */
function readLeanTos(win: Window & { document: Document }): Array<{
  type: 'attached' | 'freestanding';
  attachedSide?: 'Left Eave' | 'Right Eave' | 'Front Gable' | 'Back Gable';
  widthFt: number;
  lengthFt: number;
  lowLegHeightFt: number;
  tallLegHeightFt?: number;
  roofPitch: string;
  enclosure: 'open' | 'enclosed' | 'custom';
  customWalls?: { front: string; back: string; side: string };
  openings?: Array<{ id: string; type: string; wall: string; widthFt: number; heightFt: number; sillFt: number; offsetFt: number }>;
}> {
  const out: Array<{
    type: 'attached' | 'freestanding';
    attachedSide?: 'Left Eave' | 'Right Eave' | 'Front Gable' | 'Back Gable';
    widthFt: number;
    lengthFt: number;
    lowLegHeightFt: number;
    tallLegHeightFt?: number;
    roofPitch: string;
    enclosure: 'open' | 'enclosed' | 'custom';
    customWalls?: { front: string; back: string; side: string };
    openings?: Array<{ id: string; type: string; wall: string; widthFt: number; heightFt: number; sillFt: number; offsetFt: number }>;
  }> = [];

  const strVal = (el: Element, sel: string) => {
    const e = el.querySelector(sel) as HTMLInputElement | null;
    return e ? String(e.value || '') : '';
  };
  const numVal = (el: Element, sel: string, d = 0) => {
    const e = el.querySelector(sel) as HTMLInputElement | null;
    const n = e ? parseFloat(e.value) : NaN;
    return Number.isFinite(n) ? n : d;
  };

  const ltOpenMap: NonNullable<BuilderWindow['__ssLeanToOpenMap']> = {};

  win.document.querySelectorAll('.lte').forEach((el, ltIndex) => {
    const typeStr = strVal(el, '.lt-type');
    const type = (typeStr === 'freestanding' ? 'freestanding' : 'attached') as 'attached' | 'freestanding';

    const widthFt = numVal(el, '.ltw');
    const lengthFt = numVal(el, '.ltl2');
    const lowHeightFt = numVal(el, '.lth', 8);
    const tallHeightFt = numVal(el, '.lt-tall-h', 10);
    const roofPitchStr = strVal(el, '.ltp') || '2:12';
    const enclosureStr = strVal(el, '.lt-wm') || 'open'; // .lt-wm = lean-to wall mode (open/enclosed/custom)
    const enclosure = (['open', 'enclosed', 'custom'].includes(enclosureStr) ? enclosureStr : 'open') as 'open' | 'enclosed' | 'custom';

    // Only add if it has dimensions
    if (!widthFt || !lengthFt) return;

    const sideStr = strVal(el, '.lts') || 'Left Eave'; // .lts = Attached Side selector
    const validSides = ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable'];
    const attachedSide = (validSides.includes(sideStr) ? sideStr : 'Left Eave') as 'Left Eave' | 'Right Eave' | 'Front Gable' | 'Back Gable';

    // Read custom wall settings (only when enclosure === 'custom')
    const customFront = strVal(el, '.lt-wall-front') || 'open';
    const customBack = strVal(el, '.lt-wall-back') || 'open';
    const customSide = strVal(el, '.lt-wall-side') || 'open';
    const customWalls = enclosure === 'custom' ? { front: customFront, back: customBack, side: customSide } : undefined;

    // ── Lean-to accessories (doors / windows / roll-ups) → openings ──
    // Each `.lt-acc-e` entry: type + size + which wall + position + quantity.
    const ltOpenings: Array<{ id: string; type: string; wall: string; widthFt: number; heightFt: number; sillFt: number; offsetFt: number }> = [];
    el.querySelectorAll('.lt-acc-e').forEach((ae, accIndex) => {
      const t = strVal(ae, '.lt-acc-type');
      const oType = t === 'wtd' ? 'walkDoor' : t === 'win' ? 'window' : t === 'frameout' ? 'frameOut' : 'rollUpDoor';
      const locStr = strVal(ae, '.lt-acc-loc');
      const wall = ['outer', 'front', 'back'].includes(locStr) ? locStr : 'outer';
      const qty = Math.max(1, Math.min(3, parseInt(strVal(ae, '.lt-acc-qty'), 10) || 1));
      const pos = strVal(ae, '.lt-acc-pos') || 'auto';
      let w = 9, h = 8, sill = 0;
      if (oType === 'rollUpDoor') {
        const sz = (strVal(ae, '.lt-acc-size') || '9x8').toLowerCase().split('x');
        w = parseFloat(sz[0]) || 9;
        h = parseFloat(sz[1]) || 8;
      } else if (oType === 'walkDoor') {
        w = 3; h = 6.67; sill = 0;
      } else if (oType === 'window') {
        w = 2.5; h = 2.5; sill = 4.16667; // window sill 4'-2"
      } else {
        // frameOut — custom W×H from the entry; a real cut you can see through.
        w = parseFloat(strVal(ae, '.lt-acc-fo-w')) || 10;
        h = parseFloat(strVal(ae, '.lt-acc-fo-h')) || 10;
        sill = 0;
      }
      // Wall the opening sits on determines the run length it's positioned along.
      const wallLen = wall === 'outer' ? lengthFt : widthFt;
      const offEls = Array.from(ae.querySelectorAll('.lt-acc-off')) as HTMLInputElement[];
      for (let i = 0; i < qty; i++) {
        let center: number;
        if (pos === 'offset' && offEls[i]) center = (parseFloat(offEls[i].value) || 0) + w / 2;
        else if (pos === 'center' && qty === 1) center = wallLen / 2;
        else if (pos === 'left') center = w / 2 + 1 + i * (w + 1.5);
        else if (pos === 'right') center = wallLen - (w / 2 + 1) - i * (w + 1.5);
        else center = (wallLen * (i + 1)) / (qty + 1); // auto / centered-multi: even spacing
        center = Math.max(w / 2 + 0.2, Math.min(wallLen - w / 2 - 0.2, center)); // keep on the wall
        const id = `lt${ltIndex}:acc${accIndex}:item${i}`; // deterministic + stable across polls
        ltOpenMap[id] = { entry: ae, itemIndex: i, width: w };
        ltOpenings.push({ id, type: oType, wall, widthFt: w, heightFt: h, sillFt: sill, offsetFt: center });
      }
    });

    out.push({
      type,
      attachedSide: type === 'attached' ? attachedSide : undefined,
      widthFt,
      lengthFt,
      lowLegHeightFt: lowHeightFt,
      tallLegHeightFt: type === 'attached' ? tallHeightFt : undefined,
      roofPitch: roofPitchStr,
      enclosure,
      customWalls,
      openings: ltOpenings,
    });
  });

  (win as BuilderWindow).__ssLeanToOpenMap = ltOpenMap;
  return out;
}

/** Read the program's current building config and push it into the 3D store. */
function syncFromBuilder(win: BuilderWindow) {
  const G = win.G;
  if (typeof G !== 'function') return;
  const num = (id: string, d = 0) => {
    const el = G(id);
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) ? v : d;
  };
  const val = (id: string) => {
    const el = G(id);
    return el ? String(el.value || '') : '';
  };

  const st = useBuildingStore.getState();
  const w = num('bw');
  const l = num('bl');
  const h = num('bh', 6);
  const bt = val('btype');
  const rs = val('rs');
  const ws = val('ws');

  if (w && w !== st.width) st.setWidth(w);
  if (l && l !== st.length) st.setLength(l);
  if (h && h !== st.legHeight) st.setLegHeight(h);

  // Truss spacing: mirror the program EXACTLY by calling its own getTrussInfo()
  // (e.g. 24-wide standard = 5' OC, 4' OC upgrade, wide-span = 4'). Without this
  // the 3D recomputed its own spacing from wind load and could show 4' OC where
  // the quote — and its collision warnings — use 5', so doors looked clear in 3D
  // but the panel flagged a truss hit. 0 → let the load engine decide (standalone).
  // Only override when the program returns a real value (it returns null mid-edit
  // when bw/bl read empty) so we never flicker back to the load-engine spacing.
  const ti = typeof win.getTrussInfo === 'function' ? win.getTrussInfo() : null;
  if (ti && ti.spacing > 0 && ti.spacing !== (st.trussSpacingFt ?? 0)) st.setTrussSpacing(ti.spacing);

  const mapped = TYPE_MAP[bt];
  if (mapped && mapped !== st.buildingType) st.setBuildingType(mapped);

  const panel = ws === 'Vertical' ? 'Vertical' : 'Horizontal';
  if (ws && panel !== st.panelOrientation) st.setPanelOrientation(panel);

  const roof = rs === 'Vertical' ? 'Vertical' : 'Horizontal';
  if (rs && roof !== st.roofOrientation) st.setRoofOrientation(roof);

  // Roof overhang: 6" standard, upgradeable to 12" via the program's "1' Overhang"
  // option (overhang-sel: none/eaves/gables/both). Any non-none selection → 12".
  const ohSel = val('overhang-sel');
  const ohFt = ohSel && ohSel !== 'none' ? 1 : 0.5;
  if (ohFt !== st.roofOverhangFt) st.setRoofOverhang(ohFt);

  if (bt === 'gch') {
    const enc = num('gch-enc');
    if (enc && enc !== st.enclosedLengthFt) st.setEnclosedLength(enc);
  }

  // Gable-only sheeting on the OPEN end (carport / GCH open bay): the 3D needs
  // openEndGableSheeting=true to draw the sheeted gable triangle over an open end.
  const fg = val('wfg');
  const bg = val('wbg');
  const gableOnly =
    bt === 'gch'
      ? fg === 'Gable Only' // GCH open bay is the front
      : bt === 'carport'
        ? fg === 'Gable Only' || bg === 'Gable Only'
        : false;
  if (gableOnly !== st.openEndGableSheeting) st.setOpenEndGableSheeting(gableOnly);

  // GCH open-bay side panels (the "Side Panels" dropdown) → partial eave bands.
  // none | full | half | 1 | 2 | 3  →  band height (ft from slab), per chosen side.
  let leftFt = 0;
  let rightFt = 0;
  if (bt === 'gch') {
    const pv = val('gch-panels');
    const sides = val('gch-sides') || 'both';
    let band = 0;
    if (pv === 'full') band = h;
    else if (pv === 'half') band = 1.5;
    else {
      const n = parseInt(pv, 10);
      if (n > 0) band = n * 3;
    }
    leftFt = sides === 'both' || sides === 'left' ? band : 0;
    rightFt = sides === 'both' || sides === 'right' ? band : 0;
  }
  if (leftFt !== st.eavePanelFt.left || rightFt !== st.eavePanelFt.right) {
    st.setEavePanels({ left: leftFt, right: rightFt });
  }

  // Wainscot (base accent band) on/off from the program's #wain select.
  const wainOn = val('wain') === 'yes';
  if (wainOn !== st.wainscot.enabled) st.setWainscotEnabled(wainOn);

  // ── Colors (roof / wall / trim / wainscot) → 3D ──
  // Program selects: cr=roof, cw=wall, ct=trim, cwn=wainscot. Each option's
  // .value is the on-screen hex and its text is "Name (CODE)". Prefer the CODE
  // (so Galvalume reads metallic); fall back to the raw hex. 'TBD' = leave as-is.
  const colorOf = (id: string): string | null => {
    const el = G(id) as HTMLSelectElement | null;
    if (!el) return null;
    const v = String(el.value || '');
    if (!v || v === 'TBD') return null;
    const opt = el.options ? el.options[el.selectedIndex] : null;
    const m = opt && opt.textContent ? opt.textContent.match(/\(([^)]+)\)\s*$/) : null;
    return m ? m[1] : v;
  };
  const COLOR_FIELDS = [
    ['roof', 'cr'],
    ['walls', 'cw'],
    ['trim', 'ct'],
    ['wainscot', 'cwn'],
  ] as const;
  for (const [target, id] of COLOR_FIELDS) {
    const c = colorOf(id);
    if (c && c !== st.colors[target]) st.setColor(target, c);
  }

  // ── Doors / windows → 3D openings ──
  // Source the wall sizes from the store (authoritative + snapped) rather than
  // the program's bw/bl, which can read empty mid-update. Only rebuild when the
  // set actually changes (cheap signature compare) so the poll/rc hook don't thrash.
  const live = useBuildingStore.getState();
  const desired = readOpenings(win as Parameters<typeof readOpenings>[0], live.width, live.length);
  const sig = JSON.stringify(desired);
  if (sig !== win.__ssOpenSig) {
    win.__ssOpenSig = sig;
    const cur = useBuildingStore.getState();
    cur.openings.slice().forEach((o) => cur.removeOpening(o.id));
    const map: NonNullable<BuilderWindow['__ssOpenMap']> = {};
    for (const d of desired) {
      const id = cur.addOpening(d.type, d.side);
      cur.updateOpening(id, { offset: d.offset, width: d.width, height: d.height, sillHeight: d.sillHeight, color: d.color });
      map[id] = { entry: d.entry, itemIndex: d.itemIndex, side: d.side, width: d.width };
    }
    win.__ssOpenMap = map;
  }

  // ── Lean-tos → 3D model ──
  // Read lean-to entries from the pricing program and sync to the store.
  const desiredLeanTos = readLeanTos(win);
  const leanToSig = JSON.stringify(desiredLeanTos);
  if (leanToSig !== win.__ssLeanToSig) {
    win.__ssLeanToSig = leanToSig;
    const cur = useBuildingStore.getState();
    // Remove all existing lean-tos
    cur.leanTos.slice().forEach((lt) => cur.removeLeanTo(lt.id));
    // Add lean-tos from the program
    for (const lt of desiredLeanTos) {
      const id = cur.addLeanTo();
      cur.updateLeanTo(id, {
        type: lt.type,
        attachedSide: lt.attachedSide,
        widthFt: lt.widthFt,
        lengthFt: lt.lengthFt,
        lowLegHeightFt: lt.lowLegHeightFt,
        tallLegHeightFt: lt.tallLegHeightFt,
        roofPitch: lt.roofPitch,
        enclosure: lt.enclosure,
        customWalls: lt.customWalls as any, // per-wall settings (front/back/side)
        openings: lt.openings as any, // lean-to doors/windows/roll-ups
      });
    }
  }
}

export default function BuildHost() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const width = useBuildingStore((s) => s.width);
  const length = useBuildingStore((s) => s.length);
  const legHeight = useBuildingStore((s) => s.legHeight);
  const buildingType = useBuildingStore((s) => s.buildingType);

  useEffect(() => {
    // Start a fresh quote with a BARE building — strip the demo openings.
    const store = useBuildingStore.getState();
    store.openings.slice().forEach((o) => store.removeOpening(o.id));

    const iframe = iframeRef.current;
    if (!iframe) return;
    let poll: number | undefined;
    let unsubDrag: (() => void) | undefined;

    function onLoad() {
      const win = iframe!.contentWindow as BuilderWindow | null;
      if (!win) return;
      const sync = () => {
        try {
          ensurePartitionOption(win);
          syncFromBuilder(win);
        } catch {
          /* ignore transient reads while the program is still booting */
        }
      };
      if (typeof win.rc === 'function' && !win.__ssWrapped) {
        const orig = win.rc;
        win.rc = function wrappedRc(...args: unknown[]) {
          const r = orig.apply(this, args);
          sync();
          return r;
        };
        win.__ssWrapped = true;
      }
      sync();
      poll = window.setInterval(sync, 800);
      (window as unknown as Record<string, unknown>).__ssStore = useBuildingStore;
      (window as unknown as Record<string, unknown>).__ssEditor = useEditorStore;
      (window as unknown as Record<string, unknown>).__ssSync = sync;

      // Auto-rotate the 3D to whatever wall you're working on: any time you focus
      // or change a field inside a door/window row, snap the camera to that wall.
      if (!win.__ssViewHooked) {
        win.__ssViewHooked = true;
        const snapToEntryWall = (target: EventTarget | null) => {
          const el = target as Element | null;
          if (!el || typeof el.closest !== 'function') return;
          const entry = el.closest('.re, .we, .ne');
          if (!entry) return;
          const loc = entry.querySelector('.rloc, .wloc, .nloc') as HTMLInputElement | null;
          const wall = loc ? SIDE_MAP[loc.value] : undefined;
          if (wall && wall !== 'partition') {
            useEditorStore.getState().goToView(wall);
          }
        };
        win.document.addEventListener('focusin', (e) => snapToEntryWall(e.target));
        win.document.addEventListener('change', (e) => snapToEntryWall(e.target));
      }

      // Two-way: when a 3D drag ends, write the new position back into the program.
      if (!unsubDrag) {
        unsubDrag = useEditorStore.subscribe((s, prev) => {
          if (prev.dragging && !s.dragging) {
            // Whichever id matches its map writes back; the other no-ops.
            writeBackDrag(win, prev.selectedOpeningId ?? s.selectedOpeningId);
            writeBackLeanToOpening(win, prev.selectedLeanToOpeningId ?? s.selectedLeanToOpeningId);
          }
        });
      }
    }

    iframe.addEventListener('load', onLoad);
    return () => {
      iframe.removeEventListener('load', onLoad);
      if (poll) clearInterval(poll);
      if (unsubDrag) unsubDrag();
    };
  }, []);

  const fmt = (n: number) => (Number.isFinite(n) ? `${n}′` : '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#08121d', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* ── Unified top bar ── */}
      <header
        style={{
          height: 52,
          flex: '0 0 52px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '0 18px',
          background: 'rgba(8,18,29,.97)',
          borderBottom: '1px solid #1e2d42',
        }}
      >
        <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: '.04em', textTransform: 'uppercase', color: '#e2e8f0' }}>
          Storm<span style={{ color: '#22d3c8' }}>Safe</span> Steel
        </div>
        <div style={{ width: 1, height: 22, background: '#1e2d42' }} />
        <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#1ab5ab' }}>Quote + Live 3D</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
            {fmt(width)} × {fmt(length)} × {fmt(legHeight)}
          </span>
          <span style={{ margin: '0 8px', color: '#1e2d42' }}>|</span>
          {TYPE_LABEL[buildingType]}
        </div>
      </header>

      {/* ── Two panes ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
        {/* Left: the program (untouched) */}
        <div style={{ position: 'relative', minWidth: 0, background: '#fff' }}>
          {/* RELATIVE path (no leading slash) so it resolves next to build.html
              in BOTH the dev server (/quote-builder.html) and the packaged
              desktop app (file://…/dist/quote-builder.html). A leading-slash
              path would resolve to the filesystem root under file:// and 404. */}
          <iframe ref={iframeRef} src="quote-builder.html" title="StormSafe Pricing" style={{ border: 'none', width: '100%', height: '100%', display: 'block' }} />
        </div>

        {/* Right: the 3D preview */}
        <div style={{ position: 'relative', minWidth: 0, borderLeft: '1px solid #22d3c8' }}>
          <Viewport />
        </div>
      </div>
    </div>
  );
}
