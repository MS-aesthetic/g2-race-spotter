# G2 Race Spotter — current agent handoff

Snapshot: 2026-09-04 (America/New_York)
Authoritative main snapshot: `6e82c4f4a6af432a600d940e857878ed4891e373`

## Read first

Work in `C:\Users\maxx\Documents\EVEN G2 HUD`, the local Git repository outside OneDrive. Read `AGENTS.md`, `specs/000-constitution.md`, `ralph/README.md`, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, `specs/020-protocol-and-relay.md`, and `.agents/skills/race-relay-protocol/SKILL.md`. Specs are authoritative; later committed plan/progress changes supersede this snapshot.

## Current status

- Branch `master`; plan status `BLOCKED`; no active lease or Git remote.
- No spec is `DISPUTED`; no Cloudflare deployment occurred; no secrets were added.
- Latest approved application commit: `0909521` (T016 pong/heartbeat/self-arming alarm).
- Main passed Node 22 typecheck, 60/60 tests, lint, pins, environment, Wrangler types, and isolated-assets deploy dry-run.
- Three untracked `.claude/agents/cavecrew-*.md` files are preserved. They make `npm run sync:agents:check` report orphans; do not delete or commit them without Maxx's direction.

## Human decisions required

No independent non-hardware task is runnable until Maxx explicitly resolves at least one item.

### T011 review-cap override

Authorize or reject a fourth T011 repair. Quarantine:

- Worktree `C:\Users\maxx\.cache\g2rs-worktrees\L014`
- Branch `ralph/L014-T011c`; head `581bead4f9debde18f32cbd1831b2dbf1ca3675b`
- Exact unintegrated range `c4d8d6d..581bead`

The stack otherwise passes 70/70 tests and all relay gates. One defect remains: a missing/invalid URL role is rejected before parsing and version-checking a structurally valid first hello, so `v:999` receives `error{bad_frame}` + 4400 instead of `error{version}` + 4426.

If approved, only move the null-role decision after structural hello parsing/version rejection and add the pinned live precedence test. Then obtain a fresh `protocol-keeper` review of the complete candidate-plus-repair range. Do not begin without explicit approval.

### T006c scope extension

Authorize or reject one additional timer-adapter typing edit. Preserved repair:

- Worktree `C:\Users\maxx\.cache\g2rs-worktrees\L009`
- Branch/head `ralph/L009-T006c` at `1872085`
- `stash@{0}` / object `d84a200`, message `T006c scoped repair blocked by inherited timer typecheck`

The four authorized changes pass client tests 10/10, root tests 69/69, and lint. Typecheck fails before and after the stash at `packages/protocol/src/client.ts:74,76`: Node globals return `Timeout`, while the public/injected browser timer contract uses numeric handles.

If approved, restrict the fifth edit to `packages/protocol/src/client.ts:73-78`, preserve the public numeric `RoomClientTimers` contract, apply the stash, run all gates, and review the complete range. Do not broaden or rewrite the client.

## Integrated functionality

| Commits | Result |
|---|---|
| `35e74dc` + `42d7d5b` | Pure room-state reducer |
| `794fd17` + `a380d6f` | Hibernating relay roundtrip |
| `9eb2876` + `191d9a1` | HTTP/debug/assets routes and hardening |
| `56e0729` + `637c2c2` | Replay persistence and room expiry |
| `0909521` | Pong, attachment heartbeat refresh, self-arming alarms |

T009/T012/T013/T014 depend on T011. T017 and later client consumers depend on T006c. T002c still needs an interactive simulator window. Hardware/deployment work remains under `## Needs human [HW]` in the plan.

## Workflow and gates

Use one isolated lease, one fresh worker, one task, and one commit. A fresh `protocol-keeper` reviews the exact range; integrate only an approved stack and rerun all gates. Never assign `[HW]` work to an agent, redefine wire types outside `packages/protocol`, show stale driver data as live, commit secrets, or hand-edit generated `.claude/`/`.codex/` files.

```powershell
$env:Path='C:\Users\maxx\.cache\g2-race-spotter-node22\node-v22.23.2-win-x64;'+$env:Path
$env:npm_config_cache='C:\Users\maxx\.cache\g2rs-npm-main'
npm run typecheck
npm test
npm run lint
npm run check:pins
npm run sync:agents:check
node scripts/check-environment.mjs
```

Relay work also requires its focused live Wrangler test, `npx wrangler types src/worker-configuration.d.ts --check`, and `npx wrangler deploy --dry-run` with isolated temporary spotter assets. Never deploy or set secrets without explicit permission.

## Prompt for the receiving LLM

> Read `HANDOFF.md`, `AGENTS.md`, the constitution, current plan/progress, spec 020, and the race-relay-protocol skill. Do not edit yet. Confirm main and identify which of `T011-review-cap` or `T006c-scope` Maxx explicitly approved. For an approved item, record an isolated lease, make only the documented minimal repair, run every Node 22/live Wrangler gate, obtain a fresh exact-range protocol review, integrate only on approval, and have the planner reconcile the result. Preserve unrelated and quarantined work.
