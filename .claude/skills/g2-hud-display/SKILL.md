---
name: g2-hud-display
description: Project-specific G2 glasses rendering rules for the Race Spotter HUD — container layout and IDs, the two 576x48 HUD strips (lane icons on top, car bars on the bottom) split into four 288x48 image containers, gray4 packing, text-mode fallback, the per-container update queue, stale/NO LINK rendering, the 5 s message auto-clear, and glasses input mapping. Use when writing or changing anything in apps/glasses/src/render or the page setup.
---

# G2 Race Spotter HUD rendering

This skill encodes the *project's* display decisions. For generic SDK mechanics (container property classes, event enums, font metrics) use the official `everything-evenhub` plugin skills `glasses-ui`, `sdk-reference`, `font-measurement` (invoked as `/name` or `/everything-evenhub:name` in Claude Code, `$name` in Codex). Constraints quoted here come from `docs/RESEARCH_NOTES.md`. The acceptance criteria that bind this skill are in `specs/030-glasses-app-text-mode.md` and `specs/050-image-hud.md`.

## Page layout (created once with `createStartUpPageContainer`)

Canvas 576×288, 4-bit grey (0 off … 15 brightest). `zOrderIndex` must be set on every container if set on any; values unique. Maxx, 2026-09-25 design round 4: "I want the icons to be close to the perimeter so it's not directly in line of sight. Separate the bars on the glasses. Use corners on the glasses, then the top border and bottom borders for the 'middle' icons." The centre of the screen stays empty apart from the message.

Image mode — 7 containers:

| containerID | containerName | type | x | y | w | h | zOrder | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | `bg` | text | 0 | 0 | 576 | 288 | 1 | `content: ' '`, `isEventCapture: 1`, `textColor: 0`, no border. The only event-capture container; the only container that overlaps others (it is behind them all). |
| 2 | `stripTL` | image | 0 | 0 | 288 | 48 | 6 | Left half of the TOP strip: ▼ in the corner, left half of ▬. |
| 5 | `stripTR` | image | 288 | 0 | 288 | 48 | 7 | Right half of the TOP strip: right half of ▬, ▲ in the corner. |
| 3 | `msg` | text | 16 | 112 | 504 | 64 | 4 | `textColor: 4`. `''` when no message. Centre band — a message is meant to be read. Ends at x 520 so it clears `status`. |
| 4 | `status` | text | 528 | 124 | 40 | 28 | 5 | `textColor: 2`, `paddingLength: 2`. Right border, mid-height; `L`/`S` only. (The "4 when NO LINK" idea is not implemented: `textContainerUpgrade` carries content only and the app never rebuilds for text — the blinking `L` plus the dimmed HUD is the NO LINK cue.) |
| 6 | `stripBL` | image | 0 | 240 | 288 | 48 | 8 | Left half of the BOTTOM strip: LEFT bar in the corner, left part of the MIDDLE bar. |
| 7 | `stripBR` | image | 288 | 240 | 288 | 48 | 9 | Right half of the BOTTOM strip: right part of the MIDDLE bar, RIGHT bar in the corner. |

Text mode (startup override or the mid-session fallback) — 4 containers: `bg` (1), `hud` (2, text, 144,8 288×96, `textColor: 4`, zOrder 3), `msg` (3) and `status` (4) with the rects above. Slot 2 is `stripTL` in image mode and `hud` in text mode, so both pages number their containers 1..n with no gaps; `msg` is always 3 and `status` always 4. `startup-page.test.ts` pins all of this: rects on the canvas, no overlaps apart from `bg`, unique zOrder, and the SDK caps below.

**Four image containers, not one (supersedes the design-round-3 "exactly one image container" rule; constitution §3 still says "one image container" and is the planner's to reconcile).** The rule existed because each image update is its own serialised bridge call (~100 ms per update, `docs/RESEARCH_NOTES.md`), so one image was cheapest. Maxx's perimeter layout cannot be reached with one image: an image container is at most 288×144, and the icons and bars have to span the full 576-px width at both the top and the bottom edges. The pinned SDK 0.0.12 caps a page at **4 image containers, 8 text containers and 12 containers in total** (`CreateStartUpPageContainer` / `RebuildPageContainer`: `Image_Object (max_count 4)`, `Text_Object (max_count 8)`, `containerTotalNum 1~12`; also `docs/RESEARCH_NOTES.md` §2). Six separate icon/bar images are therefore impossible; four edge strips are the design that fits. To keep the cost down, the queue only sends the containers whose pixels changed (see *Update queue*). **The per-call hardware cost of four 288×48 images is not verified** — the simulator does not model it; `[HW]` T109/T110 measure it on glasses. Until then, treat every number in *Costs to plan around* as an estimate.

Startup sequence:

1. `await waitForEvenAppBridge()`.
2. Draw status `CONNECTING…` as part of the startup page (text content is allowed at startup; image data is not).
3. `createStartUpPageContainer({...})` once. Check the `StartUpPageCreateResult`; on failure log and show the phone-side companion error. Do **not** retry in a loop (a failed retry blocks ~2.1 s and drops input).
4. Only after the room's first `state` frame: render HUD bitmap and message.

## HUD strips (two 576×48 strips → four 288×48 images)

Each strip is drawn into a `Uint8Array(576*48)` of values 0–15 (one byte per pixel, simple to test) as ONE virtual canvas, then `splitStrip` cuts it at x 288 into the two image containers, and each half is packed. Drawing the whole strip first means a shape that crosses the seam (▬, the middle bar) is drawn once and lands half in each image; the halves are pixel-adjacent on the canvas, and the seam is at an even x, so the 2×2 dither stays in phase across it. Positions and levels live in `DESIGN` (`src/render/hud-design.ts`) in strip coordinates (x 0–575, y 0–47); where the strips sit on the canvas is `STRIP_Y` (top 0, bottom 240). It is the only file to edit for a look change; `primitives.ts` is the generic drawing library and knows nothing about racing.

**Dither.** Every *filled* area is painted with a 2×2 checkerboard (`DESIGN.fill = {on:15, off:6}`, alert fill `{on:8, off:3}`) rather than a flat 15 — Maxx, 2026-09-04: "easier on the eyes". One pixel is the finest period the raster carries, so the fill reads as an even mid tone instead of a glare panel; a coarser cell (4×4 Bayer) leaves visible texture at these shape sizes. Outlines and dividers stay flat levels.

Layout (Maxx, 2026-09-25 design round 4; shapes and sizes unchanged from round 3):

- Top strip (canvas y 0–47): three fixed lane slots — ▼ at x 51 (top-left corner), ▬ at x 288 (centred on the seam), ▲ at x 525 (top-right corner), mirror-symmetric. Icons span y 9–39. Triangles are isosceles, 30 px tall, half-width 17 (34 wide); the middle is a 40×10 dash (y 19–28).
  - The called lane is filled with the dither; **the other two are always drawn as 2 px outlines at level 4** (the dash as a hollow rectangle), so the driver sees all three positions and reads which one is lit.
  - `lane: null` → three outlines, nothing filled.
- Bottom strip (canvas y 240–287): three hollow bars, one per `cars[i]` (left / middle / right), each 86×28 at strip y 10–37 (canvas y 250–277), x 8 / 245 / 482 — each centred under the lane icon of the same side (x 51 / 288 / 525). LEFT sits wholly in `stripBL`, RIGHT wholly in `stripBR`, MIDDLE straddles the seam (its middle cell is cut by it).
  - Each bar: 2 px outline at level 6, split into three 26-px cells by two 2-px dividers (same level as the outline).
  - `cars[i]` cells are dithered-filled **left-to-right** (`DESIGN.cars.fillDirection`), each fill inset 1 px from its cell walls.
  - Level 3 (`alertLevel`) swaps the bar to outline 15 and the dimmer alert fill `{8,3}` — the bright outline is the "on the bumper" cue.
  - Level 0 → a hollow bar with its dividers.
- Stale (`linkOk === false`): after drawing, halve every pixel of every strip (`v >> 1`) — all four image containers dim. Shapes remain, obviously dim.
- The relay clears lane, cars and message `HUD_STALE_CLEAR_MS` (6 s) after the spotter's last call (a driver ack does not postpone it); the glasses just draw that `state` like any other (constitution §2 — no local timer decides it).

Keep `drawTopStrip(lane, {linkOk})`, `drawBottomStrip(cars, {linkOk})` and `splitStrip(strip)` pure and unit-tested (`test/draw-hud.test.ts`) with ASCII snapshots of each whole strip (render `#` for ≥8, `+` for 1–7, `.` for 0, downsampled 4× — 144×12 characters, the seam at column 72) so a reviewer can eyeball the shapes in a test file, plus a seam test proving the two halves re-join to the strip byte for byte. The default `max` block sampling keeps thin features but hides the dither (a dithered block still holds a 15); `toAscii(frame, { sample: 'min' })` inverts that and gives a map of exactly which areas are dithered — keep one golden of each per strip.

## gray4 packing

The SDK accepts `number[] | Uint8Array | ArrayBuffer | base64`. Pack two pixels per byte, **verify the nibble order on hardware in Phase 4** (the docs do not state it; community encoders from the `image` template pack high nibble = left pixel — start there, and confirm with a test bitmap that has a single bright column at x=0). Row stride = width/2 bytes, rows top to bottom. Each image container is packed on its own: 288×48 → 6 912 bytes, with `imageWidth: 288`, `imageHeight: 48` as required by `ImageRawDataUpdate`. If the pinned SDK version needs a `compressMode` workaround (0.0.12 with Even App < 2.2.7), apply it in one place: `src/render/sdk-quirks.ts`.

If hardware shows a mirrored/garbled image, the first two things to flip are nibble order and row stride.

## Render mode selection

`resolveRenderMode()` runs once before `createStartUpPageContainer`, in this order:

1. `?render=text` or `?render=image` in the page URL → that.
2. Bridge KV `g2rs:v1:render` set → that (manual override from the phone companion UI).
3. Otherwise `image` — **on hardware and in the simulator alike**. The simulator (≥ 0.9.x; 0.9.5 is what the project pins) accepted the round-3 page (one 288×144 image, 4 containers); the round-4 page (four 288×48 images, 7 containers) still needs its `[SIM]` re-run (050 AC-5b) before that is claimed for it. Image mode is the normal simulator path. Do not detect the simulator to change rendering; `import.meta.env.MODE === 'simulator'` (set by the `dev:sim` script) may only affect logging verbosity and the relay URL default.

Simulator success is **functional** evidence only: the simulator explicitly does not enforce on-device image-size limits, does not decode LZ4, and is faster than hardware. Anything about size limits, nibble order, pacing, or `sendFailed` behaviour is still proven on glasses (`[HW]` criteria in specs 030/050).

In **text mode the startup page is built with one text container in slot 2 instead of the four image containers** (`hud`, 144,8 288×96, `textColor: 4`). `rebuildPageContainer` is only used for the *mid-session* fallback described next. Text mode exists for the exit-dialogue wedge defect and as a manual override — it is no longer needed to run in the simulator, but it must keep working there (the harness runs every scenario in both modes).

## Text-mode fallback (`renderText(state): string`)

Mid-session trigger: three consecutive `sendFailed` from `updateImageRawData` (typically after the exit dialogue). In-memory only; lasts until restart; does not write `g2rs:v1:render`.

A single text container (`hud`, slot 2) replaces the four image containers on a `rebuildPageContainer` (this is the only rebuild the app performs; flicker is acceptable once). The rebuilt page is the text-mode page above, drawn from the newest HUD state:

```
. . ^
[#  ] [## ] [###]
```

Line 1 is the lane row in track order `v - ^`: the called lane shows its marker, the other two a `.` (`. . .` when no lane is called). Line 2 is the three car-behind bars `[left] [mid] [right]`, three cells each, `#` filled left to right and a space empty. Both lines keep a fixed width (5 and 17 characters) so nothing jumps. ASCII only.

**Glyph policy.** Research verified ▲ ▶ ▼ ◀ ● ○ and box-drawing characters on hardware. `█ ░` (Block Elements) and `·` `…` are *not* yet verified — the firmware silently drops unsupported glyphs, which would hollow out the bar. Phase 2 exit includes a hardware render of every non-ASCII glyph the app uses (`▲ ● ▼ █ ░ · …`); anything that fails is swapped for its ASCII fallback in `src/render/glyphs.ts`: `█`→`#`, `░`→`-`, `·`→`|`, `…`→`...`. Keep every non-ASCII character behind that one module.

After switching to text mode mid-session, stay there until app restart (the image channel does not recover).

## Update queue (`src/render/queue.ts`)

Single async worker, **one bridge call in flight, ever**. Inputs: `{kind:'hud', state, linkOk}`, `{kind:'msg', text}`, `{kind:'status', text}`.

Image mode — a `hud` input is drawn as both strips, split and packed straight away (`packContainers`), and from there **each image container is its own job, keyed by container id**:

- A new job for a container **replaces** its pending job (latest wins; never a queue of stale frames).
- **Skip unchanged:** a container whose packed bytes equal the bytes the host last accepted for it (`success`) is not sent; while a send is in flight, the comparison is against the bytes in flight. So a lane change costs ≤ 2 sends (▼↔▲: TL + TR; to/from ▬: TL + TR, the dash straddles the seam; none→▼: TL only), a left or right car change 1, a middle car change up to 2 (1 when only its left cell changes), the relay's stale clear only the containers it changes, and a state that changes nothing costs nothing. A failed send is not recorded as shown, so the next `hud` input re-sends that container — never an automatic retry loop.
- **Top (lane) strip: immediate.** **Bottom (cars) strip: debounced per strip** to one flush per `HUD_GAP_FLUSH_MS` (250 ms); a flush sends both of its pending halves back to back, so the middle bar never shows half old, half new for a debounce window. A link-state change, the first frame and any change to an all-empty HUD (the relay's stale clear, with or without a lane up) flush it at once.
- Order: a half-done bottom flush finishes first, then the top strip, then a due bottom flush, then text jobs.
- Three consecutive `sendFailed` on any image containers → the one `rebuildPageContainer` to the text-mode page, drawn from the newest HUD state; text mode until restart.

Text mode — the whole HUD is one `renderText` job on container 2 (`hud`): a new one replaces the pending one; cars-only changes wait out the 250 ms floor; lane changes, link-state changes and a change to an all-empty HUD bypass it.

Both modes:

- `msg` → `textContainerUpgrade` on container 3 only. `status` → container 4 only. Never rebuild for text.
- Every call: measure `performance.now()` delta, log `{call, ms, result, container}` (`container` = the target container's name; omitted for page-level calls); count consecutive `sendFailed` for the fallback trigger.
- Treat a resolved promise as "accepted", not "displayed" — never wait for confirmation that does not exist.

## Input mapping

| Event | Root page action |
|---|---|
| `CLICK_EVENT` | Ack: send `ack{msgId}` for the current unacked message, and settle the auto-clear timer for it. Do **not** clear locally — the next `state` frame carries `ackedAt` and the renderer hides `msg.text` whenever `ackedAt !== null`. (Rendering is a pure function of the last `state`; the message must not pop back.) |
| `DOUBLE_CLICK_EVENT` | `shutDownPageContainer(1)` (exit dialogue — required) |
| `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` | reserved; no-op in v1 |
| `FOREGROUND_ENTER_EVENT` | re-arm socket, re-render last state |
| `FOREGROUND_EXIT_EVENT` | keep socket (iOS holds it); nothing else |
| `SYSTEM_EXIT_EVENT` / `ABNORMAL_EXIT_EVENT` | close socket, persist nothing new |

Events arrive on `event.textEvent.eventType` for text-capture pages; normalise with a tiny `toOsEvent(event)` helper because community notes report inconsistent event-type shapes across SDK versions.

## Message auto-clear (`MSG_AUTO_ACK_MS`, 5 s)

Maxx, 2026-09-04 design round 2 — messages disappear on their own. `driver.ts`
arms an injected `setTimeout` (the same timer surface as the blink timer)
`MSG_AUTO_ACK_MS` after a message first reaches the screen; when it fires the
app hides that message *and*, if it is still unacked, sends `ack{msgId}` so the
relay's state, the spotter's ack tick and what the driver can see agree.

- Keyed on `msg.id` and measured from **first render**, not from the last
  frame: an unrelated `state` (a cars change) must not buy a message another
  five seconds. A new id starts a fresh window.
- A tap settles the message early and cancels the timer; the text still stays
  up until the relay's `state` says `ackedAt` (R4 is unchanged).
- `RoomClient.send` silently drops an `ack` while the socket is down or before
  the session has replayed, so neither kind of ack may be assumed delivered:
  - a **tapped** ack is recoverable by hand — a transport change
    (`connection !== 'open'`) forgets the settle, the replayed state re-arms
    the timer, and the message is still on screen to tap again;
  - an **auto** ack is not: the text is already gone. The id is therefore held
    as `pendingAckMsgId` and re-sent on every `state` that still shows it
    unacked, until `ackedAt` arrives or the message changes. The retry is
    scheduled one turn later (an injected `setTimeout(…, 0)`), because
    `RoomClient` marks a session replayed only *after* its state listeners run
    and would drop an ack sent from inside the frame that triggered it.
    Duplicates are safe: `reduce` returns the room unchanged for an
    already-acked id and does not bump `seq`.
- `stop()` clears both timers. The constant lives in `apps/glasses/src/app.ts`, not in
  `packages/protocol`: it is a display rule, not a wire timing.
- Hiding is the one thing the driver side decides locally. Lane and cars
  are still drawn only from `state` (constitution §2). The relay's 6 s stale
  clear also removes the message from the room state.

## Status strip strings

Two letters in fixed columns (Maxx, 2026-09-04), on the right border at mid-height (design round 4):

| State | Content |
|---|---|
| link up, spotter connected | `L S` |
| link up, no spotter | `L` |
| NO LINK, spotter last seen connected | `L S` ⇄ `  S` every `STATUS_BLINK_MS` (700 ms) |
| NO LINK, no spotter | `L` ⇄ `` (empty) |
| no room configured | `ROOM ?` |
| before the first frame of the first session | `CONNECTING…` |
| terminal close | `PIN REJECTED` / `DRIVER REPLACED` / `UPDATE APP` / `LINK ERROR` / `DISCONNECTED` |

`L` = the link; solid when it is up, **blinking** when it is not. `S` appears only while `spotterOnline`, and the blank blink phase is a space so `S` never moves column. The blink is driven by a timer in `driver.ts` that exists only while the strip blinks, and it emits `status` queue jobs — **never** an image send (the bitmap does not change between phases). The 40×28 size of container 4 fits `L S` by assumption — confirm with `/font-measurement` that one line fits. The longer strings (`ROOM ?`, `CONNECTING…`, the terminal-close strings) do **not** fit 40 px and will wrap or clip; that is an open question for the planner/Maxx, not something the queue works around.

## Costs to plan around

Unverified estimates (`[HW]` T109/T110 measure them). Round 3 estimated a full 288×144 gray4 frame (~20.7 KB) at ~104 ms + 3.9 ms/KB ≈ 185 ms per image send. A 288×48 half is 6.9 KB → ≈ 131 ms per send by the same formula, so a lane change (≤ 2 sends) ≈ 260 ms, a middle-car flush ≈ 260 ms, a NO-LINK dim (4 sends) ≈ 525 ms, while a left/right car change stays ≈ 131 ms. If the fixed per-call cost dominates on hardware, the skip-unchanged rule is what keeps this layout affordable; do not lower the 250 ms cars flush below 200 ms without measuring.
