# 000 — Constitution

The invariants every spec, plan, task, and review is measured against. If a task or a plan conflicts with this file, this file wins and the conflict is reported, not resolved silently.

## Product invariants

1. **The driver never sees stale data as live.** If the glasses app has heard nothing from the room for `DRIVER_NO_LINK_MS` (5 s) it shows `NO LINK` and renders the HUD at half intensity. No exception, no setting.
2. **The glasses render only room state.** Nothing on the glasses is drawn from a spotter intent that has not come back as a `state` frame from the relay. No optimistic rendering on the driver side.
3. **One image container.** Symbol and bar share one 288×144 image; messages and status are text containers updated in place. Gap updates coalesce at `HUD_GAP_FLUSH_MS` (250 ms); lane changes flush immediately.
4. **Message shapes come from `packages/protocol`.** No app redefines a wire type, constant, or timing. The shared `RoomClient` is the only socket client.
5. **Persistence on the glasses side uses the bridge KV**, never browser `localStorage`. The spotter PWA uses `localStorage`. Keys are namespaced `g2rs:v1:`.
6. **`createStartUpPageContainer` is called exactly once per session** and never retried in a loop.
7. **Text mode always works.** Image mode is an enhancement with an automatic fallback.
8. **The HUD stays minimal.** Anything that would make the driver look at the glasses for more than a glance is out of scope until a human says otherwise.

## Engineering invariants

9. Node 22, npm workspaces, TypeScript `strict`, vitest. `npm test` and `npm run typecheck` must be green before any commit.
10. Pinned SDK/CLI/simulator versions in `docs/ENVIRONMENT.md`; bumping is its own task with a note in *Decisions*.
11. No secrets in the repo. Cloudflare secrets via `wrangler secret put`; `.dev.vars` is git-ignored.
12. Every acceptance criterion carries exactly one evidence class: **automated** (a named test that CI runs), **`[SIM]`** (produced by the simulator harness `npm run sim:scenarios`, evidence under `qa/<date>/sim/`; functional proof only — the simulator enforces no on-device image limits, no LZ4, no BLE pacing), or **`[HW]`** (glasses, phones, or a deployed relay; executed by a human with evidence under `qa/<date>/`). `[SIM]` evidence never satisfies an `[HW]` criterion; human visual approval of the display is always `[HW]`.

## Process invariants (spec-driven + Ralph loop)

13. **Specs are the source of truth; the plan is disposable.** `specs/*.md` say what "done" means. `IMPLEMENTATION_PLAN.md` is regenerated freely and may be deleted at any time.
14. **One task, one fresh context, one commit.** A worker iteration implements exactly one plan task, runs the backpressure commands, commits, writes its hand-off, and exits. The serial Ralph runner takes the first unchecked task in *Next*; an interactive coordinator may instead give a fresh worker the exact task named by an active lease. A worker never picks a second task.
15. **Don't assume not implemented.** Before writing code, study the tree and tests; much may already exist.
16. **Tests are backpressure, never decoration.** A task is not done until the tests it names pass. Placeholder implementations that make tests pass without meeting the criterion are a review `block`.
17. **Specs may be clarified, never weakened, by an agent.** Only a human relaxes an acceptance criterion. An agent that believes a criterion is wrong marks it `DISPUTED:` with a reason.
18. **Reviews are adversarial and specific.** A review names file:line, the failure scenario, and the minimal fix, then gives one verdict: `approve`, `approve with nits`, or `block`.
19. **Hardware is human; the simulator is not.** `[HW]` criteria are never assigned to a worker; they live under *Needs human* in the plan and are listed in `ralph/PROGRESS.md`. `[SIM]` criteria are ordinary worker tasks; when the simulator is unreachable the task parks under *Needs simulator* instead of being faked.
20. **Model routing is a config, not a prompt.** `ralph/models.env` decides which model and effort each tier runs on; role files never name a model.
21. **Parallelism is leased, isolated, and integrated serially.** An interactive coordinator may run independent worker/reviewer streams concurrently only in separate Git worktrees. Every lease records an exact base commit, task, dependencies, write scope, and exclusive locks before dispatch. Workers stay inside that scope; the planner remains the sole writer of specs, `IMPLEMENTATION_PLAN.md`, and `ralph/PROGRESS.md`. Reviewers inspect the lease's exact base-to-head range. Only approved commits are integrated, one at a time in dependency order, and the full root backpressure gates run on the integration branch after each integration. `ralph/loop.sh` remains the trusted serial fallback.

## Roles

| Tier | Roles | Does | Claude model @ effort | OpenAI model @ effort |
|---|---|---|---|---|
| worker | `g2-glasses-dev`, `relay-backend-dev`, `spotter-pwa-dev` | Implements exactly one plan task | Sonnet 5 @ high | GPT 5.6 Terra @ high |
| reviewer | `protocol-keeper`, `hud-qa` | Reviews the iteration's diff against the spec it claims to advance (`hud-qa` also owns `[SIM]` harness tasks when the plan names it — as a worker-tier run) | Opus 5 @ high | GPT 5.6 Sol @ high |
| planner | `plan-updater` | Reconciles specs ↔ code ↔ review; rewrites the plan; decides DONE | Opus 5 @ xhigh | GPT 5.6 Sol @ xhigh |
| auditor (human-invoked) | Maxx's final QA pass over an integration or a batch of iterations | Re-runs gates, dispatches independent reviewers, verifies their findings against source, records `docs/reviews/<date>-*.md` | Fable 5.1 (or Opus 5 @ xhigh) | GPT 5.6 Sol @ xhigh |

Either vendor column is a complete, interchangeable routing: a run may mix them (a Claude worker and an OpenAI reviewer, or the reverse) as long as the tier's effort is honoured. The concrete IDs live in `ralph/models.env` (rule 20); this table is the human-readable contract and must be kept in step with it.
