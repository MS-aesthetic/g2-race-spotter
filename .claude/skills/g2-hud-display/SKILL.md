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
| 2 | `hud` | image | 144 | 8 | 288 | 144 | 3 | Created empty; populated via `updateImageRawData` after startup returns. |
| 3 | `msg` | text | 16 | 160 | 544 | 96 | 4 | `textColor: 4`. `''` when no message. |
| 4 | `status` | text | 16 | 258 | 544 | 28 | 5 | `textColor: 2`. (The "4 when NO LINK" idea is not implemented: `textContainerUpgrade` carries content only and the app never rebuilds for text — the dimmed HUD bitmap is the NO LINK cue.) |

Exactly one image container. Do not add more; each extra image costs ~100 ms per update and serialises.

Startup sequence:

1. `await waitForEvenAppBridge()`.
2. Draw status `CONNECTING…` as part of the startup page (text content is allowed at startup; image data is not).
3. `createStartUpPageContainer({...})` once. Check the `StartUpPageCreateResult`; on failure log and show the phone-side companion error. Do **not** retry in a loop (a failed retry blocks ~2.1 s and drops input).
4. Only after the room's first `state` frame: render HUD bitmap and message.

## HUD bitmap (288×144)

Draw into a `Uint8Array(288*144)` of values 0–15 (one byte per pixel, simple to test), then pack.

- Symbol region: y 0–95, centred at x 144.
  - `top` → up-pointing isosceles triangle, apex (144, 6), base y 92, half-width 60, fill 15.
  - `mid` → filled circle centre (144, 49), radius 42, fill 15.
  - `bot` → down-pointing triangle, base y 6, apex (144, 92), half-width 60, fill 15.
  - `null` → nothing.
- Bar region: y 108–140.
  - Outline rectangle x 0–287, y 108–139, 2 px thick, level 6.
  - Fill x 3 … 3 + round((288-6) * gap/100), y 111–136, level 15.
  - Tick marks 1 px wide at x = 72, 144, 216 across the empty part, level 3.
  - `gap ≥ 90`: swap — outline 15, fill 8 (reads as "solid alert").
- Stale (`linkOk === false`): after drawing, halve every pixel (`v >> 1`). Shape remains, obviously dim.

Keep `drawHud(state): Uint8Array` pure and unit-tested with ASCII snapshots (render `#` for ≥8, `+` for 1–7, `.` for 0, downsampled 4×) so a reviewer can eyeball the shapes in a test file.

## gray4 packing

The SDK accepts `number[] | Uint8Array | ArrayBuffer | base64`. Pack two pixels per byte, **verify the nibble order on hardware in Phase 4** (the docs do not state it; community encoders from the `image` template pack high nibble = left pixel — start there, and confirm with a test bitmap that has a single bright column at x=0). Row stride = width/2 bytes, rows top to bottom. Include `imageWidth: 288`, `imageHeight: 144` as required by `ImageRawDataUpdate`. If the pinned SDK version needs a `compressMode` workaround (0.0.12 with Even App < 2.2.7), apply it in one place: `src/render/sdk-quirks.ts`.

If hardware shows a mirrored/garbled image, the first two things to flip are nibble order and row stride.

## Render mode selection

`resolveRenderMode()` runs once before `createStartUpPageContainer`, in this order:

1. `?render=text` or `?render=image` in the page URL → that.
2. Bridge KV `g2rs:v1:render` set → that (manual override from the phone companion UI).
3. Otherwise `image` — **on hardware and in the simulator alike**. The simulator (≥ 0.9.x; 0.9.5 is what the project pins) accepts the 288×144 image container and our 4-container page, so image mode is the normal simulator path. Do not detect the simulator to change rendering; `import.meta.env.MODE === 'simulator'` (set by the `dev:sim` script) may only affect logging verbosity and the relay URL default.

Simulator success is **functional** evidence only: the simulator explicitly does not enforce on-device image-size limits, does not decode LZ4, and is faster than hardware. Anything about size limits, nibble order, pacing, or `sendFailed` behaviour is still proven on glasses (`[HW]` criteria in specs 030/050).

In **text mode the startup page is built with a text container in slot 2 instead of the image container** (same rect 144,8,288,144, `textColor: 4`). `rebuildPageContainer` is only used for the *mid-session* fallback described next. Text mode exists for the exit-dialogue wedge defect and as a manual override — it is no longer needed to run in the simulator, but it must keep working there (the harness runs every scenario in both modes).

## Text-mode fallback (`renderText(state): string`)

Mid-session trigger: three consecutive `sendFailed` from `updateImageRawData` (typically after the exit dialogue). In-memory only; lasts until restart; does not write `g2rs:v1:render`.

Single text container replaces `hud` on a `rebuildPageContainer` (this is the only rebuild the app performs; flicker is acceptable once):

```
▲                      (or ● / ▼ / blank line)
████████████░░░░░░░░  62
```

Bar is 20 cells (`█` filled, `░` empty): `filled = Math.round(gap / 5)`, then two spaces and the integer value. At gap ≥ 90 prefix the bar line with `!!`.

**Glyph policy.** Research verified ▲ ▶ ▼ ◀ ● ○ and box-drawing characters on hardware. `█ ░` (Block Elements) and `·` `…` are *not* yet verified — the firmware silently drops unsupported glyphs, which would hollow out the bar. Phase 2 exit includes a hardware render of every non-ASCII glyph the app uses (`▲ ● ▼ █ ░ · …`); anything that fails is swapped for its ASCII fallback in `src/render/glyphs.ts`: `█`→`#`, `░`→`-`, `·`→`|`, `…`→`...`. Keep every non-ASCII character behind that one module.

After switching to text mode mid-session, stay there until app restart (the image channel does not recover).

## Update queue (`src/render/queue.ts`)

Single async worker. Jobs: `{kind:'hud', state}`, `{kind:'msg', text}`, `{kind:'status', text}`.

- At most one bridge call in flight.
- A new `hud` job **replaces** any pending `hud` job (latest wins). Gap-only changes are additionally debounced to a 250 ms floor; lane changes bypass the debounce.
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

`LINK OK · SPOTTER ON`, `LINK OK · SPOTTER OFF`, `NO LINK`, `CONNECTING…`, `ROOM ?` (no room configured — set it on the phone). Keep them short; the strip is one line of the baked font. The 28 px height of container 4 is an assumption — confirm in Phase 0 with `/font-measurement` that one line fits, and grow the container (shrinking `msg`) if it does not.

## Costs to plan around

A full 288×144 gray4 frame is ~20.7 KB → ~104 ms + 3.9 ms/KB ≈ **185 ms per image send** on hardware (≈5 fps ceiling). The 250 ms gap flush leaves headroom; do not lower it below 200 ms without measuring.
