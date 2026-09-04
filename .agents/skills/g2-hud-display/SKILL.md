---
name: g2-hud-display
description: Project-specific G2 glasses rendering rules for the Race Spotter HUD — container layout and IDs, the 288x144 symbol+bar bitmap, gray4 packing, text-mode fallback, the coalescing update queue, stale/NO LINK rendering, and glasses input mapping. Use when writing or changing anything in apps/glasses/src/render or the page setup.
---

# G2 Race Spotter HUD rendering

This skill encodes the *project's* display decisions. For generic SDK mechanics (container property classes, event enums, font metrics) use the official `everything-evenhub` plugin skills `glasses-ui`, `sdk-reference`, `font-measurement` (invoked as `/name` or `/everything-evenhub:name` in Claude Code, `$name` in Codex). Constraints quoted here come from `docs/RESEARCH_NOTES.md`. The acceptance criteria that bind this skill are in `specs/030-glasses-app-text-mode.md` and `specs/050-image-hud.md`.

## Page layout (created once with `createStartUpPageContainer`)

Canvas 576×288, 4-bit grey (0 off … 15 brightest). `zOrderIndex` must be set on every container if set on any; values unique.

| containerID | containerName | type | x | y | w | h | zOrder | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | `bg` | text | 0 | 0 | 576 | 288 | 1 | `content: ' '`, `isEventCapture: 1`, `textColor: 0`, no border. The only event-capture container. |
| 3 | `msg` | text | 16 | 8 | 544 | 96 | 4 | `textColor: 4`. `''` when no message. Top of the canvas (Maxx, 2026-09-04). |
| 2 | `hud` | image | 144 | 108 | 288 | 144 | 3 | Created empty; populated via `updateImageRawData` after startup returns. Sits under the message. |
| 4 | `status` | text | 480 | 258 | 80 | 28 | 5 | `textColor: 2`. Bottom-right corner; two letters wide (`L S`). (The "4 when NO LINK" idea is not implemented: `textContainerUpgrade` carries content only and the app never rebuilds for text — the blinking `L` plus the dimmed HUD bitmap is the NO LINK cue.) |

Rows are listed in screen order; the container IDs never change (`msg` is 3 wherever it sits).

Exactly one image container. Do not add more; each extra image costs ~100 ms per update and serialises.

Startup sequence:

1. `await waitForEvenAppBridge()`.
2. Draw status `CONNECTING…` as part of the startup page (text content is allowed at startup; image data is not).
3. `createStartUpPageContainer({...})` once. Check the `StartUpPageCreateResult`; on failure log and show the phone-side companion error. Do **not** retry in a loop (a failed retry blocks ~2.1 s and drops input).
4. Only after the room's first `state` frame: render HUD bitmap and message.

## HUD bitmap (288×144)

Draw into a `Uint8Array(288*144)` of values 0–15 (one byte per pixel, simple to test), then pack. Positions and levels live in `DESIGN` (`src/render/hud-design.ts`) — the only file to edit for a look change; `primitives.ts` is the generic drawing library and knows nothing about racing.

**Dither.** Every *filled* area is painted with a 2×2 checkerboard (`DESIGN.fill = {on:15, off:6}`, alert fill `{on:8, off:3}`) rather than a flat 15 — Maxx, 2026-09-04: "easier on the eyes". One pixel is the finest period the raster carries, so the fill reads as an even mid tone instead of a glare panel; a coarser cell (4×4 Bayer) leaves visible texture at these shape sizes. Outlines and ticks stay flat levels.

- Lane row: y 6–66, three fixed slots left to right — ▼ at x 48, ● at x 144, ▲ at x 240 (Maxx, 2026-09-04). Triangles are isosceles, half-width 34; the disc has radius 30.
  - The called lane is filled with the dither; **the other two are always drawn as 2 px outlines at level 4**, so the driver sees all three positions and reads which one is lit.
  - `lane: null` → three outlines, nothing filled.
- Bar region: y 76–107.
  - Outline rectangle x 0–287, 2 px thick, level 6.
  - Fill x 3 … 3 + round((288-6) * gap/100), y 79–104, dithered.
  - Tick marks 1 px wide at x = 72, 144, 216 across the empty part, level 3.
  - `gap ≥ 90`: swap — outline 15, dithered fill `{8,3}` (reads as "solid alert").
- Side band: y 112–142. `side === 'inside'` → a ◀ hard against the left edge (apex x 4, 34 px long, 30 px tall, dithered); `side === 'outside'` → the mirrored ▶ at the right edge; `null` → nothing. This is the "car trying to pass" call and it bypasses the gap debounce in the queue.
- Stale (`linkOk === false`): after drawing, halve every pixel (`v >> 1`). Shapes remain, obviously dim.

Keep `drawHud(state): Uint8Array` pure and unit-tested with ASCII snapshots (render `#` for ≥8, `+` for 1–7, `.` for 0, downsampled 4×) so a reviewer can eyeball the shapes in a test file. The default `max` block sampling keeps thin features but hides the dither (a dithered block still holds a 15); `toAscii(frame, { sample: 'min' })` inverts that and gives a map of exactly which areas are dithered — keep one golden of each.

## gray4 packing

The SDK accepts `number[] | Uint8Array | ArrayBuffer | base64`. Pack two pixels per byte, **verify the nibble order on hardware in Phase 4** (the docs do not state it; community encoders from the `image` template pack high nibble = left pixel — start there, and confirm with a test bitmap that has a single bright column at x=0). Row stride = width/2 bytes, rows top to bottom. Include `imageWidth: 288`, `imageHeight: 144` as required by `ImageRawDataUpdate`. If the pinned SDK version needs a `compressMode` workaround (0.0.12 with Even App < 2.2.7), apply it in one place: `src/render/sdk-quirks.ts`.

If hardware shows a mirrored/garbled image, the first two things to flip are nibble order and row stride.

## Render mode selection

`resolveRenderMode()` runs once before `createStartUpPageContainer`, in this order:

1. `?render=text` or `?render=image` in the page URL → that.
2. Bridge KV `g2rs:v1:render` set → that (manual override from the phone companion UI).
3. Otherwise `image` — **on hardware and in the simulator alike**. The simulator (≥ 0.9.x; 0.9.5 is what the project pins) accepts the 288×144 image container and our 4-container page, so image mode is the normal simulator path. Do not detect the simulator to change rendering; `import.meta.env.MODE === 'simulator'` (set by the `dev:sim` script) may only affect logging verbosity and the relay URL default.

Simulator success is **functional** evidence only: the simulator explicitly does not enforce on-device image-size limits, does not decode LZ4, and is faster than hardware. Anything about size limits, nibble order, pacing, or `sendFailed` behaviour is still proven on glasses (`[HW]` criteria in specs 030/050).

In **text mode the startup page is built with a text container in slot 2 instead of the image container** (same rect 144,108,288,144, `textColor: 4`). `rebuildPageContainer` is only used for the *mid-session* fallback described next. Text mode exists for the exit-dialogue wedge defect and as a manual override — it is no longer needed to run in the simulator, but it must keep working there (the harness runs every scenario in both modes).

## Text-mode fallback (`renderText(state): string`)

Mid-session trigger: three consecutive `sendFailed` from `updateImageRawData` (typically after the exit dialogue). In-memory only; lasts until restart; does not write `g2rs:v1:render`.

Single text container replaces `hud` on a `rebuildPageContainer` (this is the only rebuild the app performs; flicker is acceptable once):

```
▲                      (or ● / ▼ / blank line)
████████████░░░░░░░░  62
<                      (or > / blank line — the side call)
```

Bar is 20 cells (`█` filled, `░` empty): `filled = Math.round(gap / 5)`, then two spaces and the integer value. At gap ≥ 90 prefix the bar line with `!!`. The third line is `<` for `side: 'inside'`, `>` for `'outside'`, and stays present but empty otherwise so the bar never moves. (The shipped renderer is ASCII throughout: `^ o v`, `#`/`-`, `<`/`>`.)

**Glyph policy.** Research verified ▲ ▶ ▼ ◀ ● ○ and box-drawing characters on hardware. `█ ░` (Block Elements) and `·` `…` are *not* yet verified — the firmware silently drops unsupported glyphs, which would hollow out the bar. Phase 2 exit includes a hardware render of every non-ASCII glyph the app uses (`▲ ● ▼ █ ░ · …`); anything that fails is swapped for its ASCII fallback in `src/render/glyphs.ts`: `█`→`#`, `░`→`-`, `·`→`|`, `…`→`...`. Keep every non-ASCII character behind that one module.

After switching to text mode mid-session, stay there until app restart (the image channel does not recover).

## Update queue (`src/render/queue.ts`)

Single async worker. Jobs: `{kind:'hud', state}`, `{kind:'msg', text}`, `{kind:'status', text}`.

- At most one bridge call in flight.
- A new `hud` job **replaces** any pending `hud` job (latest wins). Gap-only changes are additionally debounced to a 250 ms floor; lane changes, side calls and link-state changes bypass the debounce.
- `msg` → `textContainerUpgrade` on container 3 only. `status` → container 4 only. Never rebuild for text.
- Every call: measure `performance.now()` delta, log `{call, ms, result}`; count consecutive `sendFailed` for the fallback trigger.
- Treat a resolved promise as "accepted", not "displayed" — never wait for confirmation that does not exist.

## Input mapping

| Event | Root page action |
|---|---|
| `CLICK_EVENT` | Ack: send `ack{msgId}` for the current unacked message. Do **not** clear locally — the next `state` frame carries `ackedAt` and the renderer hides `msg.text` whenever `ackedAt !== null`. (Rendering is a pure function of the last `state`; the message must not pop back.) |
| `DOUBLE_CLICK_EVENT` | `shutDownPageContainer(1)` (exit dialogue — required) |
| `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` | reserved; no-op in v1 |
| `FOREGROUND_ENTER_EVENT` | re-arm socket, re-render last state |
| `FOREGROUND_EXIT_EVENT` | keep socket (iOS holds it); nothing else |
| `SYSTEM_EXIT_EVENT` / `ABNORMAL_EXIT_EVENT` | close socket, persist nothing new |

Events arrive on `event.textEvent.eventType` for text-capture pages; normalise with a tiny `toOsEvent(event)` helper because community notes report inconsistent event-type shapes across SDK versions.

## Status strip strings

Two letters in fixed columns (Maxx, 2026-09-04), bottom-right:

| State | Content |
|---|---|
| link up, spotter connected | `L S` |
| link up, no spotter | `L` |
| NO LINK, spotter last seen connected | `L S` ⇄ `  S` every `STATUS_BLINK_MS` (700 ms) |
| NO LINK, no spotter | `L` ⇄ `` (empty) |
| no room configured | `ROOM ?` |
| before the first frame of the first session | `CONNECTING…` |
| terminal close | `PIN REJECTED` / `DRIVER REPLACED` / `UPDATE APP` / `LINK ERROR` / `DISCONNECTED` |

`L` = the link; solid when it is up, **blinking** when it is not. `S` appears only while `spotterOnline`, and the blank blink phase is a space so `S` never moves column. The blink is driven by a timer in `driver.ts` that exists only while the strip blinks, and it emits `status` queue jobs — **never** an image send (the bitmap does not change between phases). The 28 px height of container 4 is an assumption — confirm with `/font-measurement` that one line fits.

## Costs to plan around

A full 288×144 gray4 frame is ~20.7 KB → ~104 ms + 3.9 ms/KB ≈ **185 ms per image send** on hardware (≈5 fps ceiling). The 250 ms gap flush leaves headroom; do not lower it below 200 ms without measuring.
