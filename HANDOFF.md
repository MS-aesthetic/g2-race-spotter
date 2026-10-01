# G2 Race Spotter — current agent handoff

Snapshot: 2026-09-04 (America/New_York)
Latest application commit: `8bf5531` (T017 auditor nit) on top of `c9fb8b6` (T017) and `b28cc2c` (T009). The plan commit that carries this file supersedes it; `git log --oneline -1` on `master` is authoritative.

## Read first

Work in `C:\Users\maxx\Documents\EVEN G2 HUD`, the local Git repository outside OneDrive. Read `AGENTS.md`, `specs/000-constitution.md`, `ralph/README.md`, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, `ralph/last-review.md`, `specs/020-protocol-and-relay.md`, and `.agents/skills/race-relay-protocol/SKILL.md`. Specs are authoritative; later committed plan/progress changes supersede this snapshot.

## Current status

- Branch `master`; plan status `BUILDING` (consolidated plan since 2026-09-04); no active lease; remote `origin` = https://github.com/MS-aesthetic/g2-race-spotter (public, `master`). Push after every integration; the OneDrive bundle hand-off is retired.
- **Both apps exist now.** Glasses app (`apps/glasses`, image-first HUD drawn from primitives; edit `src/render/hud-design.ts` to change the look) and spotter PWA (`apps/spotter`, 6 KB gz) are integrated with the relay and the shared `RoomClient`. Automated criteria met: 010 AC-1/2/6/7; 020 AC-1–6, 8; 030 AC-1–6; 040 AC-1–5; 050 AC-1–5.
- Main passes on Node 22 (2026-10-01, design round 6 integrated): typecheck, **425/425** tests (49 files, live `wrangler dev`), lint (0 errors, 2 pre-existing generated-d.ts warnings) + prettier, `check:pins`, `sync:agents:check`, both app builds, `wrangler deploy --dry-run` with the real spotter assets. Read gate exit codes, never grep their output.
- Reviews for every application commit live under `docs/reviews/` (latest: `2026-10-01-round-11-T063-T064.md`; `ralph/last-review.md` is git-ignored scratch). Current look: `docs/reviews/hud-design-round6.png` (glasses) and `spotter-round6.png` (phone) — Maxx approves a rendered mock BEFORE a design round is coded.
- Three untracked `.claude/agents/cavecrew-*.md` files are Maxx's and are preserved; never delete, commit, or regenerate over them.
- No human decision is pending. Design round 6 (2026-10-01) is in specs 050/040 Decisions; the glasses image page is now 6 containers (4 image strips 288×96 / 288×144 + status; the message is a bitmap in the top strip). Earlier human decisions recorded in the specs: image-first HUD; ASCII-only text fallback (030 AC-9 dropped); rate limiting dropped (020 R4); fake-spotter, T018, 060, 070 deferred to after the first hardware session.

## Next work

**Maxx (this is now the critical path):** T101b QR-sideload the glasses app; T102 first Cloudflare deploy (Worker + spotter assets) — never done by an agent; T026 / T002c simulator scenarios on the machine with simulator 0.9.5 open; then T104/T109 on real glasses. Findings feed T051.

**Agents:** T050 — relay heartbeat + validation (020 AC-7, AC-9) in one task; Sonnet-tier is fine. Then nothing until hardware evidence arrives.

## How to put it on the glasses

Since T058 (Maxx 2026-09-30: "a deployable app not requiring a PC running locally") one Cloudflare Worker serves everything: the relay, the spotter PWA at `/`, and the glasses app at `/glasses/`.

1. **Deploy (once per change, from any machine with `wrangler login`):** `npm ci`, then `npm run deploy` at the repo root (= typecheck → `npm run build:site` → `wrangler deploy` from `services/relay`). `site/` is build output and git-ignored. Dry run: `npm run build:site`, then `npx wrangler deploy --dry-run` in `services/relay`.
2. **Spotter:** open `https://g2-race-relay.maxx-384.workers.dev/` on the phone (Add to Home Screen), set a PIN, Start.
3. **Driver:** on the spotter phone tap the room chip in the header. The driver setup screen shows ROOM, PIN, a QR and the URL it carries — `https://g2-race-relay.maxx-384.workers.dev/glasses/?room=<ROOM>&pin=<PIN>&name=driver`. Driver: Even app → Developer Mode → Scan → aim at the code. The glasses app loads from the relay and joins the room; no PC, no typing.
4. New relay origin (custom domain)? Put it in `apps/glasses/app.json`'s network whitelist and redeploy — the build copies `app.json` next to the hosted `index.html`.

The dev-PC path (`npm run dev -w apps/glasses` + `npx evenhub qr --url http://<ip>:5173`, relay from `apps/glasses/.env`) still works for local iteration.

## Workflow and gates

Use one isolated lease, one fresh worker, one task, and one commit. A fresh `protocol-keeper` reviews the exact range **and writes `ralph/last-review.md` before the planner runs** — two commits landed without a review record this week; do not repeat that. Integrate only an approved stack and rerun all gates. Never assign `[HW]` work to an agent, redefine wire types outside `packages/protocol`, show stale driver data as live, commit secrets, or hand-edit generated `.claude/`/`.codex/` files (edit `agents/roles/` or `.agents/skills/` and run `node scripts/sync-agents.mjs`).

```powershell
$env:Path='C:\Users\maxx\.cache\g2-race-spotter-node22\node-v22.23.2-win-x64;'+$env:Path
$env:npm_config_cache='C:\Users\maxx\.cache\g2rs-npm-main'
$env:NODE_ENV=''            # this machine sets NODE_ENV=production system-wide; without this, npm ci skips every devDependency
npm ci --include=dev
npm run typecheck
npm test
npm run lint
npm run check:pins
npm run sync:agents:check
node scripts/check-environment.mjs
```

From `cmd` (or when PowerShell's execution policy blocks `npm.ps1`) use `npm.cmd` / `npx.cmd` with the same `Path` prefix.

Relay work also requires its focused live Wrangler test, `npx wrangler types src/worker-configuration.d.ts --check`, and `npx wrangler deploy --dry-run` with isolated temporary spotter assets. Never deploy or set secrets without explicit permission.

## Prompt for the receiving LLM

> Read `HANDOFF.md`, `AGENTS.md`, the constitution, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, the latest file under `docs/reviews/`, spec 020, and the race-relay-protocol skill. Do not edit yet. Confirm `master` matches the plan's `Done this cycle` and that every root gate is green. Then take the first unchecked task under `## Next` (T050) with an isolated lease and a fresh worker; do not start T051 until Maxx has recorded hardware evidence. Quote the task line's reviewer guidance in the worker prompt. Run every Node 22 and live Wrangler gate, obtain a fresh exact-range `protocol-keeper` review written to `ralph/last-review.md`, integrate only on approval, and have the planner reconcile the result. Preserve the untracked `cavecrew-*` agents and the quarantined worktrees.
