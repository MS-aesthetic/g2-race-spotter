# Ralph progress log

Append-only history of loop iterations. The planner keeps "Blocked on human" current; Maxx clears items by doing them and telling the loop (or by editing the plan).

## Blocked on human
- T101b — QR sideload photo/log evidence (spec 010 AC-4); simulator evidence remains separate under T002c (`[SIM]`)
- T102 — first Cloudflare deploy + `DEBUG_KEY` evidence (spec 020 AC-10)
- T104–T106 — real-glasses scenarios, glyph sheet, and WebSocket whitelist evidence (spec 030 AC-8–AC-10); T103 (030 AC-7) is now a `[SIM]` worker task
- T107–T108 — mobile PWA installation/layout and LTE end-to-end evidence (spec 040 AC-6/AC-7)
- T109–T111 — gray4 packing, image soak/latency, and exit-dialogue fallback evidence (spec 050 AC-6–AC-8)
- T112–T115 — iOS/Android lifecycle, redeploy recovery, and safe structured-tail evidence (spec 060 AC-5–AC-8)
- T116–T117 — pre-grid checklist and signed full-session evidence (spec 070 AC-4/AC-5)

## Codex pre-flight
- 2026-09-03 — Bootstrap re-plan confirmed the official `everything-evenhub` skills are available in Codex; cleared the stale T002 environment blocker.
- 2026-09-03 — Verified live on this account that `gpt-5.6-terra` accepts `high` and `gpt-5.6-sol` accepts both `high` and `xhigh`.
- 2026-09-03 — Codex CLI 0.151.0-alpha.7.2 exposes `--ask-for-approval` only before the `exec` subcommand; all other assumed `codex exec` flags match this install.
- 2026-09-03 — A live iteration showed Windows `workspace-write` blocks npm network/cache access and Git index writes under approval `never`. Kept `workspace-write`, enabled its network setting, redirected npm cache to the writable temp directory, and switched to Codex automatic approval so guarded Git writes can complete.

## Simulator update (2026-09-03)
- Simulator 0.9.5 renders the full 288×144 image; the old 200×100 / 4-container caps were ≤ 0.7. Image mode is the normal simulator path; `[SIM]` evidence class added (constitution §12/§19, specs 010/030/050, skills `g2-hud-display` + `hud-e2e-testing`, roles); hardware criteria unchanged.

## Process decisions
- 2026-09-03 — Human authorized parallel subagent streams for independent tasks. Each stream uses an isolated Git worktree and an explicit lease (base, dependency, write scope, exclusive locks); one worker still owns one task/commit, exact commit ranges are reviewed, approved commits integrate serially, the planner remains the sole plan/spec/progress writer, and root gates run after each integration. The existing Ralph shell loop remains serial.

## Iterations

| # | date | task | owner | outcome | review | commit | lesson |
|---|---|---|---|---|---|---|---|
| 0 | 2026-09-03 | bootstrap plan | (hand-written) | — | — | — | Specs and loop scaffolding created; no application code yet |
| 1 | 2026-09-03 | T001 | relay-backend-dev | review-blocked | block | cc13020 | AC-1 is an end-to-end gate: lint, its CI command chain, and the named workspace test must exist before handoff. |
| 2 | 2026-09-03 | T010 | relay-backend-dev | review-blocked | block | 6e4c2d9 | Cross-platform lint must be reproduced from LF Git blobs; focused workspace tests must discover future criterion tests. |
| 3 | 2026-09-03 | T010a | relay-backend-dev | done | approve | 7a4a114 | LF normalization and a discovering workspace test close the cross-platform AC-1 repair chain. |
| 4 | 2026-09-03 | T001b | relay-backend-dev | done | approve | 31a0615 | CI now rejects stale generated agent and skill outputs after the standard verification gate. |
| 5 | 2026-09-03 | T015 | relay-backend-dev | review-blocked | block | 62ea204 | AC-6's `@evenrealities/*` requirement is namespace-wide; a fixed allowlist leaves future SDK packages unguarded. |
| 6 | 2026-09-03 | T015a | relay-backend-dev | done | approve | 4cc5ffb | A namespace predicate plus an unknown scoped-package fixture closes the future `@evenrealities/*` pinning gap. |
| 7 | 2026-09-03 | T002 | g2-glasses-dev | failed | n/a | - | Mandatory official SDK plugin skills were unavailable, so the worker correctly stopped before undocumented bridge work; install the plugin before retrying. |
| 8 | 2026-09-03 | T002 | g2-glasses-dev | done | approve with nits | f0adb01 | The pinned startup scaffold and one-call guard pass; AC-3 remains separate `[SIM]` evidence, and the README greeting nit affects no criterion. |
| 9 | 2026-09-03 | T003 | relay-backend-dev | nothing-to-do | n/a | - | No worker hand-off, review, or post-plan commit exists; retain T003 first for its one permitted retry before splitting. |
| 10 | 2026-09-03 | T003 | relay-backend-dev | nothing-to-do | n/a | - | A second absent hand-off exhausts the retry; split environment schema/testing from post-simulator repository and CI enforcement. |
| 11 | 2026-09-03 | T003a | relay-backend-dev | review-blocked | block | 6a2292a | An AC-5 hand-off cannot allow a non-hardware `TBD` or omit its named verifier from CI; repair both before closing the task. |
| 12 | 2026-09-03 | T003c | relay-backend-dev | nothing-to-do | n/a | - | No worker hand-off or review exists; retain the blocked repair first for its one permitted retry before splitting. |
| 13 | 2026-09-03 | T003c | relay-backend-dev | failed | n/a | - | The automation server alone is insufficient: without an interactive simulator main window, the exact `bridge.getDeviceInfo()` value cannot be observed; park the repair under Needs simulator. |
| 14 | 2026-09-03 | T002b | hud-qa | review-blocked | block | 66595a1 | AC-7's named verifier must exercise the CLI boundary and actual output root; internal-result tests cannot prove stderr, non-zero exit, or absence of a partial report. |
| 15 | 2026-09-03 | T002e | hud-qa | review-blocked | block | 6f3b4b3 | A fixed-date no-report assertion cannot prove the harness leaves no partial report beneath its selected output root on later dates. |
| 16 | 2026-09-03 | T002f | hud-qa | done | approve | 1c56c26 | Recursive search beneath the injected output root now proves launcher and ping failures cannot leave a partial report on any run date. |
| 17 | 2026-09-03 | T002d | hud-qa | review-blocked | block | 3c22234 | Device info can precede startup rendering, and broad `sim-unavailable` mapping hides product assertion or evidence failures. |
| 18 | 2026-09-03 | T002g | hud-qa | review-blocked | block | 3b683f1 | After automation readiness, missing device info is an evidence failure; the required lint gate must also pass before hand-off. |
| 19 | 2026-09-03 | T002h | hud-qa | done | approve | 2ef2f63 | Post-readiness device-info absence and dark screenshots now fail as evidence, closing the blocked repair ancestry while preserving the real `[SIM]` gate. |
| 20 | 2026-09-03 | T004 | relay-backend-dev | done | approve | 019d2e4 | Protocol v1 types, constants, guards, and fixture pairs are centralized with zero runtime dependencies and pass the integrated root gates. |
| 21 | 2026-09-03 | T005 | relay-backend-dev | review-blocked | block | a1bb73e | Reducer semantics and tests pass, but the unused `Lane` import fails the mandatory root lint gate; quarantine the candidate and repair only that finding before integration. |
| 22 | 2026-09-03 | T005a | relay-backend-dev | done | approve | 42d7d5b | Exact combined-range review approved the repaired reducer; T005 (`35e74dc`) and T005a integrated serially with protocol 29/root 47 tests, typecheck, and lint green on Node 22. |
| 23 | 2026-09-03 | T004a | relay-backend-dev | review-blocked | block | 20f5f7c | A source-entry manifest cannot expose an export graph containing nonexistent `./reduce.js` under `noEmit`; a plain Node 22 workspace-consumer import must be tested because Vitest masks this failure. |
| 24 | 2026-09-03 | T004b | relay-backend-dev | review-blocked | block | 62a33ca | `allowImportingTsExtensions` is consumer-program scoped; plain Node loading and Wrangler bundling do not prove a real TypeScript app consumer can compile the source export graph. |
