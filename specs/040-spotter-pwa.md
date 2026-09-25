# 040 — Spotter PWA

Status: ACTIVE
Depends on: 020
Design reference: docs/BUILD_PLAN.md §5, §7 Phase 3; skill `spotter-ui`

## Purpose

The spotter's one-handed console: join a room, call a lane with one tap, call the cars behind with one tap per change, send short messages, and always know whether the driver is receiving — all on one screen that never scrolls.

## Scope

In: Join and Console screens, `RoomClient` wrapper, car-behind rows, recent-message chips, status header with latency and ack tick, reconnect banner, the no-scroll console grid, PWA manifest + service worker, hosting from the Worker's assets.
Out: accounts, multiple drivers, push notifications.

## Requirements

R1. MUST follow `.agents/skills/spotter-ui/SKILL.md` for layout, sizes, colours, behaviour, and structure.
R2. Lane buttons MUST be stacked ▲/▬/▼ and stretch to fill the console, never under 64 px; tapping the selected lane is a no-op; "clear lane" sends `lane:null`.
R3. The car-behind control MUST be three rows LEFT / MIDDLE / RIGHT, each a 3-segment tappable bar: tapping segment n sets that row to level n, tapping the lit top segment sets it to 0, and each change sends exactly one `cars` frame with the full `[left, mid, right]` triple; lit segments come from `state.cars`. There is no slider and no throttle.
R4. Messages MUST be trimmed, capped at `MSG_MAX_CHARS`, stored as 5 recent chips in `localStorage`.
R5. Header MUST show room, driver online/offline, EWMA round-trip latency, and ack state; socket loss shows a RECONNECTING banner while controls stay enabled.
R6. Reconnect MUST rely on `RoomClient` (replay is truth; only offline-queued intents are flushed).
R7. Bundle MUST be ≤ 40 KB gzipped for JS; service worker MUST never intercept `/room/*`.
R8. The console MUST fit the viewport without scrolling at 360×640 and in landscape, with every button ≥ 44 px tall.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a `State` with `lane:"mid"`, when `view()` renders, then the lane row reads **▼ BOTTOM · ▬ MIDDLE · ▲ TOP** left to right, only the ▬ button has the selected class, and the header's driver dot shows online/offline per `driverOnline` | `apps/spotter/test/view.test.ts` (jsdom) |
| AC-2 | Given the three vertical sliders LEFT / MIDDLE / RIGHT (segments stacked 1 at the bottom … 3 on top), when segment n of a slider is tapped, or a pointer drag across that slider's segments is released, then exactly one `cars` with the full triple is decided (that slider = n, or the level under the finger at release — 0 when the tap was on the lit top segment or the drag ended on the label), nothing is sent while the finger is down, and segments `1..level` of each slider light from `state.cars` (optimistically for ≤ 300 ms, then from the room); a slider at level 3 is marked hot | `apps/spotter/test/intents.test.ts`, `apps/spotter/test/view.test.ts`, `apps/spotter/test/main-rebase.test.ts` |
| AC-3 | Given connection `closed`, then the banner (since design round 4 the header's `RECONNECTING` pill beside a red link dot) is present and buttons are not disabled; given `open` and a replayed `state`, then the banner is gone and controls reflect the replayed state | `apps/spotter/test/view.test.ts` |
| AC-4 | Given a sent message, when `state.msg.ackedAt` becomes non-null, then the header shows the ack tick | `apps/spotter/test/view.test.ts` |
| AC-5 | Given `npm run build -w apps/spotter`, then the main JS chunk is ≤ 40 KB gzipped | `apps/spotter/test/bundle-size.test.ts` |
| AC-6 | Given the built app served by `wrangler dev`, when opened on iOS Safari and Android Chrome, then join → console works, "Add to Home Screen" installs, and landscape keeps lane buttons ≥ 64 px | `[HW]` screenshots `qa/<date>/040-*.png` |
| AC-7 | Given two phones and real glasses on LTE, when the spotter taps ▲, then the glasses show ▲ within ~0.5 s (log timestamps) | `[HW]` `qa/<date>/REPORT.md` |
| AC-8 | Given the built app served over http, when it is opened at 390×664, 360×640 and 740×360 in Chromium, then `documentElement.scrollHeight <= innerHeight`, the console root's `scrollHeight <= clientHeight`, every visible button is ≥ 44 px tall and the lane buttons ≥ 64 px; in portrait the lane row and the car sliders end within the top half of the viewport; and a room holding three saved messages shows all three chips without scrolling | `apps/spotter/test/layout.test.ts` (skips with a message when no Chromium is found) |

## Decisions

- 2026-09-03 PWA, not native — why: no store, same TypeScript, the socket client is shared with the glasses app.

- 2026-09-04 Round-trip latency is derived in the spotter's `RoomClient` wrapper by teeing inbound `pong` frames through the injected `WebSocket` constructor — why: `RoomClient` treats `pong` as liveness only; promoting an `onLatency` hook into `packages/protocol` is a separate task if a third client ever needs it.

- 2026-09-04 (Maxx) **Design round 1 — CAR INSIDE / CAR OUTSIDE.** The console gains two amber toggle buttons under the car-behind slider, ≥ 56 px tall, that send the new `side` message. Selected state comes from `state.side` with the same ≤ 300 ms optimistic highlight as the lanes; tapping the lit button sends `side: null`, so there is no separate clear control to find with a car alongside. Header, lane stack, slider and message box are unchanged.

- 2026-09-04 (Maxx) **Design round 2 — gap buttons, and a console that never scrolls.** The car-behind slider is replaced by five buttons `CLEAR · 25 · 50 · 75 · BUMPER` (0/25/50/75/100): one tap, one `gap`, selected state from `state.gap` snapped to the nearest of the five, the same ≤ 300 ms optimistic highlight as the lanes, and a tap on the lit button is a no-op. AC-2 is rewritten accordingly and the throttle (`createGapThrottle`) and `slider.test.ts` are deleted — one tap cannot outrun `GAP_SEND_MIN_MS`, so there is nothing left to throttle. **Why buttons:** a drag needs the spotter to look at the phone and land on a number; five buttons are one glanceless tap and give both ends a value they can say out loud.

  The console is now a `100dvh` grid (`100vh` fallback) with `overflow: hidden` and safe-area insets: header / banner / lane stack (the only stretchy row) / gap row / inside-outside row / message row + at most 3 recent chips / update toast. The lane stack takes what is left and never drops under 64 px. New R8 and AC-8 are held by `apps/spotter/test/layout.test.ts`, which builds the app, serves `dist` from a local http server and measures three viewports in a real Chromium via a pinned `playwright-core` (`PLAYWRIGHT_BROWSERS_PATH`; it skips with an explicit message where no browser is installed) — jsdom cannot answer a layout question.

- 2026-09-25 (Maxx) **Design round 3 — three car rows replace the gap buttons and the inside/outside toggles.** Maxx: "make UI have 3 sliders with 3 segments each." The console's car-behind block is now three rows LEFT / MIDDLE / RIGHT (glasses order), each a label and three ≥ 44 px segment buttons `1 · 2 · 3`: tap n → level n, tap the lit top segment → 0, one `cars` frame per change carrying the full triple (protocol v2, spec 020). Lit segments fill left to right like the glasses' bars, come from `state.cars` with the lanes' ≤ 300 ms optimistic window, and a level-3 row turns red like the glasses' alert outline. Dragging across segments was optional and is not built. The middle lane glyph becomes ▬ to match the glasses' dash. R3 and AC-2 are rewritten (human-authorized). `layout.test.ts` still holds AC-8: lanes measured ≈85 / 77 / 71 px at 390×664 / 360×640 / 740×360, every button ≥ 44 px, no scroll. Car taps made before a (re)connected session has replayed are held per row and rebased onto the replayed `state.cars` (`rebaseCars` in `intents.ts`, T055a) rather than queued in `RoomClient` as a pre-drop triple, so rows the relay stale-cleared meanwhile are not resurrected.

- 2026-09-25 (Maxx) **Design round 4 — top half / bottom half, room presets, a random room with a PIN.** Maxx: "Bottom is the left most buttons, Middle is middle, and top is right. Make the lower buttons 3 segment sliders in the app. This can all fit on the top half of the app ui. Make the room and status small icons instead of big bars. On the bottom half, have buttons to send messages to driver. Pull off / Leaders Behind / Back up Entry / Drive in Further / SPIN and an option to manually type a short message and save the message for a future push. [Saved messages live in the room.] When a user goes to the page, they are assigned a random room ID. User is asked to set a 4 digit pin. This room and pin will save the session. Sessions should last 24 hours and then be removed." The console is now: a **one-row 36 px header** of small icons (room code chip — tap shows code and PIN large for the driver —, link dot with a small `RECONNECTING`/`SYNCING…` pill, driver dot, ack icon `⌛`/`✓`, latency); the **top half** — a lane row left to right **▼ BOTTOM · ▬ MIDDLE · ▲ TOP** (≥ 64 px) plus a narrow `✕ CLEAR` (`lane: null`), and three **vertical** 3-segment sliders LEFT / MIDDLE / RIGHT side by side (bottom-up level meters, tap n → n, tap the lit top → 0, pointer drag across the segments sets the level and sends **one** `cars` on release); the **bottom half** — five built-in message buttons (`PULL OFF · LEADERS BEHIND · BACK UP ENTRY · DRIVE IN FURTHER · SPIN`, one tap → `msg`), the room's saved messages as chips (tap → `msg`, `×` → `preset remove`; they scroll inside their own box if many), and `[message] [Send] [Save]` (Save → `preset add`). Saved messages are room state (`State.presets`, spec 020) rendered from the replayed state; the localStorage recent-message chips (`recent-messages.ts`, `g2rs:v1:recentMsgs`) and the Clear button are removed. **Join:** a first visit (or one more than 24 h after the phone last heard its room, `g2rs:v1:seenAt`) gets a random 6-char `[A-Z0-9]` code from `crypto.getRandomValues`, shown large, and must set a 4-digit PIN before **Start**; an `auth` answer to the fresh code (a collision with someone's PIN'd room) is retried once with a new code; "Join an existing room" keeps the classic form (PIN optional) for a second phone; a return inside 24 h auto-joins. This supersedes the stacked-lane wording of R2, the "rows" of R3, R4's localStorage chips (now room presets) and R5's full-width banner (now the header pill); AC-1 and AC-2 are rewritten, AC-3 names the pill, AC-8 gains the top-half and preset-chip checks. The brief allowed 40 px segments; they stay **44 px** because 44 still fits — `layout.test.ts` measured, relay down and live with three presets, no scroll at 390×664 / 360×640 / 740×360, every button ≥ 44 px, lanes 64 px, sliders ending at y = 276 in both portrait sizes (43 % of 640). New verifier `apps/spotter/test/join.test.ts` (code shape and bias, PIN required, one collision retry, 24 h resume rule, classic form). shipped JS 8.5 KB gzipped, service worker included (T056).

## Open questions

- Haptic feedback on lane tap: Android only via `navigator.vibrate`; acceptable?
