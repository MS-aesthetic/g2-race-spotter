# Implementation plan — 2026-10-28 (stability: T050 + T065)

Status: BUILDING — code complete for the first hardware session
Current spec focus: hardware evidence (Maxx). No agent code task is open until that session reports back.

## Model routing (either vendor per tier — pick per run, mixing is fine)

| Tier | Claude | OpenAI |
|---|---|---|
| worker — small task | Sonnet 5 @ high | GPT 5.6 Terra @ high |
| worker — consolidated task (T030/T040/T050 below) | Opus 5 @ high | GPT 5.6 Sol @ high |
| reviewer (`protocol-keeper` / `hud-qa`) | Opus 5 @ high | GPT 5.6 Sol @ high |
| planner (`plan-updater`) | Opus 5 @ xhigh | GPT 5.6 Sol @ xhigh |
| auditor (human-invoked final QA) | Fable 5.1 / Opus 5 @ xhigh | GPT 5.6 Sol @ xhigh |

## Consolidation (Maxx, 2026-09-04)

The one-criterion-per-iteration slicing cost ~3 iterations per task and the app is small. From here: **one task per app or subsystem**, a strong worker, one exact-range review per task, the auditor over the batch. Image HUD first (no text-first phase); text is an ASCII fallback. Rate limiting dropped; fake-spotter scenarios, client verifier polish (old T018), 060 hardening and 070 packaging deferred until after the first hardware session. Simulator runs are Maxx's (`npm run sim:scenarios` on his machine) once T030 lands.

## Active stream leases (interactive coordinator only)

- No active leases. T065 (`ef8d476`) and T050 (`6cf87b5`) were done directly by the coordinator on 2026-10-28 with a fresh exact-range review — `docs/reviews/2026-10-28-round-12-T050-T065.md`.
- Closed: L021 (T063) `6eab30d`, L022 (T064) `2ede204` — review `docs/reviews/2026-10-01-round-11-T063-T064.md`.
- Closed: L019 (T052), L020 (T053) and the round 3–5b leases — see `ralph/PROGRESS.md`.

## Next (ordered; the serial runner takes the first unchecked task)

- [ ] T051 (owner: g2-glasses-dev) (spec: 050 image polish) [depends:T030 integrated; T104/T109 evidence] Whatever the first hardware session shows: nibble order / stride flip, pacing, `sendFailed` behaviour, design tweaks in `hud-design.ts`. Scoped by Maxx after the session; do not start before.
- [ ] T054 (owner: plan-updater + any worker, Sonnet-tier) Housekeeping collected by the review records (role files, `hud-e2e-testing` skill, BUILD_PLAN §3/§5, constitution/AGENTS v1 prose, PWA icons, `HUD_GAP_FLUSH_MS` rename). Not blocking; batch it with T051.

## Needs simulator [SIM] — Maxx runs these on his machine

- [ ] T002c (owner: maxx) (spec: 010 AC-3) `npm run sim:scenarios -- --smoke` with simulator 0.9.5 open; commit `qa/<date>/sim/report.json` + `smoke-01.png` (records the real `getDeviceInfo()` for T003c).
- [ ] T026 (owner: maxx) (spec: 050 AC-5b, 030 AC-7) [depends:T030 integrated; needs a local relay: `npm run dev -w services/relay` + the spotter PWA or a hand-sent frame] `npm run sim:scenarios` in image mode for `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay`; commit `qa/<date>/sim/image/*.png` + `report.json`. This is the first look at the actual HUD design — expect to iterate `hud-design.ts` afterwards.

## Deferred (not before the first hardware session)

- T003c environment TBD removal (after T002c); T014 fake-spotter scenarios (real phones are the scenario runner); T018 client verifier polish (shared fakes, numeric-close detail, error-before-closed ordering, try/catch around listeners); spec 060 hardening (Android/iOS lifecycle, redeploy recovery, structured tail); spec 070 race-day packaging.

## Needs human [HW]

- [ ] T118 (owner: maxx) Redeploy the relay with T050 + T065 (`npm run deploy` from the PC clone after pulling `master`). Round 6 is already live — verified 2026-10-28: the deployed spotter bundle `main-BC16Fc7e.js` matches a `build:site` of `2708fb0`.
- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode in the Even app, scan the QR from the spotter page's room overlay (no PC needed since T058), save a photo/log under `qa/<date>/`. **First real information the project gets.**
- [x] T102 (owner: maxx) (spec: 020 AC-10) Deployed 2026-09-04 to `https://g2-race-relay.maxx-384.workers.dev` (account `maxx-384`); `DEBUG_KEY` not yet set; `qa/<date>/020-deploy.log` not yet saved — Maxx to paste the deploy output when convenient.
- [ ] T104 (owner: maxx) (spec: 030 AC-8) Real-glasses `lanes`, `gap-sweep`, `message-ack`, `link-loss` from the spotter PWA; `qa/<date>/REPORT.md`.
- [ ] T106 (owner: maxx) (spec: 030 AC-10) `wss://` upgrade on hardware against the whitelisted origin; note in `docs/ENVIRONMENT.md`.
- [ ] T107 (owner: maxx) (spec: 040 AC-6) Install + join on iOS Safari and Android Chrome; landscape check; `qa/<date>/040-*.png`.
- [ ] T108 (owner: maxx) (spec: 040 AC-7) Two phones + glasses over LTE; lane-call latency in `qa/<date>/REPORT.md`.
- [ ] T109 (owner: maxx) (spec: 050 AC-6) Bright-column test pattern → nibble/stride confirmation in `docs/ENVIRONMENT.md`.
- [ ] T110 (owner: maxx) (spec: 050 AC-7) `gap-sweep` + 10-minute soak; `latency.csv`.
- [ ] T111 (owner: maxx) (spec: 050 AC-8) Exit dialogue → text fallback within 3 sends.
- Deferred with 060/070: T112–T117.

## Done this cycle

- [x] T065 (coordinator, 2026-10-28) `ef8d476` — `RoomClient` drops a socket silent for `SOCKET_SILENT_MS` (6 s) or not open within `CONNECT_TIMEOUT_MS` (10 s) and reconnects; same-URL `connect()` replaces a socket quiet for > 2 ping periods; spotter reconnects on `visibilitychange`/`pageshow`/`online`. Half-open LTE sockets previously never recovered until the OS gave up.
- [x] T050 (coordinator, 2026-10-28) `6cf87b5` — relay silent-peer reaper (020 AC-7) + joined-socket validation (020 AC-9). 445/445 tests.
- [x] T063 + T064 design round 6 (approved from mocks first): 500 ms ×8 lane blink, bitmap message in 288×96 top strips blinking 1 s for 5 s, L-shaped corner bars + centre-out middle bar in 288×144 bottom strips; spotter: no CLEAR, square lanes, 2×2 messages, no Save/chips. `6eab30d`, `2ede204`. Relay redeployed (verified live 2026-10-28).
- [x] T060 + T061 design round 5 (corner arcs, vertical middle bar, ◀▲▶ + blink, faders, renamed presets). Relay redeployed.
- [x] T058 hosted glasses app + QR driver setup; T059 solid fills. `npm run deploy` is the one-command deploy.
- [x] T056 + T057 design round 4 (presets/random room/24 h TTL/new spotter layout; four-strip perimeter HUD). Relay redeployed.
- [x] T055 design round 3 (`4f1c746`, `87500c0`, `976cf47`, `b7139b5`, `da3823b`, `b1dbb78`, T055c). Relay redeployed with protocol v2.
- [x] T052 design round 1 (`56d979b`, `510bd90`, `b07aad5`); T053 design round 2 (`c0e5d18`, `b6d94cc`, `9276828`, `50678f2`); T102 first deploy done by Maxx (relay live at `https://g2-race-relay.maxx-384.workers.dev`, redeployed after each round). See `docs/reviews/2026-09-04-round-4-5-T052-T053.md`.
- [x] T030 (g2-glasses-dev) (030 AC-1–AC-6, 050 AC-1–AC-5) `a1fea67` + `253a238` + `9fe6c90` — image-first glasses app: `render/primitives.ts`, `render/hud-design.ts` (the one file to edit for a new look), `draw-hud.ts`, `gray4.ts`, `sdk-quirks.ts`, ASCII `text.ts`, `mode.ts`, `queue.ts`, `link.ts`, `input.ts`, `settings.ts`, companion page, `even-bridge.ts` (only SDK importer). 13 test files. Review approve with nits, nits fixed. Preview: `docs/reviews/hud-design-preview.png`.
- [x] T040 (spotter-pwa-dev) (040 AC-1–AC-5) `9a392a0` + `c000566` — join + console + PWA shell, 150-line vdom, `RoomClient` wrapper with pong-teed latency, SW that precaches the shell and never touches `/room/*`. 6 KB gz JS. Review approve with nits, nits fixed.
- [x] auditor `90a0e73` — eviction live test waits for the matching frame (pre-existing 1-in-5 flake).
- [x] T009 `b28cc2c` (020 AC-5 driver eviction); T017 `c9fb8b6` + `8bf5531` (client `onError`, `{code, terminal}`, terminal-close queue clear, `connect()` replay guard); docs `d633a5d`; `9fd612b`; `d447981`.
- [x] Earlier: T011 chain (`7bab61a`, `4181e34`, 020 AC-6); T006 chain (`68d9776`, `fa63af2`, `c1218e7`, 020 AC-8); T016 `0909521`; T008/T008a; T007a/T007c; T007/T007b; T004–T004c; T005/T005a — see `ralph/PROGRESS.md`.

## Notes / why

- 2026-10-28 stability pass (Maxx: "tell me … what i need to do so that I can actually use this with some level of stability", then "do the fixes now"): no simulator or hardware evidence exists in `qa/` yet; the only code risks left before a track session were half-open sockets (no client ever acted on `lastFrameAt` — reconnect happened only on `FOREGROUND_ENTER_EVENT`) and the relay never reaping silent peers (`S` could stay lit for a dead spotter phone). Both fixed. The OneDrive mirror (`C:\Users\maxx\OneDrive\Documents\EVEN G2 HUD`) is frozen at 2026-09-04 and its `_xfer\round6.bundle` is already on GitHub — the PC clone + GitHub are the only live copies.
- 2026-10-01 design round 6: showing Maxx rendered mocks (PIL from the real top strip + the proposed geometry) BEFORE writing code took four quick iterations on the corner shape and cost no worker tokens; both leases then landed in one iteration each with an in-lease nit pass. T054 housekeeping grows again (role files, hud-e2e-testing skill, BUILD_PLAN §3/§5 — see the review record).
- 2026-09-25 design round 4: SDK 0.0.12 page caps are 4 image / 8 text / 12 containers (RESEARCH_NOTES §2) — the worker stopping on the type instead of working around it saved a hardware-only failure. Open items listed in the round-7 review record; T054 housekeeping now also covers 040 R2–R5, 050 Scope/R1, cloudflare-relay-deploy 24 h.
- 2026-09-25 design round 3 lessons for T050 (done 2026-10-28 — the reaper runs first in the same `alarm()`): the relay alarm now also serves the 6 s stale clear (`alarm.ts`, keyed on `calledAt`, earlier-only re-pointing); T050's silent-peer reaper must compose with it, not replace it. T054 housekeeping grows: v1 (`gap`/`side`) prose in AGENTS.md §3/§47, constitution §3, `hud-e2e-testing` skill, role files; rename `HUD_GAP_FLUSH_MS`; PWA icons; optional drag across segments.
- 2026-09-04 design rounds: Maxx iterates live (phone + simulator) and each round is one lease with an Opus worker, one review, an in-lease nit pass, integrate, redeploy — ~30–40 min per round. Housekeeping task T054 collects the doc drift and small nits the reviews listed (see the review record) so they do not pile up: rewrite 030 R3/AC-4 + constitution §1 + BUILD_PLAN for the L/S strip; purge slider/throttle prose from the protocol + e2e skills, the spotter role and BUILD_PLAN; add `playwright-core` to `check:pins`; cap the auto-ack retry; `export function start(root)` in the spotter so wiring is testable; make every relay live test wait for a matching frame (flakes under parallelism).
- 2026-09-04 round 3: both consolidated app tasks landed in one iteration each with an in-lease nit pass — the consolidation paid for itself immediately. What is left before race day is mostly Maxx's: sideload (T101b), deploy (T102), first real-glasses run (T104), then T051 for whatever that shows. T050 (relay heartbeat + validation) is the only remaining pre-hardware code task and can run while Maxx tests.
- 2026-09-04 consolidation: Maxx judged the per-criterion slicing too expensive for an app this size. T020–T025 + 050's automated criteria → T030; spec 040 → T040; T012 + T013 (minus rate limiting) → T050; T014/T018/060/070 deferred. Consolidated tasks get an Opus-tier worker because a review block on a large task costs more than the model-tier difference.
- Image-first: the HUD is a bitmap composed from primitives; `hud-design.ts` is the single file to edit for a new look, and the golden snapshots pin whatever design is current. Text mode is ASCII-only, so the glyph-sheet hardware check is gone.
- The simulator (Maxx's machine, interactive window) is the functional check for the HUD; nibble order, pacing and `sendFailed` remain hardware questions, deliberately parked ("timers/update rates later").
- T030 and T040 are disjoint (glasses vs spotter) and run as parallel leases; T050 can run alongside either. The serial runner order is T030 → T040 → T050.
- `ralph/loop.sh` still honours only `owner:` and `[HW]`; `depends:`/`lock:` are honoured by agents reading the plan.
- The three untracked `.claude/agents/cavecrew-*.md` files are Maxx's; never delete, commit, or regenerate over them.
- AC audit 010: AC-1/2/6/7 met; AC-3/AC-5 `[SIM]`/T003c; AC-4 `[HW]`. 020: AC-1–9 met (AC-7/AC-9 by T050, 2026-10-28); AC-10 `[HW]` (deployed; `qa/` log still to save). 030: AC-1–6 met, AC-7 `[SIM]` T026, AC-8/10 `[HW]`, AC-9 dropped. 040: AC-1–5 met, AC-6/7 `[HW]`. 050: AC-1–5 met, AC-5b `[SIM]` T026, AC-6–8 `[HW]`. 060/070 deferred.
- No criterion is `DISPUTED`; the 2026-09-04 spec changes (030 AC-9 dropped, 020 R4 rate limiting dropped, image-first) are human decisions recorded in each spec's Decisions. No simulator or hardware evidence is claimed; no deployment or secrets.
