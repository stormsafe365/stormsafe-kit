# StormSafe 3D Builder — Handoff & Gotchas

> Living doc. Read this first before touching the 3D builder. Updated 2026‑06‑07.
> Its job: remember where we are + stop the same bugs from happening again.

---

## 0. TL;DR — where we are

- **Working folder (canonical):** `C:\Users\ops\Desktop\claude.code\3D Builder\`
  (this is now THE folder — the dev server, edits, and git all happen here).
- **Run it:** `cd "C:\Users\ops\Desktop\claude.code\3D Builder\configurator"` → `npm run dev`
  → open **`http://localhost:5174/build.html`** (the split view: pricing left, live 3D right).
- **Git:** branch **`rename-buildings-to-index`**, remote `github.com/stormsafe365/stormsafe-kit`.
  Latest work pushed (lean‑to openings). NOT on `main` yet.
- **A backup copy** still exists at `claude.code\` root — ignore/delete whenever.

### Done
- Lean‑tos: paneling, corner posts/eave/rake trim, 6" roof overhang.
- Left/Right eave sides fixed; component (door/window) sides fixed.
- Lean‑to openings: **outer wall + front/back gable ends** — cut real holes + render
  the SAME detailed fixtures as the main building (slat roll‑ups, knob walk doors,
  glazed windows).

### Next (parked)
- **Drag‑to‑move lean‑to openings with live spacing + truss‑collision guides** (like the
  main building). Deferred = "option 2": for now you position lean‑to openings via the
  pricing program's **Position** dropdown (Auto / Center / Left / Right / Custom offset ft).
  To build it: needs (a) a draggable wrapper on the lean‑to `OpeningFixture`, (b) raycast
  against the lean‑to wall plane → offset, (c) **write the new offset back into the program's
  `.lt-acc-off` field** (set `.lt-acc-pos='offset'`, set value, call `rc()`), tracking which
  `.lt-acc-e` entry + item index each rendered opening came from (like the main building's
  `__ssOpenMap`), and (d) dimension/truss guides like `OpeningDimensions`.
- Maybe merge `rename-buildings-to-index` → `main`.

---

## 1. Architecture (how the split view works)

```
build.html (ROOT of repo)  →  /src/build/main.tsx  →  <BuildHost/>
   BuildHost renders:  LEFT  = <iframe src="/quote-builder.html">  (the pricing program, untouched)
                       RIGHT = the React‑Three‑Fiber 3D canvas
```

- **`/src/build/BuildHost.tsx`** — the DOM bridge. Polls the iframe's form **every 800 ms**,
  reads fields by CSS selector, and pushes into the Zustand store (`useBuildingStore`).
- **`/src/engine/geometry.ts`** — `deriveStructure()` turns config → explicit 3D members +
  enclosure + lean‑to data. Coordinate conventions live here.
- **`/src/three/`**
  - `BuildingModel.tsx` — assembles Frame → Siding → LeanToSiding → Trim → Openings.
  - `Siding.tsx` — main building panels; exports **`stripsAround()`** (cuts a wall rect
    around holes) and `LocalRect`.
  - `LeanToSiding.tsx` — ALL lean‑to rendering (frame skin, trim, openings).
  - `OpeningFixture.tsx` — **shared** door/window/roll‑up visual (used by lean‑tos; the
    main building's `Openings.tsx` still has its own inline copy — keep them in sync if you
    change one).
  - `Openings.tsx` — main building openings (draggable; has the writeback + guides).
  - `Trim.tsx` — main building trim (reference for proportions).
  - `CameraRig.tsx` — camera presets.

---

## 2. Coordinate & convention rules (MEMORIZE — these caused real bugs)

- Axes: **X = width** (−W/2…+W/2), **Y = height** (0 = slab), **Z = length** (front = −L/2).
- **FRONT camera** sits at −Z looking toward +Z. In that view **world +X renders on
  SCREEN‑LEFT**, and **−X on screen‑right**.
- Therefore "Left/Right" as a customer faces the **front** of the building map like this:
  - **Left = +X**, **Right = −X**.
  - Lean‑to: **Left Eave → +X**, **Right Eave → −X** (`geometry.ts`, both lean‑to passes).
  - Components: `BuildHost.SIDE_MAP` maps **"Left Eave Side" → internal `'right'` (+X)** and
    **"Right Eave Side" → `'left'` (−X)** so they appear on the correct screen side and match
    the lean‑to convention.
  - The position‑along‑wall `mirror` in BuildHost is keyed off the **program location string**
    (length axis, X‑independent), NOT the swapped `side`.

- **A lean‑to is HALF a building.** It has: ONE single‑slope roof, ONE **outer** long wall,
  and TWO **trapezoidal** gable ends. There is **NO inner wall** on the building side (that's
  the main building's own wall). Don't render a 4th wall, and gable ends are trapezoids
  (tall at the building, low at the free leg), not averaged rectangles.

---

## 3. Key constants / values

| Name | Value | Meaning |
|---|---|---|
| `SHEET_OUTSET` | 0.18 | wall sheeting sits this far outside the framing centerline |
| `COMPONENT_OUTSET` | 0.34 | doors/windows mount on the sheeting's outer face |
| `COMP_PROUD` | 0.16 | = COMPONENT_OUTSET − SHEET_OUTSET (how far a fixture stands proud of the wall) |
| `ROOF_LIFT` | 0.11 | roof nudged out along its normal so it clears the rafters |
| `TILE` (lean‑to) | 3 | ft per corrugation texture module (rib pitch) |
| Roof overhang | `structure.roofOverhangFt` (≈0.5 = 6") | applied to lean‑to eave + both gable ends |

**Default opening sizes** (when reading lean‑to accessories):
- walk door `3 × 6.67`, sill `0`
- window `2.5 × 2.5`, sill `4.5`
- roll‑up: parse `.lt-acc-size` `"WxH"` (e.g. `9x8`), sill `0`

---

## 4. Pricing‑program CSS selectors (the iframe contract)

BuildHost reads the program (`public/quote-builder.html`) by class. **If a selector is wrong,
the 3D silently ignores it.** Verified selectors:

**Lean‑to entry** (`.lte`):
`.lt-type` · `.lts` (Attached Side: "Left Eave"/"Right Eave"/"Front Gable"/"Back Gable") ·
`.ltw` (width) · `.ltl2` (length) · `.lth` (low‑leg height) · `.lt-tall-h` · `.ltp` (pitch) ·
`.lt-wm` (**wall mode**: open/enclosed/custom — NOT `.lt-enc`) ·
`.lt-wall-front` / `.lt-wall-back` (open/gable/closed) · `.lt-wall-side` (open/1‑3panel/q1‑q3/closed).

**Lean‑to accessory** (`.lt-acc-e`, added via `addLTAcc()`):
`.lt-acc-type` (rollup/wtd/win) · `.lt-acc-size` (e.g. `9x8`) · `.lt-acc-loc`
(**outer / front / back**) · `.lt-acc-pos` (auto/center/left/right/offset) · `.lt-acc-qty` ·
`.lt-acc-off` (custom offset ft from left).

**Add functions** (call on the iframe window): `aLT()`, `addLTAcc(lte)`, `aRUD()`, `aWTD()`,
`aWIN()`, and `ltWMClick(btnSpan, 'open'|'enclosed'|'custom')`.

**ALWAYS thread new fields all the way through:** read in BuildHost → pass in
`updateLeanTo({... new field ...})` → add to type (`types/building.ts`) → carry in
`geometry.ts` `LeanToStructure` → use in `LeanToSiding.tsx`. (Forgetting the `updateLeanTo`
step is what made "Custom walls" silently do nothing.)

---

## 5. BUGS WE HIT — do not repeat

1. **Blank 3D / "@vitejs/plugin-react can't detect preamble" crash.**
   Cause: a stale **`public/build.html`** shadowed the real root `build.html`. Files in
   `public/` are served **raw** (no React‑refresh preamble) → every component throws.
   Also it loaded the wrong entry (`/src/main.tsx` instead of `/src/build/main.tsx`).
   **Rule:** the split‑view `build.html` lives at the **repo root** and loads
   `/src/build/main.tsx`. Never put a `build.html` in `public/`.

2. **"Custom" lean‑to walls did nothing.** `updateLeanTo()` in BuildHost wasn't passing
   `customWalls`. → Always pass every read field through `updateLeanTo`.

3. **Wrong CSS selector.** Enclosure mode is `.lt-wm`, not `.lt-enc`. Verify selectors
   against `quote-builder.html` before trusting them.

4. **Left/Right backwards** (lean‑tos AND components). Coordinate convention — see §2.
   Left = +X, Right = −X in the front view.

5. **Lean‑to geometry was a mess.** Was drawing a phantom inner wall + averaged‑height
   rectangles. Fix: ONE outer wall + TWO trapezoid gable ends, no inner wall (§2).

6. **Left vs right lean‑to roof looked different.** A `BasisPanel` cross‑product flipped the
   roof normal on one side → different lighting. Fix: build roof/walls as explicit polygons
   with `computeVertexNormals()` and **force the normal to point up** (`upNormal`).

7. **Trim overlapped / sat on top of the roof.** Fix: recess eave fascia + rake **inboard**
   (`TUCK ≈ 0.12`) and drop them below the drip line so the roof panel **overhangs** them
   (mirrors `Trim.tsx`).

8. **Gable‑end openings didn't show.** The gable is a trapezoid, so `stripsAround` (rect‑only)
   can't cut it directly. Fix: decompose the gable into its **lower rectangle** (cut with
   `stripsAround`) + the **triangle above**; mount the fixture on the correct gable plane.

9. **Lean‑to openings looked worse than the main building.** Fix: extracted the main
   building's visual into shared **`OpeningFixture.tsx`** and reuse it. (Main `Openings.tsx`
   still has its own copy — if you improve one, update the other.)

10. **Accidentally committed stray folders.** `git add -A` swept in a stray `3D Builder/`
    duplicate + a `CRM/` embedded repo (44k files). Both are now in `.gitignore`. **Be
    explicit with `git add <paths>`; check `git status` before committing.**

11. **Canvas goes dark after a config change.** The camera doesn't always auto‑reframe.
    Just click a **camera preset** (ISO/Front/Left/Right) to reframe.

---

## 6. Windows / PowerShell gotchas (this machine)

- `robocopy` exit code **1 = success** (files copied). 0–7 are all success.
- `git` writes progress to **stderr**; PowerShell flags it as an error even when it worked.
  Trust the actual result line (e.g. `oldsha..newsha -> branch`).
- `Bash` tool's default dir is `C:\Users\ops\stormsafe-kit` (the OLD location) — for the 3D
  builder use **PowerShell** and `cd "C:\Users\ops\Desktop\claude.code\3D Builder\..."`.
- The local `tsc` was flaky via `npx` (grabbed a typo‑squat package). Prefer letting Vite/HMR
  surface type/compile errors in the browser console, or use the project's own scripts.

---

## 7. Quick repro for testing (what I used)

In the iframe (`document.querySelector('iframe').contentWindow`):
- `btype='standard'`, `bw=30`, `bl=40`, `bh=12`; colors `cr=#9EA5A8` `cw=#7D3030` `ct=#DDDDE8`.
- `aLT()` → set `.lts`, `.ltw`, `.ltl2`, `.lth`, `.ltp` → `ltWMClick(btn,'enclosed')`.
- `addLTAcc(lte)` → set `.lt-acc-type` / `.lt-acc-loc` / `.lt-acc-pos` → `rc()`.
- Always dispatch `change` + `input` events after setting a field, then call `rc()`.

---

## 8. Daily checklist

- [ ] Work in `C:\Users\ops\Desktop\claude.code\3D Builder\`.
- [ ] `git status` clean before/after; commit with explicit paths.
- [ ] Push to `origin/rename-buildings-to-index`; verify `local == remote`.
- [ ] New iframe field? Thread it: BuildHost read → `updateLeanTo` → type → geometry → render.
- [ ] Touch a wall/roof normal or trim? Re‑check both eave‑ and gable‑attached lean‑tos AND
      left vs right (they're separate code paths).
