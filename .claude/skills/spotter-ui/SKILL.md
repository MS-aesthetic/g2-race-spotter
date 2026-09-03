---
name: spotter-ui
description: Design and implementation conventions for the spotter's phone web app (apps/spotter) — screen structure, one-tap lane buttons, car-behind slider mapping and throttling, message chips, status/latency header, reconnect UX, and PWA manifest/service-worker setup. Use when building or restyling anything the spotter sees.
---

# Spotter console conventions

The spotter is standing outside, glancing between the track and the phone, often with one hand. Design for sunlight, gloves, and zero attention to spare.

## Screens

1. **Join** — fields: Room code (auto-uppercase, 4–6 chars), PIN (optional, numeric), Your name. Big "Join as spotter" button. Values persist in `localStorage` (`g2rs:v1:*`). Show the relay host in small print so a wrong deployment is obvious.
2. **Console** — the only screen that matters. Portrait layout, top to bottom:
   - **Status header** (sticky): `ROOM CAR42 · DRIVER ONLINE · 180 ms` and, when a message is outstanding, `✓ acked` / `… waiting`. Driver offline turns the header amber; socket down turns the whole header red with `RECONNECTING`.
   - **Lane stack**: three full-width buttons ≥ 88 px tall, in glasses order ▲ / ● / ▼ with the words TOP / MIDDLE / BOTTOM beside the glyph. Selected = solid bright fill with dark glyph; unselected = dark fill with bright glyph and a 2 px border. A small "clear lane" text button under the stack sends `lane: null`.
   - **Car behind**: a horizontal slider spanning the width, thick track (≥ 44 px hit height), labelled `CLEAR` at 0 and `ON BUMPER` at 100, current value shown large. Chips `0 · 25 · 50 · 75 · 100`. The track fill colour shifts toward red above 75 to mirror the glasses' inverted bar at ≥ 90.
   - **Message**: single-line input (maxlength 80), `Send` (primary) and `Clear` (secondary). Below it, up to 5 recent messages as chips; tapping a chip sends it immediately.
   - Bottom safe area padded (`env(safe-area-inset-bottom)`).

Landscape: lane stack on the left third, slider + message on the right. Never let the lane buttons shrink under 64 px.

## Behaviour

- Lane tap → `lane` immediately; button reflects *server* state from the next `state` frame (optimistic highlight allowed for ≤ 300 ms, then reconcile). Tapping the already-selected lane does nothing.
- Slider: emit `gap` at most every `GAP_SEND_MIN_MS` (100 ms) while dragging and once on `change`; ignore sub-1-point jitter. Chips send once.
- Send: trim, cap 80, send `msg`, clear input, push to recent chips (dedupe, keep 5). Clear sends `clear`.
- Reconnect: handled by the shared `RoomClient` — on `open` it sends `hello`, takes the replayed `state` as truth, then flushes only intents queued *while the socket was down* (latest `lane`, latest `gap`, any `msg`/`clear` in order). Never re-send an already-delivered `msg` (each `msg` gets a new id and would duplicate). Show the banner until the first `state` arrives, then reconcile the UI to it.
- Latency: round trip from the `ping`/`pong` pair (`pong.ts` field is the client's send timestamp), EWMA over 5 samples, shown in the header; grey out if older than 10 s.
- Haptics: `navigator.vibrate?.(10)` on lane tap and send (Android only; harmless elsewhere).

## Visual system

- Dark background `#0b0f14`, text `#e8f0f2`, accent `#39ff88` (matches the glasses' green), alert `#ff4d4d`, amber `#ffb020`. Minimum contrast 7:1 for text on buttons.
- Typography: system UI font, 18 px base, lane labels 22 px bold, slider value 40 px.
- `touch-action: manipulation` globally; `user-select: none` on controls; no hover-only states; focus rings visible for keyboard users anyway.
- No animations longer than 150 ms; nothing moves while the spotter is not touching it, except the status header text.

## PWA

- `manifest.webmanifest`: `display: standalone`, `orientation: any`, `theme_color` = background, 192/512 icons (simple ▲●▼ mark on dark), `start_url: /`.
- Service worker: precache the built shell (`index.html`, JS, CSS, icons) with a version stamp; network-first for `index.html`; **never** intercept `/room/*` or WebSocket traffic. Show a small "update available — reload" toast when a new SW activates.
- First-visit hint: "Add to Home Screen for full-screen use" with platform-specific one-liners (iOS: Share → Add to Home Screen).
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">`.

## Structure (apps/spotter/src)

```
main.ts          bootstrap, route join/console by stored state
net/room-client  thin wrapper: `new RoomClient({ WebSocket: window.WebSocket, ... })` from packages/protocol/src/client.ts
ui/join.ts       join screen
ui/console.ts    console screen: view(state, conn) → DOM, event wiring
ui/slider.ts     throttled slider component (unit-tested)
sw.ts            service worker
styles.css
```

Keep `view()` pure enough to unit-test with jsdom: given a `State` and a connection status, assert which lane is highlighted, the header text, and the banner presence.
