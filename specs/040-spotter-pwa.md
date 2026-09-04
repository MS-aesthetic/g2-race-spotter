# 040 — Spotter PWA

Status: ACTIVE
Depends on: 020
Design reference: docs/BUILD_PLAN.md §5, §7 Phase 3; skill `spotter-ui`

## Purpose

The spotter's one-handed console: join a room, call a lane with one tap, slide the car-behind gauge, send short messages, and always know whether the driver is receiving.

## Scope

In: Join and Console screens, `RoomClient` wrapper, slider throttle, recent-message chips, status header with latency and ack tick, reconnect banner, PWA manifest + service worker, hosting from the Worker's assets.
Out: accounts, multiple drivers, push notifications.

## Requirements

R1. MUST follow `.agents/skills/spotter-ui/SKILL.md` for layout, sizes, colours, behaviour, and structure.
R2. Lane buttons MUST be stacked ▲/●/▼, ≥ 88 px tall; tapping the selected lane is a no-op; "clear lane" sends `lane:null`.
R3. Slider MUST emit `gap` at most every `GAP_SEND_MIN_MS` while dragging and once on release; chips 0·25·50·75·100.
R4. Messages MUST be trimmed, capped at `MSG_MAX_CHARS`, stored as 5 recent chips in `localStorage`.
R5. Header MUST show room, driver online/offline, EWMA round-trip latency, and ack state; socket loss shows a RECONNECTING banner while controls stay enabled.
R6. Reconnect MUST rely on `RoomClient` (replay is truth; only offline-queued intents are flushed).
R7. Bundle MUST be ≤ 40 KB gzipped for JS; service worker MUST never intercept `/room/*`.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a `State` with `lane:"mid"`, when `view()` renders, then only the ● button has the selected class and the header shows `DRIVER ONLINE`/`OFFLINE` per `driverOnline` | `apps/spotter/test/view.test.ts` (jsdom) |
| AC-2 | Given the slider dragged through 30 values in 300 ms, then ≤ 4 `gap` messages are sent and the last equals the final value | `apps/spotter/test/slider.test.ts` |
| AC-3 | Given connection `closed`, then the banner is present and buttons are not disabled; given `open` and a replayed `state`, then the banner is gone and controls reflect the replayed state | `apps/spotter/test/view.test.ts` |
| AC-4 | Given a sent message, when `state.msg.ackedAt` becomes non-null, then the header shows the ack tick | `apps/spotter/test/view.test.ts` |
| AC-5 | Given `npm run build -w apps/spotter`, then the main JS chunk is ≤ 40 KB gzipped | `apps/spotter/test/bundle-size.test.ts` |
| AC-6 | Given the built app served by `wrangler dev`, when opened on iOS Safari and Android Chrome, then join → console works, "Add to Home Screen" installs, and landscape keeps lane buttons ≥ 64 px | `[HW]` screenshots `qa/<date>/040-*.png` |
| AC-7 | Given two phones and real glasses on LTE, when the spotter taps ▲, then the glasses show ▲ within ~0.5 s (log timestamps) | `[HW]` `qa/<date>/REPORT.md` |

## Decisions

- 2026-09-03 PWA, not native — why: no store, same TypeScript, the socket client is shared with the glasses app.

- 2026-09-04 Round-trip latency is derived in the spotter's `RoomClient` wrapper by teeing inbound `pong` frames through the injected `WebSocket` constructor — why: `RoomClient` treats `pong` as liveness only; promoting an `onLatency` hook into `packages/protocol` is a separate task if a third client ever needs it.

## Open questions

- Haptic feedback on lane tap: Android only via `navigator.vibrate`; acceptable?
