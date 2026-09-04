# apps/glasses — driver-side Even Hub app

Runs in the WebView inside the Even Realities phone app and drives the G2 glasses
through `@evenrealities/even_hub_sdk` 0.0.12. The page you see on the phone is the
companion UI (room / PIN / name / HUD override + a bridge log); the interesting
output is on the glasses.

## Run

```bash
npm run dev -w apps/glasses         # Vite on 0.0.0.0:5173
npx evenhub qr --url http://<your-ip>:5173   # sideload onto real glasses
npm run simulate -w apps/glasses    # evenhub-simulator against the dev server
```

`?render=text` forces the ASCII fallback, `?relay=ws://host:8787` points the app at
a local relay. Image mode is the default everywhere, simulator included.

## Layout

| File                             | Purpose                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/render/primitives.ts`       | Generic drawing ops on a `Uint8Array` canvas (`fillRect`, `fillTriangle`, `fillCircle`, `hline`, `vline`, `pixel`, `dim`). Knows nothing about racing.                    |
| `src/render/hud-design.ts`       | **The look.** `DESIGN` holds every position/level/threshold; `drawSymbol`/`drawBar` compose the primitives. Edit this file (and re-record the goldens) to change the HUD. |
| `src/render/draw-hud.ts`         | `drawHud(state, {linkOk}) → Uint8Array(288*144)`. Allocates, calls the design, halves the frame when the link is stale.                                                   |
| `src/render/gray4.ts`            | Packs the frame to 20 736 gray4 bytes. `NIBBLE_ORDER` is the one thing to flip if hardware mirrors the image.                                                             |
| `src/render/sdk-quirks.ts`       | Everything version-specific about SDK 0.0.12 (`compressMode`, minimum Even App version).                                                                                  |
| `src/render/text.ts`             | ASCII fallback (`^ o v`, `#`/`-`, `!!` at gap ≥ 90).                                                                                                                      |
| `src/render/ascii.ts`            | Bitmap → ASCII, for the golden snapshots.                                                                                                                                 |
| `src/render/glyphs.ts`           | The only non-ASCII characters in the app (`·`, `…`), each with an ASCII fallback.                                                                                         |
| `src/render/mode.ts`             | `?render=` → KV `g2rs:v1:render` → image. Never looks at the build mode.                                                                                                  |
| `src/render/queue.ts`            | Single async writer: one bridge call in flight, HUD jobs replace each other, gap changes debounce to 250 ms, three `sendFailed` → text mode.                              |
| `src/bridge.ts`                  | The `Bridge` interface the app talks to.                                                                                                                                  |
| `src/even-bridge.ts`             | The only file that imports the SDK. No test loads it.                                                                                                                     |
| `src/startup-page.ts`            | The 4-container page (`bg`/`hud`/`msg`/`status`) and the one-call guard.                                                                                                  |
| `src/app.ts`                     | Room state → render jobs. Renders only what the relay confirmed.                                                                                                          |
| `src/link.ts`                    | NO LINK watchdog and the status strip strings.                                                                                                                            |
| `src/input.ts`                   | `toOsEvent` normaliser + tap/double-tap/foreground mapping.                                                                                                               |
| `src/settings.ts`                | Bridge-KV settings, relay URL, Even App version check.                                                                                                                    |
| `src/driver.ts`                  | Wires client + queue + watchdog + input.                                                                                                                                  |
| `src/companion.ts`, `index.html` | The phone-side page.                                                                                                                                                      |
| `src/main.ts`                    | Composition root; no logic.                                                                                                                                               |

## Changing the HUD design

1. Edit `src/render/hud-design.ts` — numbers in `DESIGN`, or new shapes in
   `drawSymbol`/`drawBar` built from `primitives.ts`.
2. Run `npx vitest run apps/glasses/test/draw-hud.test.ts` and read the ASCII diff.
3. When the new shape is what you meant, paste the new snapshots into the goldens
   in the same commit. Nothing else in the app needs to change.

## Tests

`npm test` from the repo root. Everything runs in plain Node against a fake
`Bridge`; the SDK, the glasses and the simulator are never needed.
