# Release notes — combined-1002 (assembled 2026-10-02)

Worktree: `3D Builder-combined`, branch `combined-1002`.
Base the owner runs today: `rename-buildings-to-index` @ `aecb039`.
Head after this run: `f176964` (Section 5 in the program) on top of `1260507` (foundation merge).

Nothing is installed or deployed by this run. The quote engine's pricing code is not modified:
`quote-builder.html` changes in this run are a UI layer appended before `</body>`; the only other
quote-builder changes vs aecb039 come from the storage-partition / GCH commits already on the branch.

---

## 1. What reps will see that's new (vs today's aecb039)

### A. Section 5 — "Doors, Windows & Add-ons" (this run, commit f176964)
- Sections 5–7, 9 and 10 (Roll-Up Doors, Walk-Through Doors, Windows, Lean-Tos, Additional
  Components) are gathered into **one Section 5**. Pick a wall tile (Front gable / Back gable /
  Left eave / Right eave), press **+ Roll-up door / + Walk door / + Window / + Lean-to / + Component**,
  and the item lands on that wall. Each item is a collapsible card outlined in its wall colour, with
  the item's own line price (the program's category price with and without that entry) and a wall
  dropdown in the card header. Every field inside a card is the program's own field.
- Later sections renumber: 6 Insulation, 7 Color Selections, 8 Site Information, 9 Pricing & Notes,
  10 Contract Information.
- An open card folds by itself when you click anything else in the quote panel (like the MBHQ tool);
  **Expand all / Collapse all / This wall only** are in the list header.
- On the 3D build page the 3D turns to the wall you pick or the card you open. If the 3D is showing a
  different wall than the add buttons target, an orange "Viewing … in 3D — adds still go to …" line
  offers **Add here instead** / **Show <wall>**.
- With **End Storage** on (Section 4), a dashed pink **Storage wall** tile appears (e.g. "12′ from
  back"); items added there go on the program's "Partition Wall" location and the 3D turns to its
  Interior view. If the 3D is back outside, the section says so with a **Show storage wall** button.
- A GCH that still needs its Enclosed Storage length shows the program's red notice at the top of
  Section 5 too, with a **Go to it** button (the program itself keeps doing the blocking).
- No subtotal strip (owner 10/1). In INPUT mode a one-line note says item prices come from the
  Manual Pricing panel and the per-card prices are hidden.
- **Classic layout**: a small quiet link at the right of the Section 5 title (left of the collapse
  chevron). It puts the five lists back into today's Sections 5–10, with the same items and prices;
  the link then sits in "5 — Roll-Up Doors" as **New layout**. The choice is remembered per browser
  (localStorage `ss_s5_layout`). Default on load is **New**.
- Saving, the Saved tab, quote PDF, contract, revision form, revised layout, text quote, Send to
  client, Pricing tab, reset and INPUT mode all run exactly as today — the entries keep their ids and
  containers (`#rl #wl #nl #ltl #acl`), only their place on the page moves.

### B. Foundation drawing in the 3D (this run's merge 1260507, from branch `foundation`)
- The 3D draws the slab / pad, thickened-edge footings, #5 bars and anchors for the quote's
  **Foundation Type** (Section 3 dropdown: concrete / footers / gravel / asphalt / ground).
  View-only: the 3D never prices anything from it. CCI builds use CCI's FL foundation & anchoring
  details, CA builds use CA's own sheet (owner 9/29–9/30 review rounds).
- Enhanced look: always drawn (exterior shows only what is above the surface). Classic look:
  only in Structure / Cutaway, so the classic exterior is unchanged.

### C. Already on combined-1002 before this run (also new vs aecb039)
- **Storage partitions** (742fa27, ff56801, 5a74654): Section 4 "Storage / Add'l End Wall" asks
  where the storage is (End Storage: which end + depth; Left/Right Storage: width); the 3D draws the
  partition wall; partition doors are offered on it; paperwork / revisions / reset follow it.
- **GCH Enclosed Storage length is required** (8591f08): red note in Section 3; quote PDF, contract,
  revised layout, text quote and send-to-client stop until it is picked.
- **Walk-in Interior view** (5097357, merge c154c4c): 3D "Interior" button — stand inside at eye
  height, drag to look around, W/A/S/D + arrows to move, can't leave the building; clicking a door
  inside still opens/closes it.
- **Combined copy fixes** (c95891f): stay inside after a PDF capture, no lean-to flashing band
  inside, and doors/windows left on auto position that land on the same spot are drawn 1′ apart
  (3D only — quote, prices and fields unchanged).

---

## 2. Section 5 port — what was removed from / kept in the preview block

Source: `Demos/full-tool-preview-combined/quote-builder.html`, between the `BEGIN S5 PREVIEW` /
`END S5 PREVIEW` markers (984 LF lines). Verified first that the preview minus that block is
byte-identical to the program, so the port is exactly the block. Now in
`configurator/public/quote-builder.html` as `BEGIN SECTION 5 … END SECTION 5` before `</body>`
(874 lines, converted to the file's CRLF; checked: 17,422 CRLF lines, 0 LF-only lines).

Removed (preview-only):
- "Load example" button and the EXAMPLE quote data (`loadExample`, `barHTML`, `.s5-bar/.s5-seg/.s5-btn`).
- The "Preview copy — nothing saves" chip (in-panel and the one placed in the build page header:
  `placeChip`, `#s5-pchip`, `html.s5-chip-up`) and the dashed "Preview controls" strip (`#s5-classic`,
  `#s5-pvtext`).
- The `window.saveQuote / deleteFromLog / downloadFromLog / sendToClient` "switched off" overrides —
  the program's real functions run (smoke-tested: save → log → reload → delete).
- The auto-scroll to Section 5 on first open (`jumpOnce`).
- The preview toast (`.s5-toast`) — nothing used it once the above was gone.
- Dead subtotal-strip CSS (`.s5-st/.s5-ks/.s5-k`), README/preview wording in comments;
  `window.__s5Preview` guard renamed `window.__s5Section`.

Kept: wall tiles → add buttons → wall-coloured collapsible cards; the Storage-wall tile; auto-minimize;
the 3D turn + "Viewing…" / "Show storage wall" hints; header wall dropdowns; no subtotal strip (only
the INPUT-mode note); the GCH red notice; the `rc()` hook; the `window.__s5` debug handle
(`refresh / setMode / state / linePrice / describe`).

Changed: the New / Classic (today) segmented switch became the quiet **Classic layout** / **New layout**
link in the section title, remembered in `localStorage` key `ss_s5_layout`, default New.

---

## 3. Verification

- `npx tsc -b --noEmit`: clean. `npx vitest run`: 36 files / 713 tests pass (after the merge; the
  Section 5 commit touches only `public/quote-builder.html`, which no test covers).
- `npm run build`: ok; `dist/quote-builder.html` carries the section.
- Smoke on the built dist, one headless Chrome (http 5700 / CDP 9700, swiftshader), driven over CDP:
  - build.html loads; New layout on load; the five original sections hidden; titles renumbered
    5 Doors, Windows & Add-ons … 10 Contract Information; no preview strip / chip / wording; the real
    `saveQuote / sendToClient / deleteFromLog / downloadFromLog` are in place.
  - `ss_s5_layout = classic` survives a reload (Classic on load, link in "5 — Roll-Up Doors");
    link back to New.
  - Fixture restored through the program's own `restoreQuoteData` (CCI 30×40×12, Palm Beach);
    adds on every wall (roll-up, walk door, window on front / back / left / right; lean-to on the
    right eave; framed opening on the front): each entry's real location select equals the wall,
    card gets the wall class, the 3D camera turns to that wall, `__ssStore` openings 16 / lean-tos 1.
  - End Storage 12′ from back → "Storage wall" tile; walk door added there lands on "Partition Wall"
    and the 3D goes to the Interior view. Header wall dropdown moves a window to the back gable.
  - Classic link: today's Sections 5–14 back, same 20 entries, `_qTotals` identical; back to New,
    identical again.
  - Quote PDF, contract and revision form each open their window and write it (9.6 MB / 3.0 MB / 14 KB
    documents); text quote copies the quote text; `gchEncPrintBlock()` and `ltStoragePrintBlock()`
    are false for this normal build — no guard toast. (Chrome was started with popups allowed; "not
    blocked" here means the program's own GCH / lean-to-storage guards let a normal build through.)
  - Saved tab: real save (log entry + JSON download + auto PDF), log renders, reset, `loadFromLog`
    restores all 20 entries into the moved containers with identical totals, `deleteFromLog` empties
    the log. Pricing tab renders its 7 tables; Building tab; back to Quote.
  - INPUT mode: Manual-pricing note shown, card prices hidden; back to engine mode, prices back.
  - Card × removes one entry; `resetAll()` empties Section 5 ("Nothing added yet…", tiles Empty).
  - GCH with no Enclosed Storage length: red notice at the top of Section 5, program blocks prints.
  - **Totals unchanged vs the preview copy for the same state**: the same script run against
    `Demos/full-tool-preview-combined` gives `$40,582.00` on both, all 58 `_qTotals` fields and all
    20 card line prices identical.
  - Console: only a favicon 404. All test processes were stopped; the owner's 5577 / 5590 servers
    were not touched.

---

## 4. Every file changed vs aecb039 (38 files, +5638 / −211)

Commit key: f176964 Section 5 in program · 1260507 merge foundation · c95891f combined fixes ·
5097357 interior view · 5a74654 / ff56801 / 742fa27 storage partitions r3 / r2 / r1 ·
8591f08 GCH enclosed length required · c75b673 / 6d77adf / 9bf7a13 foundation drawing.

| File | Status | Commits |
|---|---|---|
| configurator/public/quote-builder.html | M | f176964, 3f113f2, 5a74654, ff56801, 742fa27, 8591f08 |
| configurator/src/build/BuildHost.tsx | M | 1260507, c95891f, ff56801, 742fa27, 9bf7a13 |
| configurator/src/build/__tests__/mainStorageProgram.test.ts | A | 5a74654, ff56801, 742fa27 |
| configurator/src/build/mainStorage.ts | A | 742fa27 |
| configurator/src/components/Viewport.tsx | M | 5097357 |
| configurator/src/engine/__tests__/autoSpread.test.ts | A | c95891f |
| configurator/src/engine/__tests__/mainStorage.test.ts | A | 5a74654, 742fa27 |
| configurator/src/engine/autoSpread.ts | A | c95891f |
| configurator/src/engine/geometry.ts | M | 5a74654, 742fa27 |
| configurator/src/engine/useResolvedBuilding.ts | M | 9bf7a13 |
| configurator/src/store/useBuildingStore.ts | M | 1260507, 742fa27, 9bf7a13 |
| configurator/src/store/useEditorStore.ts | M | 5097357 |
| configurator/src/three/BuildingModel.tsx | M | 1260507, 742fa27, c75b673, 9bf7a13 |
| configurator/src/three/CameraRig.tsx | M | 5097357, ff56801, 742fa27 |
| configurator/src/three/CaptureHook.tsx | M | c95891f |
| configurator/src/three/FoundationDetails.tsx | A | c75b673, 6d77adf, 9bf7a13 |
| configurator/src/three/InteriorWalk.tsx | A | c95891f, 5097357 |
| configurator/src/three/LeanToSiding.tsx | M | c95891f, 5097357 |
| configurator/src/three/Openings.tsx | M | 5097357, 742fa27 |
| configurator/src/three/Siding.tsx | M | 742fa27 |
| configurator/src/three/StoragePartitionGhost.tsx | A | 742fa27 |
| configurator/src/three/Trim.tsx | M | 742fa27 |
| configurator/src/three/__tests__/foundation.test.ts | A | c75b673, 6d77adf, 9bf7a13 |
| configurator/src/three/__tests__/interiorView.test.ts | A | 5097357 |
| configurator/src/three/__tests__/mainStorageShell.test.ts | A | 5a74654, 742fa27 |
| configurator/src/three/enhanced/EnhancedSite.tsx | M | 9bf7a13 |
| configurator/src/three/enhanced/ShellMeshes.tsx | M | 5a74654 |
| configurator/src/three/enhanced/fixtureLayout.ts | M | 742fa27 |
| configurator/src/three/enhanced/look.ts | M | 6d77adf, 9bf7a13 |
| configurator/src/three/enhanced/materials.ts | M | 5a74654 |
| configurator/src/three/enhanced/shellGeometry.ts | M | 5a74654, 742fa27 |
| configurator/src/three/enhanced/siteTextures.ts | M | 6d77adf, 9bf7a13 |
| configurator/src/three/foundationGeometry.ts | A | c75b673, 6d77adf, 9bf7a13 |
| configurator/src/three/foundationLayout.ts | A | c75b673, 6d77adf, 9bf7a13 |
| configurator/src/three/interiorPress.ts | A | 5097357 |
| configurator/src/three/interiorView.ts | A | 5097357 |
| configurator/src/types/building.ts | M | 1260507, 742fa27, 9bf7a13 |
| configurator/tsconfig.tsbuildinfo | M | 1260507 (tracked tsc build-state file, no code) |

Merge resolution in 1260507 (both sides kept): `BuildHost.tsx` imports (`FoundationType` +
`readLeanToStorage` / `mainStorage` / `spreadAutoOverlaps`); `BuildingModel.tsx` imports and the
render tail (`EnhancedSite layout={foundation}`, then `StoragePartitionGhost`, then
`FoundationDetails`). Everything else auto-merged.

---

## 5. Open / for the owner's eye

- `quote-builder.html` line 10744 has a pre-existing `\r\r\n` (one stray CR inside a CRLF line,
  present in aecb039 and in the preview copy). Harmless; left untouched so the diff stays "insertions only".
- The Storage-wall / Partition tile shows when the program offers the "Partition Wall" location **and**
  the quote panel is inside the 3D build page (or an item already sits on the Partition Wall) — the
  preview's rule, kept as-is. In a standalone quote-builder tab the tile appears once a partition item exists.
- Lean-to add is enabled on all four outside walls (gable ends included, as the program allows) and
  disabled only on the Storage / Partition wall — preview behaviour, kept.
- Text quote copies to the clipboard (program design); it does not open a window.
- Not done in this run, by the ground rules: packaging the desktop apps, the CRM `dist\build` copy,
  any push. The preview folder under Demos is unchanged.
