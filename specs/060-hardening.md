# 060 — Hardening: lifecycle, security, limits

Status: ACTIVE
Depends on: 030, 040, 050
Design reference: docs/BUILD_PLAN.md §7 Phase 5, §8 risks

## Purpose

Survive the real world: locked phones, Android suspends, relay redeploys, flaky LTE, and strangers guessing room codes.

## Scope

In: foreground re-arm, cold-start restore, room PIN UX on both ends, rate limiting verification, payload validation audit, error UX, structured logs, 5-minute-lock protocol.
Out: accounts, encryption beyond TLS, analytics.

## Requirements

R1. On `FOREGROUND_ENTER_EVENT` the glasses app MUST re-arm the socket and re-render from the last state; on cold start it MUST restore room/PIN/name from bridge KV and wait for the replayed `state` before drawing the HUD.
R2. Relay MUST enforce `RATE_LIMIT_PER_S`/`RATE_BURST` per socket and log drops without closing.
R3. Both UIs MUST surface `error` frames (`auth`, `role_taken`, `version`) in plain language and offer the fix (re-enter PIN / reload).
R4. Relay logs MUST be structured `{room, role, t, seq, ms}` with no message bodies.
R5. Companion page MUST show a warning when Even App < 2.2.7 or when the relay origin is not in `app.json`'s whitelist (detectable via a failed `/health` fetch).

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given a socket sending 100 `gap` frames within one fixed 1 s window, then exactly `RATE_BURST` (60) are applied, the remainder are dropped and counted in the structured log, and the socket remains open | `services/relay/test/ratelimit.test.ts` |
| AC-2 | Given a mocked bridge with stored room/PIN, when the app cold-starts, then no HUD render happens before the first `state` and the status strip shows `CONNECTING…` | `apps/glasses/test/cold-start.test.ts` |
| AC-3 | Given `FOREGROUND_ENTER_EVENT` after a simulated socket drop, then `RoomClient.connect` is called and the last state is re-rendered | `apps/glasses/test/foreground.test.ts` |
| AC-4 | Given an `error{code:"auth"}` frame, then the spotter console and the companion page show the PIN prompt | `apps/spotter/test/errors.test.ts`, `apps/glasses/test/errors.test.ts` |
| AC-5 | Given an iOS driver phone locked for 5 min, when unlocked, then the HUD is correct within 5 s with no user action | `[HW]` `qa/<date>/REPORT.md` |
| AC-6 | Given an Android driver phone locked for 5 min, when the Even app returns to foreground, then the HUD is correct within 5 s | `[HW]` `qa/<date>/REPORT.md` |
| AC-7 | Given `wrangler deploy` mid-session, then both clients reconnect and the spotter banner clears without user action | `[HW]` `qa/<date>/REPORT.md` |
| AC-8 | Given `wrangler tail` during a session, then every line parses as the structured shape and no `msg` text appears | `[HW]` `qa/<date>/tail.log` |

## Decisions

- 2026-09-03 iOS is the recommended driver phone — why: WebView and WebSocket survive lock; Android is best-effort.

## Open questions

- Room lifetime: per event vs persistent per driver (affects TTL and PIN UX).
