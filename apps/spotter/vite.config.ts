import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * Two entries: the app shell, and the service worker. The worker must land at
 * `/sw.js` (not under `/assets/`) or its scope cannot cover the whole origin.
 * Output goes to `apps/spotter/dist`, which is what the relay's
 * `wrangler.jsonc` serves as SPA assets.
 */
export default defineConfig({
  server: { host: '0.0.0.0', port: 5174 },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        sw: fileURLToPath(new URL('src/sw.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
