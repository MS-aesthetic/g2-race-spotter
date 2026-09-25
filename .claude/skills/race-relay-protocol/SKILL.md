---
name: race-relay-protocol
description: The wire protocol and room-state semantics shared by the spotter PWA, the RaceRoom Durable Object, and the glasses app — message schema, reducer, seq/version rules, heartbeat timings, storage keys, and how packages/protocol is organised. Use whenever touching messages, room state, the socket client, or the reducer.
---

# Race relay protocol v2

`packages/protocol` is the single source of truth and must match this document. Zero runtime dependencies; runs in Node 22, Workers and browsers. If the code and this file disagree, fix one and say which. This skill is normative for `specs/020-protocol-and-relay.md`; the spec's acceptance criteria are how it is verified.

## Transport

- WebSocket, text frames, exactly one JSON object per frame, ≤ 1024 bytes.
- URL: `wss://<host>/room/<ROOM>?role=spotter|driver&token=<PIN?>&name=<urlencoded?>`
- `ROOM`: 4–6 chars `[A-Z0-9]`, uppercase on the server.
- PIN: 4 digits, optional. The **first connection to a room that has no stored `pin`** (either role) sets it from `token` (or sets it to `null` if absent); after that, joins must present the same `token` or get `error{code:"auth"}` followed by close 4401. Rooms with `pin: null` accept anyone.
- The URL is authoritative for `role` and `name`. `hello` repeats them so the relay can cross-check; a mismatch is `error{code:"bad_frame"}` and the socket is closed 4400.
- Auth/role errors are delivered **after** the socket is accepted: the relay accepts, sends the `error` frame, then closes with the code above. (A Durable Object cannot send a WebSocket frame from a rejected upgrade; do not return HTTP 401/409 for these — clients only speak WebSocket.)
- First frame from a client must be `hello`. The relay answers with the current `state` immediately (replay), even for a brand-new room.

## Messages

```ts
export const PROTOCOL_VERSION = 2;               // major only; bump = breaking (v2 2026-09-25)
export type Lane = 'top' | 'mid' | 'bot';
export type CarLevel = 0 | 1 | 2 | 3;            // 0 = no car … 3 = on the bumper
export type Cars = [CarLevel, CarLevel, CarLevel]; // [left, mid, right]
export type Role = 'spotter' | 'driver';

// client → room
type Hello = { t:'hello'; v:number; role:Role; name?:string };
type SetLane = { t:'lane'; lane:Lane|null };
type SetCars = { t:'cars'; cars:[number,number,number] }; // full triple; server rounds+clamps each to 0..3
type SetMsg  = { t:'msg';  text:string };        // 1..80 chars, trimmed; server assigns id
type Clear   = { t:'clear' };                    // clears msg only
type Ack     = { t:'ack';  msgId:string };
type Ping    = { t:'ping'; ts:number };

// room → client
type State = {
  t:'state'; seq:number;
  lane:Lane|null; cars:Cars;
  msg:{ id:string; text:string; ts:number; ackedAt:number|null } | null;
  spotterOnline:boolean; driverOnline:boolean;
  updatedAt:number;                              // server ms epoch, last change of any kind
  calledAt:number;                               // server ms of the last spotter call (lane/cars/msg/clear); 0 when fresh or stale-cleared
};
type Pong  = { t:'pong'; ts:number; serverTs:number };
type Error = { t:'error'; code:'version'|'auth'|'role_taken'|'bad_frame'|'rate'; detail?:string };
```

Rules:

- Only a `spotter` may send `lane`/`cars`/`msg`/`clear`; only a `driver` may send `ack`. Wrong-role frames are ignored and counted.
- `cars` is the "cars behind" call (Maxx, 2026-09-25 design round 3): one closeness level per side of the car, `[left, mid, right]`, each 0 (nobody) … 3 (on the bumper). The spotter always sends the **full triple**; the reducer rounds and clamps each entry to 0..3 and a triple equal to the current one is a no-op. It replaces the v1 `gap` (0–100 bar) and `side` (inside/outside) calls, which no longer exist — hence `PROTOCOL_VERSION 2`.
- One driver per room, **last writer wins**: when a new driver joins **and passes the PIN check**, the relay sends `error{code:"role_taken"}` + close 4409 to the *previous* driver socket (which is usually a dead socket left behind by an Android suspend or a network switch) and accepts the new one. The driver must never be locked out by its own stale connection. Multiple spotters are allowed by the protocol (v1 UI assumes one).
- Unknown `t`: ignore. Malformed frame: `error{code:"bad_frame"}`, keep the socket — except a `hello` that contradicts the URL's role/name, which closes 4400 after the error frame.
- Every `state` broadcast goes to **all** sockets (spotters too — that is how the spotter sees `driverOnline` and `ackedAt`).
- **The relay answers every `ping` from a ready socket with `pong {ts: ping.ts, serverTs}`** and refreshes that socket's `lastPing`. `pong` is the liveness frame a quiet room relies on: without it a healthy link with no state changes would trip the driver's `DRIVER_NO_LINK_MS` watchdog. `ping`/`pong` never touch room state or `seq`.
- The relay's alarm is self-arming: it is scheduled when a socket becomes ready, on close/error, and at the end of `alarm()` itself — never re-pointed *later* on data frames (a `ping` every 2 s would otherwise push a 3 s tick forever and no silent peer would ever be detected).
- **Stale clear (v2).** While the room state is non-empty (`isHudEmpty(state)` false: a lane, any car, or a msg), the alarm target is the EARLIER of the tick/TTL target and `calledAt + HUD_STALE_CLEAR_MS`. A state-changing frame may pull an armed alarm earlier to that target, never later; pings never touch it. `alarm()` reduces `{t:'stale'}`, persists and broadcasts when `now - calledAt >= HUD_STALE_CLEAR_MS` and the state is non-empty, then re-arms. An empty room never arms for it, so the alarm cannot loop: with sockets open it is the tick, with none it is the TTL. The window runs from the **spotter's last call** (`calledAt`): a driver `ack` (the glasses' 5 s auto-ack included) or a presence flip moves `updatedAt` but never postpones the clear.
- `seq` starts at 1 per room lifetime and only increases; clients drop `state` with `seq ≤ lastSeen`. `seq` persists in DO storage so hibernation cannot reset it. **Clients reset `lastSeen = 0` on every socket open** — frames are ordered within a socket, and the room may have been expired and recreated with `seq` back at 1 since the last connection.
- **Ack semantics:** `ack` leaves `msg` in state but stamps `ackedAt`. The driver renders `msg.text` only while `msg.ackedAt === null`; the spotter shows a tick while `ackedAt !== null`. `clear` (or a new `msg`) removes/replaces it. The driver therefore does not "clear locally" — it sends `ack` and the next `state` frame hides the text.

## Reducer (`reduce(state, event, ctx): state`)

Pure, total. `ctx = { now: number, newId: () => string }` is injected by the caller (the relay passes `Date.now` and a ULID generator; tests pass fixed values). Events are inbound client messages tagged with role, plus internal `{t:'peer', role, online}`, `{t:'expire'}` and `{t:'stale'}`.

- `lane` → set `lane`. `cars` → `cars[i] = clamp(round(cars[i]),0,3)` for each `i`. `msg` → `msg = {id: ctx.newId(), text, ts: ctx.now, ackedAt: null}`. `clear` → `msg = null`. `ack` with matching id → `ackedAt = ctx.now`; non-matching or already-acked id ignored. `peer` → set the online flag (no-op if unchanged). `expire` → return the initial state (used by the TTL alarm before `deleteAll`). `stale` → `lane:null, cars:[0,0,0], msg:null, calledAt:0`, online flags kept (used by the stale-clear alarm); a no-op on an already-empty room. Any change bumps `seq` and sets `updatedAt`; a spotter call (`lane`/`cars`/`msg`/`clear` that changes state) also sets `calledAt = now` (`peer` and `ack` leave it alone, `expire` resets it to 0); a no-op (same lane, same cars triple after rounding, same online flag, `stale` on an empty room) does **not** bump `seq` or broadcast.
- Initial state: `{seq:0, lane:null, cars:[0,0,0], msg:null, spotterOnline:false, driverOnline:false, updatedAt:0, calledAt:0}`.
- Because `peer` flips also bump `seq`, tests must assert `seq > 0` / `seq ≥ previous` and compare values, never an exact `seq` number.

## Timings (exported constants, never re-typed)

| Constant | Value | Where enforced |
|---|---|---|
| `PING_INTERVAL_MS` | 2000 | clients |
| `PEER_OFFLINE_MS` | 6000 | relay alarm (checked every `ALARM_TICK_MS`, so worst case is `PEER_OFFLINE_MS + ALARM_TICK_MS`); the relay also **closes** sockets silent that long |
| `ALARM_TICK_MS` | 3000 | relay, while any socket is open |
| `DRIVER_NO_LINK_MS` | 5000 | glasses app (time since last frame of any kind) |
| `HUD_STALE_CLEAR_MS` | 6000 | relay alarm: a non-empty room with no spotter call for this long (`calledAt`) is cleared (`{t:'stale'}`); observed 6.0 s on `wrangler dev`, also with a driver ack at 5 s |
| `HUD_GAP_FLUSH_MS` | 250 | glasses render queue (now the floor for `cars`-only changes; the name predates v2) |
| `RECONNECT_MIN_MS` / `RECONNECT_MAX_MS` | 500 / 8000 (+ jitter) | both clients |
| `RATE_LIMIT_PER_S` / `RATE_BURST` | 30 / 60 | relay: fixed 1 s window per socket, at most `RATE_BURST` frames applied per window, the rest dropped and counted (at most one `error{code:"rate"}` per window, socket stays open); `RATE_LIMIT_PER_S` is the sustained rate clients must stay under (the spotter sends one frame per tap) |
| `ROOM_TTL_MS` | 12 h | relay alarm |
| `MSG_MAX_CHARS` | 80 | all |
| `FRAME_MAX_BYTES` | 1024 | relay |

## Shared client (`packages/protocol/src/client.ts`)

One `RoomClient` used by both the spotter PWA and the glasses app, **built in Phase 1 alongside the relay** so neither app writes its own: `connect(url)`, `send(msg)`, `onState(cb)`, `onConnection(cb)` (`connecting|open|closed`), automatic `hello`, ping loop, backoff reconnect, `lastSeq` filtering (reset to 0 on each open), `lastFrameAt` for NO LINK (`undefined` until the first frame of the current session — consumers treat `undefined` as *no link*), `onError(cb)` for `error` frames, and the close code on the `closed` connection callback so UIs can tell a terminal rejection (`auth`, `role_taken`, `version`) from a reconnecting drop. It takes a `WebSocket` constructor as a parameter so Node tests can inject `ws`. No DOM or bridge references inside. `reconnectAttempt` resets only after the first valid `state` replay of a socket (an `open` that closes before replay is not success), and every reconnect delay is clamped to `[RECONNECT_MIN_MS, RECONNECT_MAX_MS]` after jitter.

Reconnect rule: on re-open the client sends `hello` and waits for the replayed `state`; it does **not** blindly re-send its last intents. The room already holds them. Only intents the user issued *while the socket was down* are queued (latest `lane`, latest `cars` triple, and any `msg`/`clear` in order) and flushed after the replay. Never re-send an already-delivered `msg` — every `msg` creates a new id and would duplicate.

## Storage keys

- Glasses (bridge KV): `g2rs:v1:room`, `g2rs:v1:pin`, `g2rs:v1:name`, `g2rs:v1:render` (`image|text` — a manual override only; the automatic `sendFailed` fallback is in-memory and lasts until restart).
- Spotter (`localStorage`): `g2rs:v1:room`, `g2rs:v1:pin`, `g2rs:v1:name`, `g2rs:v1:recentMsgs` (JSON array ≤ 5).
- Relay (DO storage): `state` (State), `pin` (`{ value: string | null }` — the *absence* of the key means "fresh room, first joiner sets it"; `{ value: null }` means "open room, no PIN"), `createdAt`.

## Versioning

Additive fields on `state` are non-breaking (clients must ignore unknown fields). Renaming/removing fields, changing `t` names, or changing semantics of `cars` or `lane` bumps `PROTOCOL_VERSION`; the relay rejects `hello.v !== PROTOCOL_VERSION` with `error{code:"version"}` and close 4426.

Close codes: 4400 bad hello, 4401 auth, 4408 silent peer, 4409 driver evicted, 4426 version. Ship relay first, then clients, when bumping.

**v2 (2026-09-25, Maxx design round 3):** `gap` and `side` removed, `cars` added, `{t:'stale'}` + `State.calledAt` + `HUD_STALE_CLEAR_MS` added, `GAP_SEND_MIN_MS` removed. A v1 client's `hello` gets `error{code:"version"}` + 4426; the spotter PWA already turns that into its "reload the page" notice, and the glasses show `UPDATE APP`.

## Test fixtures

`packages/protocol/test/fixtures/*.json` holds one valid and one invalid example per message type (`cars` replaced `gap`/`side` in v2); guards are tested against every fixture. (`scripts/fake-spotter.ts` was deferred — see spec 020 — so nothing else reuses them yet.)
