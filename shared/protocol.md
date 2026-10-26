# Stratoks server ⇄ client interface (v1)

This is the agreed contract between the world server (`server/`) and the static browser client. The server is the only authority. Sample payloads produced by the real server are in `shared/fixtures/` (use them as the client mock; they are labelled fixtures, not live data).

Base URL: configurable HTTPS (`https://host`) and WSS (`wss://host/ws`). Until configured the client must show **"World server not connected"** and no fabricated data. Local demo/test mode = server started with `DEMO_MODE=1` (accepts `http://localhost:*` origins; `/api/status` and the snapshot carry `demoMode: true`, the client must label it).

## Public read (CORS: only origins in `ALLOWED_ORIGINS`)
| Route | Result |
|---|---|
| `GET /health` | `{ok,tick,status,overloaded}` |
| `GET /api/status` | health + metrics: `tickLatencyMs{p50,p95,p99,max,budget}`, `lagMs`, `overloaded`, `cpuPercent`, `rssMB`, `clients`, `population`, `world{...}`, `demoMode`, `learning` |
| `GET /api/world` | full snapshot (same as WS `snapshot`) |
| `GET /api/creatures` / `GET /api/creatures/:id` | compact list / inspector detail (needs, personality, relationships, memories, decisions, speech, wallet opinions, weights). Dead id → `{dead:true,cause,...}` |
| `GET /api/events?after=SEQ&limit=N` | events with `seq > after` (memory ring, falls back to rotated log files) |
| `GET /api/history?limit=N` | population/resource series, one point per 30 ticks |
| `GET /api/graveyard` | recorded deaths with cause |

## WebSocket `/ws[?after=SEQ]`
First message `snapshot`: `{type,n,tick,seq,serverTime,world{worldId,status,width,height,tiles[],tickMs,population,...},entities[],events[],history[],health,demoMode}`.
Then one `delta` per broadcast: `{type,n,tick,seq,serverTime,upsert[],remove[],events[],meta,health}`.
* Entities are keyed by `k`: `c:` creature, `b:` bush, `t:` tree, `s:` stone node, `h:` shelter (`stage` 0..3, `progress`, `integrity`), `f:` fire, `z:` storm, `v:` visitor, `p:` worn path tile.
* `n` increases by exactly 1 per message. If `n` skips, send `{"type":"resync","after":lastSeq}` (or reconnect with `?after=`) and replace local state with the new snapshot.
* Events carry a unique, increasing `seq`; clients de-duplicate by `seq`. Types: `world_created, birth, death(cause), pregnancy, miscarriage, bond, bond_end, shelter_started, shelter_stage, shelter_complete, shelter_destroyed, intervention, fire_end, storm_end, visitor_gift, visitor_harm, bush_died, downtime, extinction, reset`.
* Client → server: `{"type":"ping"}`, `{"type":"resync","after":N}`.
* Creature bubbles: `bubble{text,emote,kind:"template",tpl,cause}` – always template-generated, show an honest label.
* `world.status` is `alive` or `extinct`.
* Under overload the server thins broadcasts (the world slows down); it never removes creatures.

## Wallet sign-in
1. `POST /api/auth/nonce {address}` (Origin header must be allowed) → `{nonce,message,expiresAt}`.
2. Wallet signs `message` with `personal_sign` (EIP-191). No transaction, no key leaves the wallet.
3. `POST /api/auth/verify {address,message,signature}` → `{token,role:"visitor"|"developer",address,expiresAt}`. Nonce is single-use, 5 min; message binds address+origin+expiry.
4. Send `Authorization: Bearer <token>` afterwards. Wallets are accounts, not unique people.

## Visitors (any signed-in wallet)
* `POST /api/visitor/presence {x,y}` – places the wallet's avatar (expires after 300 ticks without refresh).
* `POST /api/visitor/action {type:"gift_food"|"startle"}` – needs presence; per-wallet cooldowns (429 + `retryAfterTicks`); `startle` is capped per wallet and deals 3 damage to the nearest creature.

## Developer (role `developer` only; 401 without token, 403 for visitors)
* `POST /api/dev/interventions {id,type:"add_food"|"heal_area"|"fire"|"storm",x,y,radius,intensity}` – `id` is `[A-Za-z0-9_-]{8,64}`. First call applies and returns `{duplicate:false,record}`; a retry with the same id and body returns `{duplicate:true,record}` and does nothing; same id with a different body → 409. Limits (422/429) come from the `interventions` config block. Records have a `payment:null` slot reserved for confirmed IMD payments later; no money is collected.
* `GET /api/dev/interventions`, `POST /api/dev/backup`.
* `POST /api/dev/reset {confirm:"RESET <worldId>", seed?, initialSeedCount?}` – the only way to start a new world.

Errors: `{error:"code", ...}` with HTTP status.
