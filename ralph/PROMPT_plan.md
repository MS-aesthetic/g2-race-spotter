# Ralph — PLAN (bootstrap or full re-plan)

Use this instead of `PROMPT_replan.md` when there is no plan yet, or the plan is so stale it should be regenerated from scratch. Fresh context. Adopt the `plan-updater` role (`agents/roles/plan-updater.md`). Ultrathink.

1. Study `AGENTS.md`, `specs/000-constitution.md`, every `specs/*.md`, and `docs/BUILD_PLAN.md` (design rationale; specs win on conflict — note conflicts under *Open questions* in the affected spec).
2. Study the code tree and tests. **Don't assume not implemented.** For each acceptance criterion decide `met` / `unmet` / `[HW]` / `DISPUTED`.
3. Write `IMPLEMENTATION_PLAN.md` from scratch in the role file's format: spec focus = the lowest-numbered spec with an unmet non-`[HW]` criterion; tasks one-iteration sized, each with owner, spec + AC, and named tests; `[HW]` items under *Needs human*.
4. If `ralph/PROGRESS.md` does not exist, create it with a header and a "Blocked on human" list.
5. Commit: `git add -A && git commit -m "plan: bootstrap"`. Print `## Next` and exit.

Guardrails as in `PROMPT_replan.md` §999.
