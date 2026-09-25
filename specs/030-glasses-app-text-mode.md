# 030 — Glasses app, text-mode HUD

Status: ACTIVE
Depends on: 020
Design reference: docs/BUILD_PLAN.md §3, §7 Phase 2; skill `g2-hud-display`

## Purpose

The driver-side Even Hub app end to end: join a room, hold the socket, render lane + cars + message + status in text mode, acknowledge messages, and never show stale data as live.

## Scope

In: bridge init, phone companion page (join form, status, log panel), `RoomClient` wiring, state store, render-mode selection, text renderer, `glyphs.ts`, update queue (text path), status strip, input mapping, exit dialogue, and the simulator harness scenarios run in text mode.
Out: image renderer and its simulator/hardware evidence (050), Android background hardening (060).

Note: text mode is no longer the "simulator mode" — the pinned simulator renders the image container. This spec ships the text path first because it is the permanent fallback and the cheapest end-to-end validation; 050 makes image mode the default on every target.

## Requirements

R1. MUST follow `.agents/skills/g2-hud-display/SKILL.md` for container IDs/rects, render-mode selection, text layout, queue rules, and input mapping.
R2. MUST call `createStartUpPageContainer` once; in text mode slot 2 is a text container. Until 050 lands, the default (image) mode may build slot 2 as an empty image container and leave it blank — text mode is where this spec's rendering is verified.
R3. MUST show `NO LINK` and halve HUD intensity when `lastFrameAt === undefined` (no frame yet this session) or `Date.now() - lastFrameAt > DRIVER_NO_LINK_MS`; recover automatically on the next frame of any kind (`pong` counts).
R4. MUST render `msg.text` only when `msg.ackedAt === null`; single tap sends `ack{msgId}`; never clears locally.
R5. MUST persist room/PIN/name via bridge KV keys from the protocol skill; the companion page edits them.
R6. Every non-ASCII glyph MUST live in `src/render/glyphs.ts` with an ASCII fallback switchable per glyph.
R7. Every bridge call MUST be timed and logged as `{call, ms, result}`.
R8. Double tap on the root page MUST call `shutDownPageContainer(1)`.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a state with `lane:"top", cars:[1,2,3]`, when `renderText` runs, then output is `. . ^\n[#  ] [## ] [###]` | `apps/glasses/test/render-text.test.ts` |
| AC-2 | Given `lane:null`, then the first line is `. . .`; given any state, then both lines keep a fixed width (5 and 17 characters) and are ASCII only | `apps/glasses/test/render-text.test.ts` |
| AC-3 | Given a mocked bridge, when 10 `cars` states arrive within 250 ms, then at most one `textContainerUpgrade` for the HUD container is issued per 250 ms window and the last value wins | `apps/glasses/test/queue.test.ts` |
| AC-4 | Given a mocked bridge and no frames for 5 s, then status becomes `NO LINK` and the next HUD render is the dimmed variant; when a frame arrives, status returns to `LINK OK · …` | `apps/glasses/test/link-watchdog.test.ts` |
| AC-5 | Given `msg` with `ackedAt:null`, when `CLICK_EVENT` fires, then `ack{msgId}` is sent and the text remains until a `state` with `ackedAt` arrives | `apps/glasses/test/ack.test.ts` |
| AC-6 | Given `?render=text` or the stored `g2rs:v1:render=text` override, then startup builds the page with a text container in slot 2 and never creates an image container; given neither (including under `--mode simulator`), then startup creates the image container — the simulator is never detected to change rendering | `apps/glasses/test/render-mode.test.ts` |
| AC-7 | Given `npm run sim:scenarios`, when `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay` run in **text mode** (`?render=text`), then every pixel assertion in the `hud-e2e-testing` skill passes and `report.json` is committed | `[SIM]` `qa/<date>/sim/text/*.png`, `qa/<date>/sim/report.json` |
| AC-8 | Given real glasses, when `lanes`, `gap-sweep`, `message-ack`, `link-loss` run, then the HUD matches, ack works from the temple, and NO LINK appears within 5 s of the relay being stopped | `[HW]` `qa/<date>/REPORT.md` |
| AC-9 | DROPPED 2026-09-04 (Maxx): the text fallback uses ASCII only (`^ o v`, `#`, `-`), so no glyph sheet needs hardware verification | — |
| AC-10 | Given an `https://` origin in `app.json`, when the app opens `wss://` to the same host on hardware, then the upgrade succeeds (or the `wss://` origin is added and recorded) | `[HW]` note in `docs/ENVIRONMENT.md` |

## Decisions

- 2026-09-03 Text mode ships first — why: fastest end-to-end validation and it is the permanent fallback anyway.
- 2026-09-04 (audit) `lastFrameAt` is per socket session: `RoomClient` resets it to `undefined` on every socket open, on `disconnect()`, and on a terminal close (4401/4409/4426). During a reconnect blip the HUD therefore shows `NO LINK` and dims until the new socket's replayed `state` arrives — why: R3 and the constitution's "never show stale driver data as live" invariant prefer a brief dim over a stale `LINK OK`; the glasses app must not cache the previous session's timestamp to paper over the blip.

- 2026-09-04 (Maxx) **Image mode is built first and is the primary HUD; text mode is an ASCII-only fallback.** The HUD is drawn as a bitmap by `drawHud(state)` composed from drawing primitives in one editable design module, so the visual design (e.g. triangles made of bar segments) can change without touching the pipeline. AC-1–AC-6 of this spec are satisfied by the consolidated glasses task together with 050; the text renderer keeps AC-1/AC-2's layout but with ASCII characters (`^`/`o`/`v`, `#`/`-`). AC-7 `[SIM]` runs in image mode by default (050 AC-5b); a text-mode pass is optional.
- 2026-09-04 (Maxx) Update-rate criteria are not a priority for v1; the 250 ms coalescing stays because it protects the BLE channel, but timing tuning is deferred to hardware testing.

- 2026-09-04 (Maxx) **Design round 1 — page layout and the status strip.** The message text container moves to the TOP of the canvas (16, 8, 544×96), the HUD image sits under it (144, 108, 288×144) and the status strip moves to the BOTTOM RIGHT (480, 258, 80×28). The strip is no longer a sentence: it is `L` for the link — solid when up, **blinking every 700 ms when down** — plus `S` only while `spotterOnline` (`L S` / `L` / `  S` / empty). The blink is a `status` job driven by a timer that exists only while the strip blinks; it must never cost an image send. `ROOM ?`, `CONNECTING…` and the terminal-close strings are unchanged. The text-mode HUD gains a third line, `<` or `>`, for the side call.

- 2026-09-04 (Maxx) **Design round 2 — messages auto-clear after 5 s.** This resolves the open question below in favour of *both*: a message is hidden `MSG_AUTO_ACK_MS` (5 s) after it first renders and, if it is still unacked at that moment, the app sends `ack{msgId}` itself, so the relay state and the spotter's ack tick agree with what the driver can see. A tap still acks earlier (and the text still stays up until the relay's `state` carries `ackedAt`, so R4/AC-5 are unchanged); a new `msg.id` restarts the window; the window is measured from first render, so an unrelated `state` frame cannot extend it. The timer is injected like the blink timer and `stop()` clears it. `MSG_AUTO_ACK_MS` is exported from `apps/glasses/src/app.ts` — it is a driver-side display rule, not a wire timing, so it does not belong in `packages/protocol`. Constitution §2 still holds for lane/gap/side: hiding a message is the only thing the glasses decide without a `state` frame. Verified by `apps/glasses/test/ack.test.ts` (auto-ack at 5 s exactly once, a tap at 2 s cancels it, a new message restarts it, a stopped driver sends nothing).

- 2026-09-25 (Maxx) **Design round 3 — page layout and text fallback.** The HUD image moves to the TOP of the canvas (144, 8, 288×144) and the message text sits under it (16, 160, 544×90); the status strip stays bottom-right (480, 258, 80×28). The text-mode HUD is two lines: `v - ^` lane markers in track order (the called lane shows its marker, the others `.`), then three bracketed 3-cell car bars `[#  ] [## ] [###]` filled left to right. AC-1/AC-2/AC-3 are reworded to `cars` (human-authorized); the side line and the `!!` prefix are gone with `gap`/`side`. The relay's 6 s stale clear arrives as an ordinary `state`; the glasses draw it like any other (constitution §2), and the 5 s message auto-clear is unchanged.

- 2026-09-25 (Maxx) **Design round 4 — page layout on the perimeter.** Maxx: "I want the icons to be close to the perimeter so it's not directly in line of sight. Separate the bars on the glasses. Use corners on the glasses, then the top border and bottom borders for the 'middle' icons." Image mode is now a 7-container page: `bg` (1), four 288×48 image strips along the top and bottom edges (`stripTL` 2, `stripTR` 5, `stripBL` 6, `stripBR` 7 — see 050), `msg` in the centre band (16, 112, 504×64; narrowed from 544 so it does not overlap `status`) and `status` small on the right border at mid-height (528, 124, 40×28). Text mode keeps its 4-container page (`bg`, `hud` 2, `msg` 3, `status` 4) with the text HUD at (144, 8, 288×96) so it clears the message band; `renderText` and the mid-session fallback are unchanged. Every container stays on the canvas, none overlaps another except the full-canvas `bg` behind them, and `zOrderIndex` is unique. Bridge-call logs gain the target container name: `{call, ms, result, container}` (R7). The strip is sized for `L S`; the longer strings (`CONNECTING…`, `ROOM ?`, the terminal-close strings) do not fit 40 px and will wrap or clip — flagged for the planner/Maxx, not worked around in code.

## Open questions

- ~~Message auto-clear after N seconds vs tap-to-ack only~~ — resolved 2026-09-04 (Maxx): both, 5 s (see *Decisions*).
