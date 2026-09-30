---
name: cloudflare-relay-deploy
description: Cloudflare Workers + Durable Objects setup, local dev, deployment and operations for the Race Spotter relay — wrangler config, SQLite DO migrations, static hosting of the assembled site (spotter PWA at / and the glasses app at /glasses/), one-command deploy, the driver's QR sideload, secrets, custom domain, CORS, wrangler tail, and the glasses app.json network whitelist that must match the deployed origin. Use when configuring, deploying, or debugging services/relay.
---

# Cloudflare relay: config, deploy, operate

Verify against current docs before relying on any flag here — fetch https://developers.cloudflare.com/durable-objects/ and https://developers.cloudflare.com/workers/wrangler/configuration/ when in doubt. The Cloudflare MCP tools available in Cowork can list Workers and check the account; wrangler does the deploys.

## Layout (`services/relay`)

```
wrangler.jsonc
src/index.ts        Worker: routes /health, /room/:id (upgrade), /room/:id/debug, assets (+ spotter SPA fallback outside /glasses/)
src/race-room.ts    RaceRoom Durable Object (hibernation API)
test/               integration tests using `ws` against wrangler dev (site.test.ts: /glasses/ hosting)
```

## The site the relay serves (T058, Maxx 2026-09-30: "a deployable app not requiring a PC running locally")

`npm run build:site` (`scripts/build-site.mjs`) builds both apps and assembles the git-ignored `site/`:

```
site/                 spotter PWA dist (index.html, sw.js, assets/, manifest, icons)
site/glasses/         glasses app dist — built with Vite base /glasses/ — plus a copy of apps/glasses/app.json
```

One Worker, one origin, so the glasses app served from `https://<relay>/glasses/` resolves its relay as `wss://<relay>` by itself (`resolveRelayBase`), and the spotter's driver setup screen can hand the driver a QR of `https://<relay>/glasses/?room=<ROOM>&pin=<PIN>&name=driver`. The Even app's Developer Mode loads whatever URL the scanned QR carries (`evenhub qr` itself just encodes a URL), and `seedFromSearch` in the glasses app reads `?room=&pin=&name=` — no PC, no typing. `scripts/test/build-site.test.ts` runs the real CLI into a temp dir.

## wrangler.jsonc essentials

- `name: "g2-race-relay"`, `main: "src/index.ts"`, `compatibility_date` = today's date when the file is created, `compatibility_flags: ["nodejs_compat"]` only if the protocol package needs it (it should not).
- `durable_objects.bindings: [{ name: "ROOMS", class_name: "RaceRoom" }]`
- `migrations: [{ tag: "v1", new_sqlite_classes: ["RaceRoom"] }]` — **SQLite classes** are required for the Workers Free plan; never use `new_classes`.
- `assets: { binding: "ASSETS", directory: "../../site", not_found_handling: "none", run_worker_first: true }` — the Worker sees every request, answers `/room/*` and `/health` itself and hands the rest to `env.ASSETS`. `not_found_handling` is one policy for the whole site and the two apps need opposite ones, so the Worker does the spotter's single-page fallback itself: an asset 404 **outside** `/glasses` is re-fetched as `/` (the spotter shell, 200); a 404 under `/glasses/` stays a 404 so the Even app's WebView never receives the spotter shell as a script. `/glasses` → 307 `/glasses/` keeps the query string (asset `html_handling` default).
- `observability: { enabled: true }` for logs in the dashboard.
- Secrets via `wrangler secret put DEBUG_KEY`; never in the config file. Local: `.dev.vars` (git-ignored).

## Routing rules in `src/index.ts`

- `GET /room/:id` with `Upgrade: websocket` → validate room id (`/^[A-Z0-9]{4,6}$/i`), `env.ROOMS.idFromName(id.toUpperCase())`, forward the request to the stub. Non-upgrade requests to `/room/:id` → 426.
- `GET /health` → `{ ok: true, version }`.
- Everything else → `serveAsset`: `env.ASSETS.fetch`; on 404 for a GET/HEAD not under `/glasses`, `env.ASSETS.fetch(/)`.
- `GET /room/:id/debug` → requires header `X-Debug-Key === env.DEBUG_KEY`; returns the DO's current state JSON (implemented as an internal DO route).
- All HTTP responses pass through `withCors()` → `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type, X-Debug-Key`, `Access-Control-Allow-Methods: GET, OPTIONS`; answer `OPTIONS` with 204.

## RaceRoom skeleton (hibernation API)

```ts
export class RaceRoom extends DurableObject<Env> {
  async fetch(req: Request) {
    // parse role/token/name from URL; load state + pin from storage.
    // ALWAYS accept the socket first — error frames can only be sent on an accepted socket.
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [role]);
    pair[1].serializeAttachment({ role, name, lastPing: Date.now() });
    // pin: first connection with no stored pin sets it (token or null); later mismatches →
    //   send error{code:'auth'} then close(4401).
    // single driver, last writer wins: for role==='driver', every existing socket tagged
    //   'driver' gets error{code:'role_taken'} then close(4409) BEFORE this one is used.
    this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, raw) { /* size check → parse → guard (+ hello cross-check vs URL) → rate limit → reduce → persist → broadcast; hello → send state replay */ }
  async webSocketClose(ws) { /* recompute online flags via getWebSockets('spotter'|'driver') → reduce(peer) → persist → broadcast → scheduleAlarm() */ }
  async webSocketError(ws) { /* same as close */ }
  async alarm() {
    // 1. sockets open: any socket with lastPing older than PEER_OFFLINE_MS → close(4408, 'silent'),
    //    which drives webSocketClose → peer offline broadcast.
    // 2. no sockets and now - updatedAt >= ROOM_TTL_MS → reduce(expire) → storage.deleteAll().
    // 3. scheduleAlarm()
  }
  scheduleAlarm() {
    // sockets open  → setAlarm(now + ALARM_TICK_MS)            (3 s tick)
    // no sockets    → setAlarm(updatedAt + ROOM_TTL_MS)         (12 h expiry) — a DO has ONE alarm,
    //                 so the TTL must be scheduled here or it never fires.
  }
}
```

Notes: `getWebSockets(tag)` gives you sockets by role after hibernation; the `hello` frame is where the first `state` replay is sent; `setAlarm` every 3 s while sockets exist is cheap (alarms are billed as requests — well within free tier). Deploying disconnects all sockets: clients reconnect on their own.

## Local dev

`npm run dev -w services/relay` → `wrangler dev` on `http://localhost:8787` (`ws://` for sockets). For phones on the LAN use `wrangler dev --ip 0.0.0.0` and put `http://<lan-ip>:8787` in the **dev** `app.json` whitelist of the glasses app (plain http is allowed only for local dev).

Run `npm run build:site` first or the assets directory (`site/`) will not exist. The live tests pass `--assets <temp dir>` and never need it.

## Deploy

One command from the repo root: **`npm run deploy`** = `npm run typecheck && npm run build:site && npm exec -w services/relay -- wrangler deploy` → `https://g2-race-relay.<account>.workers.dev` (currently `https://g2-race-relay.maxx-384.workers.dev`), serving relay, spotter and glasses app together. Needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`) once on the deploying machine; agents never deploy. Verify first with `npm run build:site` then `npx wrangler deploy --dry-run` in `services/relay`.

1. `npm run deploy` (or the three steps above by hand).
2. Driver: on the spotter phone tap the room chip → the driver setup screen shows ROOM, PIN and a QR → Even app → Developer Mode → Scan. The glasses app loads from `https://<relay>/glasses/` and joins the room.
3. Custom domain (optional, recommended for a stable whitelist entry): add a route/custom domain in `wrangler.jsonc` (`routes: [{ pattern: "spot.example.com", custom_domain: true }]`).
4. Update `apps/glasses/app.json` → `permissions[] network.whitelist` with the exact `https://` origin (no path, no wildcard, one entry per origin), then `npm run deploy` — the build copies it to `site/glasses/app.json`, next to the `index.html` the Even app loads. Re-scan the QR; the whitelist is read at load time.
5. Smoke: `curl https://<host>/health`, then `npx tsx scripts/fake-spotter.ts --url wss://<host> --room QA01 --scenario lanes` with a `--role driver` instance in another terminal.

## Operate

- `npx wrangler tail --format pretty` during a session; grep by room code.
- Free-plan budget: 100k requests/day; incoming WS messages count 20:1, outgoing are free. A 3-hour session at 10 msg/s from the spotter is ~5.4k billable requests. Nothing to worry about; still, the rate limiter stays on.
- Rollback: `npx wrangler rollback` (or redeploy the previous commit). Sockets drop either way.
- If the WebView reports a blocked request, check in order: `app.json` whitelist origin matches exactly (scheme + host + port) → CORS headers on HTTP responses → the Even app was reloaded after editing `app.json`.
