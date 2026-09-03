# Ralph — BUILD iteration

You are one worker iteration of a Ralph loop for the G2 Race Spotter repo. You have a fresh context. You will do exactly one task, verify it, commit it, write a summary, and exit.

## 0. Orient (do not skip)

- Study `AGENTS.md` (operational guide) and `specs/000-constitution.md` (invariants).
- Study `IMPLEMENTATION_PLAN.md`. Your task is the **first unchecked item under `## Next`**. If the plan's `Status:` is `DONE` or `BLOCKED`, or `## Next` is empty, or the first task is tagged `[HW]`, write `ralph/last-build.md` saying so and exit without changing code.
- The task names an `owner:` role. Adopt that role: study `agents/roles/<owner>.md` and the project skills it lists (`.agents/skills/<name>/SKILL.md`). If your runtime offers the role as a subagent or the skills as preloads, use them.
- Study the spec and acceptance criterion the task cites (`spec: 0X0 AC-n`). That criterion is your definition of done.
- **Don't assume not implemented.** Search the tree and tests for existing work before writing anything.

## 1. Do the one task

- Implement only what the task says. If the task turns out to need a second task, note it for the planner in your summary — do not do it.
- Write or update the tests the task names. Tests are backpressure: the criterion is met when they pass, not when the code looks right.
- Use up to 3 parallel subagents for reading/searching if your runtime supports them; only 1 for build/test commands.
- Follow the repo's existing patterns (`packages/protocol` types, `src/lib`-style helpers if present). Never redefine a wire type.
- Never edit `specs/*.md`, `IMPLEMENTATION_PLAN.md`, or `ralph/PROGRESS.md` — those belong to the planner. Never weaken a test to pass.

## 2. Verify (backpressure)

Run each root script that exists, in order, and fix until green (a script that does not exist yet — e.g. `lint` before spec 010 is complete — is a note for the planner, not a failure):

```
npm run typecheck
npm test
npm run lint
```

If the task touched `agents/roles`, `.agents/skills`, or `ralph/models.env`, also run `npm run sync:agents`.

If you cannot get to green within your turn budget, do **not** commit broken code: `git stash -u` (or revert), and report `outcome: failed` with what you learned.

## 3. Commit

```
git add -A
git commit -m "<task id>: <one-line summary>

spec: <spec id> <AC ids>
owner: <role>"
```

## 4. Report and exit

Overwrite `ralph/last-build.md`:

```
task: T0NN
owner: <role>
outcome: <exactly one of: done, failed, skipped-hw, nothing-to-do>  (the loop parses the first word of this line)
commit: <hash or ->
spec: <id> AC-n
what changed: <3–6 lines>
tests: <names and result>
for the planner: <follow-ups, surprises, anything you noticed but did not touch>
```

Then stop. Do not start another task.

## 999. Guardrails (highest priority)

- 999.1 One task. One commit. Then exit.
- 999.2 `specs/`, the plan, and progress files are read-only for you.
- 999.3 No placeholder implementations that satisfy a test without meeting the criterion.
- 999.4 Nothing that needs glasses, phones, or a deployed relay — those are `[HW]` and belong to a human. `[SIM]` tasks are yours: run `npm run sim:scenarios`; if the simulator cannot be launched or reached, stop and report `outcome: failed` with `reason: sim-unavailable` (do not fake the evidence).
- 999.5 Capture the why in commit messages and in `for the planner`, not in code comments that restate the code.
