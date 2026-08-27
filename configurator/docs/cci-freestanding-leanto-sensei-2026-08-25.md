# CCI Free-Standing Lean-To (Single Slope) — Sensei 2.0 sweep, 2026-08-25

Sampled live from Sensei 2.0 (Florida · Carolina Carports Inc · StormSafe dealer
login) driving the **Free Standing Lean-tos** product. Sensei itemizes base /
height / cert directly in its Built & Size panel; every grand total below
reconciled as base + height + cert exactly (Manufacturer Discount $0 — clean,
unlike the attached-lean quotes CCI corrected in July).

Parameterization: W (6–24, evens standard / odds custom) × L (20–300) ×
**one height H** (tall side; low side derived by pitch — e.g. 14w 2/12 H11 →
summary reads "11'/9' H"). Pitch 2/12 or 3/12 (both $0). Roof style
A-Frame / Vertical (both $0 — panel style only). Gauge 12/14. Certification:
Uncertified / 150 MPH ($0) / 170 MPH + 4ft ($ by length) / Other.

## Base price — width row (at L40, H11)
| W | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 | 22 | 24 |
|---|---|---|----|----|----|----|----|----|----|----|
| $ | 3,795 | 3,795 | 3,795 | 3,795 | 4,095 | 5,295 | 6,995 | 7,095 | 7,295 | 7,495 |

Widths 6–12 share one price. Steps: 14 +300 · 16 +1,200 · 18 +1,700 · then
+100/+200/+200.

## Base price — length row (at W14, H11)
| L | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 70 | 80 | 100 |
|---|----|----|----|----|----|----|----|----|----|----|----|-----|
| $ | 1,995 | 2,495 | 3,095 | 3,595 | 4,095 | 4,490 | 4,990 | 5,590 | 6,190 | 7,190 | 8,190 | 10,285 |

Cross point: 24×60 base = 11,390 (width factor persists at length).

## Height adder — tiers at L40 (H<10 not offered at 14w)
| H | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 18 | 20 |
|---|----|----|----|----|----|----|----|----|----|
| $ | 815 | 1,555 | 1,555 | 2,765 | 2,765 | 4,235 | 4,235 | 5,280 | 7,190 |

Paired tiers (11–12, 13–14, 15–16) like the huN chart. **Width-independent**
(24×40×12 → same 1,555). **Length-scaled and separable**:
hAdj(H, L) = tier(H) × fL(L) with fL = hAdj_H11(L)/1,555:
H11 by length: L20 865 · L40 1,555 · L60 2,420 · L80 3,110 · L100 3,970.
Check: H13@60 = 4,300 ≈ 2,765 × (2,420/1,555) = 4,303 ✓.

## 170 MPH certification (by length)
L20 300 · L40 400 · L60 700 · L80 800 · L100 1,100 (alternating +100/+300
per 20' — real, don't smooth). 150 MPH & Uncertified = $0.

## Options
- 12 Gauge: **+$440** at 14×40 (length/size dependence unsampled — flag).
- Pitch 3/12: $0. Roof style A-Frame vs Vertical: $0.
- Deposit = 17% of grand total (matches our tools).

## Free Standing Buildings (sheeted variant) — PARTIAL, needs a clean re-run
Same base/height/cert panel values as the lean. Clean anchors before the
walls-toggle state machine broke:
- 14×40×11 **Fully Enclosed = 10,855** → enclosure package +4,805 over lean.
- 14×40×11 walls **Open = 6,950** → +900 over the open lean (suspect 3 bay
  frame-outs @ ~$300 — unverified).
Walls: Open / Fully Enclosed / Custom · Storage: None/End/Left/Right/Both/
Both+Back · Siding Material Metal · Orientation Horizontal.
STILL NEEDED (clean pass or read off Jenna's screen): per-size Fully-Enclosed
vs Open deltas, custom per-wall prices, roll-up door add price, storage prices.

Raw sweep rows: cci-freestanding-leanto-sensei-raw-2026-08-25.json alongside.
