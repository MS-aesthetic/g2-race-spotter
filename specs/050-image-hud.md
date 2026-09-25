# 050 — Image HUD (lane icons + car bars bitmap)

Status: ACTIVE
Depends on: 020 (built together with 030's automated criteria in one task since 2026-09-04)
Design reference: docs/BUILD_PLAN.md §3, §7 Phase 4; skill `g2-hud-display`

## Purpose

Replace the small text glyph with a large, glanceable symbol and a real bar, rendered as one 288×144 gray4 image, while keeping text mode as the automatic fallback.

## Scope

In: `drawHud(state) → Uint8Array`, gray4 packing, `updateImageRawData` path in the queue, coalescing at 250 ms, stale half-intensity rendering, automatic fallback after 3 consecutive `sendFailed`, SDK quirk shim, latency logging.
Out: animation, more than one image container, icons for messages.

## Requirements

R1. MUST follow the bitmap layout in the `g2-hud-display` skill (lane icon row, three car bars, level-3 alert outline, stale halving).
R2. MUST issue at most one image send per 250 ms for cars-only changes; lane changes bypass the debounce; a pending HUD job is replaced, never queued behind another HUD job.
R3. MUST switch to text mode after 3 consecutive `sendFailed` and stay there until restart.
R4. Nibble order and row stride MUST be confirmed on hardware with a test pattern and recorded in `docs/ENVIRONMENT.md`.
R5. MUST require Even App ≥ 2.2.7 for image mode (warn on the companion page otherwise) because of the LZ4 regression. The simulator does not decode LZ4 and does not enforce on-device image-size limits, so neither can be verified there.
R6. Image mode MUST be the default everywhere (hardware and simulator); text mode only via `?render=text`, the stored override, or the `sendFailed` fallback.

## Acceptance criteria

| ID | Given / When / Then | Verification |
|---|---|---|
| AC-1 | Given `lane:"top", cars:[1,2,3]` (and the goldens for each lane, `cars` `[0,0,0]` and `[3,0,0]`), when `drawHud` runs, then the ASCII-downsampled snapshot matches the committed golden (▲ filled at the top right, the other two icons hollow, the three bars holding 1 / 2 / 3 segments left to right) | `apps/glasses/test/draw-hud.test.ts` (snapshot) |
| AC-2 | Given a bar at level 3, then that bar's outline is level 15 and its fill the alert dither `{8,3}` while the other bars keep outline 6; given `linkOk:false`, then every pixel equals the normal frame's value `>> 1` | `apps/glasses/test/draw-hud.test.ts` |
| AC-3 | Given a 288×144 frame, when packed, then the output is 20 736 bytes and a single bright column at x=0 packs to the expected nibble in byte 0 of each row | `apps/glasses/test/gray4.test.ts` |
| AC-4 | Given a mocked bridge, when 20 `cars` states arrive in 1 s, then ≤ 5 `updateImageRawData` calls are made and the final frame reflects the last value; a lane change (including the relay's stale clear) mid-burst is sent immediately | `apps/glasses/test/queue-image.test.ts` |
| AC-5 | Given a mocked bridge returning `sendFailed` three times, then the app rebuilds the page in text mode and subsequent HUD updates use `textContainerUpgrade` | `apps/glasses/test/fallback.test.ts` |
| AC-5b | Given `npm run sim:scenarios` in **image mode** (the default), when `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay` run, then the symbol-shape, bar-width, alert outline, dim-on-NO-LINK and message assertions from the `hud-e2e-testing` skill pass and `report.json` is committed — functional proof of the bitmap and queue, **not** of hardware size limits or pacing | `[SIM]` `qa/<date>/sim/image/*.png`, `qa/<date>/sim/report.json` |
| AC-6 | Given real glasses, when the test pattern is sent, then the bright column appears at the left edge (else flip nibble order/stride and re-test); the simulator's decode of the same pattern is recorded alongside but does not substitute | `[HW]` `docs/ENVIRONMENT.md` |
| AC-7 | Given real glasses and `gap-sweep` + `soak` for 10 min, then no `sendFailed`, image p95 ≤ 300 ms, and the symbol is readable at a glance | `[HW]` `qa/<date>/latency.csv`, `REPORT.md` |
| AC-8 | Given the exit dialogue is opened and cancelled on hardware, when the next image send fails, then the app is in text mode within 3 sends | `[HW]` `qa/<date>/REPORT.md` |

## Decisions

- 2026-09-03 One image for symbol+bar — why: image cost is per call (~185 ms), not per byte.
- 2026-09-03 Simulator evidence (`[SIM]`) covers bitmap content and queue behaviour; size limits, nibble order, pacing and `sendFailed` fallback stay `[HW]` — why: the simulator explicitly does not enforce on-device image limits or LZ4 and is faster than hardware.

- 2026-09-04 (Maxx) Image is the primary path from day one (no text-first phase). `drawHud` is composed from primitives (`fillRect`, `fillTriangle`, `fillCircle`, `hline`, `vline`, `pixel`) in `apps/glasses/src/render/primitives.ts`; the layout lives in `apps/glasses/src/render/hud-design.ts` as the only file to edit when changing the look. The golden snapshot in AC-1 pins the *current* design — a deliberate design change updates the golden in the same commit.
- 2026-09-04 (Maxx) The simulator is the primary functional check for the bitmap (AC-5b); R4/AC-6 nibble-order confirmation and AC-7/AC-8 pacing remain hardware questions to be discussed later.

- 2026-09-04 (Maxx) **Design round 1 — three lane positions, dither, side arrows.** The single 288×144 bitmap is re-laid out: three fixed lane slots across the top in track order (▼ at x 48, ● at x 144, ▲ at x 240) with the called one filled and the other two drawn as 2 px outlines at level 4, so the driver always sees where a call would appear; the car-behind bar in the middle band (y 76–107, same outline/fill/tick/≥90-alert rules); and a bottom band (y 112–142) holding a ◀ at the left edge for `side: 'inside'` or a ▶ at the right edge for `side: 'outside'`. **Every filled area is dithered** with a 2×2 checkerboard (`{on:15, off:6}`, alert fill `{on:8, off:3}`) — "easier on the eyes"; outlines and ticks stay flat. The 1-pixel period was chosen over a 4×4 Bayer cell because it dissolves into an even tone at these shape sizes instead of showing texture. NO-LINK dimming stays `v >> 1` over the whole frame. AC-1's goldens are re-recorded for this design, plus one `min`-sampled golden that makes the dither itself visible.

- 2026-09-25 (Maxx) **Design round 3 — half-size icons on top, three car bars on the bottom.** Maxx: "icons are too large … make them 1/2 current size. replace middle circle with dash/rectangle. move icons to top of screen … on bottom of screen have 3 hollow bars. left, middle, right these represent cars behind and closeness." The bitmap's top row holds ▼ ▬ ▲ at x 48 / 144 / 240 (triangles 30 px tall and 34 wide, the middle a 40×10 dash; called = dithered fill, others 2 px outlines at level 4). Its bottom row holds three hollow 86×28 bars (y 114–141, x 5 / 101 / 197, centred under the icons), each 2 px outline at level 6 split into three 26-px cells; `cars[i]` cells are dithered-filled **left-to-right** (chosen to match the spotter's `1 · 2 · 3` segments; recorded as `DESIGN.cars.fillDirection`), and a bar at level 3 swaps to outline 15 + alert fill `{8,3}`. NO-LINK stays `v >> 1`. **Constraint Maxx may want to revisit:** only ONE image container (≤ 288×144) exists, so "top of screen" is the top of that image at canvas y 8 and "bottom" is the bottom of the same image (canvas y ≈ 122–150); the message text now sits below the image (y 160) and the status strip stays bottom-right. Putting the bars at the very bottom of the 576×288 canvas would need a second image container (costs ~100 ms per update and is ruled out by constitution §3) — say so if that trade is wanted. AC-1/AC-2/AC-4 are rewritten to the new elements (human-authorized) and the goldens are re-recorded (four lanes, cars `[0,0,0]`, `[1,2,3]`, `[3,0,0]`, dim, and the `min`-sampled dither map).

## Open questions

- Should the lane symbol blink briefly on change? (Costs one extra image send.)
