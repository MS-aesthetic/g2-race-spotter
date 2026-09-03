# Implementation plan — 2026-09-03T11:43:24-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Next (ordered; the worker takes the first unchecked task)
- [ ] T010a (owner: relay-backend-dev) (spec: 010 AC-1) Repair the blocked cross-platform lint gate by standardizing tracked text and Prettier on LF, change the protocol workspace test script to `vitest run`, and verify an LF Git-blob checkout with Prettier plus `npm ci && npm test && npm run typecheck && npm run lint` and `npm test -w packages/protocol`. Reviewer findings (verbatim):
  - [block] .prettierrc.json:2 — `endOfLine: "crlf"` is incompatible with the new Ubuntu CI checkout: tracked checked files contain LF and `.gitattributes` does not force CRLF — scenario: GitHub's Ubuntu checkout materializes `package.json` and the other normalized text blobs with LF → `npm run lint` reaches `prettier --check` → Prettier reformats them to CRLF and exits 1, so spec 010 AC-1's fresh-clone chain is not green — fix: standardize both Git and Prettier on LF (for example `* text=auto eol=lf` plus `endOfLine: "lf"`) or use a cross-platform Prettier EOL policy.
  - [nit] packages/protocol/package.json:8 — the focused workspace test script hard-codes only `test/smoke.test.ts` — scenario: T004 adds `guards.test.ts`, then `npm test -w packages/protocol` still passes without executing the protocol guards required by the reviewer procedure — fix: use `vitest run` so the workspace command discovers every protocol test.
- [ ] T010 (owner: relay-backend-dev) (spec: 010 AC-1) Fix the first T001 review block with exact-pinned ESLint/Prettier configuration, a root `lint` script, Node 22 CI running `npm ci && npm test && npm run typecheck && npm run lint`, and a package-level protocol `test` script; re-run the full chain plus `npm test -w packages/protocol` after T010a.
- [ ] T001 (owner: relay-backend-dev) (spec: 010 AC-1) Create the npm-workspaces monorepo skeleton with root build/test/typecheck/lint scripts, strict TypeScript project references, Vitest, Node 22 enforcement, and passing protocol/relay/spotter smoke tests; re-run the AC-1 chain after T010a.
- [ ] T001b (owner: relay-backend-dev) (spec: 010 AC-2) Add `npm run sync:agents:check` to the Node 22 CI workflow and verify both `npm run sync:agents` and `npm run sync:agents:check` leave generated agent files clean.
- [ ] T015 (owner: relay-backend-dev) (spec: 010 AC-6) Add `scripts/check-pins.mjs`, fixture-driven tests in `scripts/test/check-pins.test.ts`, and a CI step rejecting range specifiers for every dependency named by R2.
- [ ] T002 (owner: g2-glasses-dev) (spec: 010 AC-3) Scaffold `apps/glasses` from the official `minimal` template; pin SDK/CLI/Vite and simulator 0.9.5 exactly; add `dev` and `dev:sim` where simulator mode changes only logging/relay defaults; render “Hello, driver” in one text container; verify `apps/glasses/test/startup-page.test.ts`.
- [ ] T002b (owner: hud-qa) (spec: 010 AC-3/AC-7) Add `scripts/sim-harness.ts` and root `sim:scenarios`: launch the pinned simulator from `node_modules/.bin` with automation port 9898, poll `/api/ping`, load the app, capture `qa/<date>/sim/image/smoke-01.png`, assert lit text pixels, write versions to `report.json`, support `--smoke`, and verify mocked launch failure prints `sim-unavailable` without a partial report in `scripts/test/sim-harness.test.ts`.
- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke`; commit `qa/<date>/sim/` and simulator fields in `docs/ENVIRONMENT.md`; if the harness reports `sim-unavailable`, report `failed` with that literal reason so the planner parks it.
- [ ] T003 (owner: relay-backend-dev) (spec: 010 AC-5) Add `docs/ENVIRONMENT.md` with every R5 field plus `scripts/check-environment.mjs` and `scripts/test/check-environment.test.ts`; CI rejects missing/toolchain/simulator `TBD` fields while allowing hardware fields to remain `TBD` only while their `[HW]` tasks are open.
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Implement protocol v1 wire types, exported constants, guards, and one valid plus invalid fixture per message type; verify `packages/protocol/test/guards.test.ts` and the discovering workspace test script.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) Implement the pure total reducer with injected clock/id and all event, no-op, seq, and expiry semantics; verify `packages/protocol/test/reduce.test.ts`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) Implement the injected-WebSocket `RoomClient` with hello/ping/backoff, per-open seq reset, replay gating, `lastFrameAt`, and disconnected-intent coalescing; verify `packages/protocol/test/client.test.ts`.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) Build the Worker/RaceRoom baseline with SQLite DO hibernation, `/health`, gated debug, CORS/static fallthrough, hello replay, persistence, and full-state broadcast; verify `services/relay/test/roundtrip.test.ts` against `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) Preserve authoritative state/seq across reconnect and DO rehydration and re-point the empty-room TTL alarm; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) Enforce authenticated last-writer-wins driver eviction with `role_taken` then close 4409; verify `services/relay/test/eviction.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) Implement first-join PIN persistence and accepted-socket auth errors/close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) Implement alarm-tick silence detection, close 4408, and offline state broadcast using shared timings; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) Enforce frame-size, malformed/unknown-type, wrong-role, and URL-vs-hello validation semantics with the required keep-open/close behavior; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) Implement `scripts/fake-spotter.ts` with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`; deployed evidence remains T102.

## Needs simulator [SIM]
- (none parked; T002c remains a worker task until it reports `sim-unavailable`)

## Needs human [HW]
- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode, QR-sideload the glasses app, and save the required photo/log under `qa/<date>/`.
- [ ] T101c (owner: maxx) (spec: 010 AC-5 hardware fields) After T002/T003, fill Even app version, firmware, hardware `getDeviceInfo()`, and the 28 px status-line result in `docs/ENVIRONMENT.md`.
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Deploy the Worker, set `DEBUG_KEY`, run `lanes` with spotter and driver clients, and save `qa/<date>/020-deploy.log`.
- [ ] T104 (owner: maxx) (spec: 030 AC-8) Run real-glasses `lanes`, `gap-sweep`, `message-ack`, and `link-loss`; record PASS by AC in `qa/<date>/REPORT.md`.
- [ ] T105 (owner: maxx) (spec: 030 AC-9) Render the glyph sheet on real glasses and record visibility/fallback choices in `docs/ENVIRONMENT.md`.
- [ ] T106 (owner: maxx) (spec: 030 AC-10) Verify the hardware `wss://` upgrade against the whitelisted origin and record the result in `docs/ENVIRONMENT.md`.
- [ ] T107 (owner: maxx) (spec: 040 AC-6) Verify install/join/console and landscape targets on iOS Safari and Android Chrome; save `qa/<date>/040-*.png`.
- [ ] T108 (owner: maxx) (spec: 040 AC-7) Run two phones plus real glasses over LTE and record the ▲ latency result in `qa/<date>/REPORT.md`.
- [ ] T109 (owner: maxx) (spec: 050 AC-6) Send the gray4 bright-column test pattern and record nibble/stride confirmation in `docs/ENVIRONMENT.md`.
- [ ] T110 (owner: maxx) (spec: 050 AC-7) Run `gap-sweep` plus a 10-minute soak on real glasses; save `latency.csv` and AC result in `qa/<date>/REPORT.md`.
- [ ] T111 (owner: maxx) (spec: 050 AC-8) Open/cancel the exit dialogue and verify text fallback within three failed image sends in `qa/<date>/REPORT.md`.
- [ ] T112 (owner: maxx) (spec: 060 AC-5) Perform the five-minute iOS lock/unlock recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T113 (owner: maxx) (spec: 060 AC-6) Perform the five-minute Android lock/foreground recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T114 (owner: maxx) (spec: 060 AC-7) Redeploy the relay mid-session and record automatic recovery in `qa/<date>/REPORT.md`.
- [ ] T115 (owner: maxx) (spec: 060 AC-8) Save a session `wrangler tail` showing parseable structured lines and no message bodies to `qa/<date>/tail.log`.
- [ ] T116 (owner: maxx) (spec: 070 AC-4) Follow `docs/RACE_DAY.md` before grid and record real `lanes` plus `message-ack` PASS in `qa/<date>/REPORT.md`.
- [ ] T117 (owner: maxx) (spec: 070 AC-5) Archive full-session logs, latency table, defects, and open-question disposition under `qa/<date>/` with human sign-off.

## Done this cycle
- (none; T010 was review-blocked at commit 6e4c2d9)

## Notes / why
- AC audit 010: AC-1/AC-2/AC-5/AC-6/AC-7 unmet; AC-3 `[SIM]` open; AC-4 `[HW]` open. No named AC is met: local smoke/typecheck/lint passes do not overcome the reproduced Ubuntu LF failure or missing verifiers.
- AC audit 020: AC-1–AC-9 unmet (protocol and relay remain placeholders); AC-10 `[HW]` open.
- AC audit 030: AC-1–AC-6 unmet (`apps/glasses` is absent); AC-7 `[SIM]` open; AC-8–AC-10 `[HW]` open.
- AC audit 040: AC-1–AC-5 unmet (spotter is a placeholder); AC-6–AC-7 `[HW]` open.
- AC audit 050: AC-1–AC-5 unmet; AC-5b `[SIM]` open; AC-6–AC-8 `[HW]` open.
- AC audit 060: AC-1–AC-4 unmet; AC-5–AC-8 `[HW]` open.
- AC audit 070: AC-1–AC-3 unmet; AC-4–AC-5 `[HW]` open. No criterion is DISPUTED.
- T010a stays first because a review block must be cleared before new scope; LF is the repository-wide policy because CI checks Linux Git blobs, and the discovering protocol test script prevents later AC tests from being silently skipped.
- T001b and pin enforcement precede the glasses scaffold so every new generated artifact and pinned dependency lands behind its CI gate; protocol types/reducer/client then precede all relay and UI consumers.
- Text-mode and image-mode simulator evidence will be scheduled with the 030/050 implementation slices; `[SIM]` never substitutes for the listed `[HW]` evidence.
