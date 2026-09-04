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
R4. `RaceRoom` MUST use the WebSocket Hibernation API, persist `state`/`seq`/`pin` in DO storage, broadcast full state on every change, enforce PIN (first joiner sets), evict the previous driver on a new driver join *after* the PIN check, close silent sockets after `PEER_OFFLINE_MS`, rate-limit per socket, and re-point its single alarm to `updatedAt + ROOM_TTL_MS` when no sockets remain.
R5. The Worker MUST route `/room/:id` upgrades, `/health`, `/room/:id/debug` (gated by `X-Debug-Key`), and fall through to static assets; all HTTP responses carry CORS headers.
R6. `fake-spotter` MUST support scenarios `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay`, `driver-evict`, `soak`, and a `--role driver` mode.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given each fixture in `packages/protocol/test/fixtures`, when guards run, then valid fixtures pass and invalid ones fail | `packages/protocol/test/guards.test.ts` |
| AC-2 | Given initial state, when `lane`, `gap`, `msg`, `ack`, `clear`, `peer`, `expire` events are reduced, then state matches the skill's semantics, `seq` never decreases, and no-ops do not bump `seq` | `packages/protocol/test/reduce.test.ts` |
| AC-3 | Given a spotter and driver connected to `wrangler dev`, when the spotter sends `lane:"top"`, then the driver receives `state` with `lane:"top"` within 500 ms and `seq > 0` | `services/relay/test/roundtrip.test.ts` |
| AC-4 | Given state has been set, when the driver disconnects and reconnects, then the first frame after `hello` is a `state` with identical lane/gap/msg and `seq ≥` last seen | `services/relay/test/replay.test.ts` |
| AC-5 | Given a connected driver, when a second driver joins with the correct PIN, then the first receives `error{code:"role_taken"}` and close 4409 and the second receives `state` | `services/relay/test/eviction.test.ts` |
| AC-6 | Given a room created with PIN 1234, when a client joins without it, then it receives `error{code:"auth"}` and close 4401 | `services/relay/test/auth.test.ts` |
| AC-7 | Given a spotter that stops pinging, when `PEER_OFFLINE_MS + ALARM_TICK_MS` elapses, then the driver receives `state.spotterOnline === false` and the spotter socket is closed 4408 | `services/relay/test/heartbeat.test.ts` |
| AC-8 | Given `RoomClient` with an injected fake `WebSocket`, when the socket drops and the user issues `lane`, `gap`, `gap`, `msg`, then on reopen the client sends `hello`, waits for `state`, then flushes exactly `lane`, the last `gap`, and `msg` | `packages/protocol/test/client.test.ts` |
| AC-9 | Given a frame > 1024 bytes or with unknown `t`, when received, then the relay ignores/rejects per the skill and the socket stays open | `services/relay/test/validation.test.ts` |
| AC-10 | Given a deployed Worker on `*.workers.dev`, when `fake-spotter --scenario lanes` and a `--role driver` instance run against it, then both exit 0 | `[HW]` needs a Cloudflare account; log in `qa/<date>/020-deploy.log` |

## Decisions

- 2026-09-03 Full-state broadcasts, no deltas — why: reconnects and reordering become trivial; payloads are tiny.
- 2026-09-03 Last-writer-wins for the driver role — why: the driver's own stale socket must never lock it out.
- 2026-09-03 Reconcile both ready-role flags before the first replay after close or rehydration, target an empty room's alarm at `updatedAt + ROOM_TTL_MS`, and reduce `expire` before deleting storage — why: replay must preserve intents and sequence without advertising dead peers, while expiry alone starts a fresh room lifetime.

- 2026-09-03 (audit) `ping` → `pong` is a relay obligation and the alarm is self-arming, never re-pointed on data frames — why: the integrated relay re-armed the tick on every frame (so AC-7's silent-peer detection could never fire while anyone pinged) and never answered pings (so a quiet healthy room would trip the driver's NO LINK); both are fixed as T016 before T011/T009/T012 build on them.
- 2026-09-03 (audit) Rate limiting (R4) belongs to T013's scope; frame-size checks are on UTF-8 byte length before `JSON.parse`; only a `hello` that contradicts the URL closes 4400, other malformed frames get `error{bad_frame}` and stay open; `hello.v !== PROTOCOL_VERSION` → `error{version}` + 4426.
- 2026-09-03 (audit) AC-8's backoff test must open the reconnected socket and close it *without* a replay, and pin `random: () => 0` — why: the quarantined candidate's test never opened the reconnected socket, which is how a reset-on-open defect and a sub-floor jitter survived three reviews.
- 2026-09-04 Treat a client as joining for AC-6 when it sends the protocol-mandated first `hello`: `fetch()` accepts the upgrade and captures URL authority, while the first WebSocket message validates the URL/hello and either establishes the room or sends the rejection error and close synchronously in that event; tests send nothing after `hello` — why: pinned live Wrangler delivers an error frame but does not reliably deliver a server close initiated during the upgrade request without later client I/O, whereas `hello` is already mandatory and provides a supported WebSocket event without weakening the required error/close sequence.
- 2026-09-04 For the first text frame, parse and require a structural `hello`, then reject `hello.v !== PROTOCOL_VERSION` before missing/invalid URL role, URL/hello role/name mismatch, or PIN/storage work — why: an incompatible protocol must consistently receive `error{version}` + 4426 without room side effects, even when URL authority is also invalid.

## Open questions

- Should multiple spotters be allowed in v1 UI? Protocol allows it; UI assumes one.
