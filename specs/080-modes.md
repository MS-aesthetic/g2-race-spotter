# 080 — Session modes (Practice / Race)

Status: DRAFT — scoped 2026-10-28, not scheduled; waiting on Maxx for the per-mode differences
Depends on: 020, 040 (round 7 layout)
Design reference: skills `spotter-ui`, `race-relay-protocol`

## Purpose

Maxx, 2026-10-28: "Scope the ability to have different modes for the app. A Practice Mode & a race mode. I'll worry about the differences later, but it will primarily be what buttons are shown on the mobile app."

Build the switch and the plumbing once, so that deciding what each mode shows later means editing one table, not reworking the app.

## Scope

In: a room-level mode (`practice` | `race`), a mode switch on the spotter console, and a single declarative table that decides which control groups the console shows in each mode. The no-scroll layout is checked per mode.
Out (until Maxx decides): the actual per-mode differences, any glasses-side behaviour change, and any timing change per mode.

## Proposal

1. **The mode lives in the room, not on one phone.** It is an additive v2 field, `State.mode: 'practice' | 'race'`, optional on the type and treated as `practice` when absent, the same way `presets` was added. It is set by a spotter-only frame, `{t:'mode', mode}`. Reducer: setting the current mode again is a no-op (no `seq` bump). Changing it bumps `seq`/`updatedAt` but never stamps `calledAt`, so it isn't a call and doesn't restart the stale clear. `stale` keeps it; `expire` resets it to `practice`. `PROTOCOL_VERSION` stays 2. The relay needs no mode code of its own beyond adding `mode` to `CLIENT_MESSAGE_TYPES` and `senderRole`. Why the room and not the phone: a second spotter phone or a reload sees the same mode, and if a mode ever needs to change what the glasses show, the glasses already receive `state`.
   - _Alternative:_ keep the mode phone-only (`localStorage` `g2rs:v1:mode`). This needs no protocol or relay change, but every spotter phone keeps its own mode. It is the right choice only if the mode will never matter beyond one phone's buttons.
2. **One table decides the console.** `apps/spotter/src/modes.ts` exports `MODE_LAYOUTS: Record<Mode, ConsoleLayout>`, where `ConsoleLayout` lists the visible groups in order. The groups are `lanes`, `faders`, `cornerCalls` (the ENTRY/EXIT rows), `messages` (the 2×2 built-ins, with a per-mode list of texts), and `freeText`. `view.ts` renders whatever the table says. Both modes start identical to the round-7 console, so shipping the switch changes nothing visible until Maxx fills in the differences.
3. **Switching.** A small `P` / `R` chip sits in the header next to the room chip, so it costs no space. Tapping it asks for confirmation ("Switch to RACE?" / Yes / No), so a stray tap mid-session can't swap the buttons. It reflects the room's `state.mode`, with an optimistic update as for lanes. While offline the change is queued like `lane` (the latest one wins).
4. **Layout check.** `layout.test.ts` runs every viewport × every mode. Fewer groups in a mode lets the remaining controls grow, and the test pins that nothing scrolls and every button stays ≥ 44 px.
5. **Glasses.** No change. If a visible mode cue is wanted later, a third status letter (for example `L S R`) is a one-line change in `link.ts` and costs no image sends.

## Acceptance criteria (draft)

| ID   | Given / When / Then                                                                                                                                                                                                  | Verification                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| AC-1 | Given a room in `practice`, when a spotter sends `{t:'mode', mode:'race'}`, then every peer receives `state.mode === 'race'` and `seq` increased; resending `race` changes nothing; a driver `mode` frame is ignored | `packages/protocol/test/reduce.test.ts`, `services/relay/test/modes.test.ts` |
| AC-2 | Given a stored room without `mode` (pre-080), when loaded, then it reads as `practice` and keeps its other state                                                                                                     | `services/relay/test/stored-state.test.ts`                                   |
| AC-3 | Given `MODE_LAYOUTS`, when the console renders each mode, then exactly the listed groups appear in the listed order                                                                                                  | `apps/spotter/test/view.test.ts`                                             |
| AC-4 | Given the header chip, when tapped and confirmed, then one `mode` frame is sent; when cancelled, none                                                                                                                | `apps/spotter/test/main-mode.test.ts`                                        |
| AC-5 | Given each mode at every layout viewport, then no scrolling and every button ≥ 44 px                                                                                                                                 | `apps/spotter/test/layout.test.ts`                                           |

## Effort

One consolidated task once round 7 is integrated: protocol (type, guard, fixtures, reducer, `RoomClient` queueing), relay (two list entries plus a live test), spotter (`modes.ts`, header chip, confirm, render from the table, tests). It's sized for one Opus-tier worker iteration plus a review. No glasses work.

## Decisions

- 2026-10-28 (Maxx) Two modes, Practice and Race; differences TBD and "primarily … what buttons are shown on the mobile app".

## Open questions (for Maxx)

- Room-level mode (proposal) or phone-only? Does a second spotter phone ever need to see the same mode?
- What does each mode show? For example: Race hides the free-text box and some presets; Practice adds driving-line coaching calls.
- Should switching mode clear the current lane call or message on the glasses, or leave them?
- Should the glasses show which mode is on?
- Is a confirm on switch wanted, or is a long-press better at the track?
