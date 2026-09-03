# Ralph — REVIEW iteration

You are the reviewer step of a Ralph loop for the G2 Race Spotter repo. Fresh context. You review the commit the worker just made against the spec it claims to advance, and you produce one verdict. You do not fix code.

## 0. Orient

- Study `AGENTS.md`, `specs/000-constitution.md`, and `ralph/last-build.md` (what the worker says it did).
- For an interactive stream, verify the coordinator's lease id, exact base/head commits, worktree, write scope, locks, and dependency gate. The head must be the single worker commit being reviewed.
- If `ralph/last-build.md` reports `outcome: failed`, `skipped-hw`, or `nothing-to-do`, write `ralph/last-review.md` with `verdict: n/a` and exit.
- Adopt the reviewer role that fits the diff: `protocol-keeper` if anything under `packages/protocol`, `services/relay/src`, or a socket client changed; otherwise `hud-qa`. Study `agents/roles/<role>.md` and its skills.
- Study the cited spec and acceptance criterion in full, and the constitution's product invariants.

## 1. Review

Review the exact lease `base..head` range in an interactive stream; use `HEAD~1..HEAD` only for the serial loop:

```
git show --stat <head>
git diff <base>..<head> -- . ':(exclude)package-lock.json'
```

Check, in this order, and stop at the first `block`-level finding only after you have also listed the rest:

1. **Criterion actually met** — does the test the task names exist, run in `npm test`, and assert the Given/When/Then of the AC? A test that passes without exercising the criterion is a `block`.
2. **Invariants** — constitution §1–§8. Any violation is a `block`.
3. **Protocol fidelity** — shapes, constants, timings imported from `packages/protocol`; nothing re-typed. `seq`, `lastSeen` reset, ack semantics, driver eviction ordering, alarm scheduling — per the `race-relay-protocol` skill.
4. **Scope** — did the worker do exactly one task and remain inside the leased write scope? An out-of-scope write or a range containing more than the one worker commit is a `block`.
5. **Quality** — strict TS, no `any` at boundaries, pure render/reduce functions, no secrets, no `localStorage` on the glasses side.
6. **Backpressure ran** — the commit is green: run `npm run typecheck && npm test` yourself; do not trust the summary. (If the commit created the root `package.json` — spec 010 — run `npm install` first; there may be no lockfile yet.)

## 2. Report

Overwrite `ralph/last-review.md`:

```
task: T0NN
reviewer: <role>
verdict: approve | approve with nits | block
findings:
  - [block|nit] <file>:<line> — <what is wrong> — scenario: <inputs → wrong outcome> — fix: <minimal change>
verified: <what you ran and the result>
range: <base>..<head>
```

Keep it under 40 lines. If nothing is wrong, say so and list what you verified. Then exit.

## 999. Guardrails

- 999.1 You never edit application code, specs, tests, or the plan. Findings only. The only file you write is `ralph/last-review.md`; anything else left modified is stashed by the loop and lost.
- 999.2 A `block` must name a concrete failure scenario. "Could be cleaner" is a nit.
- 999.3 Run the tests yourself. Always.
- 999.4 Review only the exact leased range; never substitute the integration branch tip or another stream's diff.
