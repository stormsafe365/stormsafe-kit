# StormSafe Steel — Parametric 3D Building Configurator

A web-based, parametric CAD configurator for steel tube-frame carports and
garages. Change dimensions and steel specs on the left; the 3D model and the
Bill of Materials / price regenerate live from the same engine.

## Run it

```bash
cd configurator
npm install
npm run dev        # http://localhost:5174
npm run typecheck  # strict TS, no emit
npm run build      # production bundle
```

## The four layers

| Layer | Folder | Responsibility |
|---|---|---|
| **1. Configuration State** | `src/store`, `src/types`, `src/config` | Zustand store + typed `BuildingConfig`, dimension domains, material/price tables. |
| **2. Parametric Rule Engine** | `src/engine/ruleEngine.ts`, `geometry.ts` | Enforces construction rules, then derives explicit steel members in world space. Pure functions. |
| **3. 3D Render Layer** | `src/three`, `src/components/Viewport.tsx` | R3F scene. Generatively builds tubing (no static models), scales members by gauge, adds hat channels for vertical sheeting, applies a procedural corrugated texture with 90° UV rotation on orientation change. |
| **4. BOM & CPQ** | `src/engine/bom.ts`, `src/components/BomPanel.tsx` | Sums member lengths / panel areas into linear ft, sqft, trim, weight, and a priced quote. |

The single pipeline `store → resolveBuilding → deriveStructure → generateBOM →
generateQuote` lives in `src/engine/useResolvedBuilding.ts`. Both the canvas and
the CPQ panel consume it, so the picture and the price can never disagree.

## Enforced construction rules (`ruleEngine.ts`)

1. **Width ≥ 30 ft → forces 12-gauge** framing and locks out 14-gauge in the UI.
2. **Vertical sheeting → `requiresHatChannels: true`**, which adds horizontal
   wall girts to the geometry *before* the siding is skinned.
3. **Frame count = `Math.ceil(length / spacing) + 1`**, spacing 5 ft default,
   4 ft under the snow-load package.

## Data model (`types/building.ts`)

`width · length · legHeight · framingGauge · sheetingGauge · panelOrientation ·
roofPitch · snowLoad · enclosed · openings[]` — the `openings` array is the
Component Layout tracker for garage doors, walk-in doors, and windows.

## Next steps (phase 2)

- Drag-to-place opening editor (data model + BOM pricing already wired).
- Color/finish picker feeding the panel material.
- PDF quote export from the `Quote` object.
- Persist/share builds via URL-encoded config.

> Pricing is an estimate engine — tune the knobs in `src/config/pricing.ts`.
> "Prices subject to change based on steel market conditions and local
> engineering requirements."
