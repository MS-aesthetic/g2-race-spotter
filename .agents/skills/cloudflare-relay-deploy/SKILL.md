---
name: cloudflare-relay-deploy
description: Cloudflare Workers + Durable Objects setup, local dev, deployment and operations for the Race Spotter relay — wrangler config, SQLite DO migrations, static asset hosting of the spotter PWA, secrets, custom domain, CORS, wrangler tail, and the glasses app.json network whitelist that must match the deployed origin. Use when configuring, deploying, or debugging services/relay.
---

# Cloudflare relay: config, deploy, operate

Verify against current docs before relying on any flag here — fetch https://developers.cloudflare.com/durable-objects/ and https://developers.cloudflare.com/workers/wrangler/configuration/ when in doubt. The Cloudflare MCP tools available in Cowork can list Workers and check the account; wrangler does the deploys.

## Layout (`services/relay`)

```
wrangler.jsonc
src/index.ts        Worker: routes /health, /room/:id (upgrade), /room/:id/debug, assets fallback
src/race-room.ts    RaceRoom Durable Object (hibernation API)
src/cors.ts         helper adding Access-Control-* headers
test/               integration tests using `ws` against wrangler dev
```

## wrangler.jsonc essentials

- `name: "g2-race-relay"`, `main: "src/index.ts"`, `compatibility_date` = today's date when the file is created, `compatibility_flags: ["nodejs_compat"]` only if the protocol package needs it (it should not).
- `durable_objects.bindings: [{ name: "ROOMS", class_name: "RaceRoom" }]`
- `migrations: [{ tag: "v1", new_sqlite_classes: ["RaceRoom"] }]` — **SQLite classes** are required for the Workers Free plan; never use `new_classes`.
- `assets: { directory: "../../apps/spotter/dist", not_found_handling: "single-page-application" }` so the same Worker serves the spotter PWA; the Worker's `fetch` runs first for `/room/*` and `/health`, everything else falls through to assets (`run_worker_first` for those paths if the current asset routing needs it).
- `observability: { enabled: true }` for logs in the dashboard.
- Secrets via `wrangler secret put DEBUG_KEY`; never in the config file. Local: `.dev.vars` (git-ignored).

## Routing rules in `src/index.ts`

- `GET /room/:id` with `Upgrade: websocket` → validate room id (`/^[A-Z0-9]{4,6}$/i`), `env.ROOMS.idFromName(id.toUpperCase())`, forward the request to the stub. Non-upgrade requests to `/room/:id` → 426.
- `GET /health` → `{ ok: true, version }`.
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

Build the spotter first (`npm run build -w apps/spotter`) or the assets directory will not exist.

## Deploy

1. `npm run build -w apps/spotter`
2. `npx wrangler deploy` from `services/relay` → `https://g2-race-relay.<account>.workers.dev`
3. Custom domain (optional, recommended for a stable whitelist entry): add a route/custom domain in `wrangler.jsonc` (`routes: [{ pattern: "spot.example.com", custom_domain: true }]`).
4. Update `apps/glasses/app.json` → `permissions[] network.whitelist` with the exact `https://` origin (no path, no wildcard, one entry per origin). Rebuild/re-sideload the glasses app; the whitelist is read at load time.
5. Smoke: `curl https://<host>/health`, then `npx tsx scripts/fake-spotter.ts --url wss://<host> --room QA01 --scenario lanes` with a `--role driver` instance in another terminal.

## Operate

- `npx wrangler tail --format pretty` during a session; grep by room code.
- Free-plan budget: 100k requests/day; incoming WS messages count 20:1, outgoing are free. A 3-hour session at 10 msg/s from the spotter is ~5.4k billable requests. Nothing to worry about; still, the rate limiter stays on.
- Rollback: `npx wrangler rollback` (or redeploy the previous commit). Sockets drop either way.
- If the WebView reports a blocked request, check in order: `app.json` whitelist origin matches exactly (scheme + host + port) → CORS headers on HTTP responses → the Even app was reloaded after editing `app.json`.
