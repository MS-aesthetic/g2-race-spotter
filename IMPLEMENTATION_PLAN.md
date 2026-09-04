# Implementation plan — 2026-09-04T01:31:00-04:00

Status: BLOCKED
Current spec focus: specs/020-protocol-and-relay.md

## Active stream leases (interactive coordinator only)

- No active leases. L014 is closed; its exact candidate range remains quarantined at `C:\Users\maxx\.cache\g2rs-worktrees\L014` (`ralph/L014-T011c`, head `581bead`).

## Next (ordered; the serial runner takes the first unchecked task)

- No independent non-`[HW]` task is runnable. Resume only after Maxx resolves either T011-review-cap or T006c-scope below, or after T002c simulator evidence becomes available.

## Blocked dependency queue (not runnable)

- [ ] T009 (owner: relay-backend-dev) (spec: 020 AC-5) [stream:relay-room; lock:relay-room; depends:T011 integrated] Implement PIN-checked last-writer-wins driver eviction and verify `services/relay/test/eviction.test.ts`; preserve hello-after-PIN ordering, ready-before-old-close presence, all stale-driver eviction, inline server-close reconciliation, and `role_taken` + 4409. Extra gates: pinned live Wrangler test, every root gate, Wrangler types check, isolated-assets deploy dry-run.
- [ ] T012 (owner: relay-backend-dev) (spec: 020 AC-7) [stream:relay-room; lock:relay-room; depends:T009 integrated] Implement shared-timing silent-peer alarm handling and verify `services/relay/test/heartbeat.test.ts`; close 4408, reduce offline inline, exclude closed sockets, reap unready/roleless sockets, and self-arm within the exported worst-case bound. Extra gates: pinned live Wrangler test, every root gate, Wrangler types check, isolated-assets deploy dry-run.
- [ ] T013 (owner: relay-backend-dev) (spec: 020 AC-9; requirement R4) [stream:relay-room; lock:relay-room; depends:T012 integrated] Implement UTF-8 byte cap, malformed/unknown/wrong-role handling, URL/hello semantics, and fixed-window rate limiting; verify `services/relay/test/validation.test.ts` and `services/relay/test/ratelimit.test.ts`. Preserve version precedence, keep non-hello malformed sockets open, cap applied frames at `RATE_BURST`, and normalize empty names. Extra gates: pinned live Wrangler tests, every root gate, Wrangler types check, isolated-assets deploy dry-run.
- [ ] T014 (owner: relay-backend-dev) (spec: 020 AC-10; requirement R6) [stream:tooling; lock:fake-spotter; depends:T009 integrated] Implement all fake-spotter scenarios and `--role driver` in `scripts/fake-spotter.ts`, reusing protocol fixtures; verify `scripts/test/fake-spotter.test.ts` against local Wrangler; deployed proof remains T102.

## Needs simulator [SIM]

- [ ] T002c (owner: hud-qa) (spec: 010 AC-3) [SIM] Run `npm run sim:scenarios -- --smoke` on an interactive machine where simulator 0.9.5 creates its main window; commit `qa/<date>/sim/report.json` and `qa/<date>/sim/image/smoke-01.png`, including the actual simulator `getDeviceInfo()` value.
- [ ] T003c (owner: relay-backend-dev) (spec: 010 AC-5) After T002c records the exact simulator `bridge.getDeviceInfo()` value, remove every non-hardware `TBD` allowance, make the valid fixture/test reject non-hardware `TBD`, add the root environment check to CI, and validate `engines.node` permits only major 22; verify `scripts/test/check-environment.test.ts`, the repository check, and full AC-1 gates.

## Needs human — scope decision (not [HW])

- [ ] T011-review-cap (owner: maxx) (spec: 020 AC-6; requirements R1/R4) Decide whether to authorize a fourth T011 repair after the chain's third review block. L014 is closed and its unintegrated exact application range `c4d8d6d..581bead` is quarantined. Remaining finding (verbatim): "URL-role rejection still runs before parsing and version-checking the first hello"; a missing/invalid URL role plus structurally valid `v:999` currently returns `bad_frame` + 4400 instead of `version` + 4426. The minimal future repair would move the null-role decision after structural `hello` parsing and version rejection, then add that pinned live precedence test in `services/relay/test/auth.test.ts`; do not start it without explicit approval.
- [ ] T006c-scope (owner: maxx) (spec: 020 AC-8; requirement R3) Approve or reject one additional, fifth T006c edit limited to the browser timer adapter in `packages/protocol/src/client.ts:73-78`: keep the public/injected `RoomClientTimers` number-handle contract, but make the default browser adapter compile when Node globals also contribute `Timeout` return types. The four already-authorized edits are preserved in L009 `stash@{0}` (`d84a200`, message `T006c scoped repair blocked by inherited timer typecheck`) over branch `ralph/L009-T006c` at `1872085`; targeted client tests passed 10/10, root tests 69/69, and lint passed, but root typecheck fails at lines 74/76 before and after the stash. No application commit exists. If approved, re-open a fresh protocol-client lease with this exact fifth-file-local scope, apply the stash, repair only the adapter boundary, rerun the root chain, and review the complete leased range; if rejected, keep 020 AC-8 blocked.

## Review escalation — prior authorization retained

- [x] T006/T006a/T006b (owner: maxx) (spec: 020 AC-8) **Maxx reversed the stop on 2026-09-03 ("yes on the fix") after the independent audit.** The candidate `ae5f448..e588729` was authorized as the base for exactly four T006c changes; those edits were attempted and are recoverable, but the mandatory typecheck exposed a fifth, pre-existing browser-timer adapter defect outside that authorization. Remaining reviewed findings stay resolved by the stash; integration now waits only on `T006c-scope` above.
  - **Auditor verdict (Fable 5.1, 2026-09-03, independent 4th review of `e588729` — see `docs/AUDIT-2026-09-03.md`):** `block` on exactly the two known findings, both confirmed and both ~3 lines (`client.ts:251` move `reconnectAttempt = 0` into the first-replay branch of `handleMessage`; `client.ts:380` wrap the jittered delay in `Math.max(RECONNECT_MIN_MS, …)`). AC-8 itself has a real test (`drops, reopens, waits for replay, and flushes only disconnected intents`); the replay gate, per-socket `lastSeen` reset, socket-identity guards and the intent queue are correct and match the skill. The defects survived three reviews because the backoff test never opens the reconnected socket and pins `random: () => 0.999`. **Recommendation: authorize one targeted repair, T006c, scoped to F1 + F2 + a `connect()` no-op when the URL is unchanged and the socket is healthy (060 will call it on foreground), plus a backoff test that opens the reconnected socket, closes it without a replay, and pins `random: () => 0`; reject anything wider. A rewrite is not warranted.** Every spec from 030 on depends on this client; nothing in 030/040 can be leased until it integrates. The four-change attempt is preserved; `T006c-scope` now controls whether its adapter-only blocker may be repaired.
  - Follow-up once the client integrates (not part of T006c): T017 (owner: relay-backend-dev) (spec: 060 R3) [stream: protocol-client; lock: room-client; depends: T006c integrated] add `RoomClient.onError(cb)` and the close code on the `closed` callback; drop intents queued from a rejected session on a terminal close. verify: `packages/protocol/test/client-errors.test.ts`.

## Needs human [HW]

- [ ] T101b (owner: maxx) (spec: 010 AC-4) Enable Developer Mode, QR-sideload the scaffold, and save the required photo/log under `qa/<date>/`.
- [ ] T102 (owner: maxx) (spec: 020 AC-10) Deploy the Worker, set `DEBUG_KEY`, run `lanes` with spotter and driver clients, and save `qa/<date>/020-deploy.log`.
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

- [x] T016 (owner: relay-backend-dev) (spec: 020 R1/R4; prerequisite for AC-7 and 030 R3) Exact leased range `3baec424..792a6cd` was approved with no findings and integrated as `0909521`; ready-client pings now receive `pong`, `lastPing` persists only in socket attachments, data frames no longer postpone the alarm, alarm ticks self-arm while sockets remain, and expiry persists the reducer result before storage deletion. Live verifier `services/relay/test/heartbeat-prereq.test.ts` and every Node 22 root, relay, Wrangler-types, and isolated-assets dry-run gate pass.
- [x] T008/T008a (owner: relay-backend-dev) (spec: 020 AC-4; requirement R4) Exact range `191d9a1..5689288` was approved with no findings and integrated as `56e0729` + `637c2c2`; reconnect and Durable Object restart replay preserve lane/gap/msg and monotonic seq, reconcile both presence flags before first replay, repoint an empty room to `updatedAt + ROOM_TTL_MS`, and route expiry through the normative reducer before deletion.
- [x] T007a/T007c (owner: relay-backend-dev) (spec: 020 requirement R5) Approved route stack integrated as `9eb2876` + `191d9a1`; `/health`, protected debug, CORS, asset fallthrough, generated bindings, and asset-preservation regressions pass.
- [x] T007/T007b (owner: relay-backend-dev) (spec: 020 AC-3) Approved hibernating relay roundtrip stack integrated as `794fd17` + `a380d6f`.
- [x] T004/T004a/T004b/T004c (owner: relay-backend-dev) (spec: 020 AC-1) Centralized and repaired the protocol package, guards, fixtures, exports, and consumer compilation.
- [x] T005/T005a (owner: relay-backend-dev) (spec: 020 AC-2) Implemented and approved the pure room-state reducer stack (`35e74dc` + `42d7d5b`).

## Notes / why

- 2026-09-03 audit (Fable 5.1 as final auditor; two Opus reviewers on the code, one Sonnet analyst on the process; report in `docs/AUDIT-2026-09-03.md`): HANDOFF claims re-verified on this machine (59/59, typecheck, lint 2 warnings, pins, sync, environment). Integrated relay: `approve with nits` for AC-3/AC-4, but two latent defects would have made AC-7 unreachable and tripped the glasses NO LINK on a quiet room — fixed first as T016. T011/T009/T012/T013 carry the reviewer's traps inline so first attempts stop getting blocked. First-attempt approval over 34 iterations was ~15 %; about half the blocks were avoidable — `PROMPT_build` §1.5 self-review and the planner's task-slicing rules address that. `ralph/loop.sh` ignores `depends:`/`lock:` tags (it reads only `owner:` and `[HW]`) — keep dependent tasks ordered so the serial runner cannot pick one whose dependency is open.

- T008/T008a is integrated, approved, and root-gated: 59/59 tests, typecheck, lint (only two existing generated-d.ts warnings), pins, sync, environment check, Wrangler types check, and isolated-assets deploy dry-run pass on Node 22.
- 020 AC-4 is met by `services/relay/test/replay.test.ts` and `services/relay/test/alarm.test.ts`; no stale peer-online flag is replayed after close or rehydration.
- T016 is integrated, approved, and root-gated: focused live verifier 1/1, protocol 31/31, root 60/60, typecheck, lint (only two existing generated-d.ts warnings), pins, environment, Wrangler types, and isolated-assets dry-run pass on Node 22. The committed L010 tree also passed sync; main's sync check is currently obstructed only by three unrelated untracked `.claude/agents/cavecrew-*.md` files, which this planner preserved and did not edit.
- T011 review blocked candidate `37c804e..5a614b0`: its 10 ms post-response timer does not deliver close 4401/4400 without later client activity, and it treats `token=` as a valid empty PIN.
- T011a failed without a repair commit: direct close from `fetch`, microtask, real timer, WebCrypto continuation, alarm deferral, and `DurableObjectState.waitUntil` cannot prove the close at the pinned live boundary; the alarm experiment also violates rejected-socket alarm isolation. L012 is closed and preserved at inherited candidate `afd6b62` with a clean application tree.
- T011b is valid without weakening 020 AC-6 because a protocol join already requires `hello` as the first client frame; error and close must now be emitted during that supported WebSocket event, with the verifier sending nothing after `hello`.
- T011c's exact L014 range `c4d8d6d..581bead` is not integrated. It fixed valid-URL version-before-auth/storage handling and atomic `pin`/`createdAt` persistence, but the third chain review block proved a missing URL role still wins before a structurally valid `v:999` hello. L014 is closed and quarantined; no fourth repair is authorized.
- T011, T011b, and T011c are the chain's three review blocks; T011a failed with review `n/a` and does not count. Per the retry cap, AC-6 is now under `T011-review-cap` rather than `## Next`.
- No independent worker task remains: T009/T012/T013/T014 depend on the quarantined T011 stack; T017 and all 030/040 client consumers depend on T006c; T002c requires the unavailable interactive simulator.
- L011's worker handoff recorded the older `0115862` lease base, but Git merge-base and the reviewer both establish `37c804e..5a614b0` as the exact candidate range; the repair task uses that verified range.
- T006c made no commit: its exact four authorized edits remain in L009 `stash@{0}` and pass targeted/root tests plus lint, but inherited browser timer return types fail root typecheck. The fifth adapter-only edit is neither `[SIM]` nor `[HW]`; it is blocked solely on Maxx's scope decision.
- T014 stays unleased until T009 integrates because its driver-eviction scenario depends on that behavior.
- AC audit 010: AC-1/AC-2/AC-6/AC-7 met; AC-3 and AC-5 need simulator; AC-4 needs hardware.
- AC audit 020: AC-1/AC-2/AC-3/AC-4 met; AC-5–AC-9 remain unmet except the stopped, quarantined AC-8 client chain; AC-10 remains `[HW]` after local T014.
- AC audits 030–070: automated criteria remain future work, simulator evidence is absent, and hardware criteria remain under Needs human.
- No criterion is `DISPUTED`; no simulator or hardware evidence is claimed.
