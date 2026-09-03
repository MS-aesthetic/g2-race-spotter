# Implementation plan — 2026-09-03 (bootstrap, hand-written; the planner will regenerate this)
Status: BUILDING
Current spec focus: specs/010-monorepo-bootstrap.md

This file is disposable. `ralph/loop.sh plan` regenerates it from `specs/`. Workers take the first unchecked task under `## Next`; `[HW]` tasks are for a human.

## Next (ordered; the worker takes the first unchecked task)
- [ ] T001 (owner: relay-backend-dev) (spec: 010 AC-1) Create the npm-workspaces monorepo skeleton: root package.json (workspaces; scripts test/typecheck/build/sync:agents/sync:agents:check), tsconfig.base.json (strict), vitest config, `.nvmrc` 22, `engines`, placeholder packages `packages/protocol`, `services/relay`, `apps/spotter` each with one passing smoke test. `npm install && npm test && npm run typecheck` green.
- [ ] T001b (owner: relay-backend-dev) (spec: 010 AC-1, AC-2, AC-6) Add eslint+prettier with a root `lint` script, `scripts/check-pins.mjs` (fails on range specifiers for the pinned packages), and `.github/workflows/ci.yml` running test/typecheck/lint/check-pins/sync:agents:check on Node 22.
- [ ] T002 (owner: g2-glasses-dev) (spec: 010 AC-3, R4) Scaffold `apps/glasses` from the official `minimal` template (`npx degit even-realities/evenhub-templates/minimal apps/glasses`), pin exact SDK/CLI/simulator versions, add `dev` and `dev:sim` (`vite --mode simulator`) scripts, render "Hello, driver" in a single text container, unit-test the startup page builder with a mocked bridge.
- [ ] T003 (owner: relay-backend-dev) (spec: 010 AC-5) Add `docs/ENVIRONMENT.md` template with every R5 field and `scripts/check-environment.mjs` that fails on `TBD`; CI runs it but allows `TBD` for `[HW]`-only fields until T101 is done (encode that allowance explicitly).
- [ ] T004 (owner: relay-backend-dev) (spec: 020 AC-1) `packages/protocol`: types, `PROTOCOL_VERSION`, constants table, runtime guards, fixtures (valid+invalid per message), guard tests.
- [ ] T005 (owner: relay-backend-dev) (spec: 020 AC-2) `reduce(state, event, ctx)` with tests for every event incl. no-op seq behaviour and `expire`.
- [ ] T006 (owner: relay-backend-dev) (spec: 020 AC-8) `RoomClient` with injected WebSocket, hello/ping/backoff/lastSeen reset/seq filter/offline intent queue; tests with a fake socket.
- [ ] T007 (owner: relay-backend-dev) (spec: 020 AC-3, AC-4, AC-9) `services/relay`: wrangler.jsonc (SQLite DO), Worker routes + CORS, `RaceRoom` with hibernation API, persistence, hello→state replay, validation; roundtrip + replay + validation tests against `wrangler dev`.
- [ ] T008 (owner: relay-backend-dev) (spec: 020 AC-5, AC-6, AC-7) PIN (first joiner sets), driver eviction after PIN check, rate limiter, alarm tick/silent-socket close, TTL re-pointing; eviction/auth/heartbeat tests.
- [ ] T009 (owner: relay-backend-dev) (spec: 020 R6) `scripts/fake-spotter.ts` with all scenarios and `--role driver` mode; smoke test against `wrangler dev`.

## Needs human [HW]
- [ ] T101 (owner: maxx) (spec: 010 AC-4, AC-5) Enable Developer Mode, sideload T002's app via `npx evenhub qr`, confirm "Hello, driver" on real glasses; fill `docs/ENVIRONMENT.md` (versions, `getDeviceInfo()` in simulator vs hardware, 28 px status-line check via `/font-measurement`).
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Create the Cloudflare Worker (`wrangler login`, `wrangler deploy`), set `DEBUG_KEY`, run `fake-spotter --scenario lanes` against `*.workers.dev`, save log to `qa/<date>/020-deploy.log`.

## Done this cycle
- (none yet)

## Notes / why
- Relay before glasses UI: every later task needs `fake-spotter` and a running room to test against.
- `[HW]` tasks are listed early so Maxx can do T101 in parallel with T004–T009.
