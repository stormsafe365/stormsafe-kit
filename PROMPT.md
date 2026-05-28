# Claude Code kickoff prompt

Paste this as your **first message** to Claude Code after `cd`-ing into the project folder.

---

## Setup before you paste (one-time)

1. Make a folder somewhere on your computer: `stormsafe-website/`
2. Drop `CLAUDE.md` (from this kit) at the root.
3. Make a subfolder `reference/` and copy your three existing HTML files into it:
   - `reference/index.html` (the customizer)
   - `reference/buildings-redesign.html` (the buildings gallery)
   - `reference/stormsafe-resources.html` (the resources hub)
4. Open a terminal in `stormsafe-website/` and run `claude` to start Claude Code.

Folder should look like:

```
stormsafe-website/
├── CLAUDE.md
└── reference/
    ├── index.html
    ├── buildings-redesign.html
    └── stormsafe-resources.html
```

---

## Paste this as your first message

> Read `CLAUDE.md` end-to-end before you do anything else. That's the source of truth for this project — brand, voice, colors, fonts, site map, page structure, technical conventions, and what "done" means for v1.
>
> Then open the three files in `/reference/` and study them carefully. Those are the existing StormSafe pages and they're the visual ground truth — same nav, same footer, same Orbitron+Inter type system, same teal-on-dark palette, same card patterns, same CTA buttons. Any new page I ask you to build should look like it was made by the same designer.
>
> Once you've read all four files, summarize back to me in 5–8 bullet points: (1) the brand voice in your own words, (2) the exact color tokens you'll use, (3) the two fonts and where each is used, (4) the global nav structure, (5) the v1 page list from CLAUDE.md §5, and (6) any questions you have before we start building. Do **not** generate any HTML yet — I want to confirm you've got the brief right first.
>
> After I approve your summary, we'll build pages one at a time in this order:
>
> 1. `index.html` (homepage)
> 2. `why-steel.html`
> 3. `hurricane-rated-steel-buildings.html`
> 4. `about-us.html`
> 5. `contact.html`
>
> Build each page as a single self-contained HTML file (matching the existing pattern — no React, no build step, hand-written CSS using the tokens in CLAUDE.md §4.1). Each page must pass the v1 checklist in CLAUDE.md §12 before we move on. When a page is done, show me the file path and a quick summary of what's on it, then wait for my review before starting the next one.

---

## Follow-up prompts you can use later

**To add a new page:**
> Add `<page-name>.html` following the CLAUDE.md spec. Match the existing nav, footer, and design tokens. Show me a quick outline of the sections before you write the file.

**To draft a blog post:**
> Draft a blog post for `/blog/<slug>.html` targeting the keyword "<keyword>". Follow CLAUDE.md §10 — 1,200–1,800 words, one H1, structured H2s, a comparison table if it fits, internal links to at least 2 other site pages, and end with a CTA to /customize.

**To make a small change:**
> In `<file.html>`, update the hero headline to "<new headline>". Keep everything else identical. Show me the diff before saving.

**To audit consistency:**
> Audit every `.html` file in this folder against CLAUDE.md §4 (design system) and §12 (v1 checklist). List anything that drifts from the spec, file by file, but don't fix anything yet — just give me the report.

**To regenerate the nav across pages:**
> The nav in `<file.html>` is the canonical version. Update every other `.html` page in the root folder to use that exact nav markup. Don't change anything else.

---

## Tips while working with Claude Code

- **Commit between pages.** After each page is approved, `git add . && git commit -m "Add <page>"`. Easy rollback if a later change breaks something.
- **Keep CLAUDE.md updated.** When you change a price, add a new page, or change brand voice, edit CLAUDE.md first, then ask Claude Code to re-read it.
- **Don't let it invent.** If Claude Code suggests a new section, USP, certification, or price that isn't in CLAUDE.md, stop and verify. Made-up specs are the #1 risk with AI-written marketing copy.
- **Watch for AI tells.** Reject any copy with "elevate," "unleash," "world-class," "cutting-edge," "in today's fast-paced world," or em-dash overuse. CLAUDE.md §3 lists the voice rules — point Claude Code back to that section.
- **Test on your phone.** Open each HTML file on mobile (or DevTools mobile view at 375px width) before approving. Most steel-buildings traffic is mobile.
- **Use it for the Wix migration too.** Once you have a page you like, ask Claude Code to "convert this to a Wix HTML embed block" — it'll strip the parts Wix wraps for you (html/head/body) and inline everything you need.
