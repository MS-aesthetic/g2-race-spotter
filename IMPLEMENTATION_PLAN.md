# Implementation plan — 2026-09-03T15:08:07-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Next (ordered; the worker takes the first unchecked task)
- [ ] T002g (owner: hud-qa) (spec: 010 AC-3) Repair the blocked T002d smoke path, preserving the one-call startup guard and separating simulator launch/readiness failures from product assertion/evidence failures; add focused regressions to `scripts/test/sim-harness-smoke.test.ts` for early device-info versus page readiness and blank screenshots, retain the AC-7 launcher/ping cases in `scripts/test/sim-harness.test.ts`, and run root test/typecheck/lint gates. Review findings (verbatim):
  > [block] apps/glasses/src/main.ts:25 — the device-info marker is emitted without waiting for the startup-page promise, but the harness treats that marker as display readiness — scenario: `getDeviceInfo()` resolves before `createStartUpPageContainer()` → the harness captures a blank frame and fails a valid smoke run — fix: await the one guarded `startPage()` call before logging device info, or make the harness poll the screenshot assertion until ready.
  >
  > [block] scripts/sim-harness.ts:442 — the broad catch maps display/assertion and evidence-write failures to `sim-unavailable` — scenario: simulator ping and device info succeed but the RGBA screenshot is blank → CLI prints `sim-unavailable` and writes no failed assertion, parking a product regression as an infrastructure failure — fix: reserve `sim-unavailable` for launch/readiness failures and surface or record assertion/evidence failures distinctly.
- [ ] T002d (owner: hud-qa) (spec: 010 AC-3) Complete the injectable smoke-success path in `scripts/sim-harness.ts`: start/stop the scaffold dev server and simulator, poll `/api/ping`, load the app, read simulator `bridge.getDeviceInfo()`, capture `qa/<date>/sim/image/smoke-01.png`, assert lit pixels in the “Hello, driver” text region, and write `report.json` with pinned simulator/SDK versions; verify `scripts/test/sim-harness-smoke.test.ts` with mocked automation plus root test/typecheck/lint gates.
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Implement protocol v1 wire types, shared constants, guards, and one valid plus invalid fixture per message type without runtime dependencies; verify `packages/protocol/test/guards.test.ts` through root and workspace test commands.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) Implement the pure, total reducer with injected clock/id and every event, no-op, sequence, ack, peer, and expiry semantic from the normative protocol skill; verify `packages/protocol/test/reduce.test.ts`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) Implement the injected-WebSocket `RoomClient` with hello, ping, reconnect/backoff, per-open sequence reset, replay gating, `lastFrameAt`, and disconnected-intent coalescing; verify `packages/protocol/test/client.test.ts`.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) Build the Worker and SQLite-hibernating `RaceRoom` baseline with URL/hello validation, immediate state replay, persisted full-state reduction, and broadcasts; verify `services/relay/test/roundtrip.test.ts` against self-managed `wrangler dev`.
- [ ] T007a (owner: relay-backend-dev) (spec: 020 AC-3; requirement R5) Complete `/health`, debug-key-gated `/room/:id/debug`, static-asset fallthrough, and CORS on all HTTP responses; verify `services/relay/test/routes.test.ts` against self-managed `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) Preserve state and sequence across reconnect and Durable Object rehydration, and repoint the empty-room alarm to room TTL; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken` then closing the previous driver with 4409 while accepting the new one; verify `services/relay/test/eviction.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) Implement first-join PIN persistence, open-room `null` PIN semantics, and accepted-socket auth errors followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline state reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with each required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) Implement the local `fake-spotter` prerequisite with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

## Needs simulator [SIM]
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] After T002g/T002d are approved, run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
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
- None — T002d was implemented at `3c22234` but remains unchecked because the review verdict was `block`.

## Notes / why
- Iteration 17 records T002d as `review-blocked`/`block`; T002g is first and retains the same owner, while the original T002d stays unchecked directly beneath it as required by review handling.
- The smoke harness must use display readiness, not the earlier device-info marker, and must distinguish infrastructure unavailability from assertion/evidence failure so a product regression cannot be parked under *Needs simulator*.
- T002c remains parked until the repair is approved because only a real interactive run can satisfy 010 AC-3 and supply the simulator value needed by T003c/AC-5.
- AC audit 010: AC-1 met by `.github/workflows/ci.yml` and the passing 8-file/14-test root gate; AC-2 met by `npm run sync:agents:check`; AC-6 met by `scripts/test/check-pins.test.ts` plus `check:pins`; AC-7 met by `scripts/test/sim-harness.test.ts`; AC-3 is open `[SIM]`, AC-4 is open `[HW]`, and AC-5 is unmet because the simulator value is `TBD` and the named repository check is absent from CI.
- AC audit 020: AC-1–AC-9 are unmet because their named verifier files are absent and protocol/relay remain placeholders; AC-10 is open `[HW]`, with local CLI prerequisite T014.
- AC audit 030: AC-1–AC-6 are unmet because their named tests/features are absent; AC-7 is open `[SIM]`; AC-8–AC-10 are open `[HW]`.
- AC audit 040: AC-1–AC-5 are unmet because their named tests/UI are absent; AC-6–AC-7 are open `[HW]`.
- AC audit 050: AC-1–AC-5 are unmet because their named tests/image renderer are absent; AC-5b is open `[SIM]`; AC-6–AC-8 are open `[HW]`.
- AC audit 060: AC-1–AC-4 are unmet because their named tests/hardening are absent; AC-5–AC-8 are open `[HW]`.
- AC audit 070: AC-1–AC-3 are unmet because their named tests/packaging artifacts are absent; AC-4–AC-5 are open `[HW]`.
- No criterion is `DISPUTED`; `qa/` is absent, so no `[SIM]` or `[HW]` criterion has passing evidence.
- Protocol work remains ordered types/guards → reducer → client → relay so all consumers share normative wire shapes, state semantics, and timings before integration.
