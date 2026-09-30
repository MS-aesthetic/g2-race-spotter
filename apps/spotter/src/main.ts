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
  CAR_LEVEL_MAX,
  CLOSE_CODE_AUTH,
  MSG_MAX_CHARS,
  PING_INTERVAL_MS,
  PRESETS_MAX,
} from '@g2-race-spotter/protocol';

import {
  dragCars,
  endCarDrag,
  faderPosition,
  moveCarDrag,
  nextCars,
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

/** `data-arg="<row>"` on a fader track. */
function faderRow(arg: string): 0 | 1 | 2 | null {
  return /^[0-2]$/.test(arg) ? (Number(arg) as 0 | 1 | 2) : null;
}

/**
 * The finger on a fader (design round 5): `pointerdown` anywhere on the track
 * captures the pointer and puts the knob under the finger, `pointermove`
 * drags it live, and `pointerup` snaps it to the nearest detent and sends one
 * `cars` frame if that fader changed (040 AC-2). A tap is a drag that never
 * moves: the knob jumps to that detent and it is sent. The track box is read
 * once per gesture — it does not move while the console never scrolls.
 */
let drag:
  | (CarDrag & {
      readonly pointerId: number;
      readonly top: number;
      readonly height: number;
    })
  | null = null;

function showDrag(): void {
  if (drag === null) {
    return;
  }

  update({
    dragCars: dragCars(drag),
    dragKnob: { row: drag.row, position: drag.position },
  });
}

function endDrag(event: PointerEvent): void {
  if (drag === null || event.pointerId !== drag.pointerId) {
    return;
  }

  // A cancel (the OS took the touch) still commits the detent the knob was
  // showing: the spotter let go of a fader that reads that level.
  const ended = drag;
  drag = null;
  const next = endCarDrag(ended);
  if (next === null) {
    update({ dragCars: null, dragKnob: null });
    return;
  }

  model = { ...model, dragCars: null, dragKnob: null };
  sendCars(next, ended.row);
}

/** Keyboard: arrows step one detent, Home/End go to 0/3. */
const FADER_KEYS: Readonly<Record<string, (level: number) => number>> = {
  ArrowUp: (level) => level + 1,
  ArrowRight: (level) => level + 1,
  ArrowDown: (level) => level - 1,
  ArrowLeft: (level) => level - 1,
  Home: () => 0,
  End: () => CAR_LEVEL_MAX,
};

function keyFader(row: 0 | 1 | 2, key: string): boolean {
  const step = FADER_KEYS[key];
  if (step === undefined) {
    return false;
  }

  const current = selectedCars(model);
  const level = Math.max(
    0,
    Math.min(CAR_LEVEL_MAX, step(current[row])),
  ) as CarLevel;
  const next = nextCars(current, row, level);
  if (next !== null) {
    vibrate();
    sendCars(next, row);
  }
  return true;
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
  if (action === null || action.act !== 'fader' || drag !== null) {
    return;
  }

  const row = faderRow(action.arg);
  if (row === null) {
    return;
  }

  const box = action.el.getBoundingClientRect();
  try {
    // Every move and the release land on this track, wherever the finger goes.
    action.el.setPointerCapture?.(event.pointerId);
  } catch {
    // Not an active pointer (synthetic event): window listeners still end it.
  }
  event.preventDefault();
  drag = {
    ...startCarDrag(
      selectedCars(model),
      row,
      faderPosition(event.clientY, box.top, box.height),
    ),
    pointerId: event.pointerId,
    top: box.top,
    height: box.height,
  };
  vibrate();
  showDrag();
});

root.addEventListener('pointermove', (event) => {
  if (drag === null || event.pointerId !== drag.pointerId) {
    return;
  }

  const before = drag.level;
  drag = {
    ...drag,
    ...moveCarDrag(drag, faderPosition(event.clientY, drag.top, drag.height)),
  };
  if (drag.level !== before) {
    vibrate();
  }
  showDrag();
});

// On `window`, not `root`: the finger may lift anywhere.
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

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
  const action = actionOf(event);
  if (action === null) {
    return;
  }

  if (action.act === 'fader') {
    const row = faderRow(action.arg);
    if (row !== null && keyFader(row, event.key)) {
      event.preventDefault();
    }
    return;
  }

  if (event.key !== 'Enter') {
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
