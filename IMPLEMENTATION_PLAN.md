# Implementation plan — 2026-09-03T09:31:41-04:00
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

## Next (ordered; the worker takes the first unchecked task)
- [ ] T010 (owner: relay-backend-dev) (spec: 010 AC-1) Fix the first T001 review block with exact-pinned ESLint/Prettier configuration, a root `lint` script, Node 22 CI running `npm ci && npm test && npm run typecheck && npm run lint`, and a package-level protocol `test` script; verify that full chain plus `npm test -w packages/protocol`. Reviewer findings (verbatim):
  - [block] package.json:13 — Spec 010 AC-1 is not met because the required root `lint` script is absent — scenario: fresh clone on Node 22 → `npm ci && npm test && npm run typecheck` pass, then `npm run lint` exits 1 with `npm error Missing script: "lint"` — fix: add the lint tooling/configuration and root `lint` script before claiming AC-1.
  - [block] .github/workflows/ci.yml:1 — AC-1's named verification does not exist, so no CI job asserts the required fresh-clone command chain — scenario: a commit that breaks install, test, typecheck, or lint can merge without the specified verification running — fix: add the Node 22 CI workflow that runs the exact AC-1 chain.
  - [block] packages/protocol/package.json:6 — The protocol review's required workspace test command cannot run because this package has no `test` script — scenario: `npm test -w packages/protocol` exits 1 with `npm error Missing script: "test"`, so protocol-only backpressure is unavailable — fix: add a package-level Vitest `test` script that runs `test/smoke.test.ts`.
- [ ] T001 (owner: relay-backend-dev) (spec: 010 AC-1) Create the npm-workspaces monorepo skeleton with root build/test/typecheck/lint scripts, strict TypeScript project references, Vitest, Node 22 enforcement, and passing protocol/relay/spotter smoke tests; re-run the AC-1 chain after T010.
- [ ] T001b (owner: relay-backend-dev) (spec: 010 AC-2) Add `npm run sync:agents:check` to the Node 22 CI workflow and verify both `npm run sync:agents` and `npm run sync:agents:check` leave the generated agent files clean.
- [ ] T015 (owner: relay-backend-dev) (spec: 010 AC-6) Add `scripts/check-pins.mjs`, fixture-driven tests in `scripts/test/check-pins.test.ts`, and a CI step that rejects range specifiers for every dependency named by R2.
- [ ] T002 (owner: g2-glasses-dev) (spec: 010 AC-3) Scaffold `apps/glasses` from the official `minimal` template, pin SDK/CLI/simulator/Vite exactly, add `dev` and `dev:sim`, render “Hello, driver” in one text container, and cover the startup page builder in `apps/glasses/test/startup-page.test.ts`; simulator evidence remains T101a.
- [ ] T003 (owner: relay-backend-dev) (spec: 010 AC-5) Add `docs/ENVIRONMENT.md` with every R5 field plus `scripts/check-environment.mjs` and `scripts/test/check-environment.test.ts`; strict mode rejects any `TBD`, while CI may explicitly allow only hardware fields until T101b/T101c supplies them.
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) Implement protocol v1 wire types/constants/guards and one valid plus invalid fixture per message type; verify `packages/protocol/test/guards.test.ts`.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) Implement the pure total reducer with injected clock/id and every event/no-op/seq rule; verify `packages/protocol/test/reduce.test.ts`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) Implement the shared injected-WebSocket `RoomClient`, including hello/ping/backoff, per-open seq reset, replay gating, and offline intent coalescing; verify `packages/protocol/test/client.test.ts`.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3) Build the Worker/RaceRoom baseline with SQLite DO hibernation, `/health`, gated debug, CORS/static fallthrough, hello replay, persistence, and full-state broadcast; verify `services/relay/test/roundtrip.test.ts` against `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-4) Preserve authoritative state/seq across disconnect, reconnect, and DO rehydration and re-point the empty-room TTL alarm; verify `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) Enforce authenticated last-writer-wins driver eviction with `role_taken` then close 4409; verify `services/relay/test/eviction.test.ts`.
- [ ] T011 (owner: relay-backend-dev) (spec: 020 AC-6) Implement first-join PIN persistence and accepted-socket auth errors/close 4401; verify `services/relay/test/auth.test.ts`.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) Implement alarm-tick peer silence detection, close 4408, and offline state broadcast using protocol timings; verify `services/relay/test/heartbeat.test.ts`.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9) Enforce frame-size, malformed/unknown-type, wrong-role, and URL-vs-hello validation semantics without closing sockets that must stay open; verify `services/relay/test/validation.test.ts`.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10) Implement `scripts/fake-spotter.ts` with every R6 scenario and `--role driver`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local `wrangler dev`, leaving deployment evidence to T102.

## Needs human [HW]
- [ ] T101a (owner: maxx) (spec: 010 AC-3) After T002, run `dev:sim`, confirm “Hello, driver”, and save `qa/<date>/010-sim.png`.
- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode, QR-sideload the glasses app, and save the required photo/log under `qa/<date>/`.
- [ ] T101c (owner: maxx) (spec: 010 AC-5) After T002/T003, fill every hardware/simulator R5 value in `docs/ENVIRONMENT.md` so strict `check-environment` has no `TBD`.
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Deploy the Worker, set `DEBUG_KEY`, run `lanes` with spotter and driver clients, and save `qa/<date>/020-deploy.log`.
- [ ] T103 (owner: maxx) (spec: 030 AC-7) Run simulator `lanes` and `gap-sweep`; save `qa/<date>/030-*.png`.
- [ ] T104 (owner: maxx) (spec: 030 AC-8) Run real-glasses `lanes`, `gap-sweep`, `message-ack`, and `link-loss`; record PASS by AC in `qa/<date>/REPORT.md`.
- [ ] T105 (owner: maxx) (spec: 030 AC-9) Render the full glyph sheet on real glasses and record visibility/fallback choices in `docs/ENVIRONMENT.md`.
- [ ] T106 (owner: maxx) (spec: 030 AC-10) Verify the hardware `wss://` upgrade against the whitelisted origin and record the result in `docs/ENVIRONMENT.md`.
- [ ] T107 (owner: maxx) (spec: 040 AC-6) Verify install/join/console and landscape targets on iOS Safari and Android Chrome; save `qa/<date>/040-*.png`.
- [ ] T108 (owner: maxx) (spec: 040 AC-7) Run two phones plus real glasses over LTE and record the ▲ latency result in `qa/<date>/REPORT.md`.
- [ ] T109 (owner: maxx) (spec: 050 AC-6) Send the gray4 bright-column test pattern and record nibble/stride confirmation in `docs/ENVIRONMENT.md`.
- [ ] T110 (owner: maxx) (spec: 050 AC-7) Run `gap-sweep` plus a 10-minute soak on real glasses; save `latency.csv` and AC result in `qa/<date>/REPORT.md`.
- [ ] T111 (owner: maxx) (spec: 050 AC-8) Open/cancel the exit dialogue and verify text fallback within three failed image sends in `qa/<date>/REPORT.md`.
- [ ] T112 (owner: maxx) (spec: 060 AC-5) Perform the five-minute iOS lock/unlock recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T113 (owner: maxx) (spec: 060 AC-6) Perform the five-minute Android lock/foreground recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T114 (owner: maxx) (spec: 060 AC-7) Redeploy the relay mid-session and record automatic recovery in `qa/<date>/REPORT.md`.
- [ ] T115 (owner: maxx) (spec: 060 AC-8) Capture `wrangler tail` for a session and save the structured/no-message-body evidence to `qa/<date>/tail.log`.
- [ ] T116 (owner: maxx) (spec: 070 AC-4) Follow `docs/RACE_DAY.md` before grid and record real `lanes` plus `message-ack` PASS in `qa/<date>/REPORT.md`.
- [ ] T117 (owner: maxx) (spec: 070 AC-5) Archive full-session logs, latency table, defects, and open-question disposition under `qa/<date>/` with human sign-off.

## Done this cycle
- (none; T001 was review-blocked at commit cc13020)

## Notes / why
- AC audit 010: AC-1/2/5/6 unmet; AC-3/4 `[HW]`. The passing smoke suite is useful scaffolding but is not a named AC verification.
- AC audit 020: AC-1–9 unmet (protocol/relay are placeholders); AC-10 `[HW]`.
- AC audit 030: AC-1–6 unmet (`apps/glasses` absent); AC-7–10 `[HW]`.
- AC audit 040: AC-1–5 unmet (spotter is a placeholder); AC-6/7 `[HW]`.
- AC audit 050: AC-1–5 unmet; AC-6–8 `[HW]`.
- AC audit 060: AC-1–4 unmet; AC-5–8 `[HW]`.
- AC audit 070: AC-1–3 unmet; AC-4/5 `[HW]`. No criterion is DISPUTED.
- T010 stays first because a review block must be cleared before new scope; T001 remains unchecked directly beneath it until the fix is approved.
- Protocol types/reducer/client precede the relay because every room path consumes the shared schema and state semantics; glasses/spotter feature tasks will be pulled forward after the current dependency slice.
