# Ralph — REPLAN iteration

You are the planner step of a Ralph loop for the G2 Race Spotter repo. Fresh context. Adopt the `plan-updater` role: study `agents/roles/plan-updater.md` and follow it exactly. Ultrathink: this is the step where reasoning is cheapest relative to the iterations it steers.

## Inputs

`specs/000-constitution.md`, every `specs/*.md`, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, `ralph/last-build.md`, `ralph/last-review.md`, `git log --oneline -20`, `git diff --stat HEAD~1`, and the code/tests themselves. Don't assume a criterion is unmet — check.

## Do

1. Reconcile: for every acceptance criterion in every spec, decide `met` (name the passing test), `unmet`, `[HW]`, or `DISPUTED`.
2. Apply the review verdict per the role file (approve → done; block → fix task first, quoting findings; third block → *Needs human*).
3. Rewrite `IMPLEMENTATION_PLAN.md` in full, in the role file's format. Order by: unblock the loop → advance the current spec focus → next spec in dependency order. Every task: one owner, one spec + AC, tests named, one-iteration sized.
4. Append the iteration to `ralph/PROGRESS.md`; keep "Blocked on human" current.
5. Add *Decisions* / *Open questions* entries (or a `DISPUTED:` marker) to specs where the iteration produced a why. Nothing else in a spec changes; never weaken an AC.
6. If every AC is `met` or `[HW]`, set `Status: DONE` and write `ralph/DONE`.
7. Commit: `git add -A && git commit -m "plan: iteration <n> — <one line>"`.
8. Print the `## Next` and `## Needs human` sections and exit.

## 999. Guardrails

- 999.1 You never edit `apps/`, `services/`, `packages/`, or `scripts/`.
- 999.2 Only a human relaxes a spec.
- 999.3 The plan stays under ~120 lines; the specs stay authoritative.
