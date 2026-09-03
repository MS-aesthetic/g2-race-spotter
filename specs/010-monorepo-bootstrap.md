# 010 — Monorepo bootstrap and environment pinning

Status: ACTIVE
Depends on: 000
Design reference: docs/BUILD_PLAN.md §2, §7 Phase 0; docs/RESEARCH_NOTES.md §1, §7

## Purpose

A repo where every later task can run `npm test` / `npm run typecheck` in one command, the glasses app scaffold runs in the simulator **in image mode** under an automated harness, and the toolchain versions are pinned so the 0.0.x SDK and the fast-moving simulator cannot drift under us.

## Scope

In: workspace layout, shared TS config, lint/format, vitest, glasses scaffold from the `minimal` template, `dev` / `dev:sim` scripts, the simulator scenario harness skeleton (`scripts/sim-harness.ts`, `npm run sim:scenarios`), `docs/ENVIRONMENT.md`, `scripts/sync-agents.mjs` wired as `npm run sync:agents` and checked in CI.
Out: any feature code, relay, spotter UI, real scenarios (the harness only needs to prove the pipeline here; scenario assertions arrive with 030/050).

## Requirements

R1. MUST use npm workspaces with `apps/glasses`, `apps/spotter`, `services/relay`, `packages/protocol` (empty packages may be placeholders with a passing smoke test).
R2. MUST pin exact versions (no `^`, no `latest`) for `@evenrealities/even_hub_sdk`, `@evenrealities/evenhub-cli`, `@evenrealities/evenhub-simulator` (**0.9.5** — the version Maxx has verified; confirm with `npm view @evenrealities/evenhub-simulator version` at T002 and record what was actually pinned), `wrangler`, `vite`, `vitest`, `typescript`.
R3. MUST provide root scripts: `test`, `typecheck`, `lint`, `build`, `sync:agents`, `sync:agents:check`, `sim:scenarios`.
R4. `apps/glasses` MUST have `dev` (Vite on 0.0.0.0:5173) and `dev:sim` (`vite --mode simulator`) scripts. `--mode simulator` may change logging and the default relay URL only; it MUST NOT change rendering mode (image mode is the normal path in the simulator).
R5. `docs/ENVIRONMENT.md` MUST record: SDK, CLI, simulator, Node, wrangler versions; what `bridge.getDeviceInfo()` returns in the simulator; and — hardware fields, filled by a human — Even app version, glasses firmware, what `getDeviceInfo()` returns on hardware, whether one line of the baked font fits in a 28 px text container, and the gray4 nibble order confirmed on glasses.
R6. Node version MUST be enforced via `engines` and `.nvmrc`/`.node-version` (22).
R7. `scripts/sim-harness.ts` MUST launch the pinned simulator with `--automation-port`, wait for `/api/ping`, load the app, capture `/api/screenshot/glasses`, and write `qa/<date>/sim/report.json`; scenario and assertion plumbing per the `hud-e2e-testing` skill. When the simulator cannot be launched it MUST exit non-zero with the literal reason `sim-unavailable`.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a fresh clone with Node 22, when `npm ci && npm test && npm run typecheck && npm run lint` runs, then all exit 0 | CI workflow `.github/workflows/ci.yml` |
| AC-2 | Given the repo, when `npm run sync:agents:check` runs, then it exits 0 (generated agents/skills not stale) | CI |
| AC-3 | Given `npm run sim:scenarios -- --smoke`, when the harness launches the simulator and loads the scaffold app, then the glasses screenshot shows lit pixels in the text region where "Hello, driver" is drawn and `report.json` records the simulator and SDK versions | `[SIM]` `qa/<date>/sim/report.json`, `qa/<date>/sim/image/smoke-01.png` |
| AC-4 | Given Developer Mode and `npx evenhub qr`, when the Even app scans the QR, then "Hello, driver" renders on real G2 glasses | `[HW]` photo/log in `qa/<date>/` |
| AC-5 | Given `docs/ENVIRONMENT.md`, then every simulator/toolchain field in R5 is filled (no `TBD`); hardware fields may stay `TBD` until AC-4 and 030 AC-9/AC-10, 050 AC-6 are done | `scripts/check-environment.mjs` run in CI (hardware fields allowed `TBD` while the corresponding `[HW]` items are open) |
| AC-6 | Given `package.json` files, then no `@evenrealities/*`, `wrangler`, `vite`, `vitest`, `typescript` dependency uses a range specifier | `scripts/check-pins.mjs` run in CI |
| AC-7 | Given the harness with the simulator not installed or not launchable, when `npm run sim:scenarios` runs, then it exits non-zero and prints `sim-unavailable` (no partial report claiming success) | `scripts/test/sim-harness.test.ts` (mocks the launcher) |

## Decisions

- 2026-09-03 Use the official `minimal` template rather than hand-rolling — why: it already matches the SDK version conventions and simulator wiring.
- 2026-09-03 Treat AC-1 as an indivisible end-to-end gate — why: deferring lint or its CI command chain makes the criterion fail even when the workspace smoke tests pass.
- 2026-09-03 Simulator 0.9.x accepts the full 288×144 image and our 4-container page, so image mode is the normal simulator path and the harness is the primary functional gate; the simulator does not enforce on-device image limits, so hardware criteria stay `[HW]` — why: earlier notes (200×100 cap, 4-container cap) were from simulator ≤ 0.7 and are obsolete.
- 2026-09-03 Standardize repository text and Prettier on LF — why: the AC-1 CI gate runs on Ubuntu, where Git materializes normalized text as LF, so forcing CRLF makes a clean checkout fail formatting.
- 2026-09-03 Pin TypeScript 6.0.3 rather than 7.0.2 with the current lint stack — why: `typescript-eslint` 8.69.0 requires TypeScript below 6.1 for a resolvable fresh `npm ci`.
- 2026-09-03 Treat `@evenrealities/*` as a namespace-wide pin rule rather than a fixed package list — why: newly introduced SDK packages must not evade exact-version enforcement.
- 2026-09-03 Treat the startup-page unit test as a scaffold prerequisite, not AC-3 evidence — why: AC-3 specifically requires the committed simulator screenshot and report from `npm run sim:scenarios -- --smoke`.
- 2026-09-03 Treat AC-5 as a binary repository gate, not an intermediate hand-off — why: its named verifier must reject every non-hardware `TBD` and run in CI before a task citing AC-5 can be approved.
- 2026-09-03 Park simulator-dependent environment completion on an interactive Windows desktop — why: simulator 0.9.5 can answer its automation ping without creating the main window or exposing bridge activity, so the exact `getDeviceInfo()` value must not be inferred.
- 2026-09-03 Require AC-7's named verifier to exercise the process-facing CLI boundary and the harness-selected output root — why: internal result-only tests cannot detect missing literal stderr, a zero exit status, or a partial report written at the real output path.
- 2026-09-03 Require AC-7's no-partial-report check to search beneath the runtime-selected output root rather than a fixed date — why: a date-bound assertion can pass while a later run writes invalid evidence elsewhere in that root.

## Open questions

- Can the simulator run headless on a CI runner (Linux, no display)? If yes, `sim:scenarios` joins CI; if not, it stays a local gate whose report is committed.
