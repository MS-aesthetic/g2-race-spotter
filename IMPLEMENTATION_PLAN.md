# Implementation plan — 2026-09-03T22:22:29-04:00
Status: BUILDING
Current spec focus: specs/020-protocol-and-relay.md

## Stream leases and integration queue (interactive coordinator only)

| lease | task | status / exact base | dependencies, write scope, and locks | review / integration gate |
|---|---|---|---|---|
| L007R | T007c | active repair from `01e596b` atop quarantined T007a; integrated base remains `a380d6f` | T007a candidate only; write only root `.prettierignore`, `services/relay/src/index.ts`, generated `services/relay/src/worker-configuration.d.ts`, new `services/relay/src/env.d.ts`, `services/relay/tsconfig.json`, `services/relay/wrangler.jsonc`, `services/relay/test/routes.test.ts`, and `services/relay/test/roundtrip.test.ts`; lock `relay-http` | fresh `relay-backend-dev`; combined exact `a380d6f..HEAD` review by `protocol-keeper`; integrate T007a + T007c only if approved, then run both live relay tests, `wrangler types src/worker-configuration.d.ts --check`, and every Node 22 root gate |
| L005R2 | T006/T006a/T006b | third review block; quarantined `ae5f448..e588729` | frozen: `packages/protocol/src/client.ts`, `packages/protocol/src/index.ts`, `packages/protocol/test/client.test.ts`; lock `protocol-client` | no integration and no automatic fourth repair lease; resume only after explicit human direction on the non-hardware review escalation below |

## Next (ordered; the serial runner takes the first unchecked task)

- [ ] T007c (owner: relay-backend-dev) (spec: 020 AC-3/AC-10; requirement R5) [lease L007R; stream: relay-http; lock: relay-http; base: `01e596b`] Repair the quarantined T007a candidate without changing protocol or broader room semantics. Reviewer findings, verbatim: “public caller can forge `X-G2RS-Internal-Debug: 1` on `/room` upgrade and `RaceRoom` returns state without `DEBUG_KEY`; strip caller header on public forwards or use non-forgeable dispatch, inject only after public key check, regression.” “generated `worker-configuration.d.ts` manually appends `DEBUG_KEY` and `wrangler types ... --check` says stale; keep generated file exact and put secret augmentation in separate included `.d.ts`, check generation.” “roundtrip/routes tests overwrite then delete real `apps/spotter/dist/index.html`; use per-test temp assets/config or preserve/restore contents, regression.” Add the public-header forgery and real-asset-preservation regressions. Wrangler 4.68.0 generates `worker-configuration.d.ts` formatting that passes `wrangler types ... --check` but fails Prettier; keep that generated file exact and add only `services/relay/src/worker-configuration.d.ts` to root `.prettierignore` (no broader ignore). Run both live tests plus every root gate and commit one repair.
- [ ] T007a (owner: relay-backend-dev) (spec: 020 AC-10; requirement R5) [blocked ancestor; candidate `01e596b` remains quarantined until T007c's combined review] Complete `/health`, debug-key-gated `/room/:id/debug`, static-asset fallthrough, and CORS on every HTTP response; no committed app asset or app edit is permitted.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) [stream: relay-room; lock: relay-room; depends: T007a/T007c integrated] Preserve state and sequence across reconnect and Durable Object rehydration, and repoint the empty-room alarm to room TTL; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) [stream: relay-room; lock: relay-room; depends: T008 integrated] Implement first-join PIN persistence, open-room `null` PIN semantics, and accepted-socket auth error followed by close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) [stream: relay-room; lock: relay-room; depends: T011 integrated] Enforce PIN-checked, last-writer-wins driver eviction by sending `role_taken`, closing the previous driver with 4409, and accepting the new driver; verify `services/relay/test/eviction.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) [stream: relay-room; lock: relay-room; depends: T009 integrated] Implement shared-timing alarm ticks, silent-socket close 4408, peer-offline reduction, and broadcast; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) [stream: relay-room; lock: relay-room; depends: T012 integrated] Enforce frame-size, malformed, unknown-type, wrong-role, version, and URL-versus-hello semantics with every required ignore/keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) [stream: tooling; lock: fake-spotter; depends: T008 and T009 integrated] Implement every R6 scenario and `--role driver` in `scripts/fake-spotter.ts`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed proof remains T102.

## Needs simulator [SIM]

- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
- [ ] T003c (owner: relay-backend-dev) (spec: 010 AC-5) After T002c records the exact simulator `bridge.getDeviceInfo()` value, remove every non-hardware `TBD` allowance, make the valid fixture/test reject non-hardware `TBD`, add the root environment check to CI, and validate `engines.node` permits only major 22; verify `scripts/test/check-environment.test.ts`, the repository check, and full AC-1 gates.

## Needs human — review escalation (not [HW] evidence)

- [ ] T006/T006a/T006b (owner: maxx) (spec: 020 AC-8) [NON-HARDWARE REVIEW ESCALATION] Decide whether to authorize a fourth, narrowly scoped repair of quarantined candidate `ae5f448..e588729`. Three exact-range reviews blocked the chain. Remaining findings: `reconnectAttempt` resets on socket `open` before the first valid replay, so repeated open-then-close-before-state cycles never increase toward the capped delay; reset only after the first valid replay and prove increasing delays. The jitter formula can schedule 250 ms when the normative bounds are 500–8000 ms; clamp both bounds and test `random: () => 0`. This item is a code-review escalation only and does not satisfy or represent any `[HW]` criterion.

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

- [x] T007 (owner: relay-backend-dev) (spec: 020 AC-3) Integrated the approved hibernating relay roundtrip as `794fd17`; live Wrangler coverage proves lane state reaches the driver within 500 ms.
- [x] T007b (owner: relay-backend-dev) (spec: 020 AC-3) Integrated the approved ready-state and URL-validation repair as `a380d6f`; 52 tests and every Node 22 root gate pass.
- [x] T004a/T004b/T004c (owner: relay-backend-dev) (spec: 020 AC-1) Repaired the protocol package export and consumer compile chain (integrated commits `087d31b`, `3ba292f`, `ae5f448`; exact combined-range review approved).
- [x] T005/T005a (owner: relay-backend-dev) (spec: 020 AC-2) Implemented, repaired, and approved the pure room-state reducer stack (commits `35e74dc`, `42d7d5b`).
- [x] T002h (owner: hud-qa) (spec: 010 AC-3) Hardened simulator evidence classification without claiming `[SIM]` success (commit `2ef2f63`; review `approve`).
- [x] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Centralized protocol v1 types/constants/guards and fixtures (commit `019d2e4`; review `approve`).

## Notes / why

- T007a remains quarantined after review `block`: the candidate exposes a forgeable internal debug path, drifts the generated Worker bindings, and mutates real spotter build output during tests; T007c repairs those findings on top so a reviewer can inspect the combined range.
- The first T007a review produced no verdict, so it did not count as a block; iteration 31 records the fresh protocol-keeper block and retains the original task beneath its repair.
- T014 is not leased before T008/T009 because its required live-relay scenarios depend on replay and driver eviction.
- T006 remains frozen after three blocked reviews; user approval is required only to authorize another non-hardware client repair, not for T007c.
- AC audit 010: AC-1/AC-2/AC-6/AC-7 met; AC-3 and AC-5 parked under Needs simulator; AC-4 under Needs human [HW].
- AC audit 020: AC-1, AC-2, and AC-3 met; AC-4–AC-9 remain unmet except quarantined AC-8; AC-10 remains [HW] with local prerequisites T007a/T007c and T014.
- AC audits 030–070 remain unchanged: automated criteria are unmet, `[SIM]` evidence is absent, and every `[HW]` criterion remains under Needs human [HW].
- No criterion is `DISPUTED`; `qa/` remains absent, so no simulator or hardware evidence is claimed.
