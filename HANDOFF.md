# StormSafe 3D Builder — Handoff & Gotchas

> Living doc. Read this first before touching the 3D builder. Updated 2026‑06‑08.
> Its job: remember where we are + stop the same bugs from happening again.
>
> **⚠️ Before debugging ANY visual issue, read §9 (Verifying 3D changes). Most of
> the pain in this project has been chasing visuals with broken tooling. Verify
> geometry with vitest + `__ssScene`, not screenshots.**

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
- Lean‑to openings: **drag‑to‑move** along the wall + live spacing / truss‑collision
  guides (the "parked" item below is now built).
- **Frame‑out openings read clean** — depth occluder hides what's behind the cut
  (see §5 bug 12). **Window sill = 4'‑2"** across 2D + 3D (was 4'‑6").
- **All bents render as SINGLE posts** (`SINGLE_TRUSS_ONLY` in geometry.ts) — double/
  ladder styling disabled for now (see §5 bug 13).

### Next (parked)
- **Fix the real truss styling**, then flip `SINGLE_TRUSS_ONLY` back to `false`. Current
  double/ladder geometry was visually wrong; it's disabled (see §5 bug 13). When re‑enabling,
  restore the size‑based `trussStyles.test.ts` expectations.
- **Frame‑out pricing** — currently $0 in the 3D path (no invented price); wire in the real
  per‑opening charge when given a number.
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
- window `2.5 × 2.5`, sill **`4.16667` (4'‑2")** — changed from 4'‑6"; updated in BOTH
  BuildHost (3D) AND `quote-builder.html` (2D elevation + pricing warning). Keep them in sync.
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

12. **Framed opening shows gray "truss lines / little dashes" inside the cut.**
    This burned an ENTIRE session. There were **TWO independent causes** — don't stop
    at the first:
    - **(a) The opposite wall's frame, seen straight through the transparent pane.**
      A frame‑out is a real see‑through hole; the wall sheeting/girts/posts on the
      NEAR wall ARE cut correctly. What you see is the **far wall's frame at +X / −X**
      showing through the hole (proven: `__ssScene.traverse` found the bars all at
      `x ≈ +halfW`, the opposite wall). **DO NOT "fix" the near‑wall cut — it's fine.**
      Fix = a **depth occluder** in `OpeningFixture.tsx` for `frameOut`: a plane with
      `<meshBasicMaterial colorWrite={false} side={DoubleSide} />` at `renderOrder={-1}`.
      It writes depth but no color and draws first, so everything behind the hole fails
      the depth test → the cut reads clean. (Raycast/drag still works on it.)
    - **(b) Ladder‑leg RUNGS at H ≥ 16.** At tall heights the legs WERE "ladder" legs
      (two posts + short horizontal rungs every ~4 ft). The rungs sit at the wall plane
      INSIDE the opening and the column clip (`clipFrameAtEaveOpenings`) only handles
      vertical/diagonal members, not horizontal rungs → they showed as a grid of dashes
      IN FRONT of the occluder. Symptom tell: **clean at 10 ft, dashes at 16 ft+.**
      Fix (current): `SINGLE_TRUSS_ONLY` renders all single posts (no rungs). Also
      added defensive rung‑clipping in `pushLeg` for when ladder legs return.

13. **Double‑post / ladder‑leg truss styling looked wrong.** Gated behind
    `SINGLE_TRUSS_ONLY = true` in `geometry.ts` so every bent = one post per side +
    single base rails, at any size. **3D‑visual ONLY** — pricing/BOM (in the program /
    qtepro) is separate and still charges for double trusses. Flip the flag to `false`
    to restore real styling; then restore the size‑based `trussStyles.test.ts`
    expectations (they're rewritten for single‑only right now).

14. **Elevation views (left/right eave, front/back) clip long buildings** — live AND
    in the PDF capture. Cause: the `<OrbitControls maxDistance>` clamp (was **120**).
    Framing an 80ft eave needs the camera ~**146ft** back, but `controls.update()` pulled
    it in to 120 → too close → ends clipped. The fit math was correct; the clamp masked
    it. Fix: `maxDistance 120→400` + camera `far 400→800` + `fog 200→360`. The PDF capture
    (`CaptureHook`) also temporarily drops fog, lifts the clamp, and extends `far` during
    capture (restored after) → crisp, fully framed snapshots at ANY size. *Debug tip:* if
    a preset camera lands closer than the fit formula predicts, suspect the `maxDistance`
    clamp, not stale dims (verify `impliedL == storeLen` first).

15. **PDF 3D rendering (`#pdf-render` toggle).** Save/Print PDF can embed the live
    modeler: `__ssCapture3D()` cycles ISO + 4 elevations (`__ssSetViewInstant`), snapshots
    the canvas (works because `preserveDrawingBuffer:true`), and `threeDPageHTML()` lays
    them out (ISO hero + 2×2 grid). Toggle now **defaults to 3D**. The 3D page is
    `.print-only` → shows in the saved PDF, NOT the popup's on‑screen view. If 3D capture
    fails it falls back to the 2D SVG elevations.

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
- [ ] **User says "you fixed this before"?** → `git log -p -- <file>` and grep past work
      FIRST (see §9). Don't re‑derive from scratch.
- [ ] **Geometry/cut change?** → prove it with a **vitest test** against `deriveStructure`,
      not a screenshot (see §9).

---

## 9. Verifying 3D changes — READ THIS before debugging visuals

This is where most of the time gets wasted. The visual tooling in the automation
environment is **unreliable**. Do not trust screenshots to confirm a fix; use the two
reliable methods below.

### ✅ Reliable: vitest against `deriveStructure()`
The geometry is a pure function — test it directly. To prove a member is/ isn't inside an
opening, assert over `s.members`. Examples already in the suite:
`memberCut.test.ts`, `leanToOpeningCut.test.ts`, `trussStyles.test.ts`.
Pattern: filter `members` by `kind` + world position box (opening's `x/y/z` range) and
assert the count. Run: `npx vitest run src/engine`.

### ✅ Reliable: inspect the live scene from the console
When you DO need the running scene (e.g. "what is that gray bar?"), traverse it:
```js
// __ssScene must be exposed (see caveat below). Frame steel = #c4cace / #d6dde4.
const V = window.__ssScene.position.constructor; // THREE.Vector3
window.__ssScene.traverse(o => {
  if (!o.isMesh || !o.material?.color) return;
  const p = new V(); o.getWorldPosition(p);
  // log hex + world pos; bucket by Math.round(p.x) to tell NEAR wall (−halfW) from FAR (+halfW)
});
```
This is how the "dashes" were proven to be the FAR wall (all at `x=+12`), not a near‑wall
cut bug. **Identify WHERE the geometry is before assuming what's broken.**

### ⚠️ Environment traps (all real, all cost hours)
1. **Stale module serving.** Editing a `/src/three/*` component does **not** reliably
   hot‑swap into the running R3F scene. A normal reload / the browser‑automation
   `navigate` often serves **cached** modules. Only a real **hard‑refresh
   (Ctrl+Shift+R)** — which the *user* can do — guarantees fresh code. If you clear it,
   restart the dev server: kill node, `Remove-Item -Recurse -Force node_modules/.vite`,
   `npm run dev`. Even then, see #2.
2. **Dev hooks are NOT exposed on a fresh load.** `window.__ssCam`, `__ssControls`,
   `__ssScene` only appear **after a live HMR edit re‑runs the effects** (CameraRig /
   CaptureHook). On a freshly loaded page only `__ssStore` / `__ssEditor` / `__ssSync`
   exist → you **cannot** drive the camera or inspect the scene from the console until an
   edit triggers HMR. (Net effect: from automation you frequently can't verify visuals at
   all. Lean on vitest.)
3. **CameraRig lerps over your manual camera moves.** Setting `__ssCam.position` /
   `__ssControls.target` gets overridden every frame by the in‑flight goal. **Cancel it
   first:** `__ssControls.dispatchEvent({type:'start'})`, then set position/target, then
   `__ssControls.update()`.
4. **Camera presets clip/blank on small buildings.** `left`/`right` can render an empty
   frame on short builds. Not a render bug — reframe (ISO) or set the camera manually.
5. **Store injection gets overwritten in ~800 ms.** `__ssStore.setState({openings})` is
   clobbered by the BuildHost poll re‑reading the iframe form. To make it stick, either
   **configure via the program form** (persists) or freeze the poll
   (`for (let i=1;i<=hi;i++) clearInterval(i)` after grabbing a high id).
6. **`side` is screen‑swapped.** Store `side:'left'` renders at **−X** (and program
   "Right Eave Side" → store `'left'`). See §2. When you query the scene, the opening is
   on the wall opposite to what the name suggests.

### 🧭 Process lesson (the big one)
- When the user says **"you fixed this 2 days ago / it worked before,"** the fix is almost
  certainly still in the code or in git history. **Check first** (`git log -p`, search past
  transcripts). The frame‑out purlin/ridge clipping was already present (geometry.ts
  ~L477‑510); the new symptom was a *different* member type. Re‑investigating from zero
  wasted enormous time and frustrated the user.
- A "framed opening shows framing" report has multiple possible sources (far wall, ladder
  rungs, purlins, girts, near stubs). **Enumerate + locate the exact meshes** (vitest /
  `__ssScene`) before changing anything. Don't ship an unverified visual fix to a tired
  user — and never z‑fight (the first occluder attempt put a depth plane coplanar with
  members and shattered them into "fragments," making it worse).
