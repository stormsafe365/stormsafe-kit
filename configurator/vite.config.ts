import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the production build loads from a local file://
  // (the offline Electron desktop app) — absolute "/assets/…" paths only work
  // when served from a web root.
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Multi-page build. Vite only builds index.html by default; the desktop app
    // opens build.html (the split price + 3D view), so it must be an explicit
    // input or it won't end up in dist/. (quote-builder.html lives in public/
    // and is copied to dist/ as-is.)
    rollupOptions: {
      input: {
        build: fileURLToPath(new URL('./build.html', import.meta.url)),
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        pricecheck: fileURLToPath(new URL('./pricecheck.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5174,
    open: true,
    // Windows file events are unreliable here — poll so edits are always
    // detected and HMR actually fires (otherwise the browser runs stale code).
    watch: { usePolling: true, interval: 200 },
  },
});
