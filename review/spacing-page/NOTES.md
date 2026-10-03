# Dimensioned spacing page — Section 4 demo look (branch `spacing-page-look`, 2026-10-03)

Owner request: when "Add dimensioned spacing page (exact placement & distances)" is ticked, the page should look like the
Section 4 demo drawing (`owner-screenshot-reference.png`): a small top-down plan at left, a large thin-line elevation at right,
dark navy panel, Inter, teal accent.

## What changed (drawing only — `configurator/public/quote-builder.html`, `dimElevSVG` / `dimPlanSVG` / `dimSpacingPageHTML`)

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

## Lean-to footprint label (verifier rounds 1 + 2)

A lean-to hanging off the wall being drawn is a dashed violet footprint up to its connection height with the label
`LTn · W′ × L′ lean-to`. Round 1 found the label sitting on an opening; round 2 found it drawn above the SVG (cut off) on a
build where the lean-to connects at eave height over a door that fills its footprint, next to the `frame lines N′ OC` note
(fixture L: CCI 24×40×12 Lee 4′ OC, 10′ partial lean-to at the front corner of the Right Eave, 9′ leg + 12′ @ 3:12 → conn 12′).
The label now takes the first spot that crosses no opening rectangle and no sill / centre-clearance / frame-line / open-wall /
peak label, and can never leave the drawing:

1. centred in the footprint;
2. the widest opening-free span across the footprint (mid-height, then higher up under the connection line);
3. just above the dashed connection line where the wall rises past it (gables);
4. **beside the footprint on the wall at its mid-height** — past its far end, else before its near end, inside the wall
   (this is where fixture L lands: right of the dashed footprint, clear of the 10′×8′ roll-up);
5. above the wall, but only a row whose text still sits inside the viewBox (an eave wall tops out at the top margin, so only
   the lower row is ever used there);
6. centred in the footprint on a small panel-coloured backing rectangle, painted after the openings so it sits on top of the
   hatch — always inside the drawing, always legible (reachable only when 1–5 all fail; exercised by a synthetic case).

Smaller labels bumped for print: sill 7.5 → 8.5, narrow-gap chain 7.5 → 8.5, centre clearance 8 → 9, and the GCH
`PARTITION WALL · gable-only sheeting · open carport front` caption 7.5 → 8.5 (shrinks, never below 7, so it stays inside the
inset on a narrow GCH).

## Verification (`old-vs-new-diff.txt`: 13 builds × quote / contract / revised layout, LIVE dist vs this build)

Builds: the 11 from the verifier's round 1 (lean-to storage openings, partition doors, framed openings on eaves, GCH, 4′ OC,
wide-span, CA, left storage, two lean-tos, open carport, clean CCI / GCH) plus the two round-2 edge builds L (partial corner
lean-to at eave height over a roll-up) and M (12′ lean-to across the whole front gable over two roll-ups and a walk door).
Captured through the program's own `printQuote` / `printContract` / `printRevisedLayout` with `window.open` stubbed, rendered
under print media at letter width in headless Chromium.

- (a) nothing lost: every ft-in / inch figure the OLD page printed is on the NEW page, per card (multiset superset), for every
  card with openings; opening-rectangle counts identical per card; `collectElevItems` output identical old vs new on all 13
  builds; footer notes identical on all 39 documents. The only "missing figure" lines the diff tool raises (30) are walls with
  zero openings where LIVE printed the wall length twice (chain `24'` + `24' overall`) and the new page prints it once.
- (a) totals: grand total identical before and after every print on all 13 builds ($43,108 / $38,612 / $45,856 / $77,927 /
  $42,831 / $30,190 / $37,690 / $25,526 / $8,756.50 / $42,735 / $35,019 / $32,815.50 / $33,904); every other page of each
  document byte-identical to LIVE (spacing page removed; base64 images and the per-print random SVG pattern ids / contract
  number normalised) on all 39; every dist file other than `quote-builder.html` byte-identical to LIVE; dist == public.
- (b) layout: 54 lean-to footprint labels across the 39 pages — 0 clipped, 0 on an opening rectangle, 0 text collisions;
  0 oversize cards; no yellow anywhere (hue audit of every fill / stroke / inline-style colour). Fixture L's Right-Eave label
  now sits beside the footprint at mid-height (text y 3250 inside the SVG's 3142–3400 in the quote; the same in the contract
  and revised layout). Smallest rendered label is now the plan's `BACK` / `FRONT` at 6.3px (4.7pt) in the contract; the GCH
  caption reads 8.5 → 6.7px (5pt) there.
- (c) console: only the favicon 404 on the program page (identical on LIVE); zero exceptions on any rendered document.
- Chromium print-to-PDF page counts new ≤ old in every case (274 vs 291 pages over the 39 documents).

Screenshots: `<build>-<doc>-before.png` (LIVE) / `-after.png` (this branch) for A, B, C, L, M; `L-right-eave-card-before-fix.png`
(the verifier's clipped label) vs `L-right-eave-card-after-fix.png`; `C-gch-front-card-contract-after.png` (the GCH caption at
its new size); `A-quote-page-transition-*.png` shows the previous dark page running into the spacing page.

## Open (for the owner)

- Lean-to **outer / front / back-wall** openings are still not drawn (only the lean-to partition's). Their positions exist only
  in the 3D (`BuildHost.tsx` auto/left/right/offset rule) with no JS twin; porting it would be a re-derivation, so it was left
  off rather than guessed.
- Walk doors still read `3'×6'8.04"` (the program's 6.67 ft, `_dimFtIn` to 1/100″) — kept as-is so the old/new figure diff
  stays exact; snapping the display to `6'8"` is a one-line choice.
- Contract / revised layout: dark panels on a white page (toner) vs a light drawing — confirm which he wants.
- Not deployed, not pushed — branch `spacing-page-look` in the `3D Builder-spacing` worktree only.
