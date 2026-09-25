import type {
  CarLevel,
  ConnectionCloseDetail,
  ConnectionState,
  Lane,
  RoomClient,
  State,
} from '@g2-race-spotter/protocol';
import {
  CLOSE_CODE_AUTH,
  MSG_MAX_CHARS,
  PING_INTERVAL_MS,
} from '@g2-race-spotter/protocol';

import { nextCars, normaliseMessage } from './intents.ts';
import {
  OPTIMISTIC_LANE_MS,
  createModel,
  selectedCars,
  selectedLane,
  type Model,
} from './model.ts';
import {
  createSpotterClient,
  nextLatency,
  relayOrigin,
  roomUrl,
} from './net/room-client.ts';
import {
  addRecentMessage,
  loadRecentMessages,
  saveRecentMessages,
} from './recent-messages.ts';
import {
  isValidPin,
  isValidRoom,
  loadJoinForm,
  normaliseName,
  normalisePin,
  normaliseRoom,
  saveJoinForm,
} from './storage.ts';
import { createRenderer } from './ui/vdom.ts';
import { view } from './ui/view.ts';

import './styles.css';

const root = document.getElementById('app');
if (root === null) {
  throw new Error('missing #app');
}

const render = createRenderer(root);
const origin = relayOrigin(
  window.location,
  import.meta.env.VITE_RELAY_URL as string | undefined,
);

let model: Model = createModel({
  form: loadJoinForm(window.localStorage),
  recent: loadRecentMessages(window.localStorage),
  relayHost: origin,
  now: Date.now(),
  showInstallHint: !window.matchMedia('(display-mode: standalone)').matches,
});

function update(patch: Partial<Model>): void {
  model = { ...model, ...patch, now: Date.now() };
  render(view(model));
}

const client: RoomClient = createSpotterClient({
  WebSocket: window.WebSocket,
  name: model.form.name,
  onLatency(sampleMs) {
    update({
      latencyMs: nextLatency(model.latencyMs, sampleMs),
      latencyAt: Date.now(),
    });
  },
});

client.onState((state: State) => {
  // Room state is the truth (R6); the car rows reconcile to `state.cars` as
  // soon as the optimistic window closes, exactly like the lanes.
  update({ state });
});

client.onConnection((conn: ConnectionState, detail: ConnectionCloseDetail) => {
  // A terminal close (4400/4401/4409/4426) means RoomClient will never
  // reconnect. Staying on the console would leave RECONNECTING up forever, so
  // every terminal code goes back to Join with a reason instead of a spinner.
  if (detail.terminal) {
    client.disconnect();
    update({
      screen: 'join',
      conn: 'closed',
      state: null,
      notice:
        detail.code === CLOSE_CODE_AUTH
          ? 'Wrong PIN — check the code with the driver.'
          : `The relay rejected this app (close ${detail.code ?? 'unknown'}). Reload the page to pick up the current version.`,
    });
    return;
  }

  update({ conn });
});

client.onError((error) => {
  if (error.code === 'auth') {
    update({ notice: 'Wrong PIN — check the code with the driver.' });
  }
});

function vibrate(): void {
  navigator.vibrate?.(10);
}

function join(): void {
  const form = {
    room: normaliseRoom(model.form.room),
    pin: normalisePin(model.form.pin),
    name: normaliseName(model.form.name).trim(),
  };

  if (!isValidRoom(form.room) || !isValidPin(form.pin)) {
    update({ form, notice: 'Room code must be 4–6 letters or digits.' });
    return;
  }

  saveJoinForm(window.localStorage, form);
  update({ form, notice: null, screen: 'console', state: null });
  client.connect(roomUrl(origin, form));
}

function sendMessage(text: string): void {
  const message = normaliseMessage(text);
  if (message === '') {
    return;
  }

  vibrate();
  client.send({ t: 'msg', text: message });
  const recent = addRecentMessage(model.recent, message);
  saveRecentMessages(window.localStorage, recent);
  update({ draft: '', recent });
}

function setLane(lane: Lane | null): void {
  if (lane !== null && selectedLane(model) === lane) {
    return;
  }

  vibrate();
  client.send({ t: 'lane', lane });
  update({ optimisticLane: { lane, at: Date.now() } });
  // Nothing else wakes the UI when the socket is down and no `state` follows,
  // so the optimistic highlight would otherwise linger until the next ping tick.
  window.setTimeout(() => update({}), OPTIMISTIC_LANE_MS);
}

/**
 * One `cars` frame per change, always the full triple (040 AC-2): tapping
 * segment n of a row calls level n, tapping the lit top segment clears it.
 */
function setCar(row: 0 | 1 | 2, segment: CarLevel): void {
  const next = nextCars(selectedCars(model), row, segment);
  if (next === null) {
    return;
  }

  vibrate();
  client.send({ t: 'cars', cars: next });
  update({ optimisticCars: { cars: next, at: Date.now() } });
  window.setTimeout(() => update({}), OPTIMISTIC_LANE_MS);
}

/** `data-arg="<row>:<segment>"` on a car segment button. */
function carArg(arg: string): { row: 0 | 1 | 2; segment: CarLevel } | null {
  const match = /^([0-2]):([1-3])$/.exec(arg);
  if (match === null) {
    return null;
  }

  return {
    row: Number(match[1]) as 0 | 1 | 2,
    segment: Number(match[2]) as CarLevel,
  };
}

function actionOf(
  event: Event,
): { act: string; arg: string; el: Element } | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const el = target.closest('[data-act]');
  if (el === null) {
    return null;
  }

  return {
    act: el.getAttribute('data-act') ?? '',
    arg: el.getAttribute('data-arg') ?? '',
    el,
  };
}

function inputValue(el: Element): string {
  return (el as HTMLInputElement).value;
}

root.addEventListener('click', (event) => {
  const action = actionOf(event);
  if (action === null) {
    return;
  }

  switch (action.act) {
    case 'join':
      join();
      break;
    case 'lane':
      setLane(action.arg as Lane);
      break;
    case 'lane-clear':
      setLane(null);
      break;
    case 'car': {
      const car = carArg(action.arg);
      if (car !== null) {
        setCar(car.row, car.segment);
      }
      break;
    }
    case 'send':
      sendMessage(model.draft);
      break;
    case 'clear':
      client.send({ t: 'clear' });
      update({ draft: '' });
      break;
    case 'recent':
      sendMessage(action.arg);
      break;
    case 'reload':
      window.location.reload();
      break;
    default:
      break;
  }
});

root.addEventListener('input', (event) => {
  const action = actionOf(event);
  if (action === null) {
    return;
  }

  const raw = inputValue(action.el);
  switch (action.act) {
    case 'room':
      update({ form: { ...model.form, room: normaliseRoom(raw) } });
      break;
    case 'pin':
      update({ form: { ...model.form, pin: normalisePin(raw) } });
      break;
    case 'name':
      update({ form: { ...model.form, name: normaliseName(raw) } });
      break;
    case 'draft':
      update({ draft: raw.slice(0, MSG_MAX_CHARS) });
      break;
    default:
      break;
  }
});

root.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  const action = actionOf(event);
  if (action === null) {
    return;
  }

  if (action.act === 'draft') {
    sendMessage(model.draft);
  } else if (model.screen === 'join') {
    join();
  }
});

// The header's latency and the optimistic-lane window are the only things that
// move on their own; one tick per ping interval is enough to age them out.
window.setInterval(() => update({}), PING_INTERVAL_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller !== null
            ) {
              update({ updateReady: true });
            }
          });
        });
      })
      .catch(() => undefined);
  });
}

if (isValidRoom(model.form.room)) {
  join();
} else {
  render(view(model));
}
