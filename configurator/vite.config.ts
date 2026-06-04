import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
