# StormSafe Steel — Website Build Brief

This file is the source of truth for the StormSafe Steel website. Read it before generating any page, component, or copy. Re-read it any time you're unsure about voice, colors, structure, or which page goes where.

---

## 1. Business snapshot

- **Name:** StormSafe Steel
- **Domain:** stormsafesteel.com
- **HQ:** West Palm Beach, FL
- **Phone:** 561-771-5555 (use this on every page in the nav + footer)
- **What we sell:** Custom hurricane-rated steel buildings — garages, carports, RV covers, commercial, agricultural, and fully custom builds.
- **Service area:** Florida-first, with a focus on hurricane-prone coastal counties.
- **Lead magnet:** Free quote + free 3D rendering of the customer's specific building.

## 2. Positioning & USPs

Always lead with these four trust signals (they appear in the existing hero trust strip):

| Metric | Label |
|---|---|
| **170+** | MPH Wind Rated |
| **20-yr** | Rust Warranty |
| **FL** | Code Certified |
| **Lifetime** | Building Warranty |

**Differentiators to weave through copy:**

- Engineered to 170+ mph winds, certified to Florida code.
- 14-gauge standard / 12-gauge available for high-wind zones.
- Hi-Impact rated doors and windows for coastal FL counties.
- Free 3D rendering with every quote — customer sees their actual building before signing anything.
- Configure a build in ~60 seconds on the site (no email gate to see a quote).

## 3. Voice & tone

- **Confident, technical, no-fluff.** We're engineers and builders, not a marketing agency.
- **Direct, masculine, industrial.** Think aerospace-spec, not country-folksy.
- **Specific over vague.** "30' × 50' × 14', starts at $23,200" beats "spacious workshop building."
- **Customer-side language.** "Your build," "your county," "your concrete pad" — not "the customer's."
- **Florida-aware.** Hurricane season, coastal codes, tariffs, salt air — these are part of the customer's world. Mention them.
- **Never** use "cutting-edge," "world-class," "industry-leading," "unleash," or any AI/marketing cliché.
- **Never** invent stats, certifications, or warranties. If a number isn't in this file, ask Jenna before publishing it.

## 4. Design system

### 4.1 Color tokens (use CSS variables — do not hardcode)

```css
:root {
  /* Brand */
  --teal:        #22d3c8;            /* primary accent — CTAs, links, key numbers */
  --teal-dim:    #1ab5ab;            /* hover states */
  --teal-glow:   rgba(34,211,200,.10); /* subtle backgrounds */

  /* Surfaces (dark theme — site is dark by default) */
  --dark:        #08121d;            /* page background */
  --dark-2:      #111827;            /* card / section background */
  --dark-3:      #1a2436;            /* nested card / input background */
  --dark-4:      #1f2d42;            /* hover surface */

  /* Borders */
  --border:      #1e2d42;            /* subtle dividers */
  --border-vis:  #2a3d55;            /* visible borders, inputs */

  /* Text */
  --text:        #e2e8f0;            /* primary text */
  --sub:         #94a3b8;            /* secondary text, meta */
  --muted:       #64748b;            /* tertiary text, placeholders */

  /* Status */
  --danger:      #f87171;
  --warning:     #fbbf24;
  --success:     #34d399;
}
```

### 4.2 Typography

- **Headers:** `Orbitron` — weights 600, 700, 800, 900. Use uppercase + tracked-out letter-spacing (`.04em`–`.08em`) for nav, eyebrows, and section headers. Orbitron is the StormSafe header font, full stop.
- **Body:** `Inter` — weights 300, 400, 500, 600, 700. Default body 16px, line-height 1.6.
- **Load both from Google Fonts** with `preconnect` + a single combined stylesheet link.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

### 4.3 Layout & component rules

- **Dark theme by default.** Body background is `--dark`. No light mode.
- **Sticky top nav, 56px on mobile / 60px on desktop**, backdrop-blur, `rgba(8,18,29,.97)` background.
- **Logo wordmark:** "Storm**Safe** Steel" — `Storm` and ` Steel` in `--text`, `Safe` in `--teal`. Orbitron 800, uppercase, letter-spacing `.04em`.
- **Primary CTA button:** background `--teal`, text `#08121d`, Inter 700, no border, generous padding.
- **Ghost CTA:** transparent background, 1px `--teal` border, `--teal` text.
- **Cards:** background `--dark-2`, 1px `--border-vis`, 10px radius, hover lifts/teal-glow border.
- **Section eyebrows:** small (11–13px), `--teal-dim`, uppercase, tracked-out, sit above big headlines.
- **`theme-color` meta tag:** `#08121d` (so mobile browser chrome matches).
- **Smooth scroll** on the html element.
- **Mobile-first.** Mobile breakpoint < 768px. Tablet 768–900px. Desktop 900px+.
- **`prefers-reduced-motion`** respected on any animated element.

### 4.4 Imagery

- Use real photos of steel buildings from `static.wixstatic.com` URLs already in the reference HTML when applicable (these are existing Wix-hosted assets).
- If a placeholder is needed, use a solid dark card with a teal icon — never use stock office photos or random Unsplash images.

## 5. Site map & page intent

Build these pages. Each one has a single conversion goal: get the visitor to the customizer or to call.

| Path | Purpose | Primary CTA |
|---|---|---|
| `/` (home) | Brand intro + funnel to customizer | Design Your Build → /customize |
| `/buildings` | Gallery of all build types | Customize → /customize |
| `/customize` | 6-step interactive build configurator (placeholder OK for v1 — link from CTAs) | Send quote request |
| `/residential-garages` | Garage-specific landing | Customize a garage |
| `/carports-rv-covers` | Open-air covers landing | Customize a carport |
| `/commercial-steel-buildings` | Commercial landing | Talk to a specialist |
| `/agricultural-steel-buildings` | Ag/farm landing | Talk to a specialist |
| `/custom-steel-buildings` | Custom-build gallery | Call 561-771-5555 |
| `/hurricane-rated-steel-buildings` | Hurricane-rating explainer (high-SEO page) | Get a free quote |
| `/why-steel` | Steel vs. wood vs. concrete (educational, high-SEO) | Design Your Build |
| `/about-us` | Company story, FL roots | Contact |
| `/blog` | SEO blog index (one post / week cadence) | Get a quote |
| `/contact` | Phone, form, hours, service area map | Submit form / call |
| `/resources` | Budget estimator, financing info, project checklist (already exists as an embed) | Get a quote |

## 6. Global navigation

**Top nav (desktop):** Logo · Buildings · Customize · Why Steel · About · Contact · `561-771-5555` (teal) · **Design Yours →** (teal CTA button)

**Mobile menu (hamburger):** Home · Buildings · Customize · Hurricane-Rated · Custom Builds · Why Steel · About · Blog · Contact · **Call 561-771-5555** (teal CTA)

**Footer:** Logo + tagline (left) · Quick links column · Buildings column · Contact column (phone, email, address: West Palm Beach, FL) · social row · copyright line.

## 7. Homepage structure (ordered)

1. **Hero** — Eyebrow: `Hurricane-Rated · West Palm Beach, FL` / H1: `Steel Built To` *(line break)* `Outlast The Storm.` (the second line in `--teal`) / Lede: 1–2 sentences about custom hurricane-rated buildings / Three CTAs: primary (Design Your Build), ghost (Browse Gallery), secondary (Call 561-771-5555).
2. **Trust strip** — the four metric tiles from §2.
3. **Category pills** — All Builds / Garages / Carports & RV / Commercial / Agricultural / Custom.
4. **Featured builds** — three "Most Requested" cards with rank badges (01, 02, 03), photo, title, dimensions, short description, starting price, and "Customize →" mini-CTA. Cards are clickable to /customize and have an inline quote request form that slides out.
5. **Category sections** — Garages, Carports/RV, Commercial, Agricultural, Custom — each with a header (eyebrow tag like `01 · Residential`, H3, meta line with starting price) and a 3–4 card grid.
6. **Why StormSafe** — 3-up of icons + short copy: Engineered for FL · Free 3D Rendering · 60-Second Configurator.
7. **Final CTA band** — full-width dark, big headline, primary CTA, phone number.

## 8. Pricing references (use these starting prices, don't invent new ones)

- Garages from **$6,600** (single-bay) up to **$23,200** (30×60 four-bay).
- RV Cover example: **$20,400** (20×30×14).
- Workshop example: **$23,200** (30×50×14).
- Commercial example: **$46,200** (insulated, lift-ready).
- Custom builds: "By Design" / "Quote on request."

Always note: *"Prices subject to change based on steel market conditions and local engineering requirements."*

## 9. Technical conventions

- **Stack default:** plain HTML + CSS + minimal vanilla JS, single file per page. Match the existing project HTML style — no React/Next unless Jenna asks. Existing pages are designed to drop into Wix as HTML embeds, so keep everything self-contained per page.
- **No external CSS frameworks** (no Tailwind, no Bootstrap). Hand-written CSS using the tokens above.
- **No build step required.** A page should work by opening the `.html` file in a browser.
- **Icons:** Tabler Icons via CDN (`@tabler/icons-webfont`) — already used in resources page.
- **Forms:** mailto-based or simple POST to a placeholder endpoint Jenna will wire up. Always include name, email, phone, optional notes.
- **SEO basics on every page:**
  - Unique `<title>` (≤ 60 chars) including the page topic + "StormSafe Steel."
  - Unique meta description (≤ 155 chars).
  - One `<h1>` per page.
  - `<meta name="theme-color" content="#08121d">`.
  - Open Graph + Twitter card tags.
- **Accessibility:** semantic HTML, alt text on every image, focus states visible, color contrast AA minimum, `aria-label` on icon-only buttons.
- **Performance:** lazy-load images below the fold, `preconnect` to fonts and `static.wixstatic.com`, avoid render-blocking JS.

## 10. SEO content plan (Jenna's blog cadence)

The blog publishes **one post per week** focused on Florida + steel building search intent. When asked to draft a post:

- Target one specific keyword per post (e.g., "hurricane-rated garage cost Florida," "30x40 metal building Florida," "RV carport West Palm Beach").
- 1,200–1,800 words.
- Sections with H2s answering specific questions; H3s for sub-points.
- Include a comparison table or numbered list when it fits naturally.
- End with a CTA to `/customize` or a phone link.
- Internal-link to at least 2 relevant pages from §5.

## 11. Reference files

Three existing HTML pages are in `/reference/` (Jenna will drop them in):

- `index.html` — the 6-step customizer (the most polished design reference)
- `buildings-redesign.html` — the buildings gallery page (current production design)
- `stormsafe-resources.html` — the resources hub with budget estimator, financing, checklist

**Treat these as the visual ground truth.** Match their spacing, color usage, button styling, card patterns, and Orbitron+Inter typography exactly. If a new page needs a component that already exists in these files (nav, footer, quote form modal, card grid), lift the existing pattern rather than inventing a new one.

## 12. What "done" looks like for v1

A first pass is complete when:

- [ ] `/` (home), `/buildings`, `/why-steel`, `/about-us`, `/contact` exist as standalone HTML files.
- [ ] Nav and footer are visually identical across every page.
- [ ] Every page has the trust strip and at least one path to `/customize`.
- [ ] All color, font, and spacing tokens match §4.
- [ ] Mobile (< 768px) layout is verified — nav collapses, CTAs stack, cards reflow to single column.
- [ ] No Lorem Ipsum. No placeholder phone numbers. No invented prices.
- [ ] Each page passes a basic Lighthouse pass: SEO ≥ 95, Accessibility ≥ 95, Best Practices ≥ 95.

## 13. When you're not sure — ask

If a request is ambiguous (e.g., "make a services page" — we don't have one in §5), stop and ask Jenna before generating. Better to clarify than to invent a page that doesn't fit the funnel.
