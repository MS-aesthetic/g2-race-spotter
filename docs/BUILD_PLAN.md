# G2 Race Spotter — Build Plan

A spotter watching the race uses their phone to tell the driver which lane to be in and how close the car behind is, and to push short text messages. The driver sees it in Even Realities G2 glasses. This plan covers architecture, the exact HUD spec, the wire protocol, phases with exit criteria, risks, and how the project-local agents and skills are meant to be used.

Read `docs/RESEARCH_NOTES.md` first if you have not; every constraint below traces back to it.

## 1. Product definition

**Roles**

- **Spotter** — in the stands / pit wall with a phone. Opens the spotter web app, joins a room, and drives three controls: lane buttons (bottom ▼, middle ●, top ▲), a "car behind" slider, and a message box.
- **Driver** — wearing G2 glasses, phone in the car running the Even app with our Hub app loaded. Sees the lane symbol, the closeness bar under it, and a message line. Can tap the temple to acknowledge/clear a message.

**Non-goals for v1:** audio, two-way chat, telemetry, multiple spotters per driver, more than one driver per room, app-store submission polish. The architecture leaves room for each.

## 2. Architecture

```
 Spotter phone                    Cloudflare                      Driver phone (Even app)          G2 glasses
 ┌───────────────┐   wss    ┌────────────────────┐   wss   ┌────────────────────────┐  BLE  ┌───────────┐
 │ spotter PWA   │ ───────► │ Worker             │ ──────► │ Even Hub app (WebView) │ ────► │ LVGL      │
 │ (Vite + TS)   │ ◄─────── │  └ RaceRoom DO     │ ◄────── │  Vite + TS + SDK       │ ◄──── │ renderer  │
 └───────────────┘   acks   │  (one per room)    │   acks  └────────────────────────┘ taps  └───────────┘
                            │ + static assets    │
                            └────────────────────┘
```

Three deployable pieces plus one shared package, in a single npm-workspaces monorepo:

| Path | What | Stack |
|---|---|---|
| `apps/glasses` | Even Hub app (driver side) | Vite + TypeScript + `@evenrealities/even_hub_sdk` |
| `apps/spotter` | Spotter PWA | Vite + TypeScript (vanilla or Preact), web manifest, service worker |
| `services/relay` | Worker + `RaceRoom` Durable Object; also serves `apps/spotter` build as static assets | Cloudflare Workers, wrangler, WebSocket Hibernation API |
| `packages/protocol` | Message types, validation, constants, reducer for room state | TypeScript, zero runtime deps (hand-rolled guards or a tiny validator) |

Why this split: the glasses side must be an Even Hub web app (that is the only way onto the G2 display), the spotter side gains nothing from being native, and putting both behind one Worker origin means a single `https://` entry in the glasses app's network whitelist and no CORS surprises.

**Data flow:** the spotter sends small *intent* messages (`lane`, `gap`, `msg`, `clear`). The `RaceRoom` DO folds them into one authoritative **room state** and broadcasts the whole state (with a sequence number) to the driver. The driver app is a pure function of the latest state: it diffs against what is currently on the glasses and issues the minimum bridge calls. Full-state snapshots make reconnects trivial (the DO replays the current state on join) and make out-of-order delivery harmless (drop anything with a lower `seq`).

## 3. HUD specification (glasses)

Canvas 576×288, 4-bit grey. All coordinates absolute.

### Containers (one page, created once)

| ID | Name | Type | Rect (x,y,w,h) | zOrder | Purpose |
|---|---|---|---|---|---|
| 1 | `bg` | text | 0,0,576,288 | 1 | `content: ' '`, `isEventCapture: 1` — required event-capture backdrop for an image-first page |
| 2 | `hud` | image | 144,8,288,144 | 3 | Lane symbol + closeness bar rendered as one 288×144 gray4 bitmap (centred horizontally) |
| 3 | `msg` | text | 16,160,544,96 | 4 | Message line from spotter (`textColor` 4). Empty string when none. |
| 4 | `status` | text | 16,258,544,28 | 5 | `LINK OK · SPOTTER ON` / `LINK OK · SPOTTER OFF` / `NO LINK` / `CONNECTING…` — small status strip (28 px is an assumption to confirm with `/font-measurement` in Phase 0) |

In text mode (`?render=text` or the stored override) slot 2 is a text container with the same rect instead of the image container. Image mode is the default on hardware **and** in the simulator (pinned 0.9.5 renders the full 288×144 image); the simulator is never detected to change rendering.

Status text is the only thing that should ever be visible when the link is dead; the HUD image is dimmed (see below) so the driver never trusts stale data.

### HUD bitmap layout (288×144)

- Symbol region: rows 0–95, centred. Up-triangle (top lane), filled circle (middle lane), down-triangle (bottom lane). Roughly 88 px tall, full brightness (level 15). No lane selected yet → draw nothing in the symbol region.
- Bar region: rows 108–140. Outline 288×32 at level 6; fill from left proportional to `gap` (0–100) at level 15. Optional tick marks at 25/50/75 at level 3. At `gap ≥ 90` the fill inverts (outline 15, fill 8) so "on your bumper" is unmistakable without animation.
- Stale/no-link: render the same frame at half intensity (divide every pixel value by 2) so shape stays readable but clearly "greyed out".

The symbol + bar go in **one** image container on purpose: one `updateImageRawData` call per change (~104 ms fixed + ~3.9 ms/KB; a full 288×144 gray4 frame is ~20.7 KB, so ≈185 ms, ~5 fps ceiling), no sequential reveal, and it keeps the per-page image count at 1.

### Text fallback path

Because the image channel can wedge after the exit dialogue (known firmware defect), the renderer must also support a **text-only mode**: a single text container showing `▲` / `●` / `▼` followed by a bar made of `█` and `░` characters (e.g. `▲\n████████████░░░░░░░░  62` — 20 cells, `round(gap/5)` filled). Switch to this mode automatically after 3 consecutive `sendFailed` results (in-memory, until restart), and select it at startup via `?render=text` or the stored `g2rs:v1:render` override (never by detecting the simulator — see the `g2-hud-display` skill). `▲ ● ▼` are hardware-verified glyphs; `█ ░ · …` are not yet, so every non-ASCII character sits behind `src/render/glyphs.ts` with an ASCII fallback, and Phase 2 verifies them on real glasses.

### Update policy

- `gap` changes are **coalesced, latest-wins**, and flushed at most every **250 ms** (4 fps). Faster is wasted — the BLE path cannot render it and the driver cannot read it.
- `lane` changes flush immediately (they pre-empt any pending gap flush; both land in the same bitmap anyway).
- `msg` changes use `textContainerUpgrade` on container 3 only (~83 ms). Never rebuild the page for a message.
- Status strip updates only on state transitions, never on a timer.
- One in-flight bridge call at a time. A tiny async queue with "replace pending image job" semantics lives in `apps/glasses/src/render/queue.ts`.

### Input on glasses

- Single tap (either temple or ring): acknowledge → sends `ack{msgId}` to the room; the next `state` frame carries `ackedAt`, the glasses hide the text, and the spotter sees a tick. The driver never clears locally — rendering stays a pure function of the last `state`, so the message cannot pop back.
- Double tap on the root page: must open the exit dialogue (`shutDownPageContainer(1)`) — Even submission requirement. Because that path can wedge the image channel, the app switches to text fallback if the next image send fails.
- Swipe up/down: reserved (later: cycle brightness / toggle text mode).

## 4. Wire protocol (v1)

Canonical definition lives in `packages/protocol` and in the `race-relay-protocol` skill. Summary:

- Transport: WebSocket, JSON text frames, one message per frame. URL: `wss://<host>/room/<ROOM>?role=spotter|driver&token=<optional pin>`.
- Rooms are 4–6 uppercase alphanumerics chosen by the spotter (e.g. `CAR42`). An optional 4-digit PIN is set by whoever connects first to a fresh room and gates later joins. Rooms expire after 12 h of inactivity (DO alarm).
- Client → room: `hello {v, role, name?}`, `lane {lane: "top"|"mid"|"bot"|null}`, `gap {value: 0..100}`, `msg {text ≤ 80 chars}`, `clear {}`, `ack {msgId}`, `ping {ts}`.
- Room → clients: `state {seq, lane, gap, msg:{id,text,ts,ackedAt}|null, spotterOnline, driverOnline, updatedAt}`, `pong {ts, serverTs}`, `error {code, detail}`.
- The room broadcasts `state` to everyone on every change (spotter also receives it, which is how the spotter UI shows driver online/ack). Every `state` carries a monotonically increasing `seq`; clients discard `seq ≤ lastSeen` and reset `lastSeen` on every new socket.
- One driver per room, last writer wins: a reconnecting driver evicts its own stale socket rather than being locked out by it.
- Heartbeat: clients send `ping` every 2 s; a 3 s relay tick closes any socket silent for 6 s, which flips that peer offline and broadcasts the change. The driver app additionally goes to `NO LINK` if *it* has not heard anything from the room for 5 s.
- Message size cap 1 KB; unknown `t` values are ignored, not fatal. `v` bump is a breaking change; the room rejects mismatched majors with `error{code:"version"}`.
- A shared `RoomClient` in `packages/protocol` (Phase 1) is the only socket client in the project; both apps instantiate it.

## 5. Spotter PWA spec

- Screens: **Join** (room code, PIN, display name, remembered in `localStorage`) → **Console**.
- Console layout, portrait phone, thumb-reachable: three lane buttons stacked to match the glasses meaning (▲ top, ● middle, ▼ bottom), each ≥ 88 px tall, selected one highlighted; a horizontal slider labelled "Car behind" with 0 = clear, 100 = on bumper, plus quick-set chips (0 · 25 · 50 · 75 · 100); message text field with Send and Clear, last 5 quick messages as chips; a status header showing room, driver online/offline, round-trip latency, and a green tick when the driver acks a message.
- Slider emits at most every 100 ms while dragging (room and glasses throttle further). Lane buttons are one-tap, no confirm. Send is one-tap.
- Works offline-ish: the shell is cached by the service worker; a red "RECONNECTING" banner when the socket drops; controls stay enabled, intents issued while down are queued, and after reconnect the room's replayed state is truth and only the queued intents are flushed (never a re-send of an already-delivered message).
- No accounts. The room code is the security boundary; PIN optional.

## 6. Relay spec (Cloudflare)

- `wrangler.jsonc` with `durable_objects.bindings: [{name:"ROOMS", class_name:"RaceRoom"}]`, `migrations: [{tag:"v1", new_sqlite_classes:["RaceRoom"]}]` (SQLite backend is required for the free plan), `assets` pointing at `apps/spotter/dist`.
- Worker routes: `GET /room/:id` upgrades to WebSocket and forwards to `env.ROOMS.idFromName(id)`; `GET /health`; everything else → static assets.
- `RaceRoom`: `ctx.acceptWebSocket(ws, [role])` first (errors are frames on accepted sockets: a bad PIN gets `auth` and the *new* socket closes 4401; a driver that passes the PIN check causes the *previous* driver socket to get `role_taken` and close 4409); per-socket attachment `{role, name, lastPing}`; state persisted in DO storage on every change so a hibernated/evicted object resumes with the last state; `webSocketMessage` validates via `packages/protocol`, applies the reducer, bumps `seq`, persists, broadcasts; `webSocketClose` recomputes online flags; one DO alarm that ticks every 3 s while any socket is open (closing peers silent for 6 s) and is re-pointed at `updatedAt + 12 h` once the room is empty so expiry actually fires.
- CORS: `Access-Control-Allow-Origin: *` on HTTP routes (needed for the glasses WebView gate). WebSocket upgrades are not subject to CORS but the origin **must** still be in the glasses `app.json` whitelist.
- Observability: `console.log` structured lines (room, role, event, seq) visible in `wrangler tail`; a `/room/:id/debug` JSON endpoint (behind a secret header) returning current state for testing.

## 7. Phases

Each phase ends with a demo and a checked exit criterion. Estimated effort is for one focused developer using the agents.

### Phase 0 — Bootstrap (½ day)
Monorepo skeleton (`npm init -w`), TypeScript strict config shared via `tsconfig.base.json`, Node 22, ESLint + Prettier, `README.md` pointing at this plan. Install the official `everything-evenhub` Claude Code plugin. Scaffold `apps/glasses` from the `minimal` template with two scripts — `dev` (hardware) and `dev:sim` (`vite --mode simulator`, logging/relay-URL only, never rendering) — pin the simulator at 0.9.5 (verify with `npm view`), build the simulator scenario harness skeleton (`scripts/sim-harness.ts`, `npm run sim:scenarios`: launch with `--automation-port`, `/api/ping`, screenshot, `report.json`), prove the harness's smoke run shows "Hello, driver", and prove QR sideload works on real glasses with Developer Mode on. Record in `docs/ENVIRONMENT.md`: SDK, CLI, simulator, Even app and firmware versions, what `getDeviceInfo()` returns in the simulator vs hardware, and whether one line of the baked font fits in 28 px (`/font-measurement`). Simulator-derived fields are automated; hardware fields are a human's.
*Exit:* `npm run sim:scenarios -- --smoke` passes (`[SIM]`); "Hello, driver" renders on real glasses via QR sideload (`[HW]`); `docs/ENVIRONMENT.md` exists with all non-hardware fields filled.

### Phase 1 — Protocol + relay (1 day)
`packages/protocol` with types, guards, reducer (injected `ctx`), the shared `RoomClient` (injected `WebSocket` constructor, offline intent queue, `seq` filtering), and unit tests. `services/relay` with the DO, local dev via `wrangler dev`, an integration test using two `ws` clients (spotter joins, sends `lane`, driver receives `state` with the lane set and `seq > 0`; reconnect replays state; a second driver evicts the first). A `scripts/fake-spotter.ts` CLI that scripts lane/gap/msg sequences against any relay URL — this becomes the workhorse for testing the glasses without a second person.
*Exit:* integration tests green locally and against a deployed `wrangler deploy` on `*.workers.dev`.

### Phase 2 — Glasses app, text mode (1 day)
`apps/glasses`: bridge init, room join screen (room code via `bridge.getLocalStorage`, entered on the phone companion UI — the WebView page itself is visible on the phone, so a plain HTML form there is fine), the shared `RoomClient` wired to the bridge lifecycle, state store, **text-only renderer** first (fast to validate; the permanent fallback), render-mode selection (image is the default everywhere, text only by flag/override), `glyphs.ts` with ASCII fallbacks. Status strip and NO LINK behaviour. Single-tap ack. Double-tap exit dialogue.
*Exit:* `npm run sim:scenarios` passes in text mode (`[SIM]`); fake-spotter drives lane/gap/msg on real glasses (`[HW]`); NO LINK appears within 5 s of killing the relay; every non-ASCII glyph verified on hardware (or its fallback enabled); confirmed whether an `https://` whitelist entry also covers the `wss://` upgrade.

### Phase 3 — Spotter PWA (1 day)
Join + Console screens per §5, service worker, manifest, hosted from the Worker. Driver-online and ack indicators. Latency readout from `ping/pong`.
*Exit:* two phones, one relay, real glasses: spotter taps ▲ and the driver sees ▲ within ~0.5 s on decent LTE.

### Phase 4 — Image HUD (1–2 days)
gray4 bitmap renderer (`apps/glasses/src/render/hud-bitmap.ts`): draw symbol + bar into an offscreen canvas or a plain `Uint8Array` framebuffer, pack to 4-bit, send with `updateImageRawData`; coalescing queue; automatic fallback to text mode; half-intensity stale rendering. Measure and log per-call bridge latency. Verify on hardware that the pacing (100 ms) and the 250 ms gap flush feel right in a moving car — tune constants, not code.
*Exit:* `npm run sim:scenarios` passes in image mode (`[SIM]`: shapes, bar widths, inversion, dim, message); on hardware ≤4 image sends/sec sustained for 10 min with no `sendFailed`, symbol readable at a glance, ack flow works (`[HW]`).

### Phase 5 — Hardening (1 day)
Android background survival (persist room/PIN/name via `bridge.setLocalStorage`, re-arm socket on `FOREGROUND_ENTER_EVENT`, cold-start restores last state from the room's replay), room PIN, per-socket rate limit in the DO (e.g. 30 msg/s), payload validation everywhere, error UX on both ends, the 5-minute-lock beta test from the Even docs, `wrangler tail` review after a session.
*Exit:* lock the driver phone 5 min → unlock → HUD is correct within 5 s with no user action on iOS; on Android the app recovers on foreground.

### Phase 6 — Track day + packaging (½ day + a race)
Custom domain on the Worker, final `app.json` whitelist, `evenhub pack` → `.ehpk`, sideload instructions for the driver, spotter "add to home screen" instructions, a one-page **race-day checklist** (`docs/RACE_DAY.md`: charge glasses, keep Even app foreground, screen lock timeout off, room code agreed, test ▲●▼ before grid). Collect feedback and latency logs; decide whether to pursue Even Hub store submission.

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cell coverage at the track is poor | Stale data mid-race | NO LINK + dimmed HUD within 5 s; driver never sees stale data as live. Consider a hotspot from the pit and test at the actual venue before race day. |
| Android suspends the Even app WebView | Silent loss of feed | Driver runs iOS if possible; on Android keep screen on and Even app foreground; auto-restore on foreground. Documented in race-day checklist. |
| Image channel wedges after exit dialogue | HUD stops updating | Automatic text fallback after 3 `sendFailed`; avoid triggering the exit dialogue mid-session. |
| SDK/simulator drift (0.0.x) | Build breaks | Pin exact SDK/CLI/simulator versions; `docs/ENVIRONMENT.md` records tested versions; re-run `/sdk-reference` when bumping. |
| Simulator ≠ hardware (no on-device image-size enforcement, no LZ4, no BLE pacing, not pixel-perfect) | False confidence | Two evidence classes: `[SIM]` from the automated harness proves function; `[HW]` proves compatibility and readability and stays a phase exit criterion. Image mode runs in both. |
| Even App < 2.2.7 garbles LZ4 images | Corrupt HUD | Require Even App ≥ 2.2.7 on the driver phone; check `getDeviceInfo` and warn. |
| Font glyph coverage | Symbols dropped in text mode | ▲ ● ▼ are hardware-verified; `█ ░ · …` are verified on hardware in Phase 2 and every non-ASCII glyph has an ASCII fallback in `glyphs.ts`; `/font-measurement` to confirm widths. |
| Room hijack | Prankster pushes bad lane calls | PIN, obscure room codes, rate limiting, spotter name shown on the driver's phone companion screen. |
| Legality / safety | Distraction while driving | HUD is intentionally minimal; the driver never has to look at anything but a symbol and a bar. Keep it that way — resist feature creep on the glasses side. |

## 9. Working with the agents and skills

Roles are canonical, model-agnostic prompt files in `agents/roles/*.md`; `scripts/sync-agents.mjs` generates Claude Code subagents (`.claude/agents/`) and Codex custom agents (`.codex/agents/*.toml`) from them, with model and effort per tier taken from `ralph/models.env`. Project skills live in `.agents/skills/` (read natively by Codex) and are mirrored to `.claude/skills/`. The official `everything-evenhub` plugin supplies SDK-level reference on both runtimes. See §11 for how the phases below are actually executed.

| Agent | Owns | Reaches for |
|---|---|---|
| `g2-glasses-dev` | `apps/glasses` | `g2-hud-display`, `race-relay-protocol`, plugin skills `/glasses-ui`, `/handle-input`, `/background-state`, `/sdk-reference` |
| `relay-backend-dev` | `services/relay`, `packages/protocol` | `race-relay-protocol`, `cloudflare-relay-deploy` |
| `spotter-pwa-dev` | `apps/spotter` | `spotter-ui`, `race-relay-protocol` |
| `protocol-keeper` | cross-cutting review of anything touching messages/state | `race-relay-protocol` |
| `hud-qa` | tests, simulator automation, latency measurement, race-day checklist | `hud-e2e-testing`, plugin skills `/test-with-simulator`, `/simulator-automation` |
| `plan-updater` | `IMPLEMENTATION_PLAN.md`, `ralph/PROGRESS.md`, spec *Decisions*/*Open questions* | `race-relay-protocol`, `g2-hud-display` |

Hand-driven use (Claude Code): `@agent-relay-backend-dev implement T004 from IMPLEMENTATION_PLAN.md`, then `@agent-protocol-keeper review HEAD`. Loop use: §11.

## 11. Process: spec-driven development in a Ralph loop

The phases in §7 are the *design narrative*. What agents actually execute is `specs/` (one spec per phase, each with numbered acceptance criteria and a named verification) driven by a Ralph loop (`ralph/loop.sh`): every iteration is a fresh-context **build** step by a worker role (one task, tests as backpressure, one commit), a fresh-context **review** step by a reviewer role (adversarial, against the cited criterion, one verdict), and a fresh-context **replan** step by `plan-updater` (reconcile specs ↔ code ↔ review, rewrite the plan, decide DONE). Model tiers: workers on Sonnet 5 / GPT 5.6 Terra at high effort, reviewers on Opus 5 / GPT Sol 5.6 at high, the planner on Opus 5 / GPT Sol 5.6 at x-high — configured in `ralph/models.env`, never in prompts.

Hardware-dependent criteria are tagged `[HW]`, never assigned to a worker, and surface under *Needs human* in the plan and in `ralph/PROGRESS.md`. Specs may be clarified by agents but only weakened by a human. Full instructions: `ralph/README.md`; invariants: `specs/000-constitution.md`.

## 10. Open questions for Maxx (decide before Phase 3)

1. Bar direction and meaning: the specs assume fill grows as the car behind gets closer (0 = clear, 100 = on bumper). If you would rather have a "gap remaining" gauge that shrinks, say so before Phase 3 — it is a one-line change in the renderer and the slider labels, but the wording is everywhere.
2. Should the lane symbol also carry a *direction to move* (e.g. blink when the lane call changes) or just show the target lane?
3. Message presentation: single line that stays until tapped (proposed), or auto-clears after N seconds?
4. Driver phone platform on race day (iOS strongly preferred for background reliability).
5. One room per car per event, or a persistent room per driver?
