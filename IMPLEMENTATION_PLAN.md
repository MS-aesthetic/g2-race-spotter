# Implementation plan — 2026-09-03T15:47:23-04:00
Status: BUILDING
Current spec focus: specs/020-protocol-and-relay.md

## Active stream leases (interactive coordinator only)
| lease | task | stream | write scope | locks | dependency / integration gate |
|---|---|---|---|---|---|
| L003 | T005 | protocol | `packages/protocol/src/reduce.ts`; export wiring in `packages/protocol/src/index.ts`; `packages/protocol/test/reduce.test.ts` | `protocol` | T004 integrated at `019d2e4`; coordinator records exact plan-commit base/worktree before dispatch; integrate only after independent approval and full root gates |

L001/T002h and L002/T004 are retired after approved serial integration. L003 is the only dependency-safe implementation lease at this boundary.

## Next (ordered; the serial runner takes the first unchecked task)
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) [stream: protocol; lease: L003; lock: protocol] Implement and export the pure, total reducer with injected clock/id and the normative initial state; cover lane, rounded/clamped gap, trimmed message creation, matching/nonmatching/already-acked ack, clear, peer, expire, no-op sequence behavior, and monotonic `updatedAt` in `packages/protocol/test/reduce.test.ts`; run protocol workspace and full root test/typecheck/lint gates.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) [stream: protocol; lock: protocol; depends: T005 integrated] Implement the injected-WebSocket `RoomClient` with hello, ping, reconnect/backoff, per-open sequence reset, replay gating, `lastFrameAt`, and disconnected-intent coalescing; verify `packages/protocol/test/client.test.ts` plus root gates.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) [stream: relay; lock: relay-room; depends: T005 integrated] Build the Worker and SQLite-hibernating `RaceRoom` baseline with URL/hello validation, immediate state replay, persisted full-state reduction, and broadcasts; verify `services/relay/test/roundtrip.test.ts` against self-managed `wrangler dev` plus root gates.
- [ ] T007a (owner: relay-backend-dev) (spec: 020 AC-3; requirement R5) [stream: relay; lock: relay-room; depends: T007 integrated] Complete `/health`, debug-key-gated `/room/:id/debug`, static-asset fallthrough, and CORS on every HTTP response; verify `services/relay/test/routes.test.ts` against self-managed `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) [stream: relay; lock: relay-room; depends: T007 integrated] Preserve state and sequence across reconnect and Durable Object rehydration, and repoint the empty-room alarm to room TTL; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) [stream: relay; lock: relay-room; depends: T007 integrated] Implement first-join PIN persistence, open-room `null` PIN semantics, and accepted-socket auth error followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) [stream: relay; lock: relay-room; depends: T011 integrated] Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken`, closing the previous driver with 4409, and accepting the new driver; verify `services/relay/test/eviction.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) [stream: relay; lock: relay-room; depends: T007 integrated] Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) [stream: relay; lock: relay-room; depends: T007 integrated] Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with every required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) [stream: tooling; lock: fake-spotter; depends: T007 integrated] Implement the local `fake-spotter` prerequisite with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

## Needs simulator [SIM]
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
- [ ] T003c (owner: relay-backend-dev) (spec: 010 AC-5) After T002c records the exact simulator `bridge.getDeviceInfo()` value, remove every non-hardware `TBD` allowance, make the valid fixture/test reject non-hardware `TBD`, add the root environment check to CI, and validate `engines.node` permits only major 22; verify `scripts/test/check-environment.test.ts`, the repository check, and full AC-1 gates.

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
- [x] T002h (owner: hud-qa) (spec: 010 AC-3) Hardened post-readiness device-info and screenshot evidence classification, closing the T002g/T002d blocked repair ancestry without claiming `[SIM]` success (commit `2ef2f63`; review `approve`).
- [x] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Centralized protocol v1 types/constants/guards and valid/invalid fixtures with zero runtime dependencies (commit `019d2e4`; review `approve`).

## Notes / why
- After T004, 020 AC-1 is met by `packages/protocol/test/guards.test.ts`; protocol workspace tests (20) and integrated root typecheck/tests (38)/lint pass on Node 22.
- T002h restores 010 AC-1 and closes the blocked repair chain, but 010 AC-3 remains open until T002c commits real simulator evidence; no `[SIM]` claim was inferred from mocks.
- L003/T005 is the only dependency-safe lease now. T005 and T006 remain serial on the `protocol` lock; once T005 integrates, T006 (`protocol`) and T007 (`relay-room`) may run concurrently because the relay baseline needs the reducer/guards, not the client implementation.
- Relay tasks remain serialized on `relay-room`; after T007 integrates, T014 may run concurrently with one relay-room task because its tooling scope and lock are disjoint.
- AC audit 010: AC-1/AC-2/AC-6/AC-7 met; AC-3 and AC-5 parked under Needs simulator; AC-4 under Needs human.
- AC audit 020: AC-1 met; AC-2–AC-9 unmet; AC-10 under Needs human with local prerequisite T014.
- AC audits 030–070 remain unchanged: automated criteria are unmet, `[SIM]` evidence is absent, and every `[HW]` criterion remains under Needs human.
- No criterion is `DISPUTED`; `qa/` remains absent, so no simulator or hardware evidence is claimed.
