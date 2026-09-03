# Ralph progress log

Append-only history of loop iterations. The planner keeps "Blocked on human" current; Maxx clears items by doing them and telling the loop (or by editing the plan).

## Blocked on human
- T101a–T101c — simulator screenshot, QR sideload, and complete environment observations (spec 010 AC-3/AC-4/AC-5)
- T102 — first Cloudflare deploy + `DEBUG_KEY` evidence (spec 020 AC-10)
- T103–T106 — simulator/real-glasses scenarios, glyph sheet, and WebSocket whitelist evidence (spec 030 AC-7–AC-10)
- T107–T108 — mobile PWA installation/layout and LTE end-to-end evidence (spec 040 AC-6/AC-7)
- T109–T111 — gray4 packing, image soak/latency, and exit-dialogue fallback evidence (spec 050 AC-6–AC-8)
- T112–T115 — iOS/Android lifecycle, redeploy recovery, and safe structured-tail evidence (spec 060 AC-5–AC-8)
- T116–T117 — pre-grid checklist and signed full-session evidence (spec 070 AC-4/AC-5)

## Codex pre-flight
- 2026-09-03 — Verified live on this account that `gpt-5.6-terra` accepts `high` and `gpt-5.6-sol` accepts both `high` and `xhigh`.
- 2026-09-03 — Codex CLI 0.151.0-alpha.7.2 exposes `--ask-for-approval` only before the `exec` subcommand; all other assumed `codex exec` flags match this install.
- 2026-09-03 — A live iteration showed Windows `workspace-write` blocks npm network/cache access and Git index writes under approval `never`. Kept `workspace-write`, enabled its network setting, redirected npm cache to the writable temp directory, and switched to Codex automatic approval so guarded Git writes can complete.

## Iterations

| # | date | task | owner | outcome | review | commit | lesson |
|---|---|---|---|---|---|---|---|
| 0 | 2026-09-03 | bootstrap plan | (hand-written) | — | — | — | Specs and loop scaffolding created; no application code yet |
| 1 | 2026-09-03 | T001 | relay-backend-dev | review-blocked | block | cc13020 | AC-1 is an end-to-end gate: lint, its CI command chain, and the named workspace test must exist before handoff. |
