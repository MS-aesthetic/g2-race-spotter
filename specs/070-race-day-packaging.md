# 070 — Race-day packaging and operations

Status: ACTIVE
Depends on: 060
Design reference: docs/BUILD_PLAN.md §7 Phase 6; skills `cloudflare-relay-deploy`, `hud-e2e-testing`

## Purpose

Everything needed to use the system at a real race without a laptop: a stable relay origin, a packaged glasses app, an installable spotter app, and a checklist that prevents the avoidable failures.

## Scope

In: custom domain (or stable `workers.dev`), final `app.json` whitelist, `.ehpk` build, sideload instructions, `docs/RACE_DAY.md`, post-session log collection.
Out: Even Hub store submission (tracked as a follow-up).

## Requirements

R1. `apps/glasses/app.json` MUST whitelist exactly the deployed origin(s) confirmed in 030 AC-10 and declare only the `network` permission.
R2. `npm run pack -w apps/glasses` MUST produce `dist/g2-race-spotter.ehpk` via `evenhub pack`.
R3. `docs/RACE_DAY.md` MUST contain the pre-grid checklist from the `hud-e2e-testing` skill, phone settings, room/PIN hand-off, and the fallback plan.
R4. A `scripts/latency-report.ts` MUST turn a glasses console log into `latency.csv` and a p50/p95 table per call type.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a sample console log fixture, when `latency-report` runs, then it outputs the expected CSV and p50/p95 for `image`, `textUpgrade`, `rebuild`, `startup` | `scripts/test/latency-report.test.ts` |
| AC-2 | Given `app.json`, then `permissions` contains only `network` with HTTPS origins and no wildcards, and `edition` is `"202601"` | `apps/glasses/test/app-json.test.ts` |
| AC-3 | Given `npm run pack -w apps/glasses`, then an `.ehpk` file exists and is git-ignored | `scripts/test/pack.test.ts` (runs the CLI in CI if available, else skips with a warning) |
| AC-4 | Given the checklist in `docs/RACE_DAY.md` followed before a session, then `lanes` + `message-ack` pass with the real spotter before grid | `[HW]` `qa/<date>/REPORT.md` |
| AC-5 | Given a full session, then logs, latency table, and defects are recorded in `qa/<date>/` and open questions in the specs are answered or carried forward | `[HW]` human sign-off |

## Decisions

- 2026-09-03 Sideload via Developer Mode for v1; store submission later — why: private use, fastest iteration.

- 2026-09-30 (Maxx) **Hosted deploy + QR hand-off.** Maxx: "a deployable app not requiring a PC running locally (use a service like Cloudflare)." The relay Worker now serves the glasses app too: `npm run build:site` (`scripts/build-site.mjs`) builds the spotter into `site/` and the glasses app (Vite `base: '/glasses/'`, `app.json` copied into its dist) into `site/glasses/`; `services/relay/wrangler.jsonc` serves `../../site`; `npm run deploy` = typecheck + `build:site` + `wrangler deploy`. `not_found_handling` is `"none"` and the Worker does the spotter's single-page fallback itself for misses outside `/glasses`, so `/glasses/<missing>` is a 404, never the spotter shell. `evenhub qr` encodes a plain URL and the Even app's Developer Mode loads whatever URL a scanned QR carries, so the driver sideloads from the spotter's driver setup screen (spec 040) with no PC; the glasses app joins via `seedFromSearch` and resolves `wss://` from its own https origin. This is the v1 race-day path; the `.ehpk` (R2, AC-3) remains for store submission. Verifiers: `scripts/test/build-site.test.ts`, `services/relay/test/site.test.ts` (T058).

## Open questions

- Even Hub store submission requirements (review, listing) once the portal accepts submissions.
