# StormSafe web customizer (customer 3D builder)

A customer-facing build of the 3D builder for **stormsafesteel.com/customize**. Visitors set the size, roof, walls, wainscot, lean-tos (including wrap-around corners), doors, windows and framed openings, and the colors. They can drag doors and windows on the model and switch between the Exterior and Structure views.

The page shows **no prices**. It has **no rep controls**: no gauge, no on-center spacing, no certification, no manufacturer. It never names a manufacturer, and it has no quote, contract or PDF buttons.

| What | Where |
|---|---|
| Static site (upload this folder) | `Desktop/StormSafe/web-customizer/dist/` (`index.html` + `assets/`, relative paths) |
| This file + test page | `Desktop/StormSafe/web-customizer/README.md`, `embed-test.html` |
| Source | repo `Desktop/StormSafe/claude.code/3D Builder`, branch `web-customizer`: `configurator/web-customer/` + `configurator/vite.web.config.ts` |

## Embed it

```html
<iframe
  id="ss-customizer"
  src="https://YOUR-HOST/customize/index.html?zip=33401&county=Palm%20Beach&impact=1"
  title="Design your building"
  style="width:100%;height:85vh;min-height:560px;border:0"
  allow="fullscreen"></iframe>
```

It works in an iframe and on phones. On a phone the model sits on top and the options sit below, with touch to orbit, pinch to zoom and drag to move a door. Give the iframe a real height, such as `85vh`. Inside the frame the page scrolls its own options panel, so the iframe itself never needs to scroll.

### URL parameters

| Param | Values | Effect |
|---|---|---|
| `zip` | 5 digits (ZIP+4 keeps the first 5) | Shown in the spec. Anything else is ignored. |
| `county` | A Florida county in any common spelling (`Palm Beach`, `Palm Beach County`, `St Lucie`, `miami dade`) | Shown in the spec. Sets 12-gauge framing and 4′ OC in the drawing (Palm Beach, and hi-wind counties over 24′ wide), as the quote does. Unknown values are ignored. |
| `impact` | `1` / `true` / `yes`, or `0` / `false` / `no` | **1**: shows an orange *Hi-Impact area* notice and offers only impact-rated walk doors and windows (impact 30″ × 30″ / 30″ × 36″ windows, impact-rated hi-wind door). Roll-up doors stay as they are because they are already certified. **0**: turns the notice off. **Not set**: the county rule the quote applies (Charlotte, Collier, Hillsborough, Indian River, Lee, Palm Beach, Sarasota, St. Lucie, Volusia, plus Okaloosa and Okeechobee over 720 sq ft). |

## postMessage API

All messages are plain objects. The customizer only listens to **its own parent window**, and only when that parent is on an **allowed origin** (see below). It replies to the parent's origin. It uses `"*"` only when the parent's origin is `"null"`, because a null origin cannot be targeted.

### Messages from the customizer

| Message | When |
|---|---|
| `{ type: 'ss-ready', v: 1 }` | Once on load. Sent only when the embedding page's origin (from `document.referrer`) is allowed. You can also send a request without waiting for it. |
| `{ type: 'ss-design', v: 1, id, state, spec, image, images?, imageSource }` | The reply to `ss-request-design`. |
| `{ type: 'ss-design-loaded', v: 1, id, ok, error? }` | The reply to `ss-load-design`. |

### Request the design

```js
const frame = document.getElementById('ss-customizer');
const CZ_ORIGIN = new URL(frame.src).origin;

frame.contentWindow.postMessage({ type: 'ss-request-design', id: 'lead-123' }, CZ_ORIGIN);
// Add allViews: true to also get front / back / left / right pictures.

window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || e.origin !== CZ_ORIGIN) return;
  const m = e.data;
  if (m.type === 'ss-design' && m.id === 'lead-123') {
    // m.state  -> save it with the lead (JSON); send it back later to reopen the design
    // m.spec   -> plain-text spec for the rep / the email
    // m.image  -> 'data:image/jpeg;base64,…' ISO picture, about 1600 px wide, light background
    // m.images -> { iso, front, back, left, right } when allViews was true (1200 px)
    // m.imageSource -> 'capture' (the capture tool) or 'live' (fallback, see below)
    // m.error  -> only if no picture could be made (state + spec are still there)
  }
});
```

* `id` is optional: a string of up to 64 characters (`A-Z a-z 0-9 _ . : -`) or a number. It is echoed back.
* While the picture is made, the customizer shows "Preparing your picture…". This takes about 1–3 s on a desktop and longer on phones.
* The picture comes from the existing capture tool on the **light** theme: light background, bright and even lighting, and a thin outline. The camera sweeps through the views and then returns to the 3D view. If that capture fails, for example from memory on an old phone, the live view is grabbed instead (`imageSource: 'live'`), so a request is never answered without a picture.
* `images.left` / `images.right` are the customer's left and right sides **as seen from the front**.

### Reopen a saved design

```js
frame.contentWindow.postMessage({ type: 'ss-load-design', id: 'reopen-1', state: savedState }, CZ_ORIGIN);
// reply: { type: 'ss-design-loaded', id: 'reopen-1', ok: true }
//    or { type: 'ss-design-loaded', id: 'reopen-1', ok: false, error: 'state.schema must be "ss-web-design"' }
```

Before a state is applied, the customizer checks its shape: schema, version, types, list sizes (at most 40 doors and windows, 4 lean-tos and 12 parts per lean-to) and a 256 KB size cap. Then it normalizes the state against the build rules: sizes snap to the offered options, unknown colors fall back, and duplicate ids are renumbered. The impact rule of the **current** URL is applied again, so a design saved elsewhere picks up this visitor's area. `state.ctx` is informational only.

### `state` shape (v1)

```jsonc
{
  "schema": "ss-web-design", "v": 1,
  "design": {
    "type": "garage",                 // garage | carport | combo (garage in back + carport in front)
    "width": 24, "length": 30, "height": 10,   // ft, W × L × H (height = eave)
    "enclosedLength": 20,             // combo only: garage length at the back
    "roofStyle": "Vertical",          // Vertical | Boxed Eave | Regular
    "pitch": "standard",              // standard (3:12, 2:12 over 31' wide) | 4:12 | 5:12
    "panels": "Horizontal",           // wall panels: Horizontal | Vertical
    "walls": { "front": "closed", "back": "closed", "left": "closed", "right": "closed" },
    "colors": { "roof": "galvalume", "walls": "pewter-gray", "trim": "black", "wainscot": "quaker-gray" },
    "wainscot": false,
    "openings": [ { "id": "o1", "kind": "rollup", "wall": "front", "w": 10, "h": 8, "sill": 0, "pos": 7, "color": "white" } ],
    "leanTos": [ { "id": "lt1", "side": "Left Eave", "width": 12, "length": 30, "start": 0, "lowLeg": 8, "pitch": "2:12",
                   "enclosure": "open", "walls": { "front": "open", "back": "open", "side": "open" }, "openings": [] } ],
    "wraps": []                        // wrap-around corners: FL FR BL BR
  },
  "ctx": { "zip": "33401", "county": "Palm Beach", "impact": true }
}
```

Left and right are always as seen standing in front of the building, facing the front end. They are the same as the quote program's Left / Right Eave Side.

Opening `pos` is the number a rep types in the program: feet from the reference end to the **near edge**. For the sides that is the front gable. For the front end and the divider wall it is the left-eave corner. For the back end it is the right-eave corner.

Lean-to opening `pos` is the program's lean-to "Custom offset (ft from left)".

### `spec` (plain text)

The spec lists sizes as W × L × H. It lists the roof, each wall, the colors and the wainscot. It lists every door, window and framed opening with its wall, size and position in the program's words, for example `Left side, 9' from the front gable to its near edge`. It lists each lean-to with its size, low leg, pitch, Starts At, walls, wrap-around corners and parts. It ends with the location (ZIP / county) and the impact note.

The spec has no prices and no manufacturer names, and it gives no wind numbers.

## Allowed origins

Messages from any other origin are ignored, with a console warning. The default list is:

```
https://stormsafesteel.com
https://www.stormsafesteel.com
https://stormsafesteel.pages.dev
https://*.stormsafesteel.pages.dev            (staging + preview deploys)
https://www-stormsafesteel-com.filesusr.com    (the Wix HTML-embed frame, until the cutover)
http://localhost:*   http://127.0.0.1:*         (local testing / embed-test.html)
```

To change the list, set it at build time. Pattern forms are an exact origin, `https://*.domain` (any subdomain), `http://host:*` (any port) and `null`:

```bash
VITE_SS_ALLOWED_ORIGINS="https://stormsafesteel.com,https://www.stormsafesteel.com,https://*.stormsafesteel.pages.dev" \
  npx vite build --config vite.web.config.ts
```

On Windows PowerShell: `$env:VITE_SS_ALLOWED_ORIGINS="…"; npx vite build --config vite.web.config.ts`.

## Rebuild

From `Desktop/StormSafe/claude.code/3D Builder-webcust/configurator`, on branch `web-customizer`:

```bash
npx vite build --config vite.web.config.ts     # → ../../../web-customizer/dist (+ README.md, embed-test.html)
npx tsc -p web-customer --noEmit               # typecheck the customer code
npx vitest run web-customer                    # spec / validation / mapping tests
```

Set `SS_WEB_OUT=<folder>` to write `dist` somewhere else. The normal desktop / CRM build (`npm run build`) is untouched by all of this: it has its own config, no shared file was edited, and its output stays byte-identical.

## Test page

`embed-test.html` iframes `dist/index.html?zip=33401&county=Palm%20Beach&impact=1`. It has buttons for request, request with all views, load the state box, load a sample (lean-tos and a wrap-around corner) and send a bad state. Serve the folder over http, because module scripts do not run from `file://`:

```bash
npx vite preview --config vite.web.config.ts   # serves dist/ only
# or any static server on Desktop/StormSafe/web-customizer, then open /embed-test.html
```

## How pricing and rep-only parts are kept out

* **No quote program.** The customizer does not load `quote-builder.html`, even hidden. Its source contains the whole dealer price book. The web build has `publicDir: false`, so the file is not copied either.
* **Its own panel.** The customer panel (`web-customer/src`) drives the shared 3D store directly. Gauge, on-center spacing, wind certification, manufacturer, foundation and sheeting are set internally from the build rules (`model/rules.ts`). They are never shown and never sent out: `state` holds only customer choices.
* **Zeroed estimator.** The shared 3D pipeline imports a placeholder estimator (`src/config/pricing.ts`). The web build aliases it to `web-customer/stubs/pricing.ts`, where every number is zero.
* **Rep-only drag cues.** The drag guides normally show red truss lines and a "⚠ on truss" chip. That is a side-frame pricing cue, so it is removed at build time by `vite.web.config.ts`, for the web build only. The build fails if the shared code changes and a patch no longer matches.

## Notes

* The rules are copied from the quote program: door sizes per wall, lean-to fit, wrap-around corners, roof and pitch, truss spacing and the impact counties. A web design is a request, not a quote. The rep re-enters it in the program, which checks everything again.
* The page uses a hosted font (Inter, Google Fonts). Everything else is in `dist/`.
