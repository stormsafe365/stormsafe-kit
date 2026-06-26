# QTEPRO → 3D Configurator Pricing & Option Port Spec

**Status:** extraction / port contract. This document transcribes the pricing + option model from the QTEPRO quote builder (`stormsafe_merged_qtepro - 2026-06-04T195949.893.html`, ~10,500 lines, all logic in one `<script>`) so it can be re-implemented as a framework-agnostic TypeScript module the 3D configurator imports.

**Source files referenced:**
- Builder: `stormsafe_merged_qtepro - 2026-06-04T195949.893.html` (cited as "builder line N")
- Builder rulebook: `Downloads/CLAUDE (4).md`
- Current 3D model: `configurator/src/types/building.ts`, `config/pricing.ts`, `config/constants.ts`, `engine/bom.ts`, `engine/loads.ts`, `engine/layout.ts`

> Line numbers are from the current copy of the builder and may shift by a few lines on edits. Verify against the named function, not the literal number.

---

## 1. Overview & manufacturer model

StormSafe Steel is a **dealer**, not a manufacturer. It resells steel buildings from two manufacturers and also supports a manual override:

| Key | Manufacturer | Verified against (the "real tool") |
|---|---|---|
| `CA` | Carports Anywhere | **IdeaRoom** (CA's dealer quoting tool) |
| `CCI` | Carolina Carports Inc | **Sensei** (CCI's dealer quoting tool) |
| `INPUT` | (none — manual) | n/a — per-category typed prices |

When a builder number doesn't match Sensei/IdeaRoom, the bug is on StormSafe's side, per the rulebook.

**Active-manufacturer plumbing:**
- `var ACTIVE_MFR = 'CA'` (builder line 2929) — the active key (default CA).
- `MFR()` (line 2930) returns `MANUFACTURERS[ACTIVE_MFR]` — the active config object. Pricing functions call `MFR().<key>` constantly.
- `switchMfr(key)` (line 2946):
  - `key === 'INPUT'` → `enterInputMode()` and return (engine never runs).
  - otherwise sets `ACTIVE_MFR`, sets a colored badge (CA orange `#f15e30`, CCI green `#9fc839`), then calls `initMfrPricing()` to copy the manufacturer's tables into a set of module-global runtime vars (HU_N, HU_M, EXT_BSC, VERT_END, CP, PP, PL, AC_PRICES, plus `window._wtd_std` etc.), rebuilds every dropdown (doors, windows, colors, plans, AC list, RUD colors), toggles CCI-only UI (`.cci-only-row`, overhang, hi-impact rollup), and finally `doPerm(); sy(); rc()`.
- `initMfrPricing()` (line 3046) is the only place the per-MFR tables become "live." A TS port should instead pass the chosen `MANUFACTURERS[key]` object directly into pure functions rather than mutating globals.

**What differs between CA and CCI** (high level — details in later sections):

| Concept | CA | CCI |
|---|---|---|
| Wide-span base table | falls through `PV/PR/PB` + `wideSpanCombinations` | dedicated `commercialBase` table (32'–100' wide) + `combLen` |
| Max wide-span width | 70' (62–70 provisional, mostly stubbed to 0) | 100' (62–100 released Apr 2026) |
| Vertical side wall charge | per-side (`vertSideCombined:false`) | table is both-sides-combined, halved (`vertSideCombined:true`) |
| SH/BSC index axis | indexed by **width**, floored (`shIndexByLength:false`, `shExtThresh:44`) | indexed by **length**, rounded up (`shIndexByLength:true`, `shExtThresh:52`) |
| Roof pitch upgrade | flat +50% of base (`pitchUpgradeFn`) | tiered table by width×length; also offers 6:12 (`hasPitch612:true`) |
| Plans | `As Built` $400/$500/$750, dynamic labels | `Generic` $175 / `Site Specific` 5% of retail (min $175) / Master Files $0 |
| Walk-through doors | std/hi only | std, 6-Panel, 9-Lite (each white/black), hi-wind |
| Windows | std/hi 30×30 | white/black 30×30 & 30×36, hi-impact |
| RUD color upgrades | none (white only) | `rudColors` $0 / $100 (7) / $300 (9) tiers |
| Roll-up hi-impact tier | `hiImpactRollup:true` (RDP_HI table) | `false` — certified doors already cover impact areas |
| 1' Overhang | none | `overhang` table (ends/sides by width bucket) |
| Utility (GCH) sides chart | residential 5'OC only (12–30W); 32+ falls back to scLookup | residential 5'OC + 4'OC + commercial (32–60W) |
| Fasteners | charged unless order ≥ $10k | always free (`fastenerAlwaysFree:true`) |
| Half-closed gable | $1,015/end | $900/end |
| Gable-only sheeting | $100/end | $300/end |
| Seal rate | $9.85/ft | $12.00/ft |

---

## 2. `MANUFACTURERS` config schema

`var MANUFACTURERS = { CA: {...}, CCI: {...} }` (builder line 2194). Top-level keys per manufacturer:

### 2.1 Base price tables (standard, 12'–30' wide)
Three tables, one per roof style — **the structural difference is the roof, the schema is identical**:
- `PV` — **Vertical** roof (panels run vertically up the roof; required for commercial / wide-span). builder line 3133.
- `PR` — **Regular** roof (horizontal panels). line 3141.
- `PB` — **Boxed** roof. line 3142.

Shape: `T[lengthTier][widthIndex] = basePrice`.
- Row keys = **standard length tiers** `STD_TIERS = [21,26,31,36,41,46,51]` plus wide-span tiers `[25,29,33,37,45,49,53]` that also live in these rows (the rows are a union, used by `nearestStd` and `nearestWS`). Full row key set: `21,25,26,29,31,33,36,37,41,45,46,49,51,53`.
- Column index maps into `WIDTHS = [12,14,...,70]` (line 3131). Indices 0–9 = widths 12–30 (standard); indices 10+ = widths 32–60 (wide-span columns embedded in the same rows).
- `0` entries are placeholders for invalid combinations (e.g. odd tiers at wide-span widths).
- **Vertical base correction** (line 3140): a loop copies width columns 0–9 from tier 25→26 and 45→46, fixing inflated 26'/46' rows (`22×46 Vert = $5,890`, matching IdeaRoom/Sensei). **Only PV is corrected — see §9 bug (b).**

### 2.2 `commercialBase` (CCI only — 32'–100' wide)
Dedicated table at builder line 2504. Shape:
```
commercialBase = {
  cols: [20,24,28,32,36,40,44,48,52],          // length tier columns
  rows: { 32:[...9 prices...], 34:[...], ... 100:[...] },  // keyed by width
  combLen: { 56:[28,28], 60:[28,32], ... 104:[52,52] }     // L>52' = 2 sections
}
commercialBaseFn(w,l)  // line 2565 — see §3
```
CA has **no** commercialBase; CA wide-span resolves through `PV/PR/PB` columns 10+ plus `wideSpanCombinations`.

### 2.3 `standardCombinations` / `wideSpanCombinations`
- `standardCombinations` (CA line 2268, CCI line 2486 — **identical**): `{ 56:[31,26], 61:[31,31], ..., 106:[36,36,36] }`. For 12–30W buildings over 51' long.
- `wideSpanCombinations` (CA only, line 2296): `{ 54:[25,29], ..., 106:[53,53] }` keyed by CA wide-span tiers. CCI uses `commercialBase.combLen` instead.

### 2.4 Utility (GCH) pricing
- `utilityPricing` — charts of **utility-sides** prices for the open carport portion of a GCH build (price covers **both** sides):
  - CA (line 2201): only `residential5OC` (cols=heights 6–13, rows=lengths 5/10/15). 32+ wide returns `null` → falls back to scLookup.
  - CCI (line 2613): `residential5OC` (heights 6–16), `residential4OC`, and `commercial` (heights 8–20, 32–60W).
- `utilitySidesFn(w,h,encL)` — 2D lookup with interpolation/extrapolation in both axes (CA line 2213, CCI line 2647). CCI picks chart by width (≥32 → commercial) and OC spacing (`4oc` → residential4OC).

### 2.5 Colors
`colors: [{n, c?, h}]` — `n`=name, `c`=manufacturer swatch code (CA only — used for the actual paint code), `h`=hex for rendering. CA 17 colors (line 2313), CCI 17 (line 2690, no `c` codes).

### 2.6 Scalar pricing & flags
`wtd_std`, `wtd_hi`, `win_std`, `win_hi`, `chain` (chain hoist add-on, both $325), `seal` ($/ft of door width for header seal: CA 9.85, CCI 12.00), `freeThresh` ($10,000), `fastenerAlwaysFree` (CCI true / CA false), `hiImpactRollup`, `gableOnlyPrice`, `halfGablePrice`, `vertSideCombined`, `shIndexByLength`, `shExtThresh`.

### 2.7 Door / window catalogs
- `wtdPrices` (map of typeKey→price) + `wtdTypes` (`[{v,label,style?,color?}]`). CA line 2469 (std/hi); CCI line 2908 (std, std_blk, 6panel, 6panel_blk, 9lite, 9lite_blk, hiwind).
- `winPrices` + `winTypes` (`[{v,label,fw,fh,color?}]`). CA line 2475; CCI line 2919.
- `rudColors` (CCI only, line 2887): `[{v,label,hex,price}]` — white $0, tier-1 $100 (7), tier-2 $300 (8).

### 2.8 Pitch / wainscot / overhang config
- `hasPitch612`, `pitchUpgradeFn(base,w,l,pitch)`, `pitchDisplay`, `pitchLabel`.
- `wainscotBuckets(w)` → `{cols, vals}` (price by length column). CA fixed; CCI splits std (≤30W) vs commercial.
- `overhang` (CCI only, line 2727): `{small,mid,large:{ends,sides}}` by width bucket; `overhangBucket(w)`.

### 2.9 Leg-height upcharge tables
`huN` (12–24W), `huM` (26–30W) — shape `{height:[14 values per LENGTHS index]}`, heights 7–20 (line 2427 CA / 2824 CCI). `extBsc` — extended side-close commercial table for `l > shExtThresh` (line 2430/2827).

### 2.10 Plans / county routing
- `countyPlans` — `{CountyName: planType}` map (CA line 2396, CCI line 2797) — 67 FL counties.
- `plans` — `{planType: cost}`; `planLabels`, `planOptions` (HTML), `planCostFn(planType, subtotal, isCommercial)`, `planDisplayFn`. CA `As Built` is dynamic ($400 ≤40W / $500 >40W / $750 commercial); CCI `Site Specific` = `max(175, ceil(sub*0.05))`.
- `defaultPlan`, `autoHighPlan`, `autoHighBadge`, `dynamicPlanLabels`.

### 2.11 `acPrices` — additional-component / framed-opening catalog
`{ componentLabel: unitPrice }` (CA line 2432, CCI line 2837). `(Custom Size)` and `Custom — see notes` entries price $0 and read a typed custom price at runtime.

### 2.12 `vertEnd`
`{eaveHeight: perEndVerticalUpcharge}` (line 2425/2822) — used by `vertEndUpcharge(w)` is actually keyed differently; see §4 vertical-wall note.

---

## 3. Length-combination / round-up logic

**The single most important paradigm difference vs the 3D builder: prices are table-driven with round-UP tiering and section combinations — never linearly extrapolated per foot.**

### Tier rounding
- `STD_TIERS = [21,26,31,36,41,46,51]` (line 3645). `nearestStd(l)` (line 3646) returns the **first tier ≥ l** (rounds up), capped at 51.
- `WS_TIERS = [21,25,29,33,37,41,45,49,53]` (line 3651). `nearestWS(l)` (line 3652) — first tier ≥ l, capped at 53. (CA wide-span tiers are 4-ft increments.)
- CCI commercial cols `[20,24,28,32,36,40,44,48,52]` — CCI tiers are CA tiers minus 1 ft.

### Standard combinations (12'–30' wide, L > 51')
A long building is **physically built as 2+ standard sections**, and its price is the **sum of each section's tier price** (each section keeps its own end walls). `standardCombinations` (line 2268). Example: L=66 → `[36,31]` → `PV[36][wi] + PV[31][wi]`. Lengths between combo keys round **up** to the next combo key (`gBase` loop, line 3696).

### Wide-span combinations
- CCI (32'–60' wide, L > 52'): `commercialBaseFn(w,l)` (line 2565):
  1. Direct column match → `rows[w][colIndex]`.
  2. `combLen[l]` exact → sum of the two section column prices.
  3. L between cols (≤52) → round up to next column.
  4. L 53–104 not on a combo step (54,58,62…) → round up to next `combLen` key, sum sections.
  5. L > 104 → recursive split `[104, l-104]` (104 = `[52,52]`). e.g. L=200 for 100W = `[52+52]+[48+48]`.
- CA (32'–60', L > 53'): `wideSpanCombinations` (line 2296) summed from `PV/PR/PB` wide-span columns (`gBase`, line 3718).

### Fallback extrapolation (only outside all charts)
`gBase` line 3734: if no tier/combo matches, extrapolate from the last two tiers' rate. **This is the legacy escape hatch, not the normal path** — almost every real quote hits a tier or combination.

---

## 4. Pricing functions (`g*()`)

All read live DOM via `G('id').value`. A TS port should take a typed `BuildingConfig` instead. Master recalc `rc()` (line 5139) sums them. Note: **all width lookups round odd widths UP to the next even** (`if(w%2===1) w++`), because CA/CCI only build even widths.

### `gBase()` — builder line 3656
**Input:** width, length, roof style (`rs`: Vertical/Regular/Boxed), active MFR.
**Logic:** base-override field wins if set → CA 62–70W provisional (only 70×110 = $73,385, else 0) → CCI commercial table if `w≥32 && rs==='Vertical'` → else standard/wide-span tier lookup in `PV/PR/PB` (round up via `nearestStd`/`nearestWS`) → else combinations → else extrapolate.
**Output:** base building price (the dominant line item).

### `gLeg()` — builder line 3743
**Input:** width, eave height `h` (default 6), length.
**Logic:** `h≤6` → $0. Picks a height bucket. Wide-span (≥32W) uses an embedded `SHT` table (height×width-or-length) and `EXT_SH` for `l > shExtThresh`; CCI 62–100W doubles the extended value (provisional). Standard (12–30W) uses `huN/huM` by `nearestStd(l)` for `l≤40`, `EXT_SH_30` for 30W beyond 40', else extrapolates.
**Output:** leg/eave-height upcharge. **See §9 bug (a): >40' standard not derived correctly.**

### `gWalls()` — builder line 4029
The big composite: gable ends + side closure + GCH utility storage. Reads `wfg`/`wbg` (front/back gable), `wre`/`wle` (right/left eave), `btype`.
- Each gable end: `Closed` → `ecLookup(w,h)`; `Gable Only` → `MFR().gableOnlyPrice` (CA $100 / CCI $300); `Half Closed` → `MFR().halfGablePrice` (CA $1,015 / CCI $900, **flat all-in per end, not routed through vertical upgrade**).
- **GCH branch** (`btype==='gch'`, line 4050): for enclosed length `encL>0`:
  1. Each **Closed** eave side → full-length `scLookup(h,l,w)`; each open side increments `sideOpenCount`.
  2. Internal divider end wall → `ecLookup(w,h)` **always** added.
  3. If any side open → add `utilitySidesFn(w,h,encL) * sideOpenCount / 2` (chart covers both sides). Fallback to `scLookup(h,encL,w)` when chart returns null (CA ≥32W).
- Non-GCH: each Closed eave side → `scLookup(h,l,w)`.

### `gRUD()` — builder line 4151 (roll-up doors)
Iterates `.re` entries. Per door: `getDoorPrice(type,size)*qty` (RDP_STD / RDP_CHAIN / RDP_HI tables, lines 3147–3178) + chain-hoist add-on `$325` (only for STD-tier sizes; chain/hi-impact sizes include it) + header seal (`sealQty * round(doorWidthFt * seal_rate)`) + 45° cut `$85/door` + **CCI color upgrade** (`rudColors[v].price * qty`).
**Eave-wall special rule:** a roll-up door on a Left/Right Eave Side adds `eaveHeaderCost(doorW, bldgW) * qty` — a structural header beam. (Rulebook says "+$325"; the actual table is width-bucketed, see below.)

### `gWTD()` — builder line 4198 (walk-through doors)
`qty * MFR().wtdPrices[type]` per `.we` entry, plus side-frame sqft `* window._sf_dw (425)`.

### `gWIN()` — builder line 4211 (windows)
`qty * MFR().winPrices[type]` per `.ne` entry, plus side-frame sqft. **Framed-opening windows sit at a 4'6" sill** (rendering rule, not a price rule — `item.yo=4.5`).

### `gAC()` — builder line 4956 (additional components)
Sums `AC_PRICES[component]*qty` per `.ace` entry; `(Custom Size)`/`Custom — see notes` read a typed price.

### `gSidePanels()` — builder line 4331
Only for `carport`/`gch`. Rounds length up to a panel tier (`panelTier`: `[21,26,31,36]`), then prices from `sidePanels.full/halfTrim/cutFee`. GCH variant respects per-side wall state (a Closed side is already sheeted → $0) and uses the open-section length.

### `gConnectionFees()` — builder line 3837 (lean-to attachment)
Per attached lean-to: wide-span `300 + 25/4' past 20'`; gable-end `700 + 25/5' past 21'`; eave side-to-side `100 + 25/5' past 21'`. Free-standing lean-tos don't connect ($0).

### Supporting lookups

**`scLookup(h,l,w)` — side close, per side — line 3884.** Standard (12–30W): `SC` table (line 3187) by height bucket × length column `[20,25,30,35,40]`, `EXT_BSC_30` for 30W beyond 40'. Wide-span: embedded `BSC` table (height×width/length) ÷ 2 (table is both-sides), `EXT_BSC` for `l>shExtThresh`, CCI 62–100W uses `cciWideSCBothSides`. **Returns per-side (always halved at the end).**

**`ecLookup(w,h)` — each-end close, per end — line 3867.** `EC` table (line 3188). Widths 12–30 use bucketed width `eBkt(w)`; widths 32–60 use actual even width; CCI 62–100 uses `cciWideEC`. Height capped at 16.

**`eaveHeaderCost(doorW, bldgW)` — line 4123:**
| Building width | door ≤4' | door 6'–12' | door 12'–16' | door 17'–20' |
|---|---|---|---|---|
| Standard 12'–30'W | — | $200 | $360 | $720 |
| Wide-span 32'+ W | $360 | $425 | $425 | $850 |

**Vertical-wall upgrade** (`gVertUpgrade`, line 4007): only when walls are Vertical on a ≤30' build (wide-span is already vertical). Per closed side: `vertSideUpcharge(h,l)` from `VERT_SIDE` (line 3964), CCI halves it (combined table). Per closed/gable-only end: `vertEndUpcharge(w)` from `VERT_END`.

---

## 5. Option catalog (what the 3D builder must model)

| Option group | Values | Notes / pricing hook |
|---|---|---|
| **Building type** (`btype`) | standard, widespan (32–70/100W), carport (open), **gch** | line 265 |
| **Roof style** (`rs`) | Vertical (`PV`), Regular (`PR`), Boxed (`PB`) | selects base table; Vertical required for commercial |
| **Wall sheeting** (`ws`) | Horizontal / Vertical | Vertical triggers `gVertUpgrade` + enables wainscot |
| **GCH (Garage-Carport Hybrid)** | enclosed length + open length, open end, front-gable selector | = CCI "Utility Carport." Rule in §4 `gWalls` GCH branch. Enclosed garage portion + open carport portion along the length |
| **Gable ends** (`wfg`/`wbg`) | Closed, Open, Gable Only, **Half Closed (6' Panel)** | Closed=`ecLookup`; Gable Only=flat `gableOnlyPrice`; Half Closed=flat `halfGablePrice` (CA $1,015 / CCI $900 per end) |
| **Eave sides** (`wre`/`wle`) | Closed, Open | Closed=`scLookup` per side |
| **Lean-tos** | width, length, height (cont. or stepped), placement (Front/Back Gable, eave side, free-standing), sheeting/walls, accessories (doors/windows) | `gLT` (line 4437) `$7/sqft` base + height adj (SH÷2) + enclosure (BSC÷2/side) + accessories; connection via `gConnectionFees` |
| **Roll-up doors** | type (standard/chain/hi-impact), size (`WxH` keys), qty, location, chain hoist, header seal, 45° cut, **CCI color** | `gRUD`. Eave-side → `eaveHeaderCost`. RDP_STD/CHAIN/HI tables |
| **Walk-through doors** | CA: std/hi. CCI: std, 6-Panel, 9-Lite (white/black), hi-wind | `gWTD` |
| **Windows** | CA: std/hi 30×30. CCI: white/black 30×30 & 30×36, hi-impact | `gWIN`. Framed-opening window sill = 4'6" |
| **Framed openings** (`acPrices`) | garage door, side opening, walk-through, window, custom frame-out, 45° angle | `gAC`. Customer-supplied unit; we frame only |
| **Wainscot** | yes/no | priced by length bucket (`wainscotBuckets`), Vertical walls only |
| **Side panels** | full / half-with-trim / count, which sides | `gSidePanels`, carport/GCH only |
| **Framing gauge** | 14 (std) / **12** | `rc` 12GA block (line 5158): wide-span fixed-by-length; standard fixed-by-length×width-bucket |
| **OC spacing** | 5'OC (std) / 4'OC | ≤24W only; `rc` line 5181 |
| **Roof pitch** | std / 4:12 / 5:12 / 6:12(CCI) | `pitchUpgradeFn` — CA +50% base, CCI tiered |
| **Insulation** | none / roof / roof+walls | `gInsul` (line 4231), Astro-Armour $1.50/sqft, Vertical roof only |
| **1' Overhang** | none / eaves / gables / both | CCI only, `overhang` table |
| **Sheeting gauge** | 29GA walls / 26GA (free ≥$10k) | `rc` line 5237 |
| **Colors** | per-MFR palette × roof/walls/trim/wainscot | |
| **Plans / permit** | per-county auto-routing | `countyPlans` + `planCostFn` |

---

## 6. Manual Input mode

`INPUT_MODE` (line 5042). `enterInputMode()` (line 5075) shows the `#input-pricing-panel`, sets badge to "INPUT", keeps `ACTIVE_MFR` untouched (so `MFR()` never throws). `rc()` short-circuits: `if(INPUT_MODE) return rcManual()` (line 5140). The CA/CCI engine is **never** called.

`rcManual()` (line 5088) reads per-category typed prices via `_ip(id)`:
`ip-base, ip-leg, ip-framing, ip-pitch, ip-frontend, ip-backend, ip-leftside, ip-rightside, ip-rud, ip-wtd, ip-win, ip-sidepanel, ip-leanto, ip-addl` + up to 3 labeled custom lines (`ip-custN-l/-a`). Subtotal = sum of those. Discount / tax / deposit / split-payment math is **identical** to `rc()`. Categories with no manual field (vert-wall, side-frame, lap, wainscot, insulation, connection, overhang, sheeting) render as `—`.

`manualLineItems()` / `manualSubtotal()` (lines 5045/5072) feed the same quote/contract PDFs. **Input mode has zero effect on CA/CCI pricing** — fully isolated parallel path.

---

## 7. Customer-facing vs internal rules

- The customer Quote PDF and Contract PDF are **100% StormSafe-branded**.
- The manufacturer name (CA / CCI) appears **only in the internal configurator UI** (the `#mfr-badge` + selector) — never on customer output.
- Internal-only notes (e.g. "Additional End Wall", the GCH divider note in `updateAddEndWallDisplay`, line 4293) appear in the builder UI but are **excluded from customer output**. `gAddEndWall` is shown for reference and is **not** added to the customer total for non-GCH buildings.
- A port must keep manufacturer identity out of any rendered quote string and out of the 3D builder's customer-visible price breakdown.

---

## 8. Gap analysis: QTEPRO vs current 3D configurator

| Feature / concept | In QTEPRO? | In 3D builder today? | Porting effort / notes |
|---|---|---|---|
| **Manufacturer axis (CA/CCI/Input)** | Yes (`ACTIVE_MFR`, `MANUFACTURERS`) | **No** | Large. The 3D model (`BuildingConfig`) has no manufacturer field at all. Add a `manufacturer: 'CA'\|'CCI'\|'INPUT'` axis. |
| **Table-driven base price w/ round-up tiers** | Yes (`PV/PR/PB`, `commercialBase`, `nearestStd/WS`) | **No — `pricing.ts` is LINEAR** (`framePerFt × linearFt`, `sheetPerSqFt × sqFt`) | **Fundamental paradigm mismatch.** `engine/bom.ts::generateQuote` computes price from BOM linear-feet × per-ft rates × margin. QTEPRO never does this; it reads published price tables and rounds length UP to a tier. The linear engine cannot reproduce a single real quote. Replace, don't adapt. |
| **Section-combination pricing (L>51/52)** | Yes (`standardCombinations`, `combLen`, `wideSpanCombinations`) | No | Medium — port the combo tables + sum logic. |
| **Leg-height tables** | Yes (`huN/huM`, SH/EXT_SH) | No (legHeight only affects geometry/sqft) | Medium. |
| **Side-close / end-close tables** | Yes (`scLookup`, `ecLookup`, EC/SC/BSC) | No (walls priced as sqft sheeting) | Medium. |
| **Roll-up door catalog (RDP_STD/CHAIN/HI)** | Yes, ~80 size/price entries + hoist/seal/45°/color | Partial — `OPENING_DEFAULTS.rollUpDoor` + flat `openingCost.rollUpDoor:780` | Large. Builder has full size matrix + eave-header rule; 3D has one flat price. |
| **Eave-side structural header** | Yes (`eaveHeaderCost`) | No | Small but important — roll-ups on eave walls cost extra. |
| **GCH / Utility Carport** | Yes (full `gWalls` GCH branch + utility charts) | **Type exists (`buildingType:'utility'`, `StorageMode`) but NO pricing** | Large — geometry modeled, pricing entirely missing. |
| **Lean-tos** | Yes (`gLT`, connection fees, accessories) | **No** (`types/building.ts` comment: "barn w/ lean-tos is next family — not built this pass") | Large — not modeled at all in 3D. |
| **Walk-through / window catalogs** | Yes (per-MFR type+color+size) | Flat per-type cost only | Medium. |
| **Framed openings / additional components** | Yes (`acPrices`, ~25 entries) | `frameOut` opening type, flat $120 | Medium. |
| **Wainscot** | Yes (length-bucket table, Vertical-only) | Yes but **linear** (`wainscotPerFt × baseTrimFt`) | Replace with bucket table. |
| **Gauge upgrade (12GA)** | Yes (fixed by length×width bucket) | `framePerFt` differs by gauge (linear) | Replace. |
| **Pitch upgrade (4/5/6:12)** | Yes (CA +50%, CCI tiered) | No | Medium. |
| **Insulation / overhang / OC spacing / side panels** | Yes | No | Medium each. |
| **Plans / county routing** | Yes (67-county maps, dynamic costs) | No | Medium — data port. |
| **Manual Input mode** | Yes | No | Small — a per-category override panel. |
| **Wind/snow load engine** | **No** (StormSafe sells one certified envelope) | Yes (`engine/loads.ts` ASCE-style) | The 3D builder has engineering the builder lacks; keep it advisory, but note pricing does **not** flow from loads in QTEPRO. |

**Bottom line:** the gap is large. The 3D configurator's `pricing.ts` + `bom.ts::generateQuote` implement a *cost-buildup* model (linear material rates + margin) that is the **wrong paradigm**. QTEPRO is a *price-lookup* model (published manufacturer tables, round-up tiering, section combinations, hard-coded option charges). There is no manufacturer axis, no GCH/lean-to/door-catalog pricing, and the base price math must be entirely replaced rather than tuned.

---

## 9. Known upstream bugs — DO NOT faithfully port

1. **Buildings over 40' long (standard 12–30W):** leg height (`gLeg`), side closure (`scLookup`), and front-gable-only pricing do **not** match Sensei/IdeaRoom. The CA option tables max at 40', and the >40' rule is not correctly derived (the code extrapolates). Needs real figures pulled from the tools (13' leg + one-side-closed at 40', ideally 46'/51', plus gable-only figures). **Do not guess; do not copy the extrapolation.** (Rulebook "Open items.")
2. **`PR` (Regular) and `PB` (Boxed) base tables flatline at tiers ≥36** — rows for tiers 36/37/41/45/46/49/51/53 collapse to identical width-column values (visible at builder lines 3141–3142, e.g. PR width cols 0–9 are the same `2395,2495,...` across every tier ≥36). Only the **Vertical (`PV`)** table has been corrected (line 3140 loop). Leave PR/PB alone in the source, but a port must use **real per-tier values** for non-Vertical builds, not the flatlined ones.
3. **CA 62'–70' wide is provisional/stubbed:** `gBase`/`gLeg`/`scLookup`/`ecLookup` return 0 for everything except the single verified `70×110×20` configuration. Don't treat these as real pricing.
4. **CCI 62'–100' leg height ×2 multiplier** (`gLeg` line 3769) is a provisional fudge verified only at `100×200×20`. Don't generalize without real figures.

When porting, model these as explicit "needs real data" gaps rather than transcribing the current approximations.

---

## 10. Recommended port architecture

1. **Extract a pure, framework-agnostic TS pricing module** — e.g. `configurator/src/pricing/qtepro/`:
   - `manufacturers.ts` — the `MANUFACTURERS` data as a typed const (`MANUFACTURERS: Record<MfrKey, MfrConfig>`), transcribed exactly from the builder (base tables, utility charts, combinations, colors, door/window catalogs, county maps, plan configs). **This is data, not logic — transcribe figures exactly, do not recompute.**
   - `tables.ts` — the module-global lookup tables that aren't per-MFR-keyed today but should be (RDP_STD/CHAIN/HI, SC/EC/BSC, VERT_SIDE, EXT_* tables, CCI_WIDE_*).
   - `engine.ts` — pure functions mirroring `gBase`, `gLeg`, `gWalls`, `gRUD`, `gWTD`, `gWIN`, `gAC`, `gSidePanels`, `gConnectionFees`, `gLT`, plus `nearestStd/WS`, `scLookup`, `ecLookup`, `eaveHeaderCost`. **Signature change:** take `(config: BuildingConfig, mfr: MfrConfig)` instead of reading `G('id').value` globals — no DOM, no `window._*` mutation.
   - `quote.ts` — a `priceBuilding(config, mfr): PricedQuote` that composes the above into the same line-item breakdown `rc()` produces, plus discount/tax/deposit math.
2. **Add the manufacturer axis to the model:** extend `BuildingConfig` with `manufacturer: MfrKey` and the missing option fields (gable states already partially exist; add lean-tos, door catalog refs, GCH enclosed/open lengths — much of this already exists in `WallsConfig`/`Opening`).
3. **The 3D builder imports the engine for price-while-you-build.** Replace `engine/bom.ts::generateQuote` + `config/pricing.ts` (the linear model) with calls into the new engine. Keep `engine/loads.ts` as advisory engineering only — it does **not** feed price in QTEPRO.
4. **Manual Input mode** becomes a thin `MfrKey==='INPUT'` branch that bypasses the engine and reads per-category overrides — mirror `rcManual()`.
5. **Config data should live as typed TS consts** under `src/pricing/qtepro/data/`, kept 1:1 with the builder's `MANUFACTURERS` so future price-sheet updates are a single transcription step verified against Sensei/IdeaRoom.

---

### Appendix — quick function/line index
| Function | Line | Purpose |
|---|---|---|
| `MANUFACTURERS` | 2194 | per-MFR config object |
| `MFR` / `switchMfr` / `initMfrPricing` | 2930 / 2946 / 3046 | active-MFR plumbing |
| `PV` / `PR` / `PB` | 3133 / 3141 / 3142 | base tables (Vertical/Regular/Boxed) |
| `nearestStd` / `nearestWS` | 3646 / 3652 | round length up to tier |
| `gBase` | 3656 | base building price |
| `gLeg` | 3743 | leg-height upcharge |
| `gConnectionFees` | 3837 | lean-to connection |
| `ecLookup` / `scLookup` | 3867 / 3884 | end-close / side-close lookups |
| `gVertUpgrade` / `vertSideUpcharge` / `vertEndUpcharge` | 4007 / 3975 / 3988 | vertical-wall upgrade |
| `gWalls` | 4029 | gables + sides + GCH utility |
| `eaveHeaderCost` | 4123 | eave-side RUD header |
| `gRUD` / `gWTD` / `gWIN` | 4151 / 4198 / 4211 | door & window pricing |
| `gInsul` | 4231 | insulation |
| `gSidePanels` | 4331 | carport/GCH side panels |
| `gLT` / `ltBasePrice` / `getLTWalls` | 4437 / 4433 / 4716 | lean-tos |
| `gAC` | 4956 | additional components |
| `enterInputMode` / `rcManual` | 5075 / 5088 | manual mode |
| `rc` | 5139 | master recalc |
