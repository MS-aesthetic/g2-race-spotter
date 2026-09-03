# Implementation plan — 2026-09-03T15:33:23-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Active stream leases (interactive coordinator only)
| lease | task | stream | write scope | locks | dependency / integration gate |
|---|---|---|---|---|---|
| L001 | T002h | bootstrap | `apps/glasses/src/main.ts`; `scripts/sim-harness.ts`; `scripts/test/sim-harness-smoke.test.ts` | `sim-harness` | none; integrate first and restore root lint |
| L002 | T004 | protocol | `packages/protocol/**` | `protocol` | implementation may start now; final commit/integration only after T002h is integrated and full root gates are green |

The coordinator must add the exact base commit and isolated worktree path to each dispatch record before starting a stream. L001 and L002 have disjoint scopes/locks and may run concurrently; integration is serial in the order above.

## Next (ordered; the serial runner takes the first unchecked task)
- [ ] T002h (owner: hud-qa) (spec: 010 AC-3) [stream: bootstrap; lease: L001; lock: sim-harness] Repair the blocked T002g smoke path: after the app and simulator automation endpoints are ready, classify a missing or rejected `bridge.getDeviceInfo()` observation as `evidence-failed` rather than `sim-unavailable`; make screenshot proof require actual RGB brightness `> 32` in the “Hello, driver” region (not merely opaque alpha or near-black pixels); add focused process-facing regressions in `scripts/test/sim-harness-smoke.test.ts` that prove both failures produce a non-zero CLI result, cleanup, and no success evidence; format `scripts/sim-harness.ts`; run root test/typecheck/lint gates. Review findings (verbatim):
  > [block] scripts/sim-harness.ts:461 — missing `g2rs.device-info` remains inside the `sim-unavailable` catch even after ping proves the automation server ready — scenario: simulator ping succeeds and "Hello, driver" renders, but `bridge.getDeviceInfo()` rejects or emits no marker → the harness returns `sim-unavailable` with no report, parking a product/evidence failure as infrastructure — fix: move the missing-device-info branch outside the launch/readiness catch, classify it as `evidence-failed`, and add a regression.
  >
  > [block] scripts/sim-harness.ts:1 — the committed file fails the task's required lint/format gate — scenario: a clean review runs `npm run lint` → Prettier reports `scripts/sim-harness.ts` and exits 1 — fix: format the file with the pinned Prettier and recommit.
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) [stream: protocol; lease: L002; lock: protocol] Implement protocol v1 wire types, shared constants, guards, and one valid plus invalid fixture per message type without runtime dependencies; verify `packages/protocol/test/guards.test.ts` through root and workspace test commands. Start may overlap T002h, but final verification/commit and integration wait for T002h to restore root lint.
- [ ] T002g (owner: hud-qa) (spec: 010 AC-3) [stream: bootstrap; lock: sim-harness; superseded by T002h] Preserve the blocked repair-chain record until T002h is approved; do not lease independently.
- [ ] T002d (owner: hud-qa) (spec: 010 AC-3) [stream: bootstrap; lock: sim-harness; superseded by T002h] Preserve the original blocked task until T002h is approved; do not lease independently.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) [stream: protocol; lock: protocol; depends: T004 integrated] Implement the pure, total reducer with injected clock/id and every event, no-op, sequence, ack, peer, and expiry semantic from the normative protocol skill; verify `packages/protocol/test/reduce.test.ts`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) [stream: protocol; lock: protocol; depends: T005 integrated] Implement the injected-WebSocket `RoomClient` with hello, ping, reconnect/backoff, per-open sequence reset, replay gating, `lastFrameAt`, and disconnected-intent coalescing; verify `packages/protocol/test/client.test.ts`.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) [stream: relay; lock: relay-room; depends: T006 integrated] Build the Worker and SQLite-hibernating `RaceRoom` baseline with URL/hello validation, immediate state replay, persisted full-state reduction, and broadcasts; verify `services/relay/test/roundtrip.test.ts` against self-managed `wrangler dev`.
- [ ] T007a (owner: relay-backend-dev) (spec: 020 AC-3; requirement R5) [stream: relay; lock: relay-room; depends: T007 integrated] Complete `/health`, debug-key-gated `/room/:id/debug`, static-asset fallthrough, and CORS on all HTTP responses; verify `services/relay/test/routes.test.ts` against self-managed `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) [stream: relay; lock: relay-room; depends: T007 integrated] Preserve state and sequence across reconnect and Durable Object rehydration, and repoint the empty-room alarm to room TTL; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) [stream: relay; lock: relay-room; depends: T007 integrated] Implement first-join PIN persistence, open-room `null` PIN semantics, and accepted-socket auth errors followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) [stream: relay; lock: relay-room; depends: T011 integrated] Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken` then closing the previous driver with 4409 while accepting the new one; verify `services/relay/test/eviction.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) [stream: relay; lock: relay-room; depends: T007 integrated] Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline state reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) [stream: relay; lock: relay-room; depends: T007 integrated] Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with each required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) [stream: tooling; lock: fake-spotter; depends: T007 integrated] Implement the local `fake-spotter` prerequisite with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

## Needs simulator [SIM]
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] After the T002h repair chain is approved, run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
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
- None — T002g was implemented at `3b683f1` but remains unchecked because the review verdict was `block`.

## Notes / why
- Iteration 18 records T002g as `review-blocked`/`block`; T002h is first with the same owner, while T002g and its original T002d remain unchecked beneath it as required by review handling.
- L001/T002h and L002/T004 are the only active parallel leases: their scopes and locks do not overlap, but T004 cannot make its final green commit or integrate until T002h restores root lint.
- T005 and T006 remain serial on the exclusive `protocol` lock; relay auth T011 precedes eviction T009 so last-writer-wins is built on verified PIN admission.
- Once simulator ping succeeds, a missing `getDeviceInfo()` observation is an evidence failure, not launch unavailability; this prevents a product/evidence defect from being parked under *Needs simulator*.
- AC audit 010: AC-2 is met by `npm run sync:agents:check`; AC-6 is met by `scripts/test/check-pins.test.ts` plus `check:pins`; AC-7 is met by `scripts/test/sim-harness.test.ts`; AC-1 is unmet because `npm run lint` fails on `scripts/sim-harness.ts`; AC-5 is unmet because the simulator value remains `TBD` and its named repository verifier is absent from CI; AC-3 is open `[SIM]`; AC-4 is open `[HW]`.
- AC audit 020: AC-1–AC-9 are unmet because the protocol/relay are placeholders and their named verifier files are absent; AC-10 is open `[HW]`, with local CLI prerequisite T014.
- AC audit 030: AC-1–AC-6 are unmet because their named tests/features are absent; AC-7 is open `[SIM]`; AC-8–AC-10 are open `[HW]`.
- AC audit 040: AC-1–AC-5 are unmet because their named tests/UI are absent; AC-6–AC-7 are open `[HW]`.
- AC audit 050: AC-1–AC-5 are unmet because their named tests/image renderer are absent; AC-5b is open `[SIM]`; AC-6–AC-8 are open `[HW]`.
- AC audit 060: AC-1–AC-4 are unmet because their named tests/hardening are absent; AC-5–AC-8 are open `[HW]`.
- AC audit 070: AC-1–AC-3 are unmet because their named tests/packaging artifacts are absent; AC-4–AC-5 are open `[HW]`.
- No criterion is `DISPUTED`; `qa/` is absent, so no `[SIM]` or `[HW]` criterion has passing evidence.
- Protocol work remains ordered types/guards → reducer → client → relay so all consumers share normative wire shapes, state semantics, and timings before integration.
