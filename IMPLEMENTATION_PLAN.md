# Implementation plan — 2026-09-03T23:21:18-04:00

Status: BUILDING
Current spec focus: specs/020-protocol-and-relay.md

## Active stream leases (interactive coordinator only)

- None. T008/T008a is integrated; T006/T006a/T006b is stopped and quarantined; the next implementation task is intentionally unleased for handoff to another agent instance.

## Next (ordered; the serial runner takes the first unchecked task)

- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6; requirement R4) [stream: relay-room; lock: relay-room; depends: T008/T008a integrated] Implement first-join PIN persistence under storage key `pin`, including open-room `{value:null}` semantics; after WebSocket acceptance, reject later token mismatches with `error{code:"auth"}` then close 4401, without changing state or evicting a driver. Verify fresh/open/protected/restart cases in `services/relay/test/auth.test.ts`; run every root gate and commit once.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) [stream: relay-room; lock: relay-room; depends: T011 integrated] Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken`, closing the previous driver with 4409, and accepting the new driver; verify `services/relay/test/eviction.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) [stream: relay-room; lock: relay-room; depends: T009 integrated] Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) [stream: relay-room; lock: relay-room; depends: T012 integrated] Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with every required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10; requirement R6) [stream: tooling; lock: fake-spotter; depends: T009 integrated] Implement every fake-spotter scenario and `--role driver` in `scripts/fake-spotter.ts`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

## Needs simulator [SIM]

- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
- [ ] T003c (owner: relay-backend-dev) (spec: 010 AC-5) After T002c records the exact simulator `bridge.getDeviceInfo()` value, remove every non-hardware `TBD` allowance, make the valid fixture/test reject non-hardware `TBD`, add the root environment check to CI, and validate `engines.node` permits only major 22; verify `scripts/test/check-environment.test.ts`, the repository check, and full AC-1 gates.

## Needs human — stopped review escalation (not [HW] evidence)

- [ ] T006/T006a/T006b (owner: maxx) (spec: 020 AC-8) [STOPPED; NON-HARDWARE REVIEW ESCALATION] A fourth repair was declined after three exact-range review blocks; candidate `ae5f448..e588729` remains quarantined and must not be leased or integrated. Resume only if Maxx explicitly reverses this decision. Remaining findings are retained for traceability: reset `reconnectAttempt` only after the first valid replay; clamp jitter within 500–8000 ms and test `random: () => 0`.

## Needs human [HW]

- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode, QR-sideload the scaffold, and save the required photo/log under `qa/<date>/`.
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Deploy the Worker, set `DEBUG_KEY`, run `lanes` with spotter and driver clients, and save `qa/<date>/020-deploy.log`.
- [ ] T104 (owner: maxx) (spec: 030 AC-8) Run real-glasses `lanes`, `gap-sweep`, `message-ack`, and `link-loss`; record PASS by AC in `qa/<date>/REPORT.md`.
- [ ] T105 (owner: maxx) (spec: 030 AC-9) Render the glyph sheet on real glasses and record visibility/fallback choices in `docs/ENVIRONMENT.md`.
- [ ] T106 (owner: maxx) (spec: 030 AC-10) Verify the hardware `wss://` upgrade against the whitelisted origin and record the result in `docs/ENVIRONMENT.md`.
- [ ] T107 (owner: maxx) (spec: 040 AC-6) Verify install, join, console, and landscape targets on iOS Safari and Android Chrome; save `qa/<date>/040-*.png`.
- [ ] T108 (owner: maxx) (spec: 040 AC-7) Run two phones plus real glasses over LTE and record the lane-call latency in `qa/<date>/REPORT.md`.
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

- [x] T008/T008a (owner: relay-backend-dev) (spec: 020 AC-4; requirement R4) Exact range `191d9a1..5689288` was approved with no findings and integrated as `56e0729` + `637c2c2`; reconnect and Durable Object restart replay preserve lane/gap/msg and monotonic seq, reconcile both presence flags before first replay, repoint an empty room to `updatedAt + ROOM_TTL_MS`, and route expiry through the normative reducer before deletion.
- [x] T007a/T007c (owner: relay-backend-dev) (spec: 020 requirement R5) Approved route stack integrated as `9eb2876` + `191d9a1`; `/health`, protected debug, CORS, asset fallthrough, generated bindings, and asset-preservation regressions pass.
- [x] T007/T007b (owner: relay-backend-dev) (spec: 020 AC-3) Approved hibernating relay roundtrip stack integrated as `794fd17` + `a380d6f`.
- [x] T004/T004a/T004b/T004c (owner: relay-backend-dev) (spec: 020 AC-1) Centralized and repaired the protocol package, guards, fixtures, exports, and consumer compilation.
- [x] T005/T005a (owner: relay-backend-dev) (spec: 020 AC-2) Implemented and approved the pure room-state reducer stack (`35e74dc` + `42d7d5b`).

## Notes / why

- T008/T008a is integrated, approved, and root-gated: 59/59 tests, typecheck, lint (only two existing generated-d.ts warnings), pins, sync, environment check, Wrangler types check, and isolated-assets deploy dry-run pass on Node 22.
- 020 AC-4 is met by `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`; no stale peer-online flag is replayed after close or rehydration.
- T011 is next because PIN establishment/authentication must precede driver eviction; both share `relay-room` and cannot run concurrently.
- No new implementation lease was opened because the user requested handoff after this planning update.
- T006 is frozen by the user's explicit decision; it is neither `[SIM]` nor `[HW]`, and 020 AC-8 remains unmet.
- T014 stays unleased until T009 integrates because its driver-eviction scenario depends on that behavior.
- AC audit 010: AC-1/AC-2/AC-6/AC-7 met; AC-3 and AC-5 need simulator; AC-4 needs hardware.
- AC audit 020: AC-1/AC-2/AC-3/AC-4 met; AC-5–AC-9 remain unmet except the stopped, quarantined AC-8 client chain; AC-10 remains `[HW]` after local T014.
- AC audits 030–070: automated criteria remain future work, simulator evidence is absent, and hardware criteria remain under Needs human.
- No criterion is `DISPUTED`; no simulator or hardware evidence is claimed.
