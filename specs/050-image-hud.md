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
| AC-1 | Given `lane:"top"` (and the goldens for `mid`, `bot`, `null`), when `drawTopStrip` runs, then the ASCII-downsampled 576×48 top strip matches the committed golden (▲ filled in the top-right corner, ▼ hollow in the top-left corner, ▬ hollow on the seam at x 288); given `cars:[1,2,3]` (and `[0,0,0]`, `[3,0,0]`), when `drawBottomStrip` runs, then the bottom-strip golden matches (LEFT bar in the bottom-left corner, MIDDLE on the seam, RIGHT in the bottom-right corner, holding 1 / 2 / 3 segments left to right); and for every golden strip, `splitStrip` yields two 288×48 image containers that re-join to the strip byte for byte | `apps/glasses/test/draw-hud.test.ts` (snapshot + seam) |
| AC-2 | Given a bar at level 3, then that bar's outline is level 15 and its fill the alert dither `{8,3}` while the other bars keep outline 6; given `linkOk:false`, then every pixel equals the normal frame's value `>> 1` | `apps/glasses/test/draw-hud.test.ts` |
| AC-3 | Given each 288×48 image container (a half strip), when packed, then the output is 6 912 bytes and a single bright column at x=0 packs to the expected nibble in byte 0 of each row; `packContainers` yields exactly one such buffer per image container | `apps/glasses/test/gray4.test.ts` |
| AC-4 | Given a mocked bridge and the per-container queue: when 20 `cars` states arrive in 1 s, then only `stripBL`/`stripBR` are sent, in ≤ 5 car-strip flushes (≤ 10 `updateImageRawData` calls), and each container ends on the last value; a lane change mid-burst is sent immediately and costs ≤ 2 sends; a left or right car change costs 1 send and a middle car change 2; the relay's stale clear is sent immediately and only to the containers it changes; a container whose packed bytes equal the last accepted send is not sent; one call is in flight at a time and a pending job for a container is replaced by a newer one | `apps/glasses/test/queue-image.test.ts` |
| AC-5 | Given a mocked bridge returning `sendFailed` three times, then the app rebuilds the page in text mode and subsequent HUD updates use `textContainerUpgrade` | `apps/glasses/test/fallback.test.ts` |
| AC-5b | Given `npm run sim:scenarios` in **image mode** (the default), when `lanes`, `gap-sweep`, `message-ack`, `link-loss`, `reconnect-replay` run, then the symbol-shape, bar-width, alert outline, dim-on-NO-LINK (each image container) and message assertions from the `hud-e2e-testing` skill pass and `report.json` is committed — functional proof of the bitmap and queue, **not** of hardware size limits or pacing | `[SIM]` `qa/<date>/sim/image/*.png`, `qa/<date>/sim/report.json` |
| AC-6 | Given real glasses, when the test pattern is sent to each image container, then the bright column appears at the left edge of each (else flip nibble order/stride and re-test); the simulator's decode of the same pattern is recorded alongside but does not substitute | `[HW]` `docs/ENVIRONMENT.md` |
| AC-7 | Given real glasses and `gap-sweep` + `soak` for 10 min, then no `sendFailed` on any image container, image p95 ≤ 300 ms per `updateImageRawData` call to each image container, and the symbols and bars are readable at a glance | `[HW]` `qa/<date>/latency.csv`, `REPORT.md` |
| AC-8 | Given the exit dialogue is opened and cancelled on hardware, when the next image send fails, then the app is in text mode within 3 sends | `[HW]` `qa/<date>/REPORT.md` |

## Decisions

- 2026-09-03 One image for symbol+bar — why: image cost is per call (~185 ms), not per byte.
- 2026-09-03 Simulator evidence (`[SIM]`) covers bitmap content and queue behaviour; size limits, nibble order, pacing and `sendFailed` fallback stay `[HW]` — why: the simulator explicitly does not enforce on-device image limits or LZ4 and is faster than hardware.

- 2026-09-04 (Maxx) Image is the primary path from day one (no text-first phase). `drawHud` is composed from primitives (`fillRect`, `fillTriangle`, `fillCircle`, `hline`, `vline`, `pixel`) in `apps/glasses/src/render/primitives.ts`; the layout lives in `apps/glasses/src/render/hud-design.ts` as the only file to edit when changing the look. The golden snapshot in AC-1 pins the *current* design — a deliberate design change updates the golden in the same commit.
- 2026-09-04 (Maxx) The simulator is the primary functional check for the bitmap (AC-5b); R4/AC-6 nibble-order confirmation and AC-7/AC-8 pacing remain hardware questions to be discussed later.

- 2026-09-04 (Maxx) **Design round 1 — three lane positions, dither, side arrows.** The single 288×144 bitmap is re-laid out: three fixed lane slots across the top in track order (▼ at x 48, ● at x 144, ▲ at x 240) with the called one filled and the other two drawn as 2 px outlines at level 4, so the driver always sees where a call would appear; the car-behind bar in the middle band (y 76–107, same outline/fill/tick/≥90-alert rules); and a bottom band (y 112–142) holding a ◀ at the left edge for `side: 'inside'` or a ▶ at the right edge for `side: 'outside'`. **Every filled area is dithered** with a 2×2 checkerboard (`{on:15, off:6}`, alert fill `{on:8, off:3}`) — "easier on the eyes"; outlines and ticks stay flat. The 1-pixel period was chosen over a 4×4 Bayer cell because it dissolves into an even tone at these shape sizes instead of showing texture. NO-LINK dimming stays `v >> 1` over the whole frame. AC-1's goldens are re-recorded for this design, plus one `min`-sampled golden that makes the dither itself visible.

- 2026-09-25 (Maxx) **Design round 3 — half-size icons on top, three car bars on the bottom.** Maxx: "icons are too large … make them 1/2 current size. replace middle circle with dash/rectangle. move icons to top of screen … on bottom of screen have 3 hollow bars. left, middle, right these represent cars behind and closeness." The bitmap's top row holds ▼ ▬ ▲ at x 48 / 144 / 240 (triangles 30 px tall and 34 wide, the middle a 40×10 dash; called = dithered fill, others 2 px outlines at level 4). Its bottom row holds three hollow 86×28 bars (y 114–141, x 5 / 101 / 197, centred under the icons), each 2 px outline at level 6 split into three 26-px cells; `cars[i]` cells are dithered-filled **left-to-right** (chosen to match the spotter's `1 · 2 · 3` segments; recorded as `DESIGN.cars.fillDirection`), and a bar at level 3 swaps to outline 15 + alert fill `{8,3}`. NO-LINK stays `v >> 1`. **Constraint Maxx may want to revisit:** only ONE image container (≤ 288×144) exists, so "top of screen" is the top of that image at canvas y 8 and "bottom" is the bottom of the same image (canvas y ≈ 122–150); the message text now sits below the image (y 160) and the status strip stays bottom-right. Putting the bars at the very bottom of the 576×288 canvas would need a second image container (costs ~100 ms per update and is ruled out by constitution §3) — say so if that trade is wanted. AC-1/AC-2/AC-4 are rewritten to the new elements (human-authorized) and the goldens are re-recorded (four lanes, cars `[0,0,0]`, `[1,2,3]`, `[3,0,0]`, dim, and the `min`-sampled dither map).

- 2026-09-25 (Maxx) **Design round 4 — icons and bars on the perimeter, four edge-strip images.** Maxx: "I want the icons to be close to the perimeter so it's not directly in line of sight. Separate the bars on the glasses. Use corners on the glasses, then the top border and bottom borders for the 'middle' icons." The pinned SDK 0.0.12 caps a page at 4 image containers (each ≤ 288×144), 8 text and 12 total (`docs/RESEARCH_NOTES.md` §2), so six separate images are impossible and one image cannot reach the perimeter. The HUD becomes two 576×48 strips drawn once each and split at x 288 into four pixel-adjacent 288×48 image containers — `stripTL` (0,0), `stripTR` (288,0), `stripBL` (0,240), `stripBR` (288,240). Top strip: ▼ in the top-left corner (x 51), ▬ centred on the seam (x 288), ▲ in the top-right corner (x 525). Bottom strip: LEFT bar in the bottom-left corner, MIDDLE bar straddling the seam, RIGHT bar in the bottom-right corner (x 8 / 245 / 482, each 86×28, under the icon of its side). Shapes, sizes, dither, outline and alert rules are unchanged from round 3; NO-LINK halves every strip, so all four images dim. The renderer is `drawTopStrip`/`drawBottomStrip` + `splitStrip`, all pure; goldens are per strip plus a seam test. The queue keys jobs by image container: a newer job replaces the pending one, bytes equal to the last accepted send are skipped (lane change ≤ 2 sends, left/right car 1, middle car 2, stale clear only what changed), the car strip is debounced per strip (both halves flush together), the lane strip is immediate, logs are `{call, ms, result, container}`, and 3× `sendFailed` still falls back to the single-text-container page. This supersedes the 2026-09-03 "one image for symbol+bar" decision, the round-3 "only ONE image container" constraint and this spec's *Scope* line "Out: more than one image container" (left for the planner to reword, with constitution §3). **Per-call hardware cost of four images is unverified** (`[HW]` T109/T110). AC-1/AC-3/AC-4 are rewritten to per-container bitmaps and AC-5b/AC-6/AC-7 say "each image container" (T057).

## Open questions

- Should the lane symbol blink briefly on change? (Costs one extra image send.)
