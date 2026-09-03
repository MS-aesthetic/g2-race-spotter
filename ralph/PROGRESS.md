# Ralph progress log

Append-only history of loop iterations. The planner keeps "Blocked on human" current; Maxx clears items by doing them and telling the loop (or by editing the plan).

## Blocked on human
- T101b–T101c — QR sideload and the hardware fields of `docs/ENVIRONMENT.md` (spec 010 AC-4/AC-5); simulator evidence is now automated by T002b/T002c (`[SIM]`)
- T102 — first Cloudflare deploy + `DEBUG_KEY` evidence (spec 020 AC-10)
- T104–T106 — real-glasses scenarios, glyph sheet, and WebSocket whitelist evidence (spec 030 AC-8–AC-10); T103 (030 AC-7) is now a `[SIM]` worker task
- T107–T108 — mobile PWA installation/layout and LTE end-to-end evidence (spec 040 AC-6/AC-7)
- T109–T111 — gray4 packing, image soak/latency, and exit-dialogue fallback evidence (spec 050 AC-6–AC-8)
- T112–T115 — iOS/Android lifecycle, redeploy recovery, and safe structured-tail evidence (spec 060 AC-5–AC-8)
- T116–T117 — pre-grid checklist and signed full-session evidence (spec 070 AC-4/AC-5)

## Codex pre-flight
- 2026-09-03 — Verified live on this account that `gpt-5.6-terra` accepts `high` and `gpt-5.6-sol` accepts both `high` and `xhigh`.
- 2026-09-03 — Codex CLI 0.151.0-alpha.7.2 exposes `--ask-for-approval` only before the `exec` subcommand; all other assumed `codex exec` flags match this install.
- 2026-09-03 — A live iteration showed Windows `workspace-write` blocks npm network/cache access and Git index writes under approval `never`. Kept `workspace-write`, enabled its network setting, redirected npm cache to the writable temp directory, and switched to Codex automatic approval so guarded Git writes can complete.

## Simulator update (2026-09-03)
- Simulator 0.9.5 renders the full 288×144 image; the old 200×100 / 4-container caps were ≤ 0.7. Image mode is the normal simulator path; `[SIM]` evidence class added (constitution §12/§19, specs 010/030/050, skills `g2-hud-display` + `hud-e2e-testing`, roles); hardware criteria unchanged.

## Iterations

| # | date | task | owner | outcome | review | commit | lesson |
|---|---|---|---|---|---|---|---|
| 0 | 2026-09-03 | bootstrap plan | (hand-written) | — | — | — | Specs and loop scaffolding created; no application code yet |
| 1 | 2026-09-03 | T001 | relay-backend-dev | review-blocked | block | cc13020 | AC-1 is an end-to-end gate: lint, its CI command chain, and the named workspace test must exist before handoff. |
