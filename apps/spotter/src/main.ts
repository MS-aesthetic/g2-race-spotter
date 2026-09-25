import type {
  CarLevel,
  Cars,
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
  PRESETS_MAX,
} from '@g2-race-spotter/protocol';

import {
  dragCars,
  endCarDrag,
  moveCarDrag,
  normaliseMessage,
  rebaseCars,
  startCarDrag,
  type CarDrag,
  type PendingCarRows,
} from './intents.ts';
import { generateRoomCode, isSessionCurrent, isStartPin } from './join.ts';
import {
  OPTIMISTIC_LANE_MS,
  createModel,
  roomPresets,
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
  isValidPin,
  isValidRoom,
  loadJoinForm,
  loadSeenAt,
  normaliseName,
  normalisePin,
  normaliseRoom,
  saveJoinForm,
  saveSeenAt,
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

/**
 * A stored room is the spotter's session for as long as the relay keeps it
 * (24 h idle); a first visit, or one after that, gets a fresh random code and
 * is asked for a PIN (Maxx, 2026-09-25 design round 4).
 */
const storedForm = loadJoinForm(window.localStorage);
const resume =
  isValidRoom(storedForm.room) &&
  isSessionCurrent(loadSeenAt(window.localStorage), Date.now());

let model: Model = createModel({
  joinMode: resume ? 'existing' : 'new',
  form: resume
    ? storedForm
    : { room: generateRoomCode(), pin: '', name: storedForm.name },
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

/**
 * True once the current socket session has replayed the room. Until then a
 * car tap is not sent as a triple built from the local (possibly stale) copy:
 * the tapped row is held in `pendingCarRows` and rebased onto the replayed
 * `state.cars` (040 Decision, T055a).
 */
let replayed = false;
let pendingCarRows: PendingCarRows = {};

/**
 * Armed by Start on a freshly generated code: if the relay answers `auth`,
 * the random code collided with someone else's PIN'd room, so one new code is
 * tried before the spotter is told anything (design round 4, (e)).
 */
let collisionRetry = false;

/** `seenAt` is written at most this often: it only has to be hours-accurate. */
const SEEN_AT_WRITE_MS = 60_000;
let seenAtWritten = 0;

function touchSession(): void {
  const now = Date.now();
  if (now - seenAtWritten >= SEEN_AT_WRITE_MS) {
    seenAtWritten = now;
    saveSeenAt(window.localStorage, now);
  }
}

client.onState((state: State) => {
  // Room state is the truth (R6); the sliders reconcile to `state.cars` as
  // soon as the optimistic window closes, exactly like the lanes.
  const firstOfSession = !replayed;
  replayed = true;
  collisionRetry = false;
  touchSession();
  update({ state });

  if (firstOfSession) {
    const next = rebaseCars(state.cars, pendingCarRows);
    pendingCarRows = {};
    if (next !== null) {
      // RoomClient holds this until its replay bookkeeping finishes, then
      // flushes it — still ahead of any later tap.
      client.send({ t: 'cars', cars: next });
      update({ optimisticCars: { cars: next, at: Date.now() } });
    }
  }
});

client.onConnection((conn: ConnectionState, detail: ConnectionCloseDetail) => {
  replayed = false;
  // A terminal close (4400/4401/4409/4426) means RoomClient will never
  // reconnect. Staying on the console would leave RECONNECTING up forever, so
  // every terminal code goes back to Join with a reason instead of a spinner.
  if (detail.terminal) {
    pendingCarRows = {};
    client.disconnect();
    if (detail.code === CLOSE_CODE_AUTH && collisionRetry) {
      collisionRetry = false;
      connectTo({ ...model.form, room: generateRoomCode() });
      return;
    }

    update({
      screen: 'join',
      conn: 'closed',
      state: null,
      notice:
        detail.code === CLOSE_CODE_AUTH
          ? 'Wrong PIN — check the room code and PIN.'
          : `The relay rejected this app (close ${detail.code ?? 'unknown'}). Reload the page to pick up the current version.`,
    });
    return;
  }

  update({ conn });
});

client.onError((error) => {
  if (error.code === 'auth' && !collisionRetry) {
    update({ notice: 'Wrong PIN — check the room code and PIN.' });
  }
});

function vibrate(): void {
  navigator.vibrate?.(10);
}

function connectTo(form: Model['form']): void {
  pendingCarRows = {};
  saveJoinForm(window.localStorage, form);
  seenAtWritten = 0;
  touchSession();
  update({ form, notice: null, screen: 'console', state: null });
  client.connect(roomUrl(origin, form));
}

function currentForm(): Model['form'] {
  return {
    room: normaliseRoom(model.form.room),
    pin: normalisePin(model.form.pin),
    name: normaliseName(model.form.name).trim(),
  };
}

/** "Join an existing room": any valid code, PIN optional. */
function join(): void {
  const form = currentForm();
  if (!isValidRoom(form.room) || !isValidPin(form.pin)) {
    update({ form, notice: 'Room code must be 4–6 letters or digits.' });
    return;
  }

  collisionRetry = false;
  connectTo(form);
}

/** New room: the generated code, and a PIN is required. */
function start(): void {
  const form = currentForm();
  if (!isStartPin(form.pin)) {
    update({ form, notice: 'Set a 4-digit PIN first.' });
    return;
  }

  collisionRetry = true;
  connectTo(form);
}

function sendMessage(text: string, fromDraft: boolean): void {
  const message = normaliseMessage(text);
  if (message === '') {
    return;
  }

  vibrate();
  client.send({ t: 'msg', text: message });
  if (fromDraft) {
    update({ draft: '' });
  }
}

/** Save the typed message to the room for later (`preset add`). */
function savePreset(): void {
  const message = normaliseMessage(model.draft);
  if (message === '') {
    return;
  }

  const presets = roomPresets(model);
  if (!presets.includes(message) && presets.length >= PRESETS_MAX) {
    return;
  }

  vibrate();
  client.send({ t: 'preset', add: message });
  update({ draft: '' });
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

/** Send one `cars` triple (or hold it for the replay, T055a) and pre-light it. */
function sendCars(next: Cars, row: 0 | 1 | 2): void {
  if (replayed) {
    client.send({ t: 'cars', cars: next });
  } else {
    pendingCarRows = { ...pendingCarRows, [row]: next[row] };
  }
  update({ optimisticCars: { cars: next, at: Date.now() } });
  window.setTimeout(() => update({}), OPTIMISTIC_LANE_MS);
}

/** `data-arg="<row>:<segment>"` on a slider segment (0 = its label). */
function carArg(arg: string): { row: 0 | 1 | 2; segment: CarLevel } | null {
  const match = /^([0-2]):([0-3])$/.exec(arg);
  if (match === null) {
    return null;
  }

  return {
    row: Number(match[1]) as 0 | 1 | 2,
    segment: Number(match[2]) as CarLevel,
  };
}

/**
 * The finger on a slider: `pointerdown` picks the level (a tap on the lit top
 * segment picks 0), `pointermove` across segments of the same slider changes
 * it, `pointerup` sends one `cars` frame if the level changed (040 AC-2).
 */
let drag: (CarDrag & { readonly pointerId: number }) | null = null;
/** A pointer gesture also fires `click`; that click must not send again. */
let gestureEndedAt = Number.NEGATIVE_INFINITY;

function slideTo(next: CarDrag): void {
  if (drag === null || next === drag) {
    return;
  }

  drag = { ...next, pointerId: drag.pointerId };
  vibrate();
  update({ dragCars: dragCars(drag) });
}

function carUnder(
  event: PointerEvent,
): { row: 0 | 1 | 2; segment: CarLevel } | null {
  // A touch pointer stays captured by the element it went down on, so the
  // event target never changes: ask the layout what is under the finger.
  const under =
    typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
  const el = under?.closest('[data-act="car"], [data-act="car-zero"]');
  return el === null || el === undefined
    ? null
    : carArg(el.getAttribute('data-arg') ?? '');
}

function endDrag(event: PointerEvent, commit: boolean): void {
  if (drag === null || event.pointerId !== drag.pointerId) {
    return;
  }

  const ended = drag;
  drag = null;
  gestureEndedAt = Date.now();
  const next = commit ? endCarDrag(ended) : null;
  if (next === null) {
    update({ dragCars: null });
    return;
  }

  model = { ...model, dragCars: null };
  sendCars(next, ended.row);
}

/** Keyboard (or a synthetic click): a plain tap, sent straight away. */
function tapCar(row: 0 | 1 | 2, segment: CarLevel): void {
  const next = endCarDrag(startCarDrag(selectedCars(model), row, segment));
  if (next === null) {
    return;
  }

  vibrate();
  sendCars(next, row);
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
    case 'start':
      start();
      break;
    case 'join-existing':
      update({ joinMode: 'existing', notice: null });
      break;
    case 'join-new':
      update({
        joinMode: 'new',
        notice: null,
        form: { ...model.form, room: generateRoomCode(), pin: '' },
      });
      break;
    case 'code':
      update({ showCode: !model.showCode });
      break;
    case 'lane':
      setLane(action.arg as Lane);
      break;
    case 'lane-clear':
      setLane(null);
      break;
    case 'car': {
      // A pointer gesture already sent (or deliberately did not); only a
      // keyboard or synthetic click is a tap of its own.
      const car = carArg(action.arg);
      if (
        car !== null &&
        car.segment !== 0 &&
        Date.now() - gestureEndedAt > 500
      ) {
        tapCar(car.row, car.segment);
      }
      break;
    }
    case 'send':
      sendMessage(model.draft, true);
      break;
    case 'save':
      savePreset();
      break;
    case 'say':
    case 'preset-send':
      sendMessage(action.arg, false);
      break;
    case 'preset-remove':
      vibrate();
      client.send({ t: 'preset', remove: action.arg });
      break;
    case 'reload':
      window.location.reload();
      break;
    default:
      break;
  }
});

root.addEventListener('pointerdown', (event) => {
  const action = actionOf(event);
  if (action === null || action.act !== 'car' || drag !== null) {
    return;
  }

  const car = carArg(action.arg);
  if (car === null || car.segment === 0) {
    return;
  }

  drag = {
    ...startCarDrag(selectedCars(model), car.row, car.segment),
    pointerId: event.pointerId,
  };
  vibrate();
  update({ dragCars: dragCars(drag) });
});

root.addEventListener('pointermove', (event) => {
  if (drag === null || event.pointerId !== drag.pointerId) {
    return;
  }

  const car = carUnder(event);
  if (car !== null) {
    slideTo(moveCarDrag(drag, car.row, car.segment));
  }
});

// On `window`, not `root`: the finger may lift anywhere.
window.addEventListener('pointerup', (event) => endDrag(event, true));
window.addEventListener('pointercancel', (event) => endDrag(event, false));

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
    sendMessage(model.draft, true);
  } else if (model.screen === 'join') {
    if (model.joinMode === 'new') {
      start();
    } else {
      join();
    }
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

if (resume) {
  join();
} else {
  render(view(model));
}
