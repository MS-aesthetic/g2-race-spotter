# Implementation plan — 2026-09-03T13:36:13-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Next (ordered; the worker takes the first unchecked task)
- [ ] T003 (owner: relay-backend-dev) (spec: 010 AC-5) Add `docs/ENVIRONMENT.md` with every R5 field and exact non-hardware version/device values, plus `scripts/check-environment.mjs` and `scripts/test/check-environment.test.ts`; wire the checker into CI and allow `TBD` only for hardware fields whose `[HW]` criteria remain open; verify the focused test and the AC-1 gate.
- [ ] T002b (owner: hud-qa) (spec: 010 AC-7) Add `scripts/sim-harness.ts` and the root `sim:scenarios` script with injectable launcher/automation seams; resolve the pinned local simulator, use automation port 9898, and on launch or ping failure exit non-zero with literal `sim-unavailable` and no partial report; verify `scripts/test/sim-harness.test.ts`.
- [ ] T002d (owner: hud-qa) (spec: 010 AC-3) Complete the mocked simulator smoke-success path: poll `/api/ping`, load the scaffold app, capture `qa/<date>/sim/image/smoke-01.png`, assert lit pixels in the “Hello, driver” text region, and write pinned simulator/SDK versions to `report.json`; verify `scripts/test/sim-harness-smoke.test.ts`.
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke` and commit `qa/<date>/sim/` plus simulator fields in `docs/ENVIRONMENT.md`; if the command reports `sim-unavailable`, hand off `failed` with that literal reason so this task is parked rather than retried.
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Implement protocol v1 wire types, shared constants, guards, and one valid plus invalid fixture per message type without runtime dependencies; verify `packages/protocol/test/guards.test.ts` through root and workspace test commands.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) Implement the pure, total reducer with injected clock/id and every event, no-op, sequence, ack, peer, and expiry semantic from the normative protocol skill; verify `packages/protocol/test/reduce.test.ts`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) Implement the injected-WebSocket `RoomClient` with hello, ping, reconnect/backoff, per-open sequence reset, replay gating, `lastFrameAt`, and disconnected-intent coalescing; verify `packages/protocol/test/client.test.ts`.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) Build the Worker and SQLite-hibernating `RaceRoom` baseline with URL/hello validation, immediate state replay, persisted full-state reduction, and broadcasts; verify `services/relay/test/roundtrip.test.ts` against self-managed `wrangler dev`.
- [ ] T007a (owner: relay-backend-dev) (spec: 020 AC-3) Complete requirement R5 with `/health`, debug-key-gated `/room/:id/debug`, static-asset fallthrough, and CORS on all HTTP responses; verify `services/relay/test/routes.test.ts` against self-managed `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) Preserve state and sequence across reconnect and Durable Object rehydration, and repoint the empty-room alarm to room TTL; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken` then closing the previous driver with 4409 while accepting the new one; verify `services/relay/test/eviction.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) Implement first-join PIN persistence, open-room `null` PIN semantics, and accepted-socket auth errors followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline state reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with each required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) Implement the local `fake-spotter` prerequisite with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

## Needs simulator [SIM]
- (none parked; T002c has not reported `sim-unavailable`)

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
- [x] T002 (owner: g2-glasses-dev) (spec: 010 AC-3) Scaffolded the pinned minimal G2 app and verified one guarded startup-page call rendering “Hello, driver”; simulator evidence remains T002d/T002c. (commit f0adb01)

## Notes / why
- Review verdict `approve with nits` closes T002; the README greeting mismatch is documentation-only and affects no acceptance criterion, so it does not create a follow-up task.
- AC audit 010: AC-1 is met by `.github/workflows/ci.yml` plus the passing root gate; AC-2 is met by `sync:agents:check`; AC-6 is met by `scripts/test/check-pins.test.ts`; AC-3 is unmet `[SIM]`, AC-5 and AC-7 are unmet automated criteria, and AC-4 is open `[HW]`.
- AC audit 020: AC-1–AC-9 are unmet because every named verifier is absent; AC-10 is open `[HW]` and its local CLI prerequisite is T014.
- AC audit 030: AC-1–AC-6 are unmet, AC-7 is unmet `[SIM]`, and AC-8–AC-10 are open `[HW]`; spec 040 AC-1–AC-5 are unmet and AC-6–AC-7 are open `[HW]`.
- AC audit 050: AC-1–AC-5 are unmet, AC-5b is unmet `[SIM]`, and AC-6–AC-8 are open `[HW]`; spec 060 AC-1–AC-4 are unmet and AC-5–AC-8 are open `[HW]`; spec 070 AC-1–AC-3 are unmet and AC-4–AC-5 are open `[HW]`.
- No criterion is `DISPUTED`; no committed `qa/` evidence exists. The current root gates pass: 5 test files/8 tests, typecheck, lint, generated-agent sync, and dependency pins.
- T003 remains first because the checked environment schema must exist before the simulator evidence task fills its non-hardware fields; the harness failure contract follows, then mocked smoke assertions, then the real `[SIM]` run.
- Protocol tasks retain full-state replay, per-open sequence reset, accepted-socket errors, and authenticated driver eviction; future HUD tasks retain state-only rendering, one 288×144 image, 250 ms latest-wins gap coalescing, NO LINK dimming, and permanent text fallback.
