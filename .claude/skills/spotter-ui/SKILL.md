---
name: spotter-ui
description: Design and implementation conventions for the spotter's phone web app (apps/spotter) — screen structure (random-room join with PIN), the no-scroll console grid, the one-tap lane row, the three vertical 3-segment car sliders, built-in and room-saved message buttons, the one-row icon header, reconnect UX, and PWA manifest/service-worker setup. Use when building or restyling anything the spotter sees.
---

# Spotter console conventions

The spotter is standing outside, glancing between the track and the phone, often with one hand. Design for sunlight, gloves, and zero attention to spare.

## Screens

1. **Join** (Maxx, 2026-09-25 design round 4: "When a user goes to the page, they are assigned a random room ID. User is asked to set a 4 digit pin."):
   - **New visit** (no stored room, or the stored one was last heard more than `ROOM_TTL_MS` = 24 h ago): a random 6-char `[A-Z0-9]` code (`generateRoomCode`, `crypto.getRandomValues`, no modulo bias) shown large, a required **Set a PIN** field (4 digits), an optional name, and **Start**. If the relay answers `auth` to a fresh code (it collided with someone else's PIN'd room), `main.ts` silently tries **one** new code; a second `auth` goes back to Join with the wrong-PIN notice.
   - **Join an existing room** (a link under Start): the classic form — room code (auto-uppercase, 4–6 chars), PIN (optional), name, "Join as spotter" — for a second spotter phone. "Start a new room" goes back.
   - Room/PIN/name persist in `localStorage` (`g2rs:v1:*`); `g2rs:v1:seenAt` records when the phone last heard its room, so a return inside 24 h auto-joins. The relay host is in small print so a wrong deployment is obvious. Both sections are always rendered and toggled with `hidden`.
2. **Console** — the only screen that matters. **It never scrolls** (Maxx, 2026-09-04 design round 2): a `100dvh` grid (with a `100vh` fallback first) with `overflow: hidden` and safe-area insets. Design round 4 (2026-09-25): "This can all fit on the top half of the app ui … On the bottom half, have buttons to send messages to driver."
   - **Header — one 36 px row of small icons** (no full-width bars): the room code as a small mono chip (a button whose hit box is still 44 px, hanging transparently over the row's edges; tap → a full-screen overlay with the code and PIN large for the driver to type into the glasses app, tap again to close); the **link dot** (green when the socket is open *and* the room replayed, red otherwise) with a small red **`RECONNECTING`** pill beside it while down (`SYNCING…` while open but not yet replayed); the **driver dot** (green online / grey offline); the **ack icon** (`⌛` while the room's message is unacknowledged, `✓` once `ackedAt` is set, hidden when there is no message); latency `123 ms` on the right.
   - **Top half** (fixed height; ends at y = 276 px at 360×640):
     - **Lane row**: three buttons side by side in glasses order, **left to right ▼ BOTTOM · ▬ MIDDLE · ▲ TOP** ("Bottom is the left most buttons, Middle is middle, and top is right"), glyph over label, **≥ 64 px tall**, then a narrow `✕ CLEAR` button (52 px wide) that sends `lane: null`. Selected = solid bright fill with dark glyph; unselected = dark fill with bright glyph and a 2 px border.
     - **Car sliders**: three **vertical 3-segment sliders** side by side, `LEFT` / `MIDDLE` / `RIGHT` (the glasses' left-to-right order), each a column of segments stacked bottom-up like a level meter (1 at the bottom, 3 on top) with its label underneath; segments ≥ 44 px tall. Segments `1..level` are lit (accent fill), the lit top one carries `is-top`, and a slider at level 3 turns red like the glasses' alert outline.
   - **Bottom half**:
     - **Built-in messages**: `PULL OFF · LEADERS BEHIND · BACK UP ENTRY · DRIVE IN FURTHER · SPIN` (client constants `BUILTIN_MESSAGES`), a 2-column grid of ≥ 48 px amber buttons, SPIN full width in the alert colour (3 columns in landscape). One tap sends that `msg`.
     - **Saved messages**: the room's `state.presets` as chips (tap the text → `msg`; the small `×` → `preset remove`). They wrap, take whatever height is left, and scroll *inside their own box* if the room holds more than fits — the console itself never scrolls. The slot is hidden while the room has none.
     - **Message row**: `[type a short message] [Send] [Save]` — input maxlength 80; Send (primary) sends `msg` and clears the input; Save sends `preset add` and clears the input (shows `Full` with `aria-disabled` at `PRESETS_MAX`). There is no Clear button any more (the glasses auto-ack and the relay's 6 s stale clear retire a message).
   - Bottom safe area padded; the update toast is the last grid row and costs nothing while hidden.

Landscape (`orientation: landscape` and height ≤ 560 px): the top half on the left (48 %), the messages on the right. Every button the spotter can hit stays ≥ 44 px, lanes ≥ 64 px.

`apps/spotter/test/layout.test.ts` is what holds this: it builds the app, serves `dist`, and measures 390×664, 360×640 and 740×360 in a real Chromium (`playwright-core`, pinned, `PLAYWRIGHT_BROWSERS_PATH`), each twice: relay down (pill up) and a live room replayed by an in-page fake WebSocket with three saved messages and an unacknowledged message. Change a row height and re-run it before changing the numbers above. Round 4 measured: no scroll anywhere, 21 buttons (27 with three presets) all ≥ 44 px, lanes 64 px, sliders end at y = 276 in both portrait sizes (under the 50 % line), three preset chips fully visible at all three sizes.

## Behaviour

- Lane tap → `lane` immediately; button reflects *server* state from the next `state` frame (optimistic highlight allowed for ≤ 300 ms, then reconcile). Tapping the already-selected lane does nothing.
- Car slider → exactly one `cars` frame per gesture, carrying the **full triple** with only that slider changed. `pointerdown` on segment n picks level n (or 0 when n is the lit top segment — there is no separate clear control to find with a car on the bumper); `pointermove` across that slider's segments changes the level (the label under the bottom segment = 0; other sliders are ignored; wobble inside the segment under the finger changes nothing, which keeps a tap on the lit top at 0); nothing is sent while the finger is down (the sliders show the finger's level via `model.dragCars`); `pointerup` sends once if the level changed, `pointercancel` sends nothing. Touch pointers stay captured by the element they went down on, so the segment under the finger comes from `document.elementFromPoint`; `.slider`/`.seg` have `touch-action: none`. The `click` that follows a gesture is swallowed; a keyboard (or synthetic) click on a segment is a plain tap. `startCarDrag` / `moveCarDrag` / `endCarDrag` / `nextCars` in `intents.ts` are that decision, kept pure so they are unit-tested without a DOM. A gesture starts from `selectedCars(model)` (drag → optimistic within 300 ms → the room), so two quick changes on different sliders compose. No throttle.
- Messages: a built-in button or a saved chip sends its text as `msg`; Send sends the trimmed, 80-capped input and clears it; Save sends `preset add` and clears it; `×` sends `preset remove`. Saved messages appear when the room's `state` comes back — never from `localStorage`.
- Reconnect: handled by the shared `RoomClient` — on `open` it sends `hello`, takes the replayed `state` as truth, then flushes only intents queued *while the socket was down* (latest `lane`, latest `cars` triple, any `msg`/`clear`/`preset` in order). Car changes made before the session has replayed are **not** sent as a triple built from the pre-drop local copy: `main.ts` holds the changed sliders and, on the first `state` of the session, sends `rebaseCars(state.cars, pendingRows)` — only those sliders override the replayed room, so sliders the relay cleared meanwhile (the 6 s stale clear) do not come back. Never re-send an already-delivered `msg` (each `msg` gets a new id and would duplicate). The pill stays up until the first `state` arrives, then the UI reconciles to it.
- Latency: round trip from the `ping`/`pong` pair (`pong.ts` field is the client's send timestamp), EWMA over 5 samples, shown in the header; grey out if older than 10 s.
- Haptics: `navigator.vibrate?.(10)` on lane tap, slider down/level change, message send, save and remove (Android only; harmless elsewhere).

## Visual system

- Dark background `#0b0f14`, text `#e8f0f2`, accent `#39ff88` (matches the glasses' green), alert `#ff4d4d`, amber `#ffb020`. Minimum contrast 7:1 for text on buttons.
- Typography: system UI font, 18 px base; lane labels 15 px bold under a 24 px glyph; slider labels 12 px and segment numbers 15 px bold; the room code chip, overlay and join code in a monospace face. Type sizes are part of the fit — shrink a row before you let a lane drop under 64 px or the sliders spill past the top half.
- `touch-action: manipulation` globally; `user-select: none` on controls; no hover-only states; focus rings visible for keyboard users anyway.
- No animations longer than 150 ms; nothing moves while the spotter is not touching it, except the status header text.

## PWA

- `manifest.webmanifest`: `display: standalone`, `orientation: any`, `theme_color` = background, 192/512 icons (simple ▲●▼ mark on dark), `start_url: /`.
- Service worker: precache the built shell (`index.html`, JS, CSS, icons) with a version stamp; network-first for `index.html`; **never** intercept `/room/*` or WebSocket traffic. Show a small "update available — reload" toast when a new SW activates.
- First-visit hint: "Add to Home Screen for full-screen use" with platform-specific one-liners (iOS: Share → Add to Home Screen).
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">`.

## Structure (apps/spotter/src)

```
main.ts             bootstrap, the delegated click/input/keydown/pointer listeners, all sends, the join flow
model.ts            Model + selectedLane/selectedCars/roomPresets (drag → optimistic → server)
intents.ts          pure decisions: CAR_ROWS/CAR_SEGMENTS, BUILTIN_MESSAGES, nextCarLevel, nextCars,
                    startCarDrag/moveCarDrag/endCarDrag, rebaseCars, normaliseMessage
join.ts             generateRoomCode, isStartPin, isSessionCurrent (24 h)
storage.ts          join form + seenAt in localStorage
net/room-client.ts  thin wrapper: `new RoomClient({ WebSocket: window.WebSocket, ... })` + latency tee
ui/vdom.ts          ~150-line positional diff (no framework — AC-5's 40 KB budget)
ui/view.ts          join + console as one pure function of the Model
sw.ts               service worker
styles.css
```

Keep `view()` pure enough to unit-test with jsdom: given a `State` and a connection status, assert which lane and which slider segments are lit, the header icons, the pill, and the preset chips. Every interaction is a `data-act` attribute; no handler lives in the tree. Slots are always rendered and toggled with `hidden` so the positional diff never re-creates a control mid-interaction — keep child counts constant (the preset chip list is the one variable-length child, and it sits in its own container before the message row).
