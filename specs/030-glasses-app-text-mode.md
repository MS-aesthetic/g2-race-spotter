# 030 — Glasses app, text-mode HUD

Status: ACTIVE
Depends on: 020
Design reference: docs/BUILD_PLAN.md §3, §7 Phase 2; skill `g2-hud-display`

## Purpose

The driver-side Even Hub app end to end: join a room, hold the socket, render lane + gap + message + status in text mode, acknowledge messages, and never show stale data as live.

## Scope

In: bridge init, phone companion page (join form, status, log panel), `RoomClient` wiring, state store, render-mode selection, text renderer, `glyphs.ts`, update queue (text path), status strip, input mapping, exit dialogue, and the simulator harness scenarios run in text mode.
Out: image renderer and its simulator/hardware evidence (050), Android background hardening (060).

Note: text mode is no longer the "simulator mode" — the pinned simulator renders the image container. This spec ships the text path first because it is the permanent fallback and the cheapest end-to-end validation; 050 makes image mode the default on every target.

## Requirements

R1. MUST follow `.agents/skills/g2-hud-display/SKILL.md` for container IDs/rects, render-mode selection, text layout, queue rules, and input mapping.
R2. MUST call `createStartUpPageContainer` once; in text mode slot 2 is a text container. Until 050 lands, the default (image) mode may build slot 2 as an empty image container and leave it blank — text mode is where this spec's rendering is verified.
R3. MUST show `NO LINK` and halve HUD intensity when `Date.now() - lastFrameAt > DRIVER_NO_LINK_MS`; recover automatically.
R4. MUST render `msg.text` only when `msg.ackedAt === null`; single tap sends `ack{msgId}`; never clears locally.
R5. MUST persist room/PIN/name via bridge KV keys from the protocol skill; the companion page edits them.
R6. Every non-ASCII glyph MUST live in `src/render/glyphs.ts` with an ASCII fallback switchable per glyph.
R7. Every bridge call MUST be timed and logged as `{call, ms, result}`.
R8. Double tap on the root page MUST call `shutDownPageContainer(1)`.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a state with `lane:"top", gap:62`, when `renderText` runs, then output is `▲\n████████████░░░░░░░░  62` (12 filled of 20) | `apps/glasses/test/render-text.test.ts` |
| AC-2 | Given `gap ≥ 90`, then the bar line is prefixed `!!`; given `lane:null`, then the first line is blank | `apps/glasses/test/render-text.test.ts` |
| AC-3 | Given a mocked bridge, when 10 `gap` states arrive within 250 ms, then at most one `textContainerUpgrade` for the HUD container is issued per 250 ms window and the last value wins | `apps/glasses/test/queue.test.ts` |
| AC-4 | Given a mocked bridge and no frames for 5 s, then status becomes `NO LINK` and the next HUD render is the dimmed variant; when a frame arrives, status returns to `LINK OK · …` | `apps/glasses/test/link-watchdog.test.ts` |
| AC-5 | Given `msg` with `ackedAt:null`, when `CLICK_EVENT` fires, then `ack{msgId}` is sent and the text remains until a `state` with `ackedAt` arrives | `apps/glasses/test/ack.test.ts` |
| AC-6 | Given `?render=text` or the stored `g2rs:v1:render=text` override, then startup builds the page with a text container in slot 2 and never creates an image container; given neither (including under `--mode simulator`), then startup creates the image container — the simulator is never detected to change rendering | `apps/glasses/test/render-mode.test.ts` |
| AC-7 | Given `npm run sim:scenarios`, when `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay` run in **text mode** (`?render=text`), then every pixel assertion in the `hud-e2e-testing` skill passes and `report.json` is committed | `[SIM]` `qa/<date>/sim/text/*.png`, `qa/<date>/sim/report.json` |
| AC-8 | Given real glasses, when `lanes`, `gap-sweep`, `message-ack`, `link-loss` run, then the HUD matches, ack works from the temple, and NO LINK appears within 5 s of the relay being stopped | `[HW]` `qa/<date>/REPORT.md` |
| AC-9 | Given real glasses, when the glyph sheet (`▲ ● ▼ █ ░ · …`) is rendered, then each glyph is either visible or its ASCII fallback is enabled in `glyphs.ts` | `[HW]` note in `docs/ENVIRONMENT.md` |
| AC-10 | Given an `https://` origin in `app.json`, when the app opens `wss://` to the same host on hardware, then the upgrade succeeds (or the `wss://` origin is added and recorded) | `[HW]` note in `docs/ENVIRONMENT.md` |

## Decisions

- 2026-09-03 Text mode ships first — why: fastest end-to-end validation and it is the permanent fallback anyway.

## Open questions

- Message auto-clear after N seconds vs tap-to-ack only (currently tap-to-ack).
