---
name: g2-hud-display
description: Project-specific G2 glasses rendering rules for the Race Spotter HUD — container layout and IDs, the two HUD strips (576x48 lane icons on top, 576x96 corner-ring and middle car bars on the bottom) split into four image containers (288x48 / 288x96), gray4 packing, the lane-call blink, text-mode fallback, the per-container update queue, stale/NO LINK rendering, the 5 s message auto-clear, and glasses input mapping. Use when writing or changing anything in apps/glasses/src/render or the page setup.
---

# G2 Race Spotter HUD rendering

This skill encodes the *project's* display decisions. For generic SDK mechanics (container property classes, event enums, font metrics) use the official `everything-evenhub` plugin skills `glasses-ui`, `sdk-reference`, `font-measurement` (invoked as `/name` or `/everything-evenhub:name` in Claude Code, `$name` in Codex). Constraints quoted here come from `docs/RESEARCH_NOTES.md`. The acceptance criteria that bind this skill are in `specs/030-glasses-app-text-mode.md` and `specs/050-image-hud.md`.

## Page layout (created once with `createStartUpPageContainer`)

Canvas 576×288, 4-bit grey (0 off … 15 brightest). `zOrderIndex` must be set on every container if set on any; values unique. Maxx, 2026-09-25 design round 4: "I want the icons to be close to the perimeter so it's not directly in line of sight. Separate the bars on the glasses. Use corners on the glasses, then the top border and bottom borders for the 'middle' icons." Maxx, 2026-09-30 design round 5: "Put text upper middle below the top rectangle on glasses. For bottom sliders, is it possible to do bars on the corners with rounded edges? Kinda look like a mix between a banana and an L. Then for middle still be a bar but it can be vertical instead of horizontal. Can use segments instead of dynamic sliders on the glasses. For the top bars, make the left triangle point left, right triangle point right, make middle a triangle pointing up. For those, when the user presses the app button on the phone make the glasses image blink. Empty outline then filled outline." The centre of the screen stays empty apart from the message.

Image mode — 7 containers:

| containerID | containerName | type | x | y | w | h | zOrder | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | `bg` | text | 0 | 0 | 576 | 288 | 1 | `content: ' '`, `isEventCapture: 1`, `textColor: 0`, no border. The only event-capture container; the only container that overlaps others (it is behind them all). |
| 2 | `stripTL` | image | 0 | 0 | 288 | 48 | 6 | Left half of the TOP strip: ◀ at the far left, left half of ▲. |
| 5 | `stripTR` | image | 288 | 0 | 288 | 48 | 7 | Right half of the TOP strip: right half of ▲, ▶ at the far right. |
| 3 | `msg` | text | 144 | 52 | 288 | 48 | 4 | `textColor: 4`. `''` when no message. Upper middle, directly under the ▲ (round 5), 4 px below the top strip; centred on the seam, so it clears the strips, the corner rings and `status`. |
| 4 | `status` | text | 528 | 124 | 40 | 28 | 5 | `textColor: 2`, `paddingLength: 2`. Right border, mid-height; `L`/`S` only. (The "4 when NO LINK" idea is not implemented: `textContainerUpgrade` carries content only and the app never rebuilds for text — the blinking `L` plus the dimmed HUD is the NO LINK cue.) |
| 6 | `stripBL` | image | 0 | 192 | 288 | 96 | 8 | Left half of the BOTTOM strip: LEFT quarter ring in the corner, left half of the vertical MIDDLE bar. |
| 7 | `stripBR` | image | 288 | 192 | 288 | 96 | 9 | Right half of the BOTTOM strip: right half of the MIDDLE bar, RIGHT quarter ring in the corner. |

Text mode (startup override or the mid-session fallback) — 4 containers: `bg` (1), `hud` (2, text, 144,192 288×96, `textColor: 4`, zOrder 3 — bottom centre, where the car strip is in image mode, because the message owns the upper middle since round 5), `msg` (3) and `status` (4) with the rects above. Slot 2 is `stripTL` in image mode and `hud` in text mode, so both pages number their containers 1..n with no gaps; `msg` is always 3 and `status` always 4. `startup-page.test.ts` pins all of this: rects on the canvas, no overlaps apart from `bg`, unique zOrder, and the SDK caps below.

**Four image containers, not one (supersedes the design-round-3 "exactly one image container" rule; constitution §3 still says "one image container" and is the planner's to reconcile).** The rule existed because each image update is its own serialised bridge call (~100 ms per update, `docs/RESEARCH_NOTES.md`), so one image was cheapest. Maxx's perimeter layout cannot be reached with one image: an image container is at most 288×144, and the icons and bars have to span the full 576-px width at both the top and the bottom edges. The pinned SDK 0.0.12 caps a page at **4 image containers, 8 text containers and 12 containers in total** (`CreateStartUpPageContainer` / `RebuildPageContainer`: `Image_Object (max_count 4)`, `Text_Object (max_count 8)`, `containerTotalNum 1~12`; also `docs/RESEARCH_NOTES.md` §2). Six separate icon/bar images are therefore impossible; four edge strips are the design that fits. To keep the cost down, the queue only sends the containers whose pixels changed (see *Update queue*). **The per-call hardware cost of the four images (2 × 288×48 + 2 × 288×96 since round 5) is not verified** — the simulator does not model it; `[HW]` T109/T110 measure it on glasses. Until then, treat every number in *Costs to plan around* as an estimate.

Startup sequence:

1. `await waitForEvenAppBridge()`.
2. Draw status `CONNECTING…` as part of the startup page (text content is allowed at startup; image data is not).
3. `createStartUpPageContainer({...})` once. Check the `StartUpPageCreateResult`; on failure log and show the phone-side companion error. Do **not** retry in a loop (a failed retry blocks ~2.1 s and drops input).
4. Only after the room's first `state` frame: render HUD bitmap and message.

## HUD strips (576×48 + 576×96 → four images)

Each strip is drawn into a `Uint8Array(576*h)` of values 0–15 (one byte per pixel, simple to test) as ONE virtual canvas — the top strip is 576×48, the bottom strip 576×96 (`STRIP_HEIGHTS`) — then `splitStrip` cuts it at x 288 into the two image containers, and each half is packed. Drawing the whole strip first means a shape that crosses the seam (▲, the middle bar) is drawn once and lands half in each image; the halves are pixel-adjacent on the canvas, and the seam is at an even x, so a 2×2 dither (if one is re-enabled) stays in phase across it. Positions and levels live in `DESIGN` (`src/render/hud-design.ts`) in strip coordinates (x 0–575, y 0–47 / 0–95); where the strips sit on the canvas is `STRIP_Y` (top 0, bottom 192). It is the only file to edit for a look change; `primitives.ts` is the generic drawing library and knows nothing about racing (round 5 added `fillRingSector` / `strokeRingSector` / `insetRingSector`: an annulus slice rasterised at pixel centres, so a sector and its mirror about an integer x come out pixel-exact, every value stays 0–15, and a 2 px outline is closed — `test/primitives.test.ts`).

**Fills are solid.** Every *filled* area is a flat level — `DESIGN.fill = 15`, `DESIGN.alertFill = 8` — because Maxx turned dithering off on 2026-09-30 after seeing the simulator (it had been a 2×2 checkerboard `{on:15, off:6}` / `{on:8, off:3}` since 2026-09-04, an unverified guess about waveguide glare). Both are `Paint`s (`number | {on, off}` in `primitives.ts`), so **to re-enable a dither, edit those two values in the `DESIGN` object** (e.g. `fill: { on: 15, off: 6 }`) — nothing else in the renderer changes; the seam stays in phase because it is at an even x. Outlines are flat levels either way.

Layout (Maxx, 2026-09-30 design rounds 5 and 5b, on the round-4 perimeter layout):

- Top strip (canvas y 0–47), three fixed lane slots, round-5b size (42 px from apex to base, 42 px between the base vertices = 43 lit rows; was 30×34), all centred on strip y 24 and spanning rows 3–45 (≥ 2 px margin top and bottom; a 44 px span would leave only 1 px below):
  - `◀` (bottom lane) at x 51, pointing left (apex x 30, base x 72, y 3–45); `▲` (middle lane) on the seam at x 288, pointing up (apex y 3, base y 45, x 267–309 — half in each image); `▶` (top lane) at x 525, pointing right (apex x 546, base x 504). Mirror-symmetric in design coordinates.
  - The called lane is filled solid (`DESIGN.fill`); **the other two are always drawn as 2 px outlines at level 4**, so the driver sees all three positions and reads which one is lit. `lane: null` → three outlines.
  - During the hollow phases of the lane-call blink (below) the called icon is a 2 px outline at **level 15** (`blinkOutlineLevel`) — bright, so it never looks like the two dim uncalled icons.
- Bottom strip (canvas y 192–287), one bar per `cars[i]` (left / middle / right), each three segments with **2 px dark gaps**; every segment is its own 2 px outline at level 6 with its fill inset 1 px inside the outline:
  - LEFT = the "banana / L", **curving into the corner** (Maxx, round 5b: "flip the corners — the rounded side down towards the corners"): a quarter ring centred INSIDE the strip at local (R, 96 − R) = (88, 8), R = outer radius, radii 60–88 (28 px thick), sweeping the quadrant that faces the corner (maths angles 180°→270°), so the outer arc is tangent to the left edge and the bottom edge and the two arms point up the left edge and along the bottom edge; cut into three 30° sectors; the gaps are parallel-sided (`edgeInset` 1 on each side of a boundary ray). Lit pixels span x 0–86, y 9–95 (flush with the canvas edges at the tangent points), wholly in `stripBL`.
  - RIGHT = its exact mirror, centred at local (576 − R, 96 − R) = (488, 8), angles 270°→360°, lit x 489–575, wholly in `stripBR`.
  - MIDDLE = a vertical bar on the seam: x 274–301 (28 wide, 14 px in each image), y 10–94 (85 tall) — three 27-px segments stacked with 2 px gaps.
  - `cars[i]` segments fill **from the bottom edge up** (`DESIGN.cars.fillDirection: 'bottom-up'`): the middle bar bottom segment first; a corner ring from its bottom-edge arm (left ring: 240°–270°) round the corner towards its vertical arm up the side edge (180°–210°) — the same direction as the spotter's faders.
  - Level 3 (`alertLevel`) swaps the whole bar to outline 15 and the solid alert fill (`DESIGN.alertFill`, 8) — the bright outline is the "on the bumper" cue. Level 0 → three hollow segments.
- Stale (`linkOk === false`): after drawing, halve every pixel of every strip (`v >> 1`) — all four image containers dim. Shapes remain, obviously dim.
- The relay clears lane, cars and message `HUD_STALE_CLEAR_MS` (6 s) after the spotter's last call (a driver ack does not postpone it); the glasses just draw that `state` like any other (constitution §2 — no local timer decides it).

Keep `drawTopStrip(lane, {linkOk, laneStyle})`, `drawBottomStrip(cars, {linkOk})` and `splitStrip(strip)` pure and unit-tested (`test/draw-hud.test.ts`) with ASCII snapshots of each whole strip (render `#` for ≥8, `+` for 1–7, `.` for 0, downsampled 4× — 144×12 characters for the top strip, 144×24 for the bottom strip, the seam at column 72) so a reviewer can eyeball the shapes in a test file, plus a seam test proving the two halves re-join to the strip byte for byte. Goldens: the four lanes, the blink's outline phase, cars `[0,0,0]` / `[1,2,3]` / `[3,3,3]`, and the dim variants. `toAscii(frame, { sample: 'min' })` (brightest → dimmest pixel per block) exists to reveal a dither; with solid fills no golden needs it, but use it if a dither is re-enabled.

## Lane-call blink (`src/blink.ts`, `LANE_BLINK_MS` = 300)

"When the user presses the app button on the phone make the glasses image blink. Empty outline then filled outline." When an applied `state.lane` differs from the lane of the *previously applied* state and is not `null`, `driver.ts` starts the blink (the first snapshot after launch is shown as is, even with a lane already up — T060a): the called icon is drawn **outline → filled → outline → filled**, one phase per `LANE_BLINK_MS` on the injected timer, ending filled. The first phase rides on the render that applies the new state (no extra frame); each later phase is `app.setLaneStyle(style)` → a normal `hud` job carrying `laneStyle`, which changes only the top strip — so every phase is a lane-immediate top-strip send and never touches the car strip.

- Cancelled (icon left filled) by: a newer state with a different lane (a non-null one restarts the blink for the new icon), a clear (`lane: null` — the spotter's or the relay's stale clear), NO LINK (the watchdog's `linkOk → false`: a dimmed hollow icon would read as "no call") and `stop()`.
- A cars-only state mid-blink does not disturb it: every phase re-renders the *current* state, and the cars change is drawn with whatever phase is showing.
- A state that repeats the lane on screen does not restart it (only a lane *change* blinks; re-pressing the same lane button on the spotter does not blink — the relay state is unchanged).
- Text mode: `renderText` ignores `laneStyle` and the queue drops a `hud` job that differs from the newest one only in `laneStyle`, so a call costs one text send, as before.
- Constitution §2 still holds: which lane is lit comes only from `state`; the blink only changes how the called icon is drawn for 900 ms.
- Verified by `test/blink.test.ts` (phase sequence and timing, send counts per call, every cancellation path, cars-only state mid-blink, text mode).

## gray4 packing

The SDK accepts `number[] | Uint8Array | ArrayBuffer | base64`. Pack two pixels per byte, **verify the nibble order on hardware in Phase 4** (the docs do not state it; community encoders from the `image` template pack high nibble = left pixel — start there, and confirm with a test bitmap that has a single bright column at x=0). Row stride = width/2 bytes, rows top to bottom. Each image container is packed on its own: 288×48 → 6 912 bytes (top), 288×96 → 13 824 bytes (bottom, `PACKED_BYTE_LENGTHS`), with `imageWidth: 288` and `imageHeight` 48 / 96 as required by `ImageRawDataUpdate`. If the pinned SDK version needs a `compressMode` workaround (0.0.12 with Even App < 2.2.7), apply it in one place: `src/render/sdk-quirks.ts`.

If hardware shows a mirrored/garbled image, the first two things to flip are nibble order and row stride.

## Render mode selection

`resolveRenderMode()` runs once before `createStartUpPageContainer`, in this order:

1. `?render=text` or `?render=image` in the page URL → that.
2. Bridge KV `g2rs:v1:render` set → that (manual override from the phone companion UI).
3. Otherwise `image` — **on hardware and in the simulator alike**. The simulator (≥ 0.9.x; 0.9.5 is what the project pins) accepted the round-3 page (one 288×144 image, 4 containers); the round-5 page (2 × 288×48 + 2 × 288×96 images, 7 containers) still needs its `[SIM]` re-run (050 AC-5b) before that is claimed for it. Image mode is the normal simulator path. Do not detect the simulator to change rendering; `import.meta.env.MODE === 'simulator'` (set by the `dev:sim` script) may only affect logging verbosity and the relay URL default.

Simulator success is **functional** evidence only: the simulator explicitly does not enforce on-device image-size limits, does not decode LZ4, and is faster than hardware. Anything about size limits, nibble order, pacing, or `sendFailed` behaviour is still proven on glasses (`[HW]` criteria in specs 030/050).

In **text mode the startup page is built with one text container in slot 2 instead of the four image containers** (`hud`, 144,192 288×96, `textColor: 4`). `rebuildPageContainer` is only used for the *mid-session* fallback described next. Text mode exists for the exit-dialogue wedge defect and as a manual override — it is no longer needed to run in the simulator, but it must keep working there (the harness runs every scenario in both modes).

## Text-mode fallback (`renderText(state): string`)

Mid-session trigger: three consecutive `sendFailed` from `updateImageRawData` (typically after the exit dialogue). In-memory only; lasts until restart; does not write `g2rs:v1:render`.

A single text container (`hud`, slot 2) replaces the four image containers on a `rebuildPageContainer` (this is the only rebuild the app performs; flicker is acceptable once). The rebuilt page is the text-mode page above, drawn from the newest HUD state:

```
  <     ^    [>]
[#  ] [## ] [###]
```

Line 1 is the lane row, matching the image icons: `<` (bottom lane) left, `^` (middle) centre, `>` (top lane) right — **always all three, the called one bracketed** (`[<]`; ASCII has no filled/hollow pair and `<` has no upper case, so brackets are the "filled" marker). Each marker sits in a 5-character slot centred over the bar of the same side. Line 2 is the three car-behind bars `[left] [mid] [right]`, three cells each, `#` per car level and a space empty. Both lines are a fixed 17 characters so nothing jumps (the font is proportional, so the column alignment is approximate on the glasses). ASCII only.

**Glyph policy.** Research verified ▲ ▶ ▼ ◀ ● ○ and box-drawing characters on hardware. `█ ░` (Block Elements) and `·` `…` are *not* yet verified — the firmware silently drops unsupported glyphs, which would hollow out the bar. Phase 2 exit includes a hardware render of every non-ASCII glyph the app uses (`▲ ● ▼ █ ░ · …`); anything that fails is swapped for its ASCII fallback in `src/render/glyphs.ts`: `█`→`#`, `░`→`-`, `·`→`|`, `…`→`...`. Keep every non-ASCII character behind that one module.

After switching to text mode mid-session, stay there until app restart (the image channel does not recover).

## Update queue (`src/render/queue.ts`)

Single async worker, **one bridge call in flight, ever**. Inputs: `{kind:'hud', state, linkOk, laneStyle?}`, `{kind:'msg', text}`, `{kind:'status', text}`.

Image mode — a `hud` input is drawn as both strips, split and packed straight away (`packContainers`), and from there **each image container is its own job, keyed by container id**:

- A new job for a container **replaces** its pending job (latest wins; never a queue of stale frames).
- **Skip unchanged:** a container whose packed bytes equal the bytes the host last accepted for it (`success`) is not sent. The comparison is only ever against the last *successful* send, never against a send still in flight — if that flight fails, a same-bytes job pushed meanwhile must still go out (hud-qa, T057a); after a successful flight the same-bytes job is skipped at send time. So a lane change costs ≤ 2 sends before its blink (◀↔▶: TL + TR; to/from ▲: TL + TR, the ▲ straddles the seam; none→◀: TL only), a left or right car change 1, a middle car change up to 2 (1 when only its left cell changes), the relay's stale clear only the containers it changes, and a state that changes nothing costs nothing. A failed send is not recorded as shown. It is retried **once, at once** (T060a — a car container after the other half of its flush) if the container still differs from what the host last accepted; a second failure waits for the next `hud` input, which re-arms that one retry — never an automatic retry loop. So a lane change on a bridge where every send fails costs TL, TL, TR and the third `sendFailed` falls back to text as before. Until that re-send, one failed send can leave a seam-straddling shape (▲, the middle bar) half-updated. Failures are counted per container send, so three failed sends inside one frame's fan-out already trigger text mode — `[HW]` T109/T110 to confirm that is not too eager.
- **Top (lane) strip: immediate** — every lane-blink phase included. **Bottom (cars) strip: debounced per strip** to one flush per `HUD_GAP_FLUSH_MS` (250 ms); a flush sends both of its pending halves back to back, so the middle bar never shows half old, half new for a debounce window. A link-state change, the first frame and any change to an all-empty HUD (the relay's stale clear, with or without a lane up) flush it at once.
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

**Hardware cost unverified** — every number here is an estimate until `[HW]` T109/T110 measure it. Round 3 estimated a full 288×144 gray4 frame (~20.7 KB) at ~104 ms + 3.9 ms/KB ≈ 185 ms per image send. By the same formula a 288×48 top half (6.9 KB) ≈ 131 ms and a 288×96 bottom half (13.8 KB) ≈ 158 ms. So a left/right car change (1 send) ≈ 158 ms, a middle-car flush (≤ 2) ≈ 316 ms, a NO-LINK dim (4 sends) ≈ 580 ms, and a lane change (≤ 2 top sends) ≈ 260 ms **plus its blink**:

| Lane call | Top-strip sends (call frame + 3 blink phases) | ≈ ms of bridge time over the 900 ms blink |
|---|---|---|
| none → ◀ or ▶ | 4 (one image, every phase) | 525 |
| ◀ → ▶ (or back) | 5 (both images on the call frame, then one) | 655 |
| any → ▲ | 8 (▲ straddles the seam: both images, every phase) | 1 050 |

The blink therefore costs up to 3 (side icons) or 6 (▲) extra sends per call. A ▲ phase needs two sends (≈ 262 ms) inside a 300 ms phase, so on a slower link the queue's latest-wins rule merges phases: a half of the ▲ can skip a phase (a brief seam tear) and a car flush waits behind the lane sends. If hardware shows that, lengthen `LANE_BLINK_MS` or drop to one outline phase before touching the queue. If the fixed per-call cost dominates, the skip-unchanged rule is what keeps this layout affordable; do not lower the 250 ms cars flush below 200 ms without measuring.
