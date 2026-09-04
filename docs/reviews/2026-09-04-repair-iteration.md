task: T011c-precedence (7bab61a), T006c (68d9776), T011d (4181e34), T006d (fa63af2), tooling (a88832c), T006e (c1218e7)
reviewer: protocol-keeper (Opus 5, four exact-commit reviews on 7bab61a / 68d9776 / 4181e34 / fa63af2) + Fable 5.1 final auditor (a88832c, c1218e7, and verification of every Opus finding against source)
verdict: approve with nits
findings:
  - [nit] 68d9776 packages/protocol/src/index.ts — five client types (ConnectionState, RoomClientIntent, RoomClientOptions, RoomWebSocketConstructor, WebSocketCloseEvent/WebSocketMessageEvent) were dropped from the package surface relative to the reviewed candidate — scenario: apps/glasses imports ConnectionState → TS2305 at the first 030 task — fix: re-export from index.ts — DONE in T006e (c1218e7)
  - [nit] 68d9776 packages/protocol/src/client.ts connect() — the same-URL no-op guard treats a socket that is still CONNECTING as healthy — scenario: 060 foreground calls connect() while a zombie CONNECTING socket never opens → no reconnect until that socket's own close fires — fix: also require the session to have replayed (or readyState OPEN) — folded into T017
  - [nit] 4181e34 services/relay/src/race-room.ts fetch() — no alarm is armed at accept time (L014 choice; auth tests assert `alarm: null`) — scenario: a socket that never sends hello is never reaped until some other socket becomes ready — fix: T012 arms on accept/reaps unready sockets and updates the `alarm: null` assertions deliberately (they encode a temporary choice, not a spec rule)
  - [nit] fa63af2 — spec 030 must say what the HUD shows during a reconnect blip — RESOLVED: spec 030 Decision 2026-09-04 (per-session lastFrameAt; dim during the blip)
  - [nit] fa63af2 packages/protocol/src/client.ts handleClose — lastFrameAt survived a terminal close (4401/4409/4426) — scenario: driver evicted, HUD shows LINK OK for up to DRIVER_NO_LINK_MS — fix: clear on terminal close — DONE in T006e (c1218e7)
  - [nit] a88832c scripts/sync-agents.mjs — the orphan rule now keys on the generator banner, so a hand-written file dropped into .claude/agents is invisible to the check — accepted; the three untracked cavecrew-*.md files are preserved untouched
verified:
  - 7bab61a: version check runs before the URL-role decision on the first hello; hello-order matches skill (rejected-guard → parse → isHello → version 4426 → role/name 4400 → PIN 4401). approve.
  - 68d9776: F1 (reconnectAttempt reset only after first replay), F2 (delay clamped to [RECONNECT_MIN_MS, RECONNECT_MAX_MS]), connect() same-URL no-op, backoff test opens the reconnected socket, closes without replay, random: () => 0. Browser timer adapter compiles under Node globals. approve with nits.
  - 4181e34: first joiner writes {pin:{value}, createdAt} atomically; 4-digit check before storage; auth 12/12 incl. version-before-role for '' and '?role=crew'. approve with nits.
  - fa63af2: lastFrameAt reset in openSocket() and disconnect(); test covers reconnect and disconnect. approve with nits.
  - a88832c: sync:agents:check passes with the cavecrew files present; regenerated outputs unchanged. approve.
  - c1218e7: exports restored; handleClose clears lastFrameAt only on isTerminalClose; new test asserts undefined + no pending timers after 4409. approve.
  - Gates at c1218e7 (Node 22.23.2, this machine): typecheck pass; packages/protocol 43/43; root suite 84/84 (16 files, live wrangler dev); lint 0 errors / 2 pre-existing generated-d.ts warnings; sync:agents:check up to date.
  - Process finding (not code): 7bab61a and 68d9776 landed on master without a review record; these reviews were obtained after the fact. Every future integration writes ralph/last-review.md before the planner runs (PROMPT_review §2).
