# Ralph — BUILD iteration

You are one worker iteration of a Ralph loop for the G2 Race Spotter repo. You have a fresh context. You will do exactly one task, verify it, commit it, write a summary, and exit.

## 0. Orient (do not skip)

- Study `AGENTS.md` (operational guide) and `specs/000-constitution.md` (invariants).
- Study `IMPLEMENTATION_PLAN.md`. In the serial loop, your task is the **first unchecked item under `## Next`**. In an interactive parallel stream, the coordinator prepends a lease containing an exact task id, base commit, isolated worktree, dependency gate, write scope, and locks; take that exact task only after confirming it appears in the plan's active lease table. If neither selection is valid, the plan's `Status:` is `DONE` or `BLOCKED`, the selected task is `[HW]`, or a lease dependency has not opened for final verification/commit, write `ralph/last-build.md` saying so and exit without changing code.
- The task names an `owner:` role. Adopt that role: study `agents/roles/<owner>.md` and the project skills it lists (`.agents/skills/<name>/SKILL.md`). If your runtime offers the role as a subagent or the skills as preloads, use them.
- Study the spec and acceptance criterion the task cites (`spec: 0X0 AC-n`). That criterion is your definition of done.
- **Don't assume not implemented.** Search the tree and tests for existing work before writing anything.

## 1. Do the one task

- Implement only what the task says. If the task turns out to need a second task, note it for the planner in your summary — do not do it.
- For an interactive lease, confirm `HEAD` descends from the recorded base and change only the leased write scope. Do not acquire another task's lock or edit the integration worktree.
- Write or update the tests the task names. Tests are backpressure: the criterion is met when they pass, not when the code looks right.
- Use up to 3 parallel subagents for reading/searching if your runtime supports them; only 1 for build/test commands.
- Follow the repo's existing patterns (`packages/protocol` types, `src/lib`-style helpers if present). Never redefine a wire type.
- Never edit `specs/*.md`, `IMPLEMENTATION_PLAN.md`, or `ralph/PROGRESS.md` — those belong to the planner. Never weaken a test to pass.

## 1.5 Self-review before hand-off (before running the gates)

- Re-read the criterion's Given/When/Then. Does your test hit the *real* boundary it names — a CLI subprocess with exit code and stderr, the actual output root on disk, a plain Node/tsc consumer, a live `wrangler dev` socket — rather than an internal function standing in for it?
- Does the named verifier file exist **and** run inside the root `npm test` / lint chain, not only locally?
- Run `npm run lint` yourself on the exact changed files; green `typecheck` + `test` is not evidence lint is clean.
- If you changed text files on Windows, confirm they reproduce from the committed LF blobs, not your CRLF working copy.
- If the task touches sockets or timers: does a test open the connection *and* close it without the happy path (no replay, no pong), and pin `random`/`now` to their extremes?
- Reviewers block on invariants (constitution §1–§8), placeholder tests (§16), and spec deviations; nits do not block. Fix the first two categories now.

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
lease: <lease id or serial>
base: <leased base hash or HEAD~1>
head: <worker commit hash or ->
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
- 999.6 A lease changes task selection, never task size: stay in its isolated worktree, write only its declared scope, and make exactly one commit after its dependency and green-gate requirements are satisfied.
