# G2 Race Spotter — current agent handoff

Snapshot: 2026-10-28 (America/New_York)
Latest application commits: `6cf87b5` (T050 relay reaper + validation) on top of `ef8d476` (T065 client liveness). `git log --oneline -1` on `master` is authoritative.

## Read first

Work in `C:\Users\maxx\Documents\EVEN G2 HUD` (the PC clone) or a fresh clone of GitHub `master`. The OneDrive folder `C:\Users\maxx\OneDrive\Documents\EVEN G2 HUD` is a stale, git-less mirror frozen at 2026-09-04 — do not read status from it. Read `AGENTS.md`, `specs/000-constitution.md`, `ralph/README.md`, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, `ralph/last-review.md`, `specs/020-protocol-and-relay.md`, and `.agents/skills/race-relay-protocol/SKILL.md`. Specs are authoritative; later committed plan/progress changes supersede this snapshot.

## Current status

- Branch `master`; plan status `BUILDING` (consolidated plan since 2026-09-04); no active lease; remote `origin` = https://github.com/MS-aesthetic/g2-race-spotter (public, `master`). Push after every integration; the OneDrive bundle hand-off is retired.
- **Both apps exist now.** Glasses app (`apps/glasses`, image-first HUD drawn from primitives; edit `src/render/hud-design.ts` to change the look) and spotter PWA (`apps/spotter`, 6 KB gz) are integrated with the relay and the shared `RoomClient`. Automated criteria met: 010 AC-1/2/6/7; 020 AC-1–6, 8; 030 AC-1–6; 040 AC-1–5; 050 AC-1–5.
- Main passes on Node 22 (2026-10-28, T050 + T065 integrated): typecheck, **445/445** tests (52 files, live `wrangler dev`), lint (0 errors, 2 pre-existing generated-d.ts warnings) + prettier, `check:pins`, `sync:agents:check`, both app builds, `wrangler deploy --dry-run` with the real spotter assets. Read gate exit codes, never grep their output.
- Reviews for every application commit live under `docs/reviews/` (latest: `2026-10-28-round-12-T050-T065.md`; `ralph/last-review.md` is git-ignored scratch). Current look: `docs/reviews/hud-design-round6.png` (glasses) and `spotter-round6.png` (phone) — Maxx approves a rendered mock BEFORE a design round is coded.
- Three untracked `.claude/agents/cavecrew-*.md` files are Maxx's and are preserved; never delete, commit, or regenerate over them.
- No human decision is pending. Design round 6 (2026-10-01) is in specs 050/040 Decisions; the glasses image page is now 6 containers (4 image strips 288×96 / 288×144 + status; the message is a bitmap in the top strip). Earlier human decisions recorded in the specs: image-first HUD; ASCII-only text fallback (030 AC-9 dropped); rate limiting dropped (020 R4); fake-spotter, T018, 060, 070 deferred to after the first hardware session.

## Next work

**Maxx (the critical path):** T118 redeploy (`npm run deploy`) so the live relay has T050/T065 — round 6 is already live; T101b QR-sideload from the spotter page; then one bench session on real glasses covering T109 (image not garbled/mirrored — nibble/stride), T104 (lane/cars/message latency), 060 AC-5/6 (lock the driver phone 5 min → HUD back on its own) and a spotter data off/on (glasses recover within ~10 s). Save notes/photos under `qa/<date>/`. Findings feed T051.

**Agents:** nothing open until hardware evidence arrives; then T051 (+ T054 housekeeping in the same batch).

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

> Read `HANDOFF.md`, `AGENTS.md`, the constitution, `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, the latest file under `docs/reviews/`, and the skills for the area you touch. Do not edit yet. Confirm `master` matches the plan's `Done this cycle` and that every root gate is green. Do not start T051 until Maxx has recorded hardware evidence under `qa/<date>/`; scope it from that evidence. Every integration gets a fresh exact-range review recorded under `docs/reviews/`. Preserve the untracked `cavecrew-*` agents.
