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
| Simulator E2E | `qa/` | see below |
| Hardware E2E | real glasses + phones | see below |

Use `vitest` everywhere (Vite is already present). Keep hardware-only assertions out of CI.

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

## Simulator runs

1. Follow `/test-with-simulator` to start `@evenrealities/evenhub-simulator` with `apps/glasses` (`npm run dev:sim -w apps/glasses`, which sets Vite mode `simulator` so the app starts in text mode; `?render=text` forces it regardless).
2. Point the app at a local relay (`wrangler dev` on `ws://localhost:8787`) — remember the simulator has no `app.json` whitelist enforcement, real hardware does.
3. Drive with `fake-spotter`. At each scenario checkpoint capture a screenshot through the simulator HTTP API (see `/simulator-automation`) into `qa/<YYYY-MM-DD>/<scenario>-<step>.png`.
4. Pull the simulator console log for `{call, ms, result}` lines.

Simulator caveats: caps images at 200×100 and pages at 4 containers (our page uses exactly 4 — if a fifth is ever added the simulator will reject it). Image mode and true latency are hardware-only.

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
Scenarios: table of scenario → result → evidence file
Latency: p50/p95 per call type (hardware only)
Defects: ranked, each with owner agent (g2-glasses-dev | relay-backend-dev | spotter-pwa-dev)
```

## Race-day checklist (`docs/RACE_DAY.md`) — keep current

Glasses charged and paired; driver phone charged, screen-lock timeout off, Even app foreground, Hub app loaded and showing `LINK OK`; room code and PIN agreed and typed on both phones; spotter phone on a known-good network (hotspot from the pit if track Wi-Fi is bad); run `lanes` + `message-ack` with the real spotter before grid; agree the fallback (radio/pit board) if `NO LINK` appears; after the session, save the logs to `qa/<date>/`.
