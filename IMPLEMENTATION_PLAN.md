# Implementation plan — 2026-09-03T14:52:21-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Next (ordered; the worker takes the first unchecked task)
- [ ] T002d (owner: hud-qa) (spec: 010 AC-3) Complete the injectable smoke-success path in `scripts/sim-harness.ts`: start/stop the scaffold dev server and simulator, poll `/api/ping`, load the app, read simulator `bridge.getDeviceInfo()`, capture `qa/<date>/sim/image/smoke-01.png`, assert lit pixels in the “Hello, driver” text region, and write `report.json` with pinned simulator/SDK versions; verify `scripts/test/sim-harness-smoke.test.ts` with mocked automation plus root test/typecheck/lint gates.
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Implement protocol v1 wire types, shared constants, guards, and one valid plus invalid fixture per message type without runtime dependencies; verify `packages/protocol/test/guards.test.ts` through root and workspace test commands.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) Implement the pure, total reducer with injected clock/id and every event, no-op, sequence, ack, peer, and expiry semantic from the normative protocol skill; verify `packages/protocol/test/reduce.test.ts`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) Implement the injected-WebSocket `RoomClient` with hello, ping, reconnect/backoff, per-open sequence reset, replay gating, `lastFrameAt`, and disconnected-intent coalescing; verify `packages/protocol/test/client.test.ts`.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) Build the Worker and SQLite-hibernating `RaceRoom` baseline with URL/hello validation, immediate state replay, persisted full-state reduction, and broadcasts; verify `services/relay/test/roundtrip.test.ts` against self-managed `wrangler dev`.
- [ ] T007a (owner: relay-backend-dev) (spec: 020 AC-3) Complete spec 020 R5 with `/health`, debug-key-gated `/room/:id/debug`, static-asset fallthrough, and CORS on all HTTP responses; verify `services/relay/test/routes.test.ts` against self-managed `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) Preserve state and sequence across reconnect and Durable Object rehydration, and repoint the empty-room alarm to room TTL; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken` then closing the previous driver with 4409 while accepting the new one; verify `services/relay/test/eviction.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) Implement first-join PIN persistence, open-room `null` PIN semantics, and accepted-socket auth errors followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline state reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with each required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) Implement the local `fake-spotter` prerequisite with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

## Needs simulator [SIM]
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] After T002d, run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
- [ ] T003c (owner: relay-backend-dev) (spec: 010 AC-5) After T002c records the exact simulator `bridge.getDeviceInfo()` value, remove every non-hardware `TBD` allowance, make the valid fixture/test reject any non-hardware `TBD`, add the root environment-check script to CI, and validate that `engines.node` permits only major 22; verify `scripts/test/check-environment.test.ts`, the repository check, and the full AC-1 gate. This closes the blocked T003a repair.

## Needs human [HW]
- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode, QR-sideload the scaffold, and save the required photo/log under `qa/<date>/`.
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Deploy the Worker, set `DEBUG_KEY`, run `lanes` with spotter and driver clients, and save `qa/<date>/020-deploy.log`.
- [ ] T104 (owner: maxx) (spec: 030 AC-8) Run real-glasses `lanes`, `gap-sweep`, `message-ack`, and `link-loss`; record PASS by AC in `qa/<date>/REPORT.md`.
- [ ] T105 (owner: maxx) (spec: 030 AC-9) Render the glyph sheet on real glasses and record visibility/fallback choices in `docs/ENVIRONMENT.md`.
- [ ] T106 (owner: maxx) (spec: 030 AC-10) Verify the hardware `wss://` upgrade against the whitelisted origin and record the result in `docs/ENVIRONMENT.md`.
- [ ] T107 (owner: maxx) (spec: 040 AC-6) Verify install, join, console, and landscape targets on iOS Safari and Android Chrome; save `qa/<date>/040-*.png`.
- [ ] T108 (owner: maxx) (spec: 040 AC-7) Run two phones plus real glasses over LTE and record the ▲ latency result in `qa/<date>/REPORT.md`.
- [ ] T109 (owner: maxx) (spec: 050 AC-6) Send the gray4 bright-column test pattern and record nibble/stride confirmation in `docs/ENVIRONMENT.md`.
- [ ] T110 (owner: maxx) (spec: 050 AC-7) Run `gap-sweep` plus a 10-minute soak on real glasses; save `latency.csv` and the AC result in `qa/<date>/REPORT.md`.
- [ ] T111 (owner: maxx) (spec: 050 AC-8) Open and cancel the exit dialogue and verify text fallback within three failed image sends in `qa/<date>/REPORT.md`.
- [ ] T112 (owner: maxx) (spec: 060 AC-5) Perform the five-minute iOS lock/unlock recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T113 (owner: maxx) (spec: 060 AC-6) Perform the five-minute Android lock/foreground recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T114 (owner: maxx) (spec: 060 AC-7) Redeploy the relay mid-session and record automatic recovery in `qa/<date>/REPORT.md`.
- [ ] T115 (owner: maxx) (spec: 060 AC-8) Save a session `wrangler tail` showing parseable structured lines and no message bodies to `qa/<date>/tail.log`.
- [ ] T116 (owner: maxx) (spec: 070 AC-4) Follow `docs/RACE_DAY.md` before grid and record real `lanes` plus `message-ack` PASS in `qa/<date>/REPORT.md`.
- [ ] T117 (owner: maxx) (spec: 070 AC-5) Archive full-session logs, latency table, defects, and open-question disposition under `qa/<date>/` with human sign-off.

## Done this cycle
- [x] T002f (owner: hud-qa) (spec: 010 AC-7) Replaced the fixed-date assertion with a recursive no-`report.json` check beneath the injected output root for launcher and ping failure paths; approved at commit `1c56c26`.

## Notes / why
- Iteration 16 records T002f as `done`/`approve`; its approval closes the T002b → T002e → T002f AC-7 repair chain, so the blocked ancestor tasks leave *Next*.
- T002d remains first because the harness can prove its success-path behavior under mocks before T002c is retried on an interactive simulator host.
- T002c precedes T003c under *Needs simulator* because its committed smoke report supplies the exact simulator `getDeviceInfo()` value needed to close AC-5 without inference.
- AC audit 010: AC-1 is met by `.github/workflows/ci.yml` and the passing root test/typecheck/lint gates; AC-2 is met by the passing `sync:agents:check`; AC-6 is met by `scripts/test/check-pins.test.ts` plus `check:pins`; AC-7 is met by `scripts/test/sim-harness.test.ts` (2 passing); AC-3 is open `[SIM]`, AC-4 is open `[HW]`, and AC-5 is unmet because the simulator value is `TBD` and the repository check is not in CI.
- AC audit 020: AC-1–AC-9 are unmet because their named verifier files are absent and protocol/relay remain placeholders; AC-10 is open `[HW]`, with local CLI prerequisite T014.
- AC audit 030: AC-1–AC-6 are unmet because their named tests/features are absent; AC-7 is open `[SIM]`; AC-8–AC-10 are open `[HW]`.
- AC audit 040: AC-1–AC-5 are unmet because their named tests/UI are absent; AC-6–AC-7 are open `[HW]`.
- AC audit 050: AC-1–AC-5 are unmet because their named tests/image renderer are absent; AC-5b is open `[SIM]`; AC-6–AC-8 are open `[HW]`.
- AC audit 060: AC-1–AC-4 are unmet because their named tests/hardening are absent; AC-5–AC-8 are open `[HW]`.
- AC audit 070: AC-1–AC-3 are unmet because their named tests/packaging artifacts are absent; AC-4–AC-5 are open `[HW]`.
- No criterion is `DISPUTED`; `qa/` is absent, so no `[SIM]` or `[HW]` criterion has passing evidence.
- Protocol work remains ordered types/guards → reducer → client → relay so all consumers share normative wire shapes, state semantics, and timings before integration.
