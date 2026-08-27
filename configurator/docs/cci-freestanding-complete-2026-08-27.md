# CCI Free-Standing Lean-To & Free-Standing Buildings — COMPLETE pricing model
**Sources:** CCI Dealer Handbook p.24 (official rule) + full Sensei 2.0 probe sweep 2026-08-27
(StormSafe dealer login, Florida · Carolina Carports). Supersedes the partial
cci-freestanding-leanto-sensei-2026-08-25.md. Every number below read live from
Sensei's own itemization (base / height / cert rows) or grand-total deltas.

## Official CCI rule (Dealer Handbook p.24, "Free standing lean-tos")
- "Price the unit as a 12-wide unit" (handbook era: max width 12') — **confirmed live**:
  Sensei's 6–12' widths price identically to the CCI 12-wide carport chart column.
- "Charge for the tallest side height" — confirmed (one H input = tall side).
- Step-down: handbook says Regular 3' / Boxed-Eave & Vertical 2'. Sensei's live rule
  (both its styles are 2'-class): **low side = tall − round(W × pitch/12)**.
  Verified: 14w@2/12→2' (11/9), 16w@2/12→3' (14/11), 20w@2/12→3', 22w@2/12→4' (11/7),
  24w@2/12→4' (14/10), 16w@3/12→4' (14/10).
- **"Note on the order that it is a free-standing lean-to, otherwise the customer
  will receive a carport!"** → print this note on our order docs automatically.
- Base frame is 1' shorter than roof lengthwise (CCI general rule; Sensei length rows
  key to the carport chart's L+1 rows: 21/25/31/36/41/45/51).

## Product envelope
Widths 6–24 even (odd widths = custom quote). Lengths 20–100 in 5' steps verified
(product card claims to 300'; >100 unverified — quote via CCI). Tall-side heights
9–20. Pitch 2/12 or 3/12 ($0). Roof style A-Frame / Vertical ($0, roof panel
orientation). Deposit 17%. 150 MPH & Uncertified $0.

## Base price chart — base(W, L), open lean-to, 14GA
Width bands share rows exactly as CCI carport (PV) chart columns:
6–12 = PV[w12] · 14 = PV[w18] · 16 = PV[w22] · 18 = PV[w26] · 20/22/24 own rows.

| L | 6-12 | 14 | 16 | 18 | 20 | 22 | 24 |
|----|------|-----|-----|-----|-----|-----|-----|
| 20 | 1895 | 1995 | 2595 | 3495 | 3595 | 3695 | 3795 |
| 25 | 2395 | 2495 | 3295 | 4295* | 4395 | 4595 | 4695 |
| 30 | 2895* | 3095 | 3995 | 5195 | 5295 | 5495 | 5695 |
| 35 | 3395 | 3595 | 4595 | 6095* | 6195 | 6395 | 6595 |
| 40 | 3795 | 4095 | 5295 | 6995 | 7095 | 7295 | 7495 |
| 45 | 4290 | 4490 | 5890 | 7790* | 7990 | 8290 | 8490 |
| 50 | 4790 | 4990 | 6590 | 8590* | 8790 | 9190 | 9390 |
| 55 | 5290 | 5590 | 7290 | 9490 | 9690 | 10090 | 10390 |
| 60 | 5790 | 6190 | 7990 | 10390 | 10590 | 10990 | 11390 |
| 70 | 6790 | 7190 | 9190 | 12190 | 12390 | 12790 | 13190 |
| 80 | 7590 | 8190 | 10590 | 13990 | 14190 | 14590 | 14990 |
| 90 | 8685 | 9285 | 11985 | 15585 | 15885 | 16485 | 17085 |
| 100 | 9685 | 10285 | 13185 | 17385 | 17685 | 18285 | 18885 |

(* = PV-chart value, not directly probed; every directly-probed cell matched its PV
column exactly — 20+ verifications, zero misses.)

## Height adder — hAdj(Htall, L), width-independent (verified at 12/14/16/24w)
Tiers pair: {9} {10} {11,12} {13,14} {15,16} {17,18} {19,20} (17=18 & 19=20 verified).

| L | H9 | H10 | H11-12 | H13-14 | H15-16 | H17-18 | H19-20 |
|----|-----|-----|--------|--------|--------|--------|--------|
| 20 | 325 | 430 | 865 | 1535 | 2450 | 3360 | 3790 |
| 25 | 395 | 530 | 1035 | 1845 | 2895 | 3840i | 5115 |
| 30 | 470 | 625 | 1210 | 2150 | 3340 | 4320i | 5830 |
| 35 | 540 | 720 | 1380 | 2460 | 3785 | 4800i | 6510 |
| 40 | 610 | 815 | 1555 | 2765 | 4235 | 5280 | 7190 |
| 45 | 720 | 960 | 1900 | 3380 | 5345 | 7200 | 8905 |
| 50 | 790 | 1060 | 2070 | 3690 | 5790 | 7680 | 10230 |
| 55 | 865 | 1155 | 2245 | 3995 | 6235 | 8160 | 10945 |
| 60 | 940 | 1250 | 2420 | 4300 | 6680 | 8640 | 11660 |
| 70 | i | i | 2760 | 4920 | 7570 | i | i |
| 80 | 1220 | 1630 | 3110 | 5530 | 8470 | 10560 | 14380 |
| 90 | i | i | 3630 | 6450 | 10020 | i | i |
| 100 | i | i | 3970 | 7070 | 10910 | i | i |

(i = not probed — interpolate between neighbors and round to $5; H25/30/35 values in
the 17-18 column marked i were probed at 18? NO — they were probed: 3840/4320/4800
read directly at 16w H18. Only the 70/90/100 tails of H9/H10/H17-18/H19-20 are
interpolated.)

## 170 MPH + 4ft certification (14GA) — by length
20:300 · 25:325 · 30:350 · 35:375 · 40:400 · 45:625 · 50:650 · 55:675 · 60:700 ·
70:750 · 80:800 · 90:1050 · 100:1100. (Note the jump at 45'.)

## 12 Gauge
- By length (grand-verified at 150 MPH, multiple widths): 20:210 · 40:330 · 60:540 ·
  80:660 · 100:870 (other lengths: interpolate).
- **Sensei anomaly:** exactly 16×40 charges $1,220 (reproduced 3×, all radio states
  verified). Our tools replicate Sensei (price authority) but show a rep-facing note
  to verify 12GA pricing with CCI on a 16×40 order.
- 170-cert priced differently when 12GA: 20:150 · 40:510 · 60:660 · 80:1020 · 100:1170
  (replaces the 14GA cert ladder, does NOT stack with it).

## Extra Bows: flat $590 (same at L40 and L80).

## FREE-STANDING BUILDINGS (sheeted) = lean-to + walls + components
FSB "Open" with zero items = lean-to price EXACTLY (verified to the dollar).

### Walls (Custom = per-wall; Fully Enclosed = sum of all four)
**End walls** (front/back, each) — end(W, Htall), horizontal metal:
| W | 12 | 14 | 16 | 18 | 20 | 22 | 24 |
|-----|------|------|------|------|------|------|------|
| H9 | i | 815 | i | i | i | i | i |
| H11 | 1010 | 1200 | 1535 | 1745 | 1955 | 2165 | 2585 |
| H14 | 1370 | 1625 | 1925 | 2185 | 2440 | 2695 | 3205 |
(H9 non-14w & H15+ rows unprobed — scale by the 14w H-ratio and flag on quote.)

**Side walls** (each; priced by that side's OWN height × L), horizontal metal:
| side-H | L20 | L40 | L60 |
|--------|-----|-------|------|
| 7' | i | 537.50 | i |
| 8-9' | 330 | 645 | 930 |
| 10' | i | 752.50 | i |
| 11-12' | 440 | 860 | 1240 |
| 13-14' | 550 | 1075 | i |
(8' verified = 645 @L40; L-scaling ≈ linear-ish — interpolate other lengths,
round to $2.50.)

**Per-wall states:** 1/4, 1/2 (= Half End on ends), 3/4 = exact quarters of that
wall's Closed price (verified ends & sides — handbook's "half end = ½ end price"
rule generalized). Gable = flat $225 any width. Extended Gable = flat $450.

**Vertical orientation:** ends +$150 each (12w point), sides +$240 each @L20 /
+$420 each @L40 (charted by length — interpolate, flag long buildings).
**Lap Siding:** unprobed — quote via CCI.

### Components (flat, CCI catalog)
Roll-Up (default size) $750 — Sensei exposes no size editor; size upgrades via the
CCI certified-door chart with an order note.
Man Door $400 · Man Door (High Wind) $600 · Man Door Diamond Window $400 ·
6-Panel (High Wind) $800.
Windows: 4-Grid $200 · 4-Grid HW $675 · 4-Grid Impact $895 · Black Half Net $250 ·
6-Grid $225 · 6-Grid HW $675 · 6-Grid Impact $995.
Frame-outs: Roll-Up $150 · Man Door $90 · Window $75.

### Insulation
Full Roof = $1.6071/sqft of footprint (W×L): 450 @14×20, 900 @14×40 (linear ✓).
Full Building = roof + walls (walls portion 1,662 @14×40×11 ≈ $1.54/sqft wall area —
single point, provisional). Custom per-wall exists in Sensei.

### Storage rooms (End/Left/Right + depth selector)
Composite-priced by Sensei (16' end room @12×20×14 vertical = +$4,510). Deferred to
v2 — quote storage rooms via Sensei/CCI directly.

## Engine build notes
- New standalone btype for both products (open lean / sheeted building), single-slope.
- Order docs must carry: **"FREE-STANDING LEAN-TO (single slope) — NOT a carport"**
  per the handbook warning, plus tall/low side callouts.
- 3D: mono-slope roof, tall side / low side per the round(W×pitch/12) rule.
- Replaces the ltBasePrice() $7/sqft placeholder for CCI freestanding leans.
