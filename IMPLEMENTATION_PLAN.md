# Implementation plan — 2026-09-03T12:06:38-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Next (ordered; the worker takes the first unchecked task)
- [ ] T015 (owner: relay-backend-dev) (spec: 010 AC-6) Add `scripts/check-pins.mjs`, fixture-driven coverage in `scripts/test/check-pins.test.ts`, and a CI step rejecting range specifiers for every dependency named by R2; verify the checker and full AC-1 gate.
- [ ] T002 (owner: g2-glasses-dev) (spec: 010 AC-3) Scaffold `apps/glasses` from the official `minimal` template; confirm and pin SDK/CLI/Vite/simulator 0.9.5 exactly; add `dev` and `dev:sim` where simulator mode changes only logging/relay defaults; render “Hello, driver” in one text container; verify `apps/glasses/test/startup-page.test.ts`.
- [ ] T003 (owner: relay-backend-dev) (spec: 010 AC-5) Add `docs/ENVIRONMENT.md` with every R5 field plus `scripts/check-environment.mjs` and `scripts/test/check-environment.test.ts`; wire the checker into CI, rejecting missing/toolchain/simulator `TBD` fields while allowing hardware `TBD` only while their named `[HW]` criteria remain open.
- [ ] T002b (owner: hud-qa) (spec: 010 AC-7) Add the simulator harness launcher/failure foundation in `scripts/sim-harness.ts` and `sim:scenarios`: resolve the pinned local executable, use automation port 9898, and exit non-zero with literal `sim-unavailable` and no partial report when launch/ping fails; verify `scripts/test/sim-harness.test.ts` with a mocked launcher.
- [ ] T002d (owner: hud-qa) (spec: 010 AC-3) Complete the harness smoke success path: poll `/api/ping`, load the scaffold app, capture `qa/<date>/sim/image/smoke-01.png`, assert lit pixels in the “Hello, driver” text region, and record pinned simulator/SDK versions in `report.json`; verify `scripts/test/sim-harness-smoke.test.ts` with mocked automation responses.
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke`; commit `qa/<date>/sim/` and simulator fields in `docs/ENVIRONMENT.md`; if it reports `sim-unavailable`, hand off `failed` with that literal reason so the planner parks this task.
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Implement protocol v1 wire types, exported constants, guards, and one valid plus invalid fixture per message type; verify `packages/protocol/test/guards.test.ts` through both root and workspace test commands.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) Implement the pure total reducer with injected clock/id and every event, no-op, sequence, and expiry semantic from the normative protocol skill; verify `packages/protocol/test/reduce.test.ts`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) Implement the injected-WebSocket `RoomClient` with hello/ping/backoff, per-open sequence reset, replay gating, `lastFrameAt`, and disconnected-intent coalescing; verify `packages/protocol/test/client.test.ts`.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) Build the Worker/RaceRoom baseline with SQLite DO hibernation, `/health`, gated debug, CORS/static fallthrough, hello replay, persistence, and full-state broadcast; verify `services/relay/test/roundtrip.test.ts` against `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) Preserve authoritative state/sequence across reconnect and DO rehydration and re-point the empty-room TTL alarm; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) Enforce authenticated last-writer-wins driver eviction with `role_taken` then close 4409; verify `services/relay/test/eviction.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) Implement first-join PIN persistence and accepted-socket auth errors followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) Implement alarm-tick silence detection, close 4408, and offline-state broadcast using shared protocol timings; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) Enforce frame-size, malformed/unknown-type, wrong-role, and URL-vs-hello validation semantics with the required keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) Implement `scripts/fake-spotter.ts` with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed evidence remains T102.

## Needs simulator [SIM]
- (none parked; T002c remains a worker task until it reports `sim-unavailable`)

## Needs human [HW]
- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode, QR-sideload the glasses app, save the required photo/log under `qa/<date>/`, and record Even app/firmware, hardware `getDeviceInfo()`, and 28 px status-line results in `docs/ENVIRONMENT.md`.
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Deploy the Worker, set `DEBUG_KEY`, run `lanes` with spotter and driver clients, and save `qa/<date>/020-deploy.log`.
- [ ] T104 (owner: maxx) (spec: 030 AC-8) Run real-glasses `lanes`, `gap-sweep`, `message-ack`, and `link-loss`; record PASS by AC in `qa/<date>/REPORT.md`.
- [ ] T105 (owner: maxx) (spec: 030 AC-9) Render the glyph sheet on real glasses and record visibility/fallback choices in `docs/ENVIRONMENT.md`.
- [ ] T106 (owner: maxx) (spec: 030 AC-10) Verify the hardware `wss://` upgrade against the whitelisted origin and record the result in `docs/ENVIRONMENT.md`.
- [ ] T107 (owner: maxx) (spec: 040 AC-6) Verify install/join/console and landscape targets on iOS Safari and Android Chrome; save `qa/<date>/040-*.png`.
- [ ] T108 (owner: maxx) (spec: 040 AC-7) Run two phones plus real glasses over LTE and record the ▲ latency result in `qa/<date>/REPORT.md`.
- [ ] T109 (owner: maxx) (spec: 050 AC-6) Send the gray4 bright-column test pattern and record nibble/stride confirmation in `docs/ENVIRONMENT.md`.
- [ ] T110 (owner: maxx) (spec: 050 AC-7) Run `gap-sweep` plus a 10-minute soak on real glasses; save `latency.csv` and the AC result in `qa/<date>/REPORT.md`.
- [ ] T111 (owner: maxx) (spec: 050 AC-8) Open/cancel the exit dialogue and verify text fallback within three failed image sends in `qa/<date>/REPORT.md`.
- [ ] T112 (owner: maxx) (spec: 060 AC-5) Perform the five-minute iOS lock/unlock recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T113 (owner: maxx) (spec: 060 AC-6) Perform the five-minute Android lock/foreground recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T114 (owner: maxx) (spec: 060 AC-7) Redeploy the relay mid-session and record automatic recovery in `qa/<date>/REPORT.md`.
- [ ] T115 (owner: maxx) (spec: 060 AC-8) Save a session `wrangler tail` showing parseable structured lines and no message bodies to `qa/<date>/tail.log`.
- [ ] T116 (owner: maxx) (spec: 070 AC-4) Follow `docs/RACE_DAY.md` before grid and record real `lanes` plus `message-ack` PASS in `qa/<date>/REPORT.md`.
- [ ] T117 (owner: maxx) (spec: 070 AC-5) Archive full-session logs, latency table, defects, and open-question disposition under `qa/<date>/` with human sign-off.

## Done this cycle
- [x] T001b (owner: relay-backend-dev) (spec: 010 AC-2) Added `npm run sync:agents:check` to CI and verified the generated outputs and full gate (commit 31a0615; review: approve).

## Notes / why
- AC audit 010: AC-1 met by `.github/workflows/ci.yml` and the passing 3-test/typecheck/lint gate; AC-2 met by CI commit 31a0615 plus the passing freshness check; AC-5/AC-6/AC-7 unmet; AC-3 `[SIM]` open; AC-4 `[HW]` open.
- AC audit 020: AC-1–AC-9 unmet—the protocol and relay modules and named tests are absent/placeholders; AC-10 `[HW]` open.
- AC audit 030: AC-1–AC-6 unmet—`apps/glasses` and its named tests are absent; AC-7 `[SIM]` open; AC-8–AC-10 `[HW]` open.
- AC audit 040: AC-1–AC-5 unmet—the spotter module/test are placeholders; AC-6–AC-7 `[HW]` open.
- AC audit 050: AC-1–AC-5 unmet; AC-5b `[SIM]` open; AC-6–AC-8 `[HW]` open.
- AC audit 060: AC-1–AC-4 unmet; AC-5–AC-8 `[HW]` open.
- AC audit 070: AC-1–AC-3 unmet; AC-4–AC-5 `[HW]` open. No criterion is DISPUTED.
- T001b is complete because the approved diff adds the sync freshness gate to CI and `npm run sync:agents:check` passes on the generated tree.
- Pin enforcement leads the queue so each exact SDK/CLI/simulator/Worker dependency introduced by later bootstrap tasks is guarded immediately; the glasses scaffold follows because environment and simulator work depend on its actual pins.
- The harness remains split into failure plumbing, mocked smoke success, and committed `[SIM]` evidence; simulator output never substitutes for hardware nibble, pacing, lifecycle, or visual evidence.
- Protocol types, reducer, and shared `RoomClient` precede relay and UI consumers; full-state replay and authenticated last-writer-wins remain normative.
