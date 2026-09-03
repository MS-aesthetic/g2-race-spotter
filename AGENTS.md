# G2 Race Spotter — operational guide (loaded every iteration)

Spotter-to-driver comms for Even Realities G2 glasses: the spotter's phone (PWA) sends lane calls (▲ ● ▼), a "car behind" gap, and short messages through a Cloudflare Durable Object relay to the driver's phone, whose Even Hub app renders them on the glasses.

## Truth, in order

1. `specs/000-constitution.md` — invariants and process rules.
2. `specs/0X0-*.md` — what "done" means (acceptance criteria `AC-n`; evidence classes: automated test, `[SIM]` = simulator harness output, `[HW]` = a human with hardware; `[SIM]` never satisfies `[HW]`).
3. `.agents/skills/*/SKILL.md` — project decisions: `race-relay-protocol` (wire schema, normative), `g2-hud-display` (container layout, bitmap, queue), `spotter-ui`, `hud-e2e-testing`, `cloudflare-relay-deploy`.
4. `docs/BUILD_PLAN.md` and `docs/RESEARCH_NOTES.md` — design rationale and SDK facts with sources. Specs win on conflict.
5. `IMPLEMENTATION_PLAN.md` — disposable task list. `ralph/PROGRESS.md` — history.

## Layout (npm workspaces, Node 22, TypeScript strict, vitest)

```
apps/glasses       Even Hub app (driver side, runs in the Even app's WebView)   role g2-glasses-dev
apps/spotter       spotter PWA                                                  role spotter-pwa-dev
services/relay     Cloudflare Worker + RaceRoom Durable Object (+ serves PWA)   role relay-backend-dev
packages/protocol  types / guards / constants / reduce / RoomClient — the only place wire shapes exist
scripts/           fake-spotter, latency-report, sync-agents, check-pins, check-environment
qa/<date>/         test evidence (screenshots, logs, REPORT.md)
agents/roles/      canonical role prompts → generated into .claude/agents (Claude) and .codex/agents (Codex)
ralph/             the loop: prompts, models.env, loop.sh, PROGRESS.md
```

## Commands (backpressure — all must be green before a commit)

```
npm ci
npm run typecheck          # tsc -b across workspaces
npm test                   # vitest across workspaces (relay integration tests start wrangler dev themselves)
npm run lint
npm run sync:agents        # regenerate .claude/agents, .codex/agents, .claude/skills from canonical sources
npm run sync:agents:check  # CI: fail if generated files are stale
npm run dev -w apps/glasses        # Vite on 0.0.0.0:5173 for `npx evenhub qr` sideload (hardware)
npm run dev:sim -w apps/glasses    # Vite --mode simulator (logging/relay-URL defaults only; image mode is normal in the simulator)
npm run sim:scenarios              # simulator harness: launches evenhub-simulator 0.9.5 --automation-port 9898, runs fake-spotter scenarios in image+text mode, writes qa/<date>/sim/report.json  → [SIM] evidence
npm run dev -w services/relay      # wrangler dev on :8787
npx tsx scripts/fake-spotter.ts --url ws://localhost:8787 --room QA01 --scenario lanes
```

## Rules that apply everywhere

- Message shapes, constants and timings come from `packages/protocol`. Never redefine them. `RoomClient` is the only socket client.
- The driver never sees stale data as live (NO LINK + dim HUD after 5 s of silence). The glasses render only `state` frames.
- One image container; gap updates coalesce at 250 ms; messages use `textContainerUpgrade`; `createStartUpPageContainer` exactly once.
- Bridge KV on the glasses side, `localStorage` only on the spotter; keys `g2rs:v1:*`.
- Pin SDK/CLI/simulator versions (`docs/ENVIRONMENT.md`); bumping is its own task.
- SDK mechanics come from the official plugin `even-realities/everything-evenhub` (Claude: `/plugin marketplace add even-realities/everything-evenhub` then `/plugin install everything-evenhub@everything-evenhub`; Codex: `codex plugin marketplace add even-realities/everything-evenhub`). Its skills are written here as bare names (`sdk-reference`, `glasses-ui`, …); in Claude Code they may be namespaced (`/everything-evenhub:sdk-reference`), in Codex `$sdk-reference`. Project skills cover project decisions only.
- Non-ASCII glyphs on the glasses live in `apps/glasses/src/render/glyphs.ts` with ASCII fallbacks.
- No secrets in the repo (`wrangler secret put`, `.dev.vars` git-ignored).

## Loop protocol (see ralph/README.md)

One task → one fresh context → one commit. Workers take the first unchecked task under `## Next` in `IMPLEMENTATION_PLAN.md`, never `[HW]` tasks; `[SIM]` tasks are worker tasks (report `failed` + `sim-unavailable` if the simulator cannot run, never fake evidence). Reviewers report `approve | approve with nits | block` in `ralph/last-review.md`. The planner alone edits the plan, `ralph/PROGRESS.md`, and spec *Decisions*/*Open questions*; only a human weakens an acceptance criterion. Don't assume not implemented — search first.

## Skills and roles by runtime

- **Claude Code**: roles are subagents in `.claude/agents/` (generated; model/effort from `ralph/models.env`); project skills are preloaded per role and also available via the `Skill` tool; plugin skills as `/name` or namespaced `/everything-evenhub:name`.
- **Codex**: `AGENTS.md` is read natively; skills in `.agents/skills/` are invoked implicitly or as `$name`; roles are `.codex/agents/*.toml` (generated) — requires `[features] multi_agent = true` and a trusted project; `ralph/loop.sh` with `RUNNER=codex` prepends the role file to each prompt instead.
- Any other agent: read `agents/roles/<role>.md` + the skills it lists, then follow `ralph/PROMPT_*.md`.
