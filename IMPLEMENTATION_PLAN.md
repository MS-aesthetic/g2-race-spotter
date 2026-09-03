# Implementation plan — 2026-09-03T14:31:37-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Next (ordered; the worker takes the first unchecked task)
- [ ] T002e (owner: hud-qa) (spec: 010 AC-7) Repair T002b by making the named verifier exercise the process-facing `main()`/CLI boundary with injected launcher, output-root, stderr, and exit handling; assert literal `sim-unavailable`, non-zero exit, cleanup, and absence of a report at the harness-selected output root; verify `scripts/test/sim-harness.test.ts` plus the root test/typecheck/lint gates.
  - Reviewer finding (verbatim): "[block] scripts/test/sim-harness.test.ts:41 — the named verifier only asserts the internal result object; it never exercises or observes `main()`, so AC-7's required non-zero process exit and literal `sim-unavailable` output are unverified, and its no-report check targets an unrelated temporary path that the harness never receives — scenario: remove `console.error`/`process.exitCode = 1` from `main()` (or later write a partial report under the real repo root) → both tests still pass while `npm run sim:scenarios` violates AC-7 — fix: exercise the CLI boundary with an injected failing launcher (or inject dependencies/output/exit handling into `main`) and assert stderr plus non-zero status; point the report assertion at the harness's actual injected output root."
- [ ] T002b (owner: hud-qa) (spec: 010 AC-7) Add `scripts/sim-harness.ts` and the root `sim:scenarios` script with injectable launcher/automation seams; resolve the pinned local simulator, use automation port 9898, and on launch or ping failure exit non-zero with literal `sim-unavailable` and no partial report; verify `scripts/test/sim-harness.test.ts`.
- [ ] T002d (owner: hud-qa) (spec: 010 AC-3) Complete the mocked simulator smoke-success path: poll `/api/ping`, load the scaffold app, capture `qa/<date>/sim/image/smoke-01.png`, assert lit pixels in the “Hello, driver” text region, and write pinned simulator/SDK versions plus simulator `getDeviceInfo()` to `report.json`; verify `scripts/test/sim-harness-smoke.test.ts`.
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
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] After T002d, run `npm run sim:scenarios -- --smoke` on a machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
- [ ] T003c (owner: relay-backend-dev) (spec: 010 AC-5) After T002c records the exact simulator `bridge.getDeviceInfo()` value, remove every non-hardware `TBD` allowance, make the valid fixture/test reject any non-hardware `TBD`, add a root environment-check script and invoke it in CI, and validate that `engines.node` permits only major 22; verify `scripts/test/check-environment.test.ts`, the repository check, and the full AC-1 gate. This blocked repair also closes T003a.

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
- (none; T002b is review-blocked at commit 66595a1 and remains unchecked beneath repair T002e)

## Notes / why
- Iteration 14 records T002b as `review-blocked`/`block`: its internal failure-path tests pass, but they do not prove AC-7's required CLI stderr, non-zero exit, or no-report behavior at the actual output root.
- T002e stays first and quotes the blocking finding verbatim; T002b remains unchecked beneath it as required by the review policy.
- T002c precedes T003c under Needs simulator because its committed smoke report supplies the exact simulator `getDeviceInfo()` value needed to close AC-5 without inference.
- AC audit 010: AC-1 is met by `.github/workflows/ci.yml` and the passing root test/typecheck/lint commands; AC-2 is met by the passing `sync:agents:check`; AC-6 is met by `scripts/test/check-pins.test.ts` and `check:pins`; AC-3 is open `[SIM]`, AC-4 is open `[HW]`, and AC-5/AC-7 are unmet automated.
- AC audit 020: AC-1–AC-9 are unmet because their named verifier files are absent; AC-10 is open `[HW]`, with local CLI prerequisite T014.
- AC audit 030: AC-1–AC-6 are unmet because their named tests are absent; AC-7 is open `[SIM]`; AC-8–AC-10 are open `[HW]`.
- AC audit 040: AC-1–AC-5 are unmet because their named tests are absent; AC-6–AC-7 are open `[HW]`.
- AC audit 050: AC-1–AC-5 are unmet because their named tests are absent; AC-5b is open `[SIM]`; AC-6–AC-8 are open `[HW]`.
- AC audit 060: AC-1–AC-4 are unmet because their named tests are absent; AC-5–AC-8 are open `[HW]`.
- AC audit 070: AC-1–AC-3 are unmet because their named tests are absent; AC-4–AC-5 are open `[HW]`.
- No criterion is `DISPUTED`; `qa/` is absent, so no `[SIM]` or `[HW]` criterion has passing evidence.
- Protocol work remains ordered types/guards → reducer → client → relay so every consumer shares the normative wire shapes and state semantics.
