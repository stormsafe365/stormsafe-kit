# Dimensioned spacing page — Section 4 demo look (branch `spacing-page-look`, 2026-10-03)

Owner request: when "Add dimensioned spacing page (exact placement & distances)" is ticked, the page should look like the
Section 4 demo drawing (`owner-screenshot-reference.png`): a small top-down plan at left, a large thin-line elevation at right,
dark navy panel, Inter, teal accent.

## What changed (drawing only — `configurator/public/quote-builder.html`, `dimElevSVG` / `dimSpacingPageHTML`)

Every wall card is now **top-down plan (24%) + elevation (76%)** on a dark azul panel:

- **Plan**: building outline (open walls dashed), attached lean-tos in violet (dashed when the outer side is open) with their
  storage partition line, the GCH divider / End·Left·Right storage wall (same placement as the contract floor plan), every
  opening as a tick in its kind colour, the card's wall in **teal**, BACK / FRONT labels.
- **Elevation**: thin light outline (gable or eave), `Peak ≈ 16'3" · 3:12` above a gable (CCI handbook figure where there is one,
  else the geometric ridge), `12' leg` dimension line on the right, openings as outlined rectangles in their kind colour
  (roll-up teal · walk door orange · window blue · framed opening rose, dashed) with a faint hatch, the same `W×H` / `sill`
  labels as before, CCI centre-clearance line in **orange** (no yellow), lean-tos seen end-on beside the gables and as a
  dashed footprint on the eave they hang from, frame lines at the build's OC spacing on the eaves, a dimension chain under
  the wall (every gap + opening width, narrow ones on a second row) and the overall with **LEFT / RIGHT** (gables, storage
  partition), **FRONT GABLE / BACK GABLE** (eaves), **MAIN WALL / OUTER POST** (lean-to partition).
- **New card** when a lean-to has a priced storage section with openings on its partition: *Lean-to N · Storage Partition* —
  the partition under the rafter (`ltPartGeom` / `ltPartWallH`), openings where `ltPartLayout` puts them (the 3D's spots).
- Kept exactly: page title, card order (Front · Back · Storage Partition · Right Eave · Left Eave), the Storage Partition
  card's condition and label, the footer note (“All dimensions measured along grade…”, CCI clearance note, Building W×L×H),
  `page-break-before` + `break-inside:avoid`, the `#pdf-dims` gate, the three call sites, `_dimFtIn` exact feet-inches.

**Data sources are unchanged** — `collectElevItems` / `getPosItems`, `cciClearance`, and for the new pieces the program's own
readers: `getLTDims`, `getLTWalls`, `ltStorage`, `ltPartGeom` / `ltPartDims` / `ltPartLayout` / `ltPartWallH`,
`getTrussInfo` / `getTrussPositions`, `aewSpec`. Nothing is re-derived in the drawing; pricing code untouched.

## Design choice: dark page in the quote, print-safe page elsewhere

`dimSpacingPageHTML(theme)` — `printQuote` passes `'dark'` (the quote PDF is dark on every other page, so the spacing page is
now dark azul `#080f14` like its neighbours instead of the only white page); `printContract` and `printRevisedLayout` call it
with no theme → **white page, dark drawing panels as contained blocks with white text margins** (title, footer note dark on
white). A fully light drawing variant was not built — it is a palette swap (`DIM_C`) if the owner prefers it for the contract.

Inter is loaded by a Google Fonts `<link>` inside the page (the quote already loads Orbitron the same way); fallback Arial.

## Verification (`old-vs-new-diff.txt`, 3 builds × quote / contract / revised layout, LIVE dist vs this build)

- (a) every ft-in / inch figure the OLD page printed is on the NEW page, per card (multiset superset); the new page only adds
  the lean-to labels (`LT1 · 12′ × 40′ lean-to`), `frame lines 4′ OC` and the new lean-to partition card. Notes identical.
- (b) grand total identical before and after each print on all three builds ($43,108 / $38,612 / $45,856).
- (c) every other page of each document is byte-identical to LIVE (spacing page removed; base64 images and the per-print
  random SVG pattern ids / contract number normalised). Revised layout: byte-identical outright.
- Real Chromium print-to-PDF: the spacing section paginates as 2 dark pages, no card split, Inter rendered.

Screenshots: `<build>-<doc>-before.png` (LIVE) / `-after.png` (this branch); `A-quote-page-transition-*.png` shows the
previous dark page running into the spacing page.

## Open (for the owner)

- Lean-to **outer / front / back-wall** openings are still not drawn (only the lean-to partition's). Their positions exist only
  in the 3D (`BuildHost.tsx` auto/left/right/offset rule) with no JS twin; porting it would be a re-derivation, so it was left
  off rather than guessed.
- Walk doors still read `3'×6'8.04"` (the program's 6.67 ft, `_dimFtIn` to 1/100″) — kept as-is so the old/new figure diff
  stays exact; snapping the display to `6'8"` is a one-line choice.
- Contract / revised layout: dark panels on a white page (toner) vs a light drawing — confirm which he wants.
- Not deployed, not pushed — branch `spacing-page-look` in the `3D Builder-spacing` worktree only.
