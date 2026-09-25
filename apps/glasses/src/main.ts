/**
 * Composition root. No logic lives here — every decision belongs to a module
 * that runs in Node under vitest. Startup order is fixed by the
 * `g2-hud-display` skill: bridge → settings → render mode → ONE
 * `createStartUpPageContainer` → socket.
 */

import { RoomClient } from '@g2-race-spotter/protocol';

import type { BridgeCallLog } from './bridge.ts';
import { mountCompanion } from './companion.ts';
import { createEvenBridge } from './even-bridge.ts';
import { startDriver } from './driver.ts';
import { STATUS_NO_ROOM, statusConnecting } from './link.ts';
import { resolveRenderMode } from './render/mode.ts';
import { RenderQueue } from './render/queue.ts';
import {
  driverUrl,
  evenAppWarning,
  isValidRoom,
  loadSettings,
  resolveRelayBase,
  saveSettings,
  seedFromSearch,
  type Settings,
} from './settings.ts';
import { buildPage, createStartupPage } from './startup-page.ts';

const bridge = await createEvenBridge();
let settings = seedFromSearch(
  await loadSettings(bridge),
  globalThis.location?.search ?? '',
);

const mode = resolveRenderMode({
  search: globalThis.location?.search,
  kv: settings.render,
});
const relayBase = resolveRelayBase({
  search: globalThis.location?.search,
  origin: globalThis.location?.origin,
  fallback: import.meta.env.VITE_RELAY_URL,
});

const root = document.getElementById('app');
const companion =
  root === null
    ? undefined
    : mountCompanion({
        root,
        settings,
        mode,
        warning: evenAppWarning(mode),
        onSave: (next) => {
          void applySettings(next);
        },
      });

const log = (entry: BridgeCallLog): void => {
  console.info('g2rs.bridge', entry);
  companion?.append(entry);
};

const initialStatus = isValidRoom(settings.room)
  ? statusConnecting()
  : STATUS_NO_ROOM;

const startPage = createStartupPage(
  bridge,
  buildPage({ mode, status: initialStatus }),
  log,
);

if (!(await startPage())) {
  companion?.setStatus('Could not create the glasses page. Restart the app.');
  console.warn('g2rs.startup-page unavailable');
}

const queue = new RenderQueue({
  bridge,
  mode,
  log,
  onModeChange: (next) => {
    companion?.setStatus(`image send failed - fell back to ${next} mode`);
  },
});

const client = new RoomClient({
  WebSocket,
  role: 'driver',
  ...(settings.name === '' ? {} : { name: settings.name }),
});

const driver = startDriver({
  bridge,
  client,
  queue,
  hasRoom: isValidRoom(settings.room),
  initialStatus,
  now: () => Date.now(),
  connect: () => {
    connect();
  },
  log,
});

client.onConnection((state) => {
  companion?.setStatus(`socket ${state}`);
});
client.onError((error) => {
  companion?.setStatus(`relay error: ${error.code}`);
});

function connect(): void {
  if (!isValidRoom(settings.room)) {
    return;
  }

  client.connect(
    driverUrl({
      base: relayBase,
      room: settings.room,
      pin: settings.pin,
      name: settings.name,
    }),
  );
}

async function applySettings(next: Settings): Promise<void> {
  settings = next;
  await saveSettings(bridge, next);
  driver.app.setHasRoom(isValidRoom(next.room));
  companion?.setStatus(
    next.render === null
      ? 'saved'
      : `saved - restart the app to switch to ${next.render} mode`,
  );
  connect();
}

connect();
