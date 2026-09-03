# Implementation plan — 2026-09-03T16:58:56-04:00
Status: BUILDING
Current spec focus: specs/020-protocol-and-relay.md

## Active stream leases (interactive coordinator only)

| lease | task | stream | repair base / combined review base | write scope | exclusive locks | review / integration gate |
|---|---|---|---|---|---|---|
| L005R | T006a | protocol-client-repair | repair from `5c424f4cd8f623fcb76036e66881ed1b11d6fd2e`; review from `ae5f4488ae12b3e987cbec6f583724799e541be6` | `packages/protocol/src/client.ts`; `packages/protocol/src/index.ts`; `packages/protocol/test/client.test.ts` only, as needed | `protocol-client` | protocol-keeper reviews exact combined range `ae5f448..T006a-head`; integrate the quarantined candidate plus repair first only after approval, then run protocol and every root gate |
| L006R | T007b | relay-repair | repair from `df9eca80d8cadefb90ed182b09b4290d8344b3e1`; review from `ae5f4488ae12b3e987cbec6f583724799e541be6` | `services/relay/**`; `package-lock.json` only if dependency installation genuinely requires it; no protocol edits | `relay-room`, `root-lockfile` | protocol-keeper reviews exact combined range `ae5f448..T007b-head`; integrate the quarantined candidate plus repair second only after L005R approval/integration and its root gates, then run relay integration tests and every root gate |

L005/T006 (`5c424f4`) and L006/T007 (`df9eca8`) are quarantined and not integrated after independent `block` reviews. L005R and L006R may repair concurrently because their worktrees, scopes, and locks are disjoint; approved integration remains serial in the explicit order client then relay.

## Next (ordered; the serial runner takes the first unchecked task)

- [ ] T006a (owner: relay-backend-dev) (spec: 020 AC-8) [stream: protocol-client-repair; lease: L005R; lock: protocol-client; repair base: `5c424f4`; combined review base: `ae5f448`; may run concurrently with T007b] Repair the quarantined RoomClient candidate within the exact L005 scope and add regressions for every protocol-keeper finding: “terminal close codes 4400/4401/4409/4426 must not reconnect (4408 retry)”; “send must include Ack and define offline behavior”; “connect replacement must retire old socket and clear queues on disconnect/URL change”; “tests need actual drop/reopen + no delivered msg resend + jitter/cap/timer uniqueness/terminal/stale events”; and “lastFrameAt updates before parse/guard on every frame.” Run protocol tests and every root gate; one repair commit only.
- [ ] T007b (owner: relay-backend-dev) (spec: 020 AC-3) [stream: relay-repair; lease: L006R; locks: relay-room, root-lockfile; repair base: `df9eca8`; combined review base: `ae5f448`; may run concurrently with T006a] Repair the quarantined RaceRoom candidate within the exact L006 relay scope and add regressions for every protocol-keeper finding: “broadcasts must only reach attachment.ready sockets and hello gets explicit latest replay”; and “invalid/missing URL role must be accepted WS then bad_frame + close4400, with regressions.” Use only protocol exports; touch `package-lock.json` only if necessary; run relay integration tests and every root gate; one repair commit only.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) [quarantined candidate `5c424f4`; depends: T006a combined-range approval] Complete the injected-WebSocket `RoomClient` with automatic hello/ping, jittered capped reconnect, terminal-close handling, `lastSeen` reset and filtering, replay-before-flush, every-frame `lastFrameAt`, and precisely defined offline intent delivery; close only when the exact `ae5f448..T006a-head` review approves and integration gates pass.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) [quarantined candidate `df9eca8`; depends: T007b combined-range approval and T006 integrated] Complete the Worker and SQLite-hibernating `RaceRoom` with accepted-socket URL/hello validation, ready-only broadcasts, explicit latest replay, persisted full-state reduction, and roundtrip coverage; close only when the exact `ae5f448..T007b-head` review approves and integration gates pass.
- [ ] T007a (owner: relay-backend-dev) (spec: 020 AC-3; requirement R5) [stream: relay; lock: relay-room; depends: T007 integrated] Complete `/health`, debug-key-gated `/room/:id/debug`, static-asset fallthrough, and CORS on every HTTP response; verify `services/relay/test/routes.test.ts` against self-managed `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) [stream: relay; lock: relay-room; depends: T007 integrated] Preserve state and sequence across reconnect and Durable Object rehydration, and repoint the empty-room alarm to room TTL; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) [stream: relay; lock: relay-room; depends: T007 integrated] Implement first-join PIN persistence, open-room `null` PIN semantics, and accepted-socket auth error followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) [stream: relay; lock: relay-room; depends: T011 integrated] Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken`, closing the previous driver with 4409, and accepting the new driver; verify `services/relay/test/eviction.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) [stream: relay; lock: relay-room; depends: T007 integrated] Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) [stream: relay; lock: relay-room; depends: T007 integrated] Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with every required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) [stream: tooling; lock: fake-spotter; depends: T007 integrated] Implement every R6 scenario and `--role driver` in `scripts/fake-spotter.ts`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

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

- [x] T004a/T004b/T004c (owner: relay-backend-dev) (spec: 020 AC-1) Repaired the protocol package export and consumer compile chain (integrated commits `087d31b`, `3ba292f`, `ae5f448`; exact combined-range review approved).
- [x] T005/T005a (owner: relay-backend-dev) (spec: 020 AC-2) Implemented, repaired, and approved the pure room-state reducer stack (commits `35e74dc`, `42d7d5b`).
- [x] T002h (owner: hud-qa) (spec: 010 AC-3) Hardened simulator evidence classification without claiming `[SIM]` success (commit `2ef2f63`; review `approve`).
- [x] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Centralized protocol v1 types/constants/guards and fixtures (commit `019d2e4`; review `approve`).

## Notes / why

- Quarantine means neither blocked candidate is reachable from `master`; the repair branches preserve the work for exact combined-range review without weakening any criterion.
- Client integration precedes relay integration because `packages/protocol` is the wire source of truth; relay repair remains forbidden from redefining or editing protocol types.
- T006a and T007b are independently repairable now, but each keeps one owner, one scoped commit, one exact-range review, and disjoint worktree locks.
- After each approval, integrate only that candidate-plus-repair chain and rerun all Node 22 root backpressure gates before the next integration.
- AC audit 010: AC-1/AC-2/AC-6/AC-7 met; AC-3 and AC-5 parked under Needs simulator; AC-4 under Needs human.
- AC audit 020: AC-1 and AC-2 met; AC-3–AC-9 unmet; AC-10 under Needs human with local prerequisite T014.
- AC audits 030–070 remain unchanged: automated criteria are unmet, `[SIM]` evidence is absent, and every `[HW]` criterion remains under Needs human.
- No criterion is `DISPUTED`; `qa/` remains absent, so no simulator or hardware evidence is claimed.
