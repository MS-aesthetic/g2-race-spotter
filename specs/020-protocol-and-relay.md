# 020 — Shared protocol package and Cloudflare relay

Status: ACTIVE
Depends on: 010
Design reference: docs/BUILD_PLAN.md §4, §6; skills `race-relay-protocol`, `cloudflare-relay-deploy`

## Purpose

The single source of truth for what goes over the wire, plus the room relay that holds authoritative state so the driver always converges on the latest spotter intent — through reconnects, hibernation, and redeploys.

## Scope

In: `packages/protocol` (types, guards, constants, `reduce`, `RoomClient`), `services/relay` (Worker + `RaceRoom` DO), `scripts/fake-spotter.ts`, integration tests against `wrangler dev`.
Out: any UI; deployment to a custom domain (see 070).

## Requirements

R1. MUST implement every message and rule in `.agents/skills/race-relay-protocol/SKILL.md` — that skill is normative for this spec.
R2. `reduce(state, event, ctx)` MUST be pure and total; `ctx = {now, newId}`.
R3. `RoomClient` MUST take a `WebSocket` constructor, send `hello`, ping every `PING_INTERVAL_MS`, reconnect with jittered backoff, reset `lastSeen` on open, filter `seq`, expose `lastFrameAt`, and queue only intents issued while disconnected.
R4. `RaceRoom` MUST use the WebSocket Hibernation API, persist `state`/`seq`/`pin` in DO storage, broadcast full state on every change, enforce PIN (first joiner sets), evict the previous driver on a new driver join *after* the PIN check, close silent sockets after `PEER_OFFLINE_MS`, ~~rate-limit per socket~~ (dropped 2026-09-04 by Maxx — two phones in one room cannot generate abusive load; revisit only if a deployed relay shows it), and re-point its single alarm to `updatedAt + ROOM_TTL_MS` when no sockets remain.
R5. The Worker MUST route `/room/:id` upgrades, `/health`, `/room/:id/debug` (gated by `X-Debug-Key`), and fall through to static assets; all HTTP responses carry CORS headers.
R6. `fake-spotter` MUST support scenarios `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay`, `driver-evict`, `soak`, and a `--role driver` mode.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given each fixture in `packages/protocol/test/fixtures`, when guards run, then valid fixtures pass and invalid ones fail | `packages/protocol/test/guards.test.ts` |
| AC-2 | Given initial state, when `lane`, `cars`, `msg`, `ack`, `clear`, `peer`, `expire`, `stale` events are reduced, then state matches the skill's semantics, `seq` never decreases, and no-ops do not bump `seq` | `packages/protocol/test/reduce.test.ts` |
| AC-3 | Given a spotter and driver connected to `wrangler dev`, when the spotter sends `lane:"top"`, then the driver receives `state` with `lane:"top"` within 500 ms and `seq > 0` | `services/relay/test/roundtrip.test.ts` |
| AC-4 | Given state has been set, when the driver disconnects and reconnects, then the first frame after `hello` is a `state` with identical lane/cars/msg and `seq ≥` last seen | `services/relay/test/replay.test.ts` |
| AC-5 | Given a connected driver, when a second driver joins with the correct PIN, then the first receives `error{code:"role_taken"}` and close 4409 and the second receives `state` | `services/relay/test/eviction.test.ts` |
| AC-6 | Given a room created with PIN 1234, when a client joins without it, then it receives `error{code:"auth"}` and close 4401 | `services/relay/test/auth.test.ts` |
| AC-7 | Given a spotter that stops pinging, when `PEER_OFFLINE_MS + ALARM_TICK_MS` elapses, then the driver receives `state.spotterOnline === false` and the spotter socket is closed 4408 | `services/relay/test/heartbeat.test.ts` |
| AC-8 | Given `RoomClient` with an injected fake `WebSocket`, when the socket drops and the user issues `lane`, `cars`, `cars`, `msg`, then on reopen the client sends `hello`, waits for `state`, then flushes exactly `lane`, the last `cars`, and `msg` | `packages/protocol/test/client.test.ts` |
| AC-9 | Given a frame > 1024 bytes or with unknown `t`, when received, then the relay ignores/rejects per the skill and the socket stays open | `services/relay/test/validation.test.ts` |
| AC-10 | Given a deployed Worker on `*.workers.dev`, when `fake-spotter --scenario lanes` and a `--role driver` instance run against it, then both exit 0 | `[HW]` needs a Cloudflare account; log in `qa/<date>/020-deploy.log` |
| AC-11 | Given a spotter and driver on `wrangler dev` (both pinging), when the spotter calls a lane, cars and a message and then makes no further call (the driver may still ack, as the glasses' 5 s auto-ack does), then the driver receives a `state` with `lane:null, cars:[0,0,0], msg:null` (online flags kept) between `HUD_STALE_CLEAR_MS` (6 s) and 7 s after the last call; a fresh call inside the window restarts it; and a room whose state is already empty never re-arms for it (its alarm is the tick, or the TTL once no socket is open) | `services/relay/test/stale-clear.test.ts` |

## Decisions

- 2026-09-03 Full-state broadcasts, no deltas — why: reconnects and reordering become trivial; payloads are tiny.
- 2026-09-03 Last-writer-wins for the driver role — why: the driver's own stale socket must never lock it out.
- 2026-09-03 Reconcile both ready-role flags before the first replay after close or rehydration, target an empty room's alarm at `updatedAt + ROOM_TTL_MS`, and reduce `expire` before deleting storage — why: replay must preserve intents and sequence without advertising dead peers, while expiry alone starts a fresh room lifetime.

- 2026-09-03 (audit) `ping` → `pong` is a relay obligation and the alarm is self-arming, never re-pointed on data frames — why: the integrated relay re-armed the tick on every frame (so AC-7's silent-peer detection could never fire while anyone pinged) and never answered pings (so a quiet healthy room would trip the driver's NO LINK); both are fixed as T016 before T011/T009/T012 build on them.
- 2026-09-03 (audit) Rate limiting (R4) belongs to T013's scope; frame-size checks are on UTF-8 byte length before `JSON.parse`; only a `hello` that contradicts the URL closes 4400, other malformed frames get `error{bad_frame}` and stay open; `hello.v !== PROTOCOL_VERSION` → `error{version}` + 4426.
- 2026-09-03 (audit) AC-8's backoff test must open the reconnected socket and close it *without* a replay, and pin `random: () => 0` — why: the quarantined candidate's test never opened the reconnected socket, which is how a reset-on-open defect and a sub-floor jitter survived three reviews.
- 2026-09-04 Treat a client as joining for AC-6 when it sends the protocol-mandated first `hello`: `fetch()` accepts the upgrade and captures URL authority, while the first WebSocket message validates the URL/hello and either establishes the room or sends the rejection error and close synchronously in that event; tests send nothing after `hello` — why: pinned live Wrangler delivers an error frame but does not reliably deliver a server close initiated during the upgrade request without later client I/O, whereas `hello` is already mandatory and provides a supported WebSocket event without weakening the required error/close sequence.
- 2026-09-04 For the first text frame, parse and require a structural `hello`, then reject `hello.v !== PROTOCOL_VERSION` before missing/invalid URL role, URL/hello role/name mismatch, or PIN/storage work — why: an incompatible protocol must consistently receive `error{version}` + 4426 without room side effects, even when URL authority is also invalid.

- 2026-09-04 (Maxx) Per-socket rate limiting removed from R4 (human decision, not an agent weakening). AC-9 (byte cap, unknown `t`) stays and is built with AC-7 in one relay task. `fake-spotter` scenarios (R6) are deferred: real phones are the scenario runner; AC-10's deployed proof uses the spotter PWA and the glasses app instead.

- 2026-09-04 (Maxx) **Design round 1 — the `side` call.** A spotter-only message `{t:'side', side:'inside'|'outside'|null}` and an additive `State.side` (initial `null`) carry "a car is trying to pass on that side". The reducer treats it exactly like `lane` (no-op on the same value: no `seq` bump, no broadcast), the relay needs no new code (it validates with `isClientMessage` and reduces generically, and the reducer enforces the spotter-only rule), and `RoomClient` queues the latest `side` while offline alongside the latest `lane`/`gap`. `PROTOCOL_VERSION` stays 1: the field is additive, `isState` accepts a frame without it and `RoomClient` reports `null` for it, so the existing "ship the relay first" rule covers the rollout.

- 2026-09-25 (Maxx) **Design round 3 — protocol v2 and the relay stale clear.** Maxx: "Clear glasses screen after 6 seconds without data / update from app", and three car-behind bars replace the gap bar and the side arrows. `gap` and `side` are REMOVED and `State.cars: [left, mid, right]` (each 0–3, initial `[0,0,0]`) is added, carried by a spotter-only `{t:'cars', cars:[l,m,r]}` — always the full triple, the reducer rounds and clamps each entry, an equal triple is a no-op. `RoomClient` queues the latest `cars` offline like `lane`. A new internal reducer event `{t:'stale'}` clears `lane`, `cars` and `msg` (online flags kept) and bumps `seq`; it is a no-op on an already-empty room. Because fields are removed, `PROTOCOL_VERSION` is 2: a v1 `hello` gets `error{version}` + 4426 (the spotter already shows its reload notice). **Relay:** while the state is non-empty, the alarm target is the EARLIER of the tick/TTL target and `updatedAt + HUD_STALE_CLEAR_MS` (6000, exported); a state change may pull an armed alarm earlier, never later (the T016 rule stands — pings never re-point it); `alarm()` applies `{t:'stale'}` when due. **The window runs from the spotter's last call**: an additive `State.calledAt` (server ms of the last spotter-originated change — lane / cars / msg / clear; 0 initially; reset to 0 by `stale` and `expire`; untouched by `peer` and `ack`) is the clock, so a driver ack (the glasses' 5 s auto-ack) or a flapping driver link never postpones the clear (T055a, after review). AC-2/AC-4/AC-8 are reworded to `cars`, and AC-11 is new (human-authorized). Observed on `wrangler dev`: cleared 6002 ms after the last call, 6002 ms with a driver ack at 5 s, and 6004 ms after a restarting call.

- 2026-09-25 (Maxx) **Design round 4 — room presets and a 24 h session.** Maxx: "an option to manually type a short message and save the message for a future push … When a user goes to the page, they are assigned a random room ID. User is asked to set a 4 digit pin. This room and pin will save the session. Sessions should last 24 hours and then be removed." Saved messages live **in the room**, so a second spotter phone or a reload sees the same list: a spotter-only `{t:'preset', add: string}` / `{t:'preset', remove: string}` (exactly one key, trimmed 1..`MSG_MAX_CHARS`) and `State.presets: string[]` (oldest first, deduped, at most `PRESETS_MAX` = 12). The reducer bumps `seq` only on a change; `preset` is not a spotter call, so it never stamps `calledAt` (it neither shows on the glasses nor restarts the stale-clear window); `stale` keeps presets and `isHudEmpty` ignores them; `expire` drops them. `ROOM_TTL_MS` goes from 12 h to **24 h** (still idle time from `updatedAt`, applied when no socket is open), after which the room's state, presets, PIN and `createdAt` are deleted. The change is **additive — `PROTOCOL_VERSION` stays 2**: `presets` is optional on the `State` type and in `isState` (so a relay or a stored room from before it, and the glasses app's own `State` literals, stay valid; readers use `presets ?? []`), the relay loads a pre-presets stored room with `presets: []` and keeps its lane/cars/msg, and `RoomClient` queues `preset` edits offline in order with `msg`/`clear`. The relay has no preset code of its own (generic validate → reduce → persist → broadcast). A full presets list can make a `state` frame exceed 1024 bytes; `FRAME_MAX_BYTES` bounds client frames only. Verified by `guards.test.ts`, `reduce.test.ts`, `client.test.ts` and the live `services/relay/test/presets.test.ts` (add/remove reach both peers and a replay, driver edits and duplicates do not bump `seq`, the cap, the 6 s stale clear keeps them, a pre-presets stored room keeps its calls, a room idle past 24 h is deleted with its presets and PIN) (T056).

## Open questions

- Should multiple spotters be allowed in v1 UI? Protocol allows it; UI assumes one.
