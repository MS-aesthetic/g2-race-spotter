# 010 — Monorepo bootstrap and environment pinning

Status: ACTIVE
Depends on: 000
Design reference: docs/BUILD_PLAN.md §2, §7 Phase 0; docs/RESEARCH_NOTES.md §1

## Purpose

A repo where every later task can run `npm test` / `npm run typecheck` in one command, the glasses app scaffold runs in the simulator, and the toolchain versions are pinned so the 0.0.x SDK cannot drift under us.

## Scope

In: workspace layout, shared TS config, lint/format, vitest, glasses scaffold from the `minimal` template, `dev` / `dev:sim` scripts, `docs/ENVIRONMENT.md`, `scripts/sync-agents.mjs` wired as `npm run sync:agents` and checked in CI.
Out: any feature code, relay, spotter UI.

## Requirements

R1. MUST use npm workspaces with `apps/glasses`, `apps/spotter`, `services/relay`, `packages/protocol` (empty packages may be placeholders with a passing smoke test).
R2. MUST pin exact versions (no `^`) for `@evenrealities/even_hub_sdk`, `@evenrealities/evenhub-cli`, `@evenrealities/evenhub-simulator`, `wrangler`, `vite`, `vitest`, `typescript`.
R3. MUST provide root scripts: `test`, `typecheck`, `lint`, `build`, `sync:agents`, `sync:agents:check`.
R4. `apps/glasses` MUST have `dev` (Vite on 0.0.0.0:5173) and `dev:sim` (`vite --mode simulator`) scripts.
R5. `docs/ENVIRONMENT.md` MUST record: SDK, CLI, simulator, Node, wrangler versions; Even app version and glasses firmware seen on hardware; what `bridge.getDeviceInfo()` returns in the simulator vs on hardware; whether one line of the baked font fits in a 28 px text container.
R6. Node version MUST be enforced via `engines` and `.nvmrc`/`.node-version` (22).

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a fresh clone with Node 22, when `npm ci && npm test && npm run typecheck && npm run lint` runs, then all exit 0 | CI workflow `.github/workflows/ci.yml` |
| AC-2 | Given the repo, when `npm run sync:agents:check` runs, then it exits 0 (generated agents/skills not stale) | CI |
| AC-3 | Given `npm run dev:sim -w apps/glasses`, when the simulator loads the app, then "Hello, driver" text is visible | `[HW]` simulator screenshot in `qa/<date>/010-sim.png` (simulator counts as hardware-adjacent: needs a desktop session) |
| AC-4 | Given Developer Mode and `npx evenhub qr`, when the Even app scans the QR, then "Hello, driver" renders on real G2 glasses | `[HW]` photo/log in `qa/<date>/` |
| AC-5 | Given `docs/ENVIRONMENT.md`, then every field in R5 is filled (no `TBD`) | `scripts/check-environment.mjs` run in CI |
| AC-6 | Given `package.json` files, then no `@evenrealities/*`, `wrangler`, `vite`, `vitest`, `typescript` dependency uses a range specifier | `scripts/check-pins.mjs` run in CI |

## Decisions

- 2026-09-03 Use the official `minimal` template rather than hand-rolling — why: it already matches the SDK version conventions and simulator wiring.

## Open questions

- None.
