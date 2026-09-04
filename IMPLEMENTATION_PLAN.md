# Implementation plan — 2026-09-04T09:45:00-04:00

Status: BUILDING
Current spec focus: specs/020-protocol-and-relay.md

## Model routing (either vendor per tier — pick per run, mixing is fine)

| Tier | Claude | OpenAI |
|---|---|---|
| worker (every `owner:` task below) | Sonnet 5 @ high | GPT 5.6 Terra @ high |
| reviewer (`protocol-keeper` / `hud-qa`) | Opus 5 @ high | GPT 5.6 Sol @ high |
| planner (`plan-updater`) | Opus 5 @ xhigh | GPT 5.6 Sol @ xhigh |
| auditor (human-invoked final QA) | Fable 5.1 / Opus 5 @ xhigh | GPT 5.6 Sol @ xhigh |

## Active stream leases (interactive coordinator only)

- No active leases. Quarantined worktrees `L009` (`ralph/L009-T006c`, `1872085` + `stash@{0}` `d84a200`) and `L014` (`ralph/L014-T011c`, `581bead`) are superseded by the integrated commits below and are kept only for traceability; do not lease from them.

## Next (ordered; the serial runner takes the first unchecked task)

- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) [stream:relay-room; lock:relay-room; depends:T011d integrated (`4181e34`)] Implement PIN-checked last-writer-wins driver eviction; verify `services/relay/test/eviction.test.ts` (pinned live Wrangler: first driver gets `error{role_taken}` then close 4409, second driver's first frame after `hello` is `state`). Reviewer guidance (quote, do not rediscover): (1) eviction goes in the `!ready` `hello` branch of `webSocketMessage`, *after* the stored-PIN compare and *before* `serializeAttachment({ ...attachment, ready: true })`; (2) reuse `rejectSocket(old, oldAttachment, { t: 'error', code: 'role_taken' }, CLOSE_CODE_DRIVER_EVICTED, ...)` so the old socket is marked `rejected` and excluded from broadcasts; (3) select victims with `this.ctx.getWebSockets('driver')` filtered on `attachment.ready && !attachment.rejected && socket !== joiner` — evict *all* stale drivers, not just one; (4) server-side `close()` does not fire `webSocketClose` for the closer — reconcile `driverOnline` inline (the joiner becomes ready in the same event, so the flag stays `true` and no extra `seq` bump is needed unless the reducer says so); (5) no additional `scheduleAlarm` call is needed — the existing ready-path arm covers it; keep the `isSocketAttachment` guard passing. Extra gates: pinned live Wrangler test, every root gate, `npx wrangler types src/worker-configuration.d.ts --check`, isolated-assets deploy dry-run.
- [ ] T017 (owner: relay-backend-dev) (spec: 060 R3; 030 R3) [stream:protocol-client; lock:room-client; depends:T006e integrated (`c1218e7`)] Add `RoomClient.onError(cb)` for `error` frames and pass the close code (and whether the close was terminal) to the `closed` connection callback; drop intents queued from a rejected session on a terminal close; and tighten the `connect()` same-URL no-op so it only short-circuits when the current socket has *replayed* (reviewer nit on `68d9776`: a CONNECTING zombie must not block a foreground reconnect). verify: `packages/protocol/test/client-errors.test.ts` (error frame → callback with code; 4409 close → `closed` callback carries 4409, queue emptied, no reconnect timer; `connect()` on a CONNECTING socket that never opens → new socket after the old one closes). Extra gates: every root gate. May run as a parallel lease alongside T009 (disjoint write scope).
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) [stream:relay-room; lock:relay-room; depends:T009 integrated] Implement silent-peer handling in `alarm()`; verify `services/relay/test/heartbeat.test.ts` (spotter stops pinging → driver sees `spotterOnline === false` and the spotter socket closes 4408 within `PEER_OFFLINE_MS + ALARM_TICK_MS`). Traps: reduce `{t:'peer', online:false}` inline and broadcast *before* `close()` (server close does not fire `webSocketClose`); exclude sockets already closed/rejected; **reap unready or roleless sockets that never sent `hello`** — `fetch()` currently arms no alarm at accept time (L014 choice, kept by T011d), so either arm on accept or reap them on the next tick and update the `alarm: null` assertions in `services/relay/test/auth.test.ts` *deliberately* (they encode a temporary choice, not a spec rule — say so in the hand-off); self-arm at the end of `alarm()` while sockets remain; timings imported from `packages/protocol`, never re-typed. Extra gates: pinned live Wrangler test, every root gate, Wrangler types check, isolated-assets deploy dry-run.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9; requirement R4) [stream:relay-room; lock:relay-room; depends:T012 integrated] Implement UTF-8 byte cap (`FRAME_MAX_BYTES` measured before `JSON.parse`), malformed/unknown-`t`/wrong-role handling, and fixed-window rate limiting; verify `services/relay/test/validation.test.ts` and `services/relay/test/ratelimit.test.ts`. Preserve version precedence (`7bab61a`), keep non-hello malformed sockets open with `error{bad_frame}`, cap applied frames at `RATE_BURST` per 1 s window with at most one `error{rate}` per window, normalize `name=''` to absent. Extra gates: pinned live Wrangler tests, every root gate, Wrangler types check, isolated-assets deploy dry-run.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10; requirement R6) [stream:tooling; lock:fake-spotter; depends:T009 integrated] Implement all fake-spotter scenarios (`lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay`, `driver-evict`, `soak`) and `--role driver` in `scripts/fake-spotter.ts`, reusing protocol fixtures and `RoomClient`; verify `scripts/test/fake-spotter.test.ts` against local Wrangler; the deployed proof remains T102 `[HW]`.

After T017 integrates, the planner slices specs/030 (glasses app, text mode) into worker tasks; every 030 automated criterion consumes `RoomClient` from `packages/protocol` and must not re-implement the socket.

## Needs simulator [SIM]

- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
- [ ] T003c (owner: relay-backend-dev) (spec: 010 AC-5) After T002c records the exact simulator `bridge.getDeviceInfo()` value, remove every non-hardware `TBD` allowance, make the valid fixture/test reject non-hardware `TBD`, add the root environment check to CI, and validate `engines.node` permits only major 22; verify `scripts/test/check-environment.test.ts`, the repository check, and full AC-1 gates.

## Needs human [HW]

- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode, QR-sideload the scaffold, and save the required photo/log under `qa/<date>/`.
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Deploy the Worker, set `DEBUG_KEY`, run `lanes` with spotter and driver clients, and save `qa/<date>/020-deploy.log`. (Needs T014 first.)
- [ ] T104 (owner: maxx) (spec: 030 AC-8) Run real-glasses `lanes`, `gap-sweep`, `message-ack`, and `link-loss`; record PASS by AC in `qa/<date>/REPORT.md`.
- [ ] T105 (owner: maxx) (spec: 030 AC-9) Render the glyph sheet on real glasses and record visibility/fallback choices in `docs/ENVIRONMENT.md`.
- [ ] T106 (owner: maxx) (spec: 030 AC-10) Verify the hardware `wss://` upgrade against the whitelisted origin and record the result in `docs/ENVIRONMENT.md`.
- [ ] T107 (owner: maxx) (spec: 040 AC-6) Verify install, join, console, and landscape targets on iOS Safari and Android Chrome; save `qa/<date>/040-*.png`.
- [ ] T108 (owner: maxx) (spec: 040 AC-7) Run two phones plus real glasses over LTE and record the lane-call latency in `qa/<date>/REPORT.md`.
- [ ] T109 (owner: maxx) (spec: 050 AC-6) Send the gray4 bright-column test pattern and record nibble/stride confirmation in `docs/ENVIRONMENT.md`.
- [ ] T110 (owner: maxx) (spec: 050 AC-7) Run `gap-sweep` plus a 10-minute soak on real glasses; save `latency.csv` and the AC result in `qa/<date>/REPORT.md`.
- [ ] T111 (owner: maxx) (spec: 050 AC-8) Open and cancel the exit dialogue and verify text fallback within three failed image sends in `qa/<date>/REPORT.md`.
- [ ] T112 (owner: maxx) (spec: 060 AC-5) Perform the five-minute iOS lock/unlock recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T113 (owner: maxx) (spec: 060 AC-6) Perform the five-minute Android lock/foreground recovery check and record it in `qa/<date>/REPORT.md`.
- [ ] T114 (owner: maxx) (spec: 060 AC-7) Redeploy the relay mid-session and record automatic recovery in `qa/<date>/REPORT.md`.
- [ ] T115 (owner: maxx) (spec: 060 AC-8) Save a session `wrangler tail` showing parseable structured lines and no message bodies to `qa/<date>/tail.log`.
- [ ] T116 (owner: maxx) (spec: 070 AC-4) Follow `docs/RACE_DAY.md` before grid and record real `lanes` plus `message-ack` PASS in `qa/<date>/REPORT.md`.
- [ ] T117 (owner: maxx) (spec: 070 AC-5) Archive full-session logs, latency table, defects, and open-question disposition under `qa/<date>/` with human sign-off.

## Done this cycle

- [x] T011/T011b/T011c/T011c-precedence/T011d (owner: relay-backend-dev) (spec: 020 AC-6; R1/R4) Room PIN authentication integrated as `7bab61a` (version-before-URL-role precedence) + `4181e34` (T011d: null-role decision after structural hello parsing and version rejection; first joiner writes `{pin:{value}, createdAt}` atomically; non-4-digit tokens rejected before storage; pinned live precedence test for `''` and `?role=crew`). Reviews: approve / approve with nits (`docs/reviews/2026-09-04-repair-iteration.md`). `services/relay/test/auth.test.ts` 12/12 live.
- [x] T006/T006a/T006b/T006c/T006d/T006e (owner: relay-backend-dev) (spec: 020 AC-8; R3) `RoomClient` integrated as `68d9776` (T006c: reconnectAttempt reset only after first replay, delay clamped to the normative floor, `connect()` same-URL no-op, backoff test that opens the reconnected socket with `random: () => 0`, browser timer adapter typing) + `fa63af2` (T006d: `lastFrameAt` reset per socket session) + `c1218e7` (T006e: type exports restored; `lastFrameAt` cleared on a terminal close). Reviews: approve with nits ×2, approve. `packages/protocol/test/client.test.ts` 43/43 protocol.
- [x] tooling (owner: relay-backend-dev) `a88832c` — `scripts/sync-agents.mjs` treats only files carrying its generator banner as orphans; `sync:agents:check` passes with the three untracked `.claude/agents/cavecrew-*.md` files present (still untracked, still preserved).
- [x] T016 (owner: relay-backend-dev) (spec: 020 R1/R4; prerequisite for AC-7 and 030 R3) integrated as `0909521`; ready-client pings receive `pong`, data frames no longer postpone the alarm, alarm ticks self-arm, expiry persists the reducer result before deletion.
- [x] T008/T008a (`56e0729` + `637c2c2`), T007a/T007c (`9eb2876` + `191d9a1`), T007/T007b (`794fd17` + `a380d6f`), T004–T004c, T005/T005a (`35e74dc` + `42d7d5b`) — see `ralph/PROGRESS.md` rows 20–34.

## Notes / why

- 2026-09-04 repair/review/planner iteration (Fable 5.1 as final auditor; Opus 5 `protocol-keeper` for the four exact-commit reviews): Maxx authorized the repair iteration; both human decision items (`T011-review-cap`, `T006c-scope`) are closed by integration, so the plan is BUILDING again with five runnable tasks. Gates at `c1218e7`: typecheck, protocol 43/43, root 84/84, lint 0 errors / 2 generated-d.ts warnings, sync check.
- Ordering: T009 first because T012/T013/T014 all depend on it and it is the only remaining AC that changes the hello path. T017 second — it is on a disjoint stream (`protocol-client`) and unblocks every 030/040 consumer; a coordinator may lease it in parallel with T009. T012 before T013 because rate limiting and byte caps sit on top of the alarm/close paths T012 finalizes.
- T012 trap: `fetch()` arms no alarm at accept time (L014's choice, kept by T011d so the auth tests' `alarm: null` assertions stay true). An unready socket is therefore unreapable until another socket becomes ready. T012 owns this; changing the assertions is expected and must be explained in the hand-off, not hidden.
- T017 absorbs the `68d9776` reviewer nit (same-URL `connect()` guard must require a replayed session) rather than opening a sixth T006 task — one write scope, one verifier.
- Spec 030 Decision 2026-09-04: `lastFrameAt` is per socket session; the HUD dims during a reconnect blip. The glasses app must not cache the previous session's timestamp.
- Process lesson (rows 41–42): `7bab61a` and `68d9776` reached master without a review record. Every integration writes `ralph/last-review.md` before the planner runs; the loop's serial runner already enforces this, the interactive coordinator must too.
- `ralph/loop.sh` still honours only `owner:` and `[HW]`; `depends:`/`lock:` are honoured by agents reading the plan — keep dependent tasks ordered.
- The three untracked `.claude/agents/cavecrew-*.md` files are Maxx's; never delete, commit, or regenerate over them.
- AC audit 010: AC-1/AC-2/AC-6/AC-7 met; AC-3 and AC-5 need simulator; AC-4 needs hardware.
- AC audit 020: AC-1/AC-2/AC-3/AC-4/AC-6/AC-8 met; AC-5 (T009), AC-7 (T012), AC-9 (T013) open; AC-10 `[HW]` after T014.
- AC audits 030–070: automated criteria remain future work (030 slicing starts after T017), simulator evidence is absent, hardware criteria remain under Needs human.
- No criterion is `DISPUTED`; no simulator or hardware evidence is claimed; no deployment or secrets.
