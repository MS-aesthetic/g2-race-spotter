# G2 Race Spotter — Claude Code entry point

Read and follow `AGENTS.md` — it is the single operational guide for every runtime (Claude Code, Codex, others) and is kept current. This file only adds what is Claude-specific.

## Claude-specific

- Roles are subagents in `.claude/agents/` (`g2-glasses-dev`, `relay-backend-dev`, `spotter-pwa-dev`, `protocol-keeper`, `hud-qa`, `plan-updater`). They are **generated** from `agents/roles/*.md` by `npm run sync:agents`; edit the role file, then re-sync. Model and effort per tier come from `ralph/models.env`.
- Project skills in `.claude/skills/` are a mirror of `.agents/skills/` — edit the `.agents` copy.
- Install the SDK reference plugin once: `/plugin marketplace add even-realities/everything-evenhub` → `/plugin install everything-evenhub@everything-evenhub`.
- Interactive use: "Run `ralph/loop.sh once` and show me `ralph/last-review.md`" is a good first prompt. For hand-driven work, invoke a role directly (`@agent-relay-backend-dev implement T004 from IMPLEMENTATION_PLAN.md`) and then `@agent-protocol-keeper review HEAD`.
- Headless loop: `ralph/loop.sh` runs `claude -p --agent <role> --max-turns …` (model/effort come from the generated agent file), or with `RALPH_CLAUDE_USE_AGENT=0` prepends the role file and passes `--model … --effort …` instead. By default it passes `--dangerously-skip-permissions`, so run it in a VM/sandbox or set `RALPH_UNATTENDED=0`.
