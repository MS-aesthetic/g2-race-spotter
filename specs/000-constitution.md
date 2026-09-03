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
12. Every acceptance criterion is either automated (a named test that CI runs) or tagged `[HW]` (needs glasses, phones, or a deployed relay) and executed by a human with evidence saved under `qa/<date>/`.

## Process invariants (spec-driven + Ralph loop)

13. **Specs are the source of truth; the plan is disposable.** `specs/*.md` say what "done" means. `IMPLEMENTATION_PLAN.md` is regenerated freely and may be deleted at any time.
14. **One task, one fresh context, one commit.** A worker iteration takes the first unchecked task in *Next*, implements only that, runs the backpressure commands, commits, writes `ralph/last-build.md`, and exits. It does not pick a second task.
15. **Don't assume not implemented.** Before writing code, study the tree and tests; much may already exist.
16. **Tests are backpressure, never decoration.** A task is not done until the tests it names pass. Placeholder implementations that make tests pass without meeting the criterion are a review `block`.
17. **Specs may be clarified, never weakened, by an agent.** Only a human relaxes an acceptance criterion. An agent that believes a criterion is wrong marks it `DISPUTED:` with a reason.
18. **Reviews are adversarial and specific.** A review names file:line, the failure scenario, and the minimal fix, then gives one verdict: `approve`, `approve with nits`, or `block`.
19. **Hardware is human.** `[HW]` criteria are never assigned to a worker; they live under *Needs human* in the plan and are listed in `ralph/PROGRESS.md`.
20. **Model routing is a config, not a prompt.** `ralph/models.env` decides which model and effort each tier runs on; role files never name a model.

## Roles

| Tier | Roles | Does |
|---|---|---|
| worker | `g2-glasses-dev`, `relay-backend-dev`, `spotter-pwa-dev` | Implements exactly one plan task |
| reviewer | `protocol-keeper`, `hud-qa` | Reviews the iteration's diff against the spec it claims to advance |
| planner | `plan-updater` | Reconciles specs ↔ code ↔ review; rewrites the plan; decides DONE |
