/**
 * CUSTOMER WEB BUILD (stormsafesteel.com/customize) — a separate Vite build.
 *
 *   npx vite build --config vite.web.config.ts
 *
 * It never touches the desktop / CRM build: its own root (web-customer/), its
 * own entry, no public/ folder (quote-builder.html and its price book never
 * ship), and output OUTSIDE this repo (../../../web-customizer/dist =
 * Desktop/StormSafe/web-customizer/dist; override with SS_WEB_OUT). The shared
 * 3D code under src/ is imported as-is; vite.config.ts, package.json and src/
 * are untouched, so `npm run build` stays byte-identical.
 *
 * Build-time options (env):
 *   VITE_SS_ALLOWED_ORIGINS  comma-separated postMessage origins (README.md)
 *   SS_WEB_OUT               output folder for dist/ (README + embed-test go next to it)
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const posix = (p: string) => p.replace(/\\/g, '/');
const outDir = process.env.SS_WEB_OUT ? path.resolve(process.env.SS_WEB_OUT) : path.resolve(here, '../../../web-customizer/dist');

/**
 * Customer-view patches applied to the SHARED 3D source at build time, web
 * build only (the files in src/ are not changed). The drag guides show the
 * frame legs in red and a "⚠ on truss" chip when a door lands on a truss —
 * that is a rep pricing cue (a side frame is added and priced), so the
 * customer sees the clean dimension guides instead. Every pattern must match
 * exactly once or the build fails, so a change to the shared code is noticed.
 */
const PATCHES: Array<{ file: string; find: string; replace: string }> = [
  {
    file: 'src/three/Openings.tsx',
    find: 'const guideTrusses = trusses.filter(',
    replace: 'const guideTrusses = ([] as number[]).filter(',
  },
  {
    file: 'src/three/Openings.tsx',
    find: 'const hit = checkCollision(offset, w, wall).hit;',
    replace: 'const hit = false && checkCollision(offset, w, wall).hit;',
  },
  {
    file: 'src/three/LeanToSiding.tsx',
    find: 'const guideTrusses = trusses.filter(',
    replace: 'const guideTrusses = ([] as number[]).filter(',
  },
  {
    file: 'src/three/LeanToSiding.tsx',
    find: 'const hit = trusses.some((p) => p >= L - clear && p <= R + clear);',
    replace: 'const hit = false && trusses.some((p) => p >= L - clear && p <= R + clear);',
  },
];

function customerPatches(): Plugin {
  const applied = new Set<number>();
  return {
    name: 'ss-web-customer-patches',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/');
      let out = code;
      PATCHES.forEach((p, i) => {
        if (!file.endsWith(p.file)) return;
        const n = out.split(p.find).length - 1;
        if (n !== 1) this.error(`web patch #${i} expected 1 match in ${p.file}, found ${n} — update vite.web.config.ts`);
        out = out.replace(p.find, p.replace);
        applied.add(i);
      });
      return out === code ? null : { code: out, map: null };
    },
    buildEnd(err) {
      if (err) return;
      const missing = PATCHES.map((_, i) => i).filter((i) => !applied.has(i));
      if (missing.length) this.error(`web patches not applied: ${missing.join(', ')}`);
    },
  };
}

/** README.md + embed-test.html go next to dist/. */
function copyDocs(): Plugin {
  return {
    name: 'ss-web-customer-docs',
    apply: 'build',
    closeBundle() {
      const dest = path.dirname(outDir);
      mkdirSync(dest, { recursive: true });
      for (const f of ['README.md', 'embed-test.html']) copyFileSync(path.resolve(here, 'web-customer', f), path.join(dest, f));
    },
  };
}

export default defineConfig({
  root: path.resolve(here, 'web-customer'),
  base: './',
  publicDir: false,
  plugins: [customerPatches(), react(), copyDocs()],
  resolve: {
    alias: [
      // Zeroed estimator constants: no price numbers in the public bundle.
      { find: '@/config/pricing', replacement: posix(path.resolve(here, 'web-customer/stubs/pricing.ts')) },
      { find: /^@\//, replacement: posix(path.resolve(here, 'src')) + '/' },
    ],
  },
  css: { postcss: { plugins: [] } },
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
  server: { port: 5181 },
  preview: { port: 5182 },
});
