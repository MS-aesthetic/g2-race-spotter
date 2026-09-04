# G2 Race Spotter — current agent handoff

Snapshot: 2026-09-04 (America/New_York)
Latest application commit: `8bf5531` (T017 auditor nit) on top of `c9fb8b6` (T017) and `b28cc2c` (T009). The plan commit that carries this file supersedes it; `git log --oneline -1` on `master` is authoritative.

## Read first

Work in `C:\Users\maxx\Documents\EVEN G2 HUD`, the local Git repository outside OneDrive. Read `AGENTS.md`, `specs/000-constitution.md`, `ralph/README.md`, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, `ralph/last-review.md`, `specs/020-protocol-and-relay.md`, and `.agents/skills/race-relay-protocol/SKILL.md`. Specs are authoritative; later committed plan/progress changes supersede this snapshot.

## Current status

- Branch `master`; plan status `BUILDING`; no active lease; no Git remote.
- No spec is `DISPUTED`; no Cloudflare deployment occurred; no secrets were added.
- 020 AC-1–AC-6 and AC-8 are met; 060 R3 / 030 R3 client side (T017) is met. Open in 020: AC-7 (T012), AC-9 (T013), AC-10 (`[HW]` T102 after T014). Spec 030 is sliced into T020–T025 (automated) + T026 `[SIM]`.
- Main passes on Node 22: typecheck, `packages/protocol` 49/49, root suite 92/92 (18 files, live `wrangler dev`), lint (0 errors, 2 pre-existing generated-d.ts warnings) and prettier clean, `check:pins`, `sync:agents:check`, `wrangler types --check`, isolated-assets deploy dry-run. Read gate exit codes — do not grep their output for "error" (a prettier failure hid that way for two iterations).
- Three untracked `.claude/agents/cavecrew-*.md` files are Maxx's and are preserved. `sync:agents:check` no longer reports them (`a88832c`); do not delete, commit, or regenerate over them.
- No human decision is pending. Model routing lists both vendors per tier (constitution Roles table, plan header); either may run any tier.

## What changed on 2026-09-04

| Commit | Task | Result |
|---|---|---|
| `7bab61a` | T011c-precedence | version mismatch rejected before a bad URL role on the first hello |
| `68d9776` | T006c | `RoomClient` repair (backoff reset after replay, delay floor, `connect()` no-op, timer adapter typing) — 020 AC-8 |
| `4181e34` | T011d | room PIN auth integrated; null-role decision after version check; pinned live precedence test — 020 AC-6 |
| `fa63af2` | T006d | `lastFrameAt` reset per socket session |
| `a88832c` | tooling | sync-agents orphan rule keyed on the generator banner |
| `c1218e7` | T006e | client type exports restored; `lastFrameAt` cleared on terminal close |
| `d633a5d` | docs | Claude + OpenAI models per tier; auditor tier |
| `9fd612b` | T011d | prettier fix in `auth.test.ts` |
| `b28cc2c` | T009 | PIN-checked last-writer-wins driver eviction — 020 AC-5 |
| `c9fb8b6` + `8bf5531` | T017 | `onError`, `{code, terminal}` on `closed`, terminal close clears queue, `connect()` requires a replayed session |
| `d447981` | chore | stale `_to_delete/` removed |

Every application commit carries a `protocol-keeper` or auditor verdict under `docs/reviews/` (`2026-09-04-repair-iteration.md`, `2026-09-04-round-2-T009-T017.md`; `ralph/last-review.md` is git-ignored loop scratch) (approve / approve with nits; every nit is either fixed or assigned to T012/T017 in the plan). Quarantined worktrees `L009` and `L014` are superseded; keep them, do not lease from them.

## Next work (see the plan for the full task lines and the reviewer's traps)

Two independent streams; a coordinator may run one worker per stream at once, the serial runner alternates them in plan order.

1. **Relay stream** — **T012** silent-peer alarm (`services/relay/test/heartbeat.test.ts`, 020 AC-7; also adds the `rejected` filter to `persistAndBroadcast`/`hasReadyPeer` and owns the accept-time-alarm gap + the `alarm: null` assertions in `auth.test.ts`) → **T013** validation + rate limiting → **T014** fake-spotter scenarios → **T018** client verifier hardening.
2. **Glasses stream** (spec 030, owner `g2-glasses-dev`) — **T020** `glyphs.ts` + pure `renderText` → **T021** `resolveRenderMode` + text-container startup → **T022** coalescing update queue → **T023** link watchdog + status strip → **T024** input mapping (ack, exit dialogue, debounced foreground `connect()`) → **T025** companion page + `main.ts` wiring. **T026** `[SIM]` text-mode scenarios parks with T002c until an interactive simulator window exists.

Hardware/deployment work remains under `## Needs human [HW]`.

## Workflow and gates

Use one isolated lease, one fresh worker, one task, and one commit. A fresh `protocol-keeper` reviews the exact range **and writes `ralph/last-review.md` before the planner runs** — two commits landed without a review record this week; do not repeat that. Integrate only an approved stack and rerun all gates. Never assign `[HW]` work to an agent, redefine wire types outside `packages/protocol`, show stale driver data as live, commit secrets, or hand-edit generated `.claude/`/`.codex/` files (edit `agents/roles/` or `.agents/skills/` and run `node scripts/sync-agents.mjs`).

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

From `cmd` (or when PowerShell's execution policy blocks `npm.ps1`) use `npm.cmd` / `npx.cmd` with the same `Path` prefix.

Relay work also requires its focused live Wrangler test, `npx wrangler types src/worker-configuration.d.ts --check`, and `npx wrangler deploy --dry-run` with isolated temporary spotter assets. Never deploy or set secrets without explicit permission.

## Prompt for the receiving LLM

> Read `HANDOFF.md`, `AGENTS.md`, the constitution, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, `ralph/last-review.md`, spec 020, and the race-relay-protocol skill. Do not edit yet. Confirm `master` matches the plan's `Done this cycle` and that every root gate is green. Then take the first unchecked task under `## Next` (T012) with an isolated lease and a fresh worker; T020 (glasses stream) may run in parallel on its own lease. Quote the task line's reviewer guidance in the worker prompt. Run every Node 22 and live Wrangler gate, obtain a fresh exact-range `protocol-keeper` review written to `ralph/last-review.md`, integrate only on approval, and have the planner reconcile the result. Preserve the untracked `cavecrew-*` agents and the quarantined worktrees.
