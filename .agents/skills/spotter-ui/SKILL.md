---
name: spotter-ui
description: Design and implementation conventions for the spotter's phone web app (apps/spotter) — screen structure, the no-scroll console grid, one-tap lane buttons, the three 3-segment car-behind rows, message chips, status/latency header, reconnect UX, and PWA manifest/service-worker setup. Use when building or restyling anything the spotter sees.
---

# Spotter console conventions

The spotter is standing outside, glancing between the track and the phone, often with one hand. Design for sunlight, gloves, and zero attention to spare.

## Screens

1. **Join** — fields: Room code (auto-uppercase, 4–6 chars), PIN (optional, numeric), Your name. Big "Join as spotter" button. Values persist in `localStorage` (`g2rs:v1:*`). Show the relay host in small print so a wrong deployment is obvious.
2. **Console** — the only screen that matters. **It never scrolls** (Maxx, 2026-09-04 design round 2): it is a `100dvh` grid (with a `100vh` fallback first) with `overflow: hidden`, safe-area insets top and bottom, and fixed rows around one stretchy one. Nothing on it may require a scroll at 360×640. Rows, top to bottom:
   - **Status header** (sticky): `ROOM CAR42 · DRIVER ONLINE · 180 ms` and, when a message is outstanding, `✓ acked` / `… waiting`. Driver offline turns the header amber; socket down turns the whole header red with `RECONNECTING`.
   - **Lane stack** (the one stretchy row): three full-width buttons in glasses order ▲ / ▬ / ▼ with the words TOP / MIDDLE / BOTTOM beside the glyph. They take whatever height the fixed rows leave — aim for 88 px, **never below 64 px**. Selected = solid bright fill with dark glyph; unselected = dark fill with bright glyph and a 2 px border. A "clear lane" button (≥ 44 px) closes the stack and sends `lane: null`.
   - **Cars behind** (Maxx, 2026-09-25 design round 3 — replaces the five gap buttons and the inside/outside toggles): three rows `LEFT` / `MIDDLE` / `RIGHT`, in the glasses' left-to-right order, each a label plus a 3-segment bar of tappable buttons `1 · 2 · 3`, ≥ 44 px tall. Segments `1..level` are lit (accent fill), left to right like the glasses' bars; the lit top segment carries `is-top`; a row at level 3 turns red, mirroring the glasses' bright alert outline. Lit state comes from `state.cars` with the same ≤ 300 ms optimistic highlight as the lanes.
   - **Message**: one row — single-line input (maxlength 80) with `Send` (primary) and `Clear` (secondary) beside it. Under it, at most **3** recent messages as chips on one clipped line; tapping a chip sends it immediately.
   - Bottom safe area padded (`env(safe-area-inset-bottom)`); the update toast is the last grid row and costs nothing while hidden.

Landscape: lane stack on the left third, car rows + message on the right. Never let the lane buttons shrink under 64 px; every button the spotter can hit stays ≥ 44 px.

`apps/spotter/test/layout.test.ts` is what holds this: it builds the app, serves `dist`, and measures 390×664, 360×640 and 740×360 in a real Chromium (`playwright-core`, pinned, `PLAYWRIGHT_BROWSERS_PATH`). Change a row height and re-run it before changing the numbers above. With the car rows (2026-09-25) it measured lanes ≥ 85 / 77 / 71 px at those three sizes, every button ≥ 44 px.

## Behaviour

- Lane tap → `lane` immediately; button reflects *server* state from the next `state` frame (optimistic highlight allowed for ≤ 300 ms, then reconcile). Tapping the already-selected lane does nothing.
- Car segment tap → exactly one `cars` frame carrying the **full triple** with only that row changed: tapping segment n sets the row to level n, tapping the lit top segment (n === current level) sets it to 0 — there is no separate clear control to find with a car on the bumper. `nextCarLevel` / `nextCars` in `intents.ts` are that decision, kept pure so they are unit-tested without a DOM. A tap is computed against `selectedCars(model)` (optimistic within 300 ms, else the room), so two quick taps on different rows compose. Dragging across segments is not implemented (optional in the round-3 brief). No throttle: one tap is one frame.
- Send: trim, cap 80, send `msg`, clear input, push to recent chips (dedupe, keep 5). Clear sends `clear`.
- Reconnect: handled by the shared `RoomClient` — on `open` it sends `hello`, takes the replayed `state` as truth, then flushes only intents queued *while the socket was down* (latest `lane`, latest `cars` triple, any `msg`/`clear` in order). Never re-send an already-delivered `msg` (each `msg` gets a new id and would duplicate). Show the banner until the first `state` arrives, then reconcile the UI to it.
- Latency: round trip from the `ping`/`pong` pair (`pong.ts` field is the client's send timestamp), EWMA over 5 samples, shown in the header; grey out if older than 10 s.
- Haptics: `navigator.vibrate?.(10)` on lane tap, car segment tap and send (Android only; harmless elsewhere).

## Visual system

- Dark background `#0b0f14`, text `#e8f0f2`, accent `#39ff88` (matches the glasses' green), alert `#ff4d4d`, amber `#ffb020`. Minimum contrast 7:1 for text on buttons.
- Typography: system UI font, 18 px base, lane labels 22 px bold, car row labels 14 px and segment numbers 15 px bold. Type sizes are part of the fit — shrink a row before you let the lane stack drop under 64 px.
- `touch-action: manipulation` globally; `user-select: none` on controls; no hover-only states; focus rings visible for keyboard users anyway.
- No animations longer than 150 ms; nothing moves while the spotter is not touching it, except the status header text.

## PWA

- `manifest.webmanifest`: `display: standalone`, `orientation: any`, `theme_color` = background, 192/512 icons (simple ▲●▼ mark on dark), `start_url: /`.
- Service worker: precache the built shell (`index.html`, JS, CSS, icons) with a version stamp; network-first for `index.html`; **never** intercept `/room/*` or WebSocket traffic. Show a small "update available — reload" toast when a new SW activates.
- First-visit hint: "Add to Home Screen for full-screen use" with platform-specific one-liners (iOS: Share → Add to Home Screen).
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">`.

## Structure (apps/spotter/src)

```
main.ts             bootstrap, the one delegated listener, all sends
model.ts            Model + selectedLane/selectedCars (optimistic → server)
intents.ts          pure decisions: CAR_ROWS/CAR_SEGMENTS, nextCarLevel, nextCars, normaliseMessage
storage.ts          join form in localStorage; recent-messages.ts the chips
net/room-client.ts  thin wrapper: `new RoomClient({ WebSocket: window.WebSocket, ... })` + latency tee
ui/vdom.ts          ~150-line positional diff (no framework — AC-5's 40 KB budget)
ui/view.ts          join + console as one pure function of the Model
sw.ts               service worker
styles.css
```

Keep `view()` pure enough to unit-test with jsdom: given a `State` and a connection status, assert which lane and which car segments are lit, the header text, and the banner presence. Every interaction is a `data-act` attribute; no handler lives in the tree. Slots are always rendered and toggled with `hidden` so the positional diff never re-creates a control mid-interaction — keep child counts constant.
