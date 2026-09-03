# G2 Race Spotter

Spotter → driver HUD on Even Realities G2 glasses. This repo currently holds the specs, plan, research, and the agent/skill/loop scaffolding that will build it — no application code yet.

| What | Where |
|---|---|
| Operational guide (every runtime reads this) | `AGENTS.md` (Claude Code enters via `CLAUDE.md`) |
| Invariants + per-phase specs with acceptance criteria | `specs/` |
| Disposable task list / progress | `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md` |
| The loop: prompts, model routing, runner | `ralph/` (`ralph/README.md` explains it) |
| Design rationale, HUD spec, phases, risks | `docs/BUILD_PLAN.md` |
| SDK/platform research with sources | `docs/RESEARCH_NOTES.md` |
| Roles (canonical) → generated agents | `agents/roles/` → `.claude/agents/`, `.codex/agents/` via `scripts/sync-agents.mjs` |
| Project skills (canonical) → mirror | `.agents/skills/` → `.claude/skills/` |

## Start

```bash
git clone <this repo> ~/src/g2-race-spotter && cd ~/src/g2-race-spotter   # local clone, not the OneDrive folder
node scripts/sync-agents.mjs
ralph/loop.sh once            # Claude Code; or: RUNNER=codex ralph/loop.sh once
```

Then do the `[HW]` items under *Needs human* in `IMPLEMENTATION_PLAN.md` when you have the glasses and a Cloudflare login. Install the SDK reference plugin for whichever CLI you use (commands in `AGENTS.md`).
