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

## Audit (2026-09-03, Fable 5.1 as final auditor/QA)
- Re-ran the root gates on the local machine: typecheck, 59/59 tests, lint (2 generated-d.ts warnings), pins, sync, environment — HANDOFF claims hold at `ee74cd7`.
- Relay (`race-room.ts`) latent defects found by an Opus `protocol-keeper` pass: alarm re-armed on every frame (silent-peer detection could never fire while anyone pinged) and no `pong` reply (a quiet healthy room would trip the driver's NO LINK). Added as T016 ahead of T011; traps for T011/T009/T012/T013 written into the task lines; rate limiting (R4) added to T013.
- Quarantined `RoomClient` (`e588729`) independently 4th-reviewed: `block` on exactly the two known 3-line findings; AC-8 has a real test; recommendation is one targeted repair (T006c) — awaiting Maxx's explicit reversal, nothing leased.
- Process: 34 iterations, 12 chains integrated, 17 blocks (8 avoidable by a pre-hand-off checklist, 9 genuine reviewer catches). `PROMPT_build.md` §1.5 self-review, `PROMPT_review.md` §1a boundary check, and planner task-slicing rules added; skill/spec clarifications for `pong`, self-arming alarm, `lastFrameAt === undefined`, `onError`.

## Decision (2026-09-03)
- Maxx: "yes on the fix" — T006c (four-change repair of the quarantined RoomClient candidate) authorized and placed first in `## Next`; T016 second; both may run as parallel leases.

## Scope boundary (2026-09-04)
- L009/T006c stopped without a commit because the inherited candidate fails root typecheck at the default browser timer adapter before and after the four authorized edits. The passing four-change repair is preserved in L009 `stash@{0}` (`d84a200`); changing that adapter would be a fifth edit and requires Maxx's explicit scope decision. L010/T016 remains active and unchanged.

## Repair/review iteration (2026-09-04, Fable 5.1 as final auditor/QA)
- Maxx: "Do the repair/review/planner iteration as outlined." T011-review-cap and T006c-scope are both closed by integration: T011d (`4181e34`) moved the null-URL-role decision after version rejection and added the pinned precedence test; T006c (`68d9776`, applied with the timer-type fix) plus T006d (`fa63af2`, per-session `lastFrameAt`) and T006e (`c1218e7`, exports + terminal-close clear) integrate the RoomClient. 020 AC-6 and AC-8 are met.
- Formal `protocol-keeper` reviews (Opus 5) were obtained for `7bab61a`, `68d9776`, `4181e34`, `fa63af2` after the fact; recorded in `docs/reviews/2026-09-04-repair-iteration.md` (also `ralph/last-review.md`). Lesson: two commits reached master without a review record — every integration writes the review before the planner runs.
- `scripts/sync-agents.mjs` now treats only files it generated as orphans (`a88832c`); the three untracked `.claude/agents/cavecrew-*.md` files are preserved and no longer fail `sync:agents:check`.
- Spec 030 gained the reconnect-blip decision (`lastFrameAt` is per socket session; the HUD dims during a blip).

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
| 25 | 2026-09-03 | T004c | relay-backend-dev | done | approve | ae5f448 | Exact combined-range review approved the T004a/T004b/T004c source-package repair; real TypeScript consumers now compile and all Node 22 root gates pass. |
| 26 | 2026-09-03 | T006 | relay-backend-dev | review-blocked | block | 5c424f4 | Quarantine the client candidate: terminal close policy, Ack/offline semantics, socket replacement cleanup, reconnect/timer regressions, and every-frame `lastFrameAt` ordering all need repair. |
| 27 | 2026-09-03 | T007 | relay-backend-dev | review-blocked | block | df9eca8 | Quarantine the relay candidate: broadcasts must exclude pre-hello sockets, hello needs explicit latest replay, and invalid/missing URL roles must fail only after WebSocket acceptance. |
| 28 | 2026-09-03 | T006a | relay-backend-dev | review-blocked | block | e02ed66 | Despite green gates, error-before-close can reconnect after terminal codes and Node numeric close codes bypass terminal detection; repair both event paths together. |
| 29 | 2026-09-03 | T006b | relay-backend-dev | review-blocked | block | e588729 | A socket open is not reconnect success before valid replay, and jitter must remain within the normative 500–8000 ms bounds; the third block escalates the client chain to human review. |
| 30 | 2026-09-03 | T007b | relay-backend-dev | done | approve | a380d6f | The approved T007/T007b relay stack integrated as `794fd17` + `a380d6f`; 52 tests, live Wrangler roundtrips, and every Node 22 root gate pass, so 020 AC-3 is met. |
| 31 | 2026-09-03 | T007a | relay-backend-dev | review-blocked | block | 01e596b | Public callers can forge the internal debug header, generated Worker types are stale, and relay tests must not overwrite or delete real spotter assets. |
| 32 | 2026-09-03 | T007c | relay-backend-dev | done | approve | 191d9a1 | Exact candidate range `a380d6f..8dcb04a` was approved with no findings; T007a/T007c integrated serially and 56 tests plus every Node 22 root, live-relay, Wrangler-types, and dry-run gate passed. |
| 33 | 2026-09-03 | T008 | relay-backend-dev | review-blocked | block | 686c174 | Quarantine the replay/expiry candidate: close and rehydration paths can persist stale peer-online flags, and the live alarm test must prove an actually empty room plus normative expiry/delete behavior. |
| 34 | 2026-09-03 | T008a | relay-backend-dev | done | approve | 637c2c2 | Exact range `191d9a1..5689288` was approved with no findings; T008/T008a integrated as `56e0729` + `637c2c2`, and 59 tests plus every Node 22 root, relay, Wrangler-types, and isolated-assets dry-run gate passed. |
| 35 | 2026-09-04 | T006c | relay-backend-dev | failed | n/a | - | The four authorized edits pass targeted client 10/10, root 69/69, and lint, but inherited browser timer adapters fail root typecheck; preserve L009 `stash@{0}` and require human approval before a fifth adapter-only edit. |
| 36 | 2026-09-04 | T016 | relay-backend-dev | done | approve | 0909521 | Ready-socket pong and attachment-only liveness refresh now coexist with a self-arming alarm; the exact leased range and serial integration passed the live verifier and full Node 22 gates. |
| 37 | 2026-09-04 | T011 | relay-backend-dev | review-blocked | block | 5a614b0 | Green gates do not prove an accepted rejection closes: require close 4401/4400 with no client activity, and reject any supplied PIN that is not exactly four digits without creating room storage or state. |
| 38 | 2026-09-04 | T011a | relay-backend-dev | failed | n/a | - | Accepted-socket close deferral from `fetch` is not live-boundary reliable and an alarm violates isolation; perform auth rejection during the mandatory first `hello` event instead. |
| 39 | 2026-09-04 | T011b | relay-backend-dev | review-blocked | block | 2d1edb6 | Validate `PROTOCOL_VERSION` before role/name/PIN work and atomically persist fresh-room `pin` plus `createdAt`; the failed/n/a T011a attempt does not count as a review block, so this is the chain's second block. |
| 40 | 2026-09-04 | T011c | relay-backend-dev | review-blocked | block | 581bead | Missing/invalid URL role is still rejected before a structurally valid mismatched version; the third chain block closes L014 and escalates any fourth repair to Maxx. |
| 41 | 2026-09-04 | T011c-precedence | relay-backend-dev | done | approve (post-hoc) | 7bab61a | Version mismatch is rejected before a bad URL role on the first hello; landed without a review record — reviewed after the fact. |
| 42 | 2026-09-04 | T006c | relay-backend-dev | done | approve with nits (post-hoc) | 68d9776 | The four authorized edits plus the timer-adapter fix integrate the RoomClient (020 AC-8); five type exports were dropped and the same-URL connect() guard ignores a CONNECTING zombie (T006e / T017). |
| 43 | 2026-09-04 | T011d | relay-backend-dev | done | approve with nits | 4181e34 | Null URL role is decided after structural hello parsing and version rejection; pinned live precedence test for '' and '?role=crew'; 020 AC-6 met. No accept-time alarm — T012 must reap unready sockets. |
| 44 | 2026-09-04 | T006d | relay-backend-dev | done | approve with nits | fa63af2 | lastFrameAt is reset per socket session (open and disconnect) so a stale LINK OK cannot survive a reconnect; blip semantics recorded in spec 030. |
| 45 | 2026-09-04 | tooling | relay-backend-dev | done | approve | a88832c | sync-agents orphan rule keys on the generator banner; untracked hand-written agents no longer break the check. |
| 46 | 2026-09-04 | T006e | relay-backend-dev | done | approve | c1218e7 | Client type exports restored; lastFrameAt cleared on a terminal close so an evicted driver reads NO LINK immediately. |
