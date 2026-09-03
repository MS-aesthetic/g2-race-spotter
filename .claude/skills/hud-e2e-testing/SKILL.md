---
name: hud-e2e-testing
description: How to test the Race Spotter system end to end — unit/integration layout, the fake-spotter scenario CLI, Even Hub simulator automation with screenshots, harvesting bridge latency from glasses logs, lifecycle and fault-injection checks, and the QA report and race-day checklist formats. Use when verifying a phase or preparing for a track day.
---

# End-to-end testing for the Race Spotter

Evidence over opinion. Every phase exit criterion in `docs/BUILD_PLAN.md` §7 maps to a scenario below.

## Test layers

| Layer | Where | Command |
|---|---|---|
| Protocol unit (guards, reducer, RoomClient with injected `ws`) | `packages/protocol/test` | `npm test -w packages/protocol` |
| Relay integration (two `ws` clients vs `wrangler dev`) | `services/relay/test` | `npm test -w services/relay` |
| Glasses render unit (`drawHud`, `renderText`, queue) — no SDK, bridge mocked | `apps/glasses/test` | `npm test -w apps/glasses` |
| Spotter UI unit (`view`, slider throttle) — jsdom | `apps/spotter/test` | `npm test -w apps/spotter` |
| Simulator E2E — automated harness (`[SIM]` evidence) | `scripts/sim-harness.ts`, output `qa/<date>/sim/` | `npm run sim:scenarios` |
| Hardware E2E (`[HW]` evidence) | real glasses + phones | see below |

Use `vitest` everywhere (Vite is already present). Keep hardware-only assertions out of CI; the simulator harness runs locally (it needs the simulator process) and in CI only if a runner can launch the simulator headless — otherwise it is a local gate whose output is committed as evidence.

## Evidence classes

- **Automated unit/integration** — runs in `npm test`; the criterion's named test file.
- **`[SIM]`** — produced by `npm run sim:scenarios` against the Even Hub simulator: screenshots + a JSON report with pixel assertions. Proves the app *drives the display correctly* (containers, text, bitmap content, queue behaviour, link watchdog). It does **not** prove hardware compatibility: the simulator does not enforce on-device image-size limits, does not decode LZ4, has no BLE pacing, and is not pixel-perfect. A worker may produce `[SIM]` evidence when the simulator is reachable; if it is not, the task reports `outcome: failed` with `reason: sim-unavailable` and the planner parks it under *Needs simulator* until someone runs it.
- **`[HW]`** — real glasses/phones/deployed relay; a human runs it and commits evidence under `qa/<date>/`. Never assigned to a worker. Human *visual* approval (symbol readable at a glance, brightness, glyph rendering) stays here even when the same scenario has `[SIM]` evidence.

## fake-spotter CLI (`scripts/fake-spotter.ts`)

`npx tsx scripts/fake-spotter.ts --url wss://<host> --room QA01 --scenario <name> [--pin 1234] [--speed 1.0]`

Scenarios (each prints a timestamped log and exits non-zero on protocol errors):

- `lanes` — top, mid, bot, null, each held 2 s.
- `gap-sweep` — 0→100 in 5-point steps at 100 ms, hold 100 for 2 s, back to 0 (exercises coalescing and the ≥ 90 alert style).
- `message-ack` — sends "BOX THIS LAP", waits up to 20 s for `state.msg.ackedAt`, then `clear`.
- `link-loss` — sets lane top + gap 60, then stops pinging for 10 s (driver must show SPOTTER OFF), resumes.
- `reconnect-replay` — sets state, disconnects, reconnects, asserts the replayed `state` has the same lane/gap/msg and `seq ≥` the last seen (never assert an exact `seq`; peer online/offline flips bump it).
- `driver-evict` — two `--role driver` instances join in turn; the first must receive `error{code:"role_taken"}` + close 4409, the second must receive `state`.
- `soak` — random lane/gap/msg every 0.5–3 s for N minutes; reports frames sent and any `error` frames received.

Also `--role driver` mode that just prints every `state` frame and auto-acks after 1 s, for testing the spotter PWA without glasses.

## Simulator harness (`scripts/sim-harness.ts`, `npm run sim:scenarios`)

Pinned simulator: `@evenrealities/evenhub-simulator` **0.9.5** (`docs/ENVIRONMENT.md` is authoritative; bump = its own task). It accepts the full 288×144 image and our 4-container page, so the app runs in **image mode** in the simulator by default; text mode is exercised too via `?render=text`.

What the harness does, in order:

1. Starts `wrangler dev` (relay on `ws://localhost:8787`) and `npm run dev:sim -w apps/glasses` (Vite on :5173, `--mode simulator`) unless `--reuse` says they are already up.
2. Launches `evenhub-simulator http://localhost:5173?room=QA01&relay=ws://localhost:8787 --automation-port 9898`, polls `GET /api/ping` until `pong`, then waits ~4 s (SDK init + `createStartUpPageContainer`) before doing anything.
3. For each scenario in `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay` (and `soak --minutes 2` when `--soak`), runs `fake-spotter` with a `--checkpoint` hook; at each checkpoint it `GET /api/screenshot/glasses` (576×288 RGBA PNG) into `qa/<date>/sim/<mode>/<scenario>-<nn>.png` and evaluates the pixel assertions below.
4. `POST /api/input {action:"click"}` for the ack step of `message-ack`; `double_click` is *not* sent (exit dialogue).
5. Reads `GET /api/console?since_id=N` and extracts `{call, ms, result}` lines into `qa/<date>/sim/console.log` (simulator timings are not hardware timings — record them, never compare them to the hardware budget).
6. Repeats the scenario set with `?render=text`.
7. Writes `qa/<date>/sim/report.json` (`{simulatorVersion, sdkVersion, mode, scenario, checkpoint, assertions:[{name, pass, detail}]}`) and exits non-zero on any failed assertion. `DELETE /api/console` between scenarios.

Pixel assertions (on the glasses screenshot; grey = max(R,G,B) of a pixel, lit = grey > 32). The HUD image occupies x 144–431, y 8–151; symbol region rows 8–103, bar region rows 116–148:

- `lane:"top"` → lit pixels in the symbol region form a shape wider at the bottom row than at the top row; `bot` → the reverse; `mid` → lit bounding box roughly square (aspect 0.8–1.2); `null` → < 1 % of symbol-region pixels lit.
- `gap:g` → lit width of the fill row (y ≈ 132) inside the bar ≈ `(288-6) * g/100` ± 6 px; `g ≥ 90` → the bar outline rows are brighter than the fill rows.
- `linkOk:false` (after `link-loss` / relay kill) → mean grey of the HUD region ≤ 55 % of the previous checkpoint's, and the status strip region (y 258–286) contains lit pixels.
- `msg` set → lit pixels in the message region (y 160–255); after ack → none.
- Text mode: the same checks, but symbol/bar assertions reduce to "lit pixels present in the expected rows" (glyph shapes are font-dependent).

Simulator caveats that remain true: no on-device image-size enforcement, no LZ4, faster than hardware, list-scroll focus differs, error handling under abnormal conditions differs, no real background lifecycle. Everything under "Hardware runs" stays mandatory.

## Hardware runs

1. Driver phone: Even app with Developer Mode, glasses paired, `npx evenhub qr --url http://<lan-ip>:5173` from `apps/glasses`, scan. Confirm `docs/ENVIRONMENT.md` versions.
2. Relay: the deployed Worker (the WebView enforces the `app.json` whitelist; `wrangler dev` on LAN works only if `http://<lan-ip>:8787` is whitelisted in the dev `app.json`).
3. Run scenarios with `fake-spotter`, then with the real spotter PWA on a second phone.
4. Ask the user to copy the console log (from the Even app's dev console or the phone companion page's log panel) into `qa/<date>/glasses.log`.
5. `npx tsx scripts/latency-report.ts qa/<date>/glasses.log` → `latency.csv` and a p50/p95 table per call (`startup`, `image`, `textUpgrade`, `rebuild`). Flag `sendFailed`, any image call > 300 ms, and any gap between spotter send and glasses accept > 1 s (correlate via `fake-spotter` timestamps; clocks are close enough at second resolution).

## Lifecycle and fault injection

- **5-minute lock** (Even docs beta protocol): set state → lock driver phone 5 min → unlock → HUD correct within 5 s. Pass on iOS is required; on Android record whether recovery needed a foreground event.
- **Relay redeploy**: `wrangler deploy` mid-session → both clients reconnect → `state` replayed → spotter banner clears.
- **Relay down**: stop the Worker (or block DNS on the driver phone) → `NO LINK` + dim HUD within `DRIVER_NO_LINK_MS` → restore → recovers without touching the phone.
- **Spotter silent**: `link-loss` scenario → driver status `SPOTTER OFF` within `PEER_OFFLINE_MS + ALARM_TICK_MS` (≤ 9 s), HUD stays as last set but dim.
- **Glyph check (Phase 2 exit)**: render every non-ASCII glyph from `src/render/glyphs.ts` on real glasses; any that vanish get their ASCII fallback enabled.
- **Whitelist check (Phase 2 exit)**: confirm on hardware that an `https://` origin in `app.json` also allows the `wss://` upgrade to the same host; if not, add the `wss://` origin as a second entry and record it in `docs/ENVIRONMENT.md`.
- **Exit dialogue**: double-tap → cancel → next image update; if `sendFailed`, verify automatic text fallback and log it as the known defect.

## Report (`qa/<date>/REPORT.md`)

```
# QA <date> — Phase N
Verdict: PASS | FAIL against: "<exit criterion verbatim>"
Environment: SDK x.y.z, CLI, simulator, Even app, firmware, relay commit, glasses commit
Evidence class per row: unit | [SIM] | [HW]
Scenarios: table of scenario → mode (image/text) → result → evidence file
Latency: p50/p95 per call type (hardware only)
Defects: ranked, each with owner agent (g2-glasses-dev | relay-backend-dev | spotter-pwa-dev)
```

## Race-day checklist (`docs/RACE_DAY.md`) — keep current

Glasses charged and paired; driver phone charged, screen-lock timeout off, Even app foreground, Hub app loaded and showing `LINK OK`; room code and PIN agreed and typed on both phones; spotter phone on a known-good network (hotspot from the pit if track Wi-Fi is bad); run `lanes` + `message-ack` with the real spotter before grid; agree the fallback (radio/pit board) if `NO LINK` appears; after the session, save the logs to `qa/<date>/`.
