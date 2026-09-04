# G2 Race Spotter — agent handoff

Snapshot date: 2026-09-03 (America/New_York)  
Code/planning snapshot: `67311ac` (this handoff commit is layered on top)

## Start here

Work in `C:\Users\maxx\Documents\EVEN G2 HUD`, the local Git repository outside OneDrive. Do not run the loop or install `node_modules` in the OneDrive copy. Read, in order:

1. `AGENTS.md`
2. `specs/000-constitution.md`
3. `ralph/README.md`
4. `IMPLEMENTATION_PLAN.md`
5. `ralph/PROGRESS.md`
6. the active spec and applicable skills

This file is a current snapshot only. Specs remain authoritative; the implementation plan and progress log supersede this file if later commits disagree.

## Current state

- Branch: `master`; no Git remote is configured.
- Plan status: `BUILDING`; no active stream lease, `ralph/STOP`, or `ralph/DONE`.
- Current spec focus: `specs/020-protocol-and-relay.md`.
- No acceptance criterion is marked `DISPUTED`.
- No Cloudflare deployment was made and no secrets were added.
- Physical-glasses, phone, Cloudflare-account, and interactive-simulator evidence remains outstanding exactly as listed under **Needs simulator** and **Needs human** in `IMPLEMENTATION_PLAN.md`.

Latest integrated result:

- T008/T008a was approved with no findings and integrated as `56e0729` + `637c2c2`.
- Replay preserves lane, gap, message, and monotonic sequence through reconnect/local Wrangler restart while reconciling dead peers offline.
- Empty rooms schedule expiry for `updatedAt + ROOM_TTL_MS`, and expiry passes through the normative reducer before storage deletion.
- Main passed Node 22 typecheck, 59/59 tests, lint (two existing generated Wrangler declaration warnings only), pin check, generated-agent sync check, environment check, Wrangler types check, and an isolated-assets deploy dry-run.

Recent integrated relay history:

| Commit | Result |
|---|---|
| `794fd17` + `a380d6f` | T007/T007b hibernating relay roundtrip; approved |
| `9eb2876` + `191d9a1` | T007a/T007c HTTP routes and hardening; approved |
| `56e0729` + `637c2c2` | T008/T008a replay persistence and expiry alarm; approved |
| `67311ac` | Iteration 34 plan/spec/progress reconciliation |

## Next safe action

T011 is the first unchecked task under `## Next`: implement first-join/open-room/protected-room PIN semantics and authentication tests. It owns the `relay-room` lock and must be completed and reviewed before T009. No implementation lease has been opened, so a new coordinator may create a fresh isolated worktree from current `master`, record the lease, then dispatch `relay-backend-dev` with the build prompt and applicable relay/protocol skills.

Do not start or repair T006. Maxx explicitly declined exceeding its three-review-block cap. The candidate remains quarantined in L005; it must not be leased, integrated, or silently reimplemented unless Maxx later explicitly reverses that decision.

## Quarantined and historical worktrees

| Worktree | Branch | Disposition |
|---|---|---|
| `C:\Users\maxx\.cache\g2rs-worktrees\L005` | `ralph/L005-T006` at `e588729` | True quarantine. Do not integrate range `ae5f448..e588729`; remaining findings are in the plan. |
| `L001`, `L002` | historical task branches | Work is already integrated; each may contain an untracked review-copy file. |
| `L003`, `L004` | historical repair ancestry | Patch-equivalent work is already integrated under different hashes. |
| `L006`, `L007`, `L008` | historical relay candidates | Approved patch-equivalent work is already integrated on `master`; do not cherry-pick again. |

Preserve these worktrees for traceability unless Maxx explicitly asks for cleanup.

## Audit note (2026-09-03)

An independent audit (`docs/AUDIT-2026-09-03.md`) re-verified the gates above and inserted **T016** ahead of T011 (relay `pong` reply + self-arming alarm — without it T012's silent-peer detection cannot fire and the glasses would show NO LINK on a quiet room). T011/T009/T012/T013 now carry reviewer traps inline. The T006 quarantine stands; the auditor's 4th-review verdict and a scoped repair proposal (T006c) sit in the plan for Maxx's decision.

Agents on a non-Windows host: the PowerShell lines below have no analogue here — use Node 22 from your own toolchain; the Claude-side model mapping (Sonnet 5 workers, Opus 5 reviewers/planner) is in `ralph/README.md`; re-check its "Verify before first run" list before driving the loop; treat the repository path below as illustrative.

## Local toolchain

The verified Node runtime is `v22.23.2` at:

```powershell
$env:Path='C:\Users\maxx\.cache\g2-race-spotter-node22\node-v22.23.2-win-x64;'+$env:Path
$env:npm_config_cache='C:\Users\maxx\.cache\g2rs-npm-main'
```

Git is `2.52.0.windows.1`. Model routing is already verified and recorded in `ralph/models.env`: worker `gpt-5.6-terra` high, reviewer `gpt-5.6-sol` high, planner `gpt-5.6-sol` xhigh. The official `everything-evenhub` plugin is installed for the current Codex profile; a different host/profile must verify it independently before glasses SDK work.

## Required gates

Before any implementation commit, use Node 22 and run:

```powershell
npm run typecheck
npm test
npm run lint
npm run check:pins
npm run sync:agents:check
node scripts/check-environment.mjs
```

Relay changes also require the task-specific live Wrangler tests, `npx wrangler types src/worker-configuration.d.ts --check`, and `npx wrangler deploy --dry-run` with isolated temporary spotter assets. Never deploy or set secrets without Maxx's explicit request.

