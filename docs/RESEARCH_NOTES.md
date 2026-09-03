# Even Realities G2 — Research Notes (Sept 2026)

Findings that drive the build plan. Everything here was pulled from the official Even Hub docs or from community references that the official docs point at. Re-verify SDK version numbers before starting Phase 0; the SDK is at 0.0.1x and moving.

## 1. Platform model

An Even Hub "app" is a **web app** (Vite + TypeScript is the official template stack) that runs inside a **WebView hosted by the Even Realities phone app** (Chromium WebView on Android, WKWebView on iOS). The SDK injects an `EvenAppBridge` object into the page; your JS calls bridge methods, the Even app forwards them over BLE 5.x to the glasses, and the glasses firmware (LVGL-based) renders "containers". Input events (temple touchpad, R1 ring) come back the same way.

Consequences for this project:

- **No code runs on the glasses.** The driver's phone (running the Even app with our Hub app loaded) is the brain. The glasses are a dumb renderer.
- The driver-side app has the **full browser networking stack**: `fetch`, `XMLHttpRequest`, and **WebSockets** all work from the WebView. Network destinations must be whitelisted in `app.json` and the server must return proper CORS headers (both gates apply; whitelisting does not bypass CORS).
- There is no direct Bluetooth access, no arbitrary pixel drawing, no audio output, and images are greyscale only.
- The phone must be with the driver (BLE range ~28 m) and the Even app must stay in the foreground / screen unlocked on Android — Android may suspend the WebView under memory pressure and drop WebSockets and in-memory state. iOS keeps the WebView alive when locked.

Key packages:

- `@evenrealities/even_hub_sdk` (npm) — the bridge SDK. Community notes reference `^0.0.13`; docs mention behaviors introduced in 0.0.12 (LZ4, zOrder) and 0.0.14 (image pacing).
- `@evenrealities/evenhub-cli` — `evenhub qr` (sideload dev server via QR), `evenhub pack app.json dist -o app.ehpk`.
- `@evenrealities/evenhub-simulator` — desktop simulator. **Project pins 0.9.5** (Maxx's verified install; hub docs describe 0.9.3, the registry lagged at 0.8.0 when checked — confirm with `npm view` at pin time). Older notes about a 200×100 image cap and a 4-container cap applied to ≤ 0.7 and are obsolete: current versions render the full 288×144 image and our page. See §7 for what the simulator does and does not prove.
- Node 20 LTS or 22+.
- **Official Claude Code plugin:** `even-realities/everything-evenhub` — 13 skills (`/quickstart`, `/template`, `/build-and-deploy`, `/glasses-ui`, `/handle-input`, `/device-features`, `/test-with-simulator`, `/simulator-automation`, `/font-measurement`, `/background-state`, `/sdk-reference`, `/cli-reference`, `/design-guidelines`). Install with `/plugin marketplace add even-realities/everything-evenhub` then `/plugin install everything-evenhub@everything-evenhub`. Our project skills layer on top of it and do not duplicate it.

Bridge init: `await waitForEvenAppBridge()` (recommended) or `EvenAppBridge.getInstance()`.

## 2. Display facts

- Canvas: **576 × 288 px per eye**, both eyes show the same image (synced over FPC). **4-bit greyscale, 16 levels**, green micro-LED. White = bright green, black = off/transparent. Origin top-left.
- Absolute pixel positioning only — no CSS/flexbox on the glasses.
- Per page: max **4 image containers**, max **8 text/list containers**, and **exactly one** container with `isEventCapture: 1`.
- **Text containers**: single baked-in LVGL font, **no font size / bold / italic control**, not monospaced, left/top aligned, wraps at container width, `\n` for line breaks. Unsupported glyphs are silently dropped. Verified supported symbols include ▲ ▶ ▼ ◀ ● ○ and box-drawing characters. `textColor` 0–4 (0 is dimmest, not "unset"). Border (`borderWidth` 0–5, `borderColor` 0–15, `borderRadius` 0–10, `paddingLength` 0–32) is the only decoration; there is no fill/background.
- Content limits: 1,000 chars at `createStartUpPageContainer` / `rebuildPageContainer`, 2,000 at `textContainerUpgrade`. A full-screen container holds ~400–500 chars.
- **Image containers**: up to **288 × 144** px, 4-bit greyscale, data as `number[]`/`Uint8Array`/`ArrayBuffer`/base64. Cannot be populated during `createStartUpPageContainer` — create the container, then `updateImageRawData`. No concurrent sends; each call is paced at 100 ms (SDK ≥0.0.14). LZ4 in transit (SDK ≥0.0.12; requires Even App ≥2.2.7 or images garble — known regression).
- Image-first pages should place a full-screen text container with `content: ' '` and `isEventCapture: 1` behind the image.
- `zOrderIndex` (SDK ≥0.0.12): all-or-nothing per page, unique values, higher = in front.
- List containers: max 20 items, 64 chars each, no in-place update (must rebuild).

## 3. Update model and measured costs (community benchmarks, real hardware)

- `createStartUpPageContainer` — **exactly once per session**. 100–135 ms. A failed retry blocks ~2.1 s and drops input; do not retry aggressively.
- `rebuildPageContainer` — full redraw, ~165 ms flat regardless of container count. Brief flicker on hardware.
- `textContainerUpgrade` — ~83 ms per call, flicker-free. Break-even vs rebuild is 2 containers; updating 5–6 containers individually is ~3× slower than a rebuild.
- `updateImageRawData` — ~104 ms fixed + ~3.9 ms per KB of gray4 data. Payload size barely matters; **call count is the cost**. Single animated container tops out at ~9.5 fps (20×20) down to ~5.4 fps (288×144). Two containers ≈ 4.5 fps, four ≈ 2.3 fps. Sends serialize, so multi-container updates reveal one at a time.
- Merge overlapping images into one container when possible (saves ~69 ms per avoided call).
- Success return from `updateImageRawData` means the call was accepted, not that it was displayed.

## 4. Input and lifecycle

Events via `bridge.onEvenHubEvent(event => …)` with `event.textEvent` / `listEvent` / `sysEvent` / `audioEvent`. `OsEventTypeList`: `CLICK_EVENT` (0), `SCROLL_TOP_EVENT` (1), `SCROLL_BOTTOM_EVENT` (2), `DOUBLE_CLICK_EVENT` (3), `LONG_PRESS_EVENT` (9), `LONG_PRESS_RELEASE_EVENT` (10), plus `FOREGROUND_ENTER_EVENT`, `FOREGROUND_EXIT_EVENT`, `ABNORMAL_EXIT_EVENT`, `SYSTEM_EXIT_EVENT`, `IMU_DATA_REPORT`. Sources: right/left temple, R1 ring.

Submission rule: **double-tap on the root page must open the exit dialogue via `shutDownPageContainer(1)`**; non-root screens treat double-tap as back. Known defect: after dismissing the exit dialogue the image channel can wedge (every `updateImageRawData` returns `sendFailed` until restart). Plan for a text-only fallback render path.

Background: iOS keeps WebView + WebSocket alive when locked; Android may suspend, killing WebSockets and JS state. Use `bridge.setLocalStorage` / `getLocalStorage` (string KV, persists across restarts) — **not** browser `localStorage`. Re-arm connections on `FOREGROUND_ENTER_EVENT`.

Other device APIs available if wanted later: microphone (`audioControl`, PCM 16 kHz mono s16le; `g2-microphone` / `phone-microphone` permissions), IMU (`imuControl`, 100/500/1000 ms), location (`getAppLocation`, `startAppLocationUpdates`; works only after Hub upload, not QR sideload), `getDeviceInfo`, `getUserInfo`, `onDeviceStatusChanged`.

## 5. app.json and packaging

Required fields: `package_id` (reverse-domain), `edition` (`"202601"`), `name` (≤20 chars), `version` (semver), `min_app_version`, `min_sdk_version`, `tagline`, `description`, `author`, `entrypoint`, `supported_languages`, `permissions[]` — each `{ name, desc }`, and for network `{ name: "network", desc, whitelist: ["https://…"] }` with full HTTPS origins, one per line, no wildcards or bare hostnames (localhost/http allowed in dev).

Dev loop: `npm run dev` (Vite on 0.0.0.0:5173) → `npx evenhub qr --url http://<lan-ip>:5173` → scan with the Even app (Developer Mode enabled in the web hub) → hot reload works. Common blockers: firewall, AP isolation, stale firmware.

Distribution: `evenhub pack` → `.ehpk` for Even Hub Cloud submission, or host as a PWA. The Hub app store launched with Even Hub; Developer Mode sideload is the path for private/testing use.

## 6. Relay transport decision

Spotter and driver are never in BLE range of each other, so a cloud relay is required. Chosen: **Cloudflare Workers + Durable Objects** with the WebSocket Hibernation API.

- One Durable Object per race room. `ctx.acceptWebSocket(ws, [tags])`, `webSocketMessage`, `webSocketClose`, `ctx.getWebSockets()` for fan-out, automatic ping/pong that does not wake the object, per-socket `serializeAttachment` (≤16 KB) for role/room metadata across hibernation.
- Durable Objects are available on the **Workers Free plan** (SQLite backend only): 100k requests/day, 13k GB-s/day. Incoming WebSocket messages count at a 20:1 ratio; outgoing messages and pings are free. A weekend of racing is far inside free-tier limits.
- Deployments drop existing WebSockets — clients must reconnect automatically anyway.
- Same Worker can serve the spotter PWA's static assets, so one domain covers relay + spotter UI, and one origin goes into the glasses app's `app.json` whitelist.
- Alternative considered: Supabase Realtime Broadcast (less code, but adds a second vendor and the Supabase JS client to the glasses bundle). Rejected for now; the protocol package is transport-agnostic so it can be swapped.

## 7. Simulator: what it proves and what it does not (Sept 2026)

Package `@evenrealities/evenhub-simulator`, launched as `evenhub-simulator http://localhost:5173 --automation-port 9898`. HTTP automation API (v0.7.0+): `GET /api/ping` → `pong`, `GET /api/screenshot/glasses` (576×288 RGBA PNG of the framebuffer), `GET /api/screenshot/webview`, `GET /api/console[?since_id=N]`, `DELETE /api/console`, `POST /api/input` with actions `up`, `down`, `click`, `double_click`, `long_press`, `long_press_release`, `context_menu`. Allow ~4 s after launch before sending input (SDK init + `createStartUpPageContainer`).

The docs state the simulator does **not** enforce: performance, frame pacing, BLE timing or real-device quirks; on-device image-size limits for `updateImageRawData`; LZ4 decompression (it decodes uncompressed payloads); status events (user/device profiles hardcoded); photometrically matched brightness. Acknowledged discrepancies: rendering is not pixel-perfect, list-scroll focus positioning differs, image processing is faster than hardware, error handling under abnormal conditions differs. Quote: "headless runs do not replace Beta Testing before submission … Always validate on real hardware before deployment."

Consequence for this project: the simulator is the **functional** gate (containers, text, bitmap content, queue and watchdog behaviour — evidence class `[SIM]`, produced by `scripts/sim-harness.ts`), and hardware remains the **compatibility** gate (image limits, nibble order, pacing, `sendFailed`, LZ4, background lifecycle, readability — `[HW]`). Image mode is the normal path in both.

## Sources

- Even Hub docs: https://hub.evenrealities.com/docs — quickstart (`/docs/get-started/quickstart`), architecture (`/docs/get-started/architecture`), display (`/docs/build/display`), device APIs (`/docs/build/device-apis`), networking (`/docs/build/networking`), background & lifecycle (`/docs/build/background-lifecycle`)
- Official plugin: https://github.com/even-realities/everything-evenhub
- Templates: https://github.com/even-realities/evenhub-templates
- Demo app: https://github.com/even-realities/EvenDemoApp
- Community SDK notes (architecture, performance, page lifecycle, packaging, simulator): https://github.com/nickustinov/even-g2-notes
- Community dev guide (companion-app and backend patterns): https://github.com/aleapc/even-hub-devguide
- SDK feature verification: https://zenn.dev/bigdra/articles/eveng2-sdk-features?locale=en
- Curated list: https://github.com/pangoleen/awesome-even-realities-g2
- Local simulator wrapper: https://github.com/BxNxM/even-dev
- Simulator reference (limits not enforced, automation API): https://hub.evenrealities.com/docs/test/simulator
- Simulator package: https://www.npmjs.com/package/@evenrealities/evenhub-simulator
- Cloudflare DO WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets
- Cloudflare DO pricing / free plan: https://developers.cloudflare.com/durable-objects/platform/pricing/
