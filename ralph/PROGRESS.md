# Ralph progress log

Append-only history of loop iterations. The planner keeps "Blocked on human" current; Maxx clears items by doing them and telling the loop (or by editing the plan).

## Blocked on human
- T101 — sideload + fill `docs/ENVIRONMENT.md` (specs 010 AC-4/AC-5)
- T102 — first Cloudflare deploy + `DEBUG_KEY` (spec 020 AC-10)

## Codex pre-flight
- 2026-09-03 — Verified live on this account that `gpt-5.6-terra` accepts `high` and `gpt-5.6-sol` accepts both `high` and `xhigh`.
- 2026-09-03 — Codex CLI 0.151.0-alpha.7.2 exposes `--ask-for-approval` only before the `exec` subcommand; all other assumed `codex exec` flags match this install.
- 2026-09-03 — A live iteration showed Windows `workspace-write` blocks npm network/cache access and Git index writes under approval `never`. Kept `workspace-write`, enabled its network setting, redirected npm cache to the writable temp directory, and switched to Codex automatic approval so guarded Git writes can complete.

## Iterations

| # | date | task | owner | outcome | review | commit | lesson |
|---|---|---|---|---|---|---|---|
| 0 | 2026-09-03 | bootstrap plan | (hand-written) | — | — | — | Specs and loop scaffolding created; no application code yet |
