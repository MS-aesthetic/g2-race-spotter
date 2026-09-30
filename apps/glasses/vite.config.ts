import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

/**
 * The Even app reads `app.json` (network whitelist, entrypoint) next to the
 * `index.html` it loads, so the hosted build carries a copy in its root.
 */
function appManifest(): Plugin {
  return {
    name: 'g2rs-app-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'app.json',
        source: readFileSync(
          fileURLToPath(new URL('app.json', import.meta.url)),
          'utf8',
        ),
      });
    },
  };
}

/**
 * Builds are hosted by the relay at `/glasses/` (T058, spec 070 Decision
 * 2026-09-30); the dev server stays at `/` so `evenhub qr --url
 * http://<ip>:5173` and the simulator harness keep working unchanged.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/glasses/' : '/',
  server: { host: '0.0.0.0', port: 5173 },
  build: { target: 'esnext' },
  plugins: [appManifest()],
}));
