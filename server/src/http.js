// HTTP + WebSocket API. Public read endpoints; wallet-session for visitor actions; developer-only mutation endpoints.
import http from 'node:http';
import { Auth, httpErr } from './auth.js';
import { acceptUpgrade } from './ws.js';
import { worldMeta, creatureDetail, compactCreature } from './view.js';
import { isAddress } from './wallet.js';

export function createServer(service) {
  const cfg = service.cfg, auth = new Auth(cfg), buckets = new Map();
  const limited = (ip, key, max, windowMs = 60_000) => {
    const k = key + ip, now = Date.now(); let b = buckets.get(k);
    if (!b || now - b.t > windowMs) b = { t: now, n: 0 }; b.n++; buckets.set(k, b);
    if (buckets.size > 20000) buckets.clear();
    return b.n > max;
  };
  const ipOf = (req) => (cfg.server.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;

  async function body(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 8192) throw httpErr(413, 'body_too_large'); chunks.push(c); }
    if (!n) return {};
    try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!j || typeof j !== 'object') throw 0; return j; } catch { throw httpErr(400, 'bad_json'); }
  }
  const session = (req) => auth.session((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const requireDev = (req) => { const s = session(req); if (!s) throw httpErr(401, 'auth_required'); if (s.role !== 'developer') throw httpErr(403, 'developer_only'); return s; };
  const requireWallet = (req) => { const s = session(req); if (!s) throw httpErr(401, 'auth_required'); return s; };

  const routes = {
    'GET /health': () => { const h = service.health(); return { ok: h.ok, tick: h.tick, status: h.status, overloaded: h.overloaded }; },
    'GET /api/status': () => ({ ...service.health(), world: worldMeta(service.world, cfg), demoMode: cfg.server.demoMode, learning: service.world.learning }),
    'GET /api/world': () => JSON.parse(service.snapshotMessage()),
    'GET /api/creatures': () => ({ tick: service.world.tick, creatures: service.world.creatures.map((c) => compactCreature(service.world, c)) }),
    'GET /api/history': (q) => ({ history: service.world.history.slice(-Math.min(2000, Number(q.get('limit') ?? 600))) }),
    'GET /api/graveyard': (q) => ({ deaths: service.world.graveyard.slice(-Math.min(500, Number(q.get('limit') ?? 100))) }),
    'GET /api/events': (q) => {
      const after = Number(q.get('after') ?? 0), limit = Math.min(500, Number(q.get('limit') ?? 100));
      const mem = service.world.events.filter((e) => e.seq > after);
      const oldest = service.world.events[0]?.seq ?? Infinity;
      const evs = after + 1 < oldest ? service.store.readEvents(after, limit) : mem.slice(0, limit);
      return { events: evs.slice(0, limit), latestSeq: service.world.seq };
    },
    'POST /api/auth/nonce': async (q, req) => {
      if (limited(ipOf(req), 'auth', 20)) throw httpErr(429, 'rate_limited');
      const b = await body(req); return auth.issueNonce(String(b.address ?? ''), req.headers.origin);
    },
    'POST /api/auth/verify': async (q, req) => {
      if (limited(ipOf(req), 'auth', 20)) throw httpErr(429, 'rate_limited');
      return auth.verify(await body(req), req.headers.origin);
    },
    'POST /api/visitor/presence': async (q, req) => {
      const s = requireWallet(req); if (limited(s.addr, 'pres', 120)) throw httpErr(429, 'rate_limited');
      const b = await body(req); const x = Number(b.x), y = Number(b.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw httpErr(400, 'bad_numbers');
      return { ok: service.world.visitorPresence(s.addr, x, y) };
    },
    'POST /api/visitor/action': async (q, req) => {
      const s = requireWallet(req); if (limited(s.addr, 'vact', 30)) throw httpErr(429, 'rate_limited');
      const b = await body(req); const r = service.world.visitorAction(s.addr, String(b.type));
      if (!r.ok) throw Object.assign(httpErr(r.error === 'cooldown' || r.error === 'wallet_harm_cap' ? 429 : 400, r.error), { extra: r });
      return r;
    },
    'POST /api/dev/interventions': async (q, req) => {
      const s = requireDev(req); const b = await body(req);
      const r = service.world.intervene(b, s.addr);
      if (!r.ok) throw Object.assign(httpErr(r.status, r.error), { extra: r });
      if (!r.duplicate) service.snapshot(); // durable before acknowledging: a retry after a crash cannot re-apply
      return { duplicate: r.duplicate, record: r.record };
    },
    'GET /api/dev/interventions': (q, req) => { requireDev(req); const w = service.world; return { interventions: w.interventionOrder.slice(-100).map((id) => w.interventions[id]) }; },
    'POST /api/dev/backup': (q, req) => { requireDev(req); service.snapshot(); return { path: service.store.backup() }; },
    'POST /api/dev/reset': async (q, req) => {
      const s = requireDev(req); const b = await body(req);
      if (b.confirm !== `RESET ${service.world.id}`) throw httpErr(400, 'confirm_required');
      const n = b.initialSeedCount === undefined ? undefined : Number(b.initialSeedCount);
      if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= 200)) throw httpErr(400, 'bad_initial_seed_count');
      const seed = b.seed === undefined ? undefined : Number(b.seed);
      if (seed !== undefined && !Number.isInteger(seed)) throw httpErr(400, 'bad_seed');
      service.log('warn', `developer reset by ${s.addr}`);
      return service.resetWorld({ initialSeedCount: n, seed });
    },
  };

  const cors = (req, res) => {
    const o = req.headers.origin;
    if (o && auth.originAllowed(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
  };
  const send = (res, status, obj) => { const s = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(s); };

  const server = http.createServer(async (req, res) => {
    cors(req, res);
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const m = /^\/api\/creatures\/(\d+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const id = Number(m[1]), c = service.world.getCreature(id);
        if (c) return send(res, 200, creatureDetail(service.world, c));
        const g = service.world.graveyard.find((x) => x.id === id);
        return g ? send(res, 200, { dead: true, ...g }) : send(res, 404, { error: 'not_found' });
      }
      const h = routes[`${req.method} ${url.pathname}`];
      if (!h) return send(res, 404, { error: 'not_found' });
      if (req.method === 'GET' && limited(ipOf(req), 'get', 600)) throw httpErr(429, 'rate_limited');
      send(res, 200, await h(url.searchParams, req));
    } catch (e) {
      if (!e.status) { service.log('error', e.stack ?? String(e)); return send(res, 500, { error: 'internal_error' }); }
      send(res, e.status, { error: e.code ?? e.message, ...(e.extra ?? {}) });
    }
  });
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const o = req.headers.origin;
    if (url.pathname !== '/ws' || (o && !auth.originAllowed(o))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    const conn = acceptUpgrade(req, socket); if (!conn) return;
    const after = Number(url.searchParams.get('after') ?? 0) || 0;
    if (!service.addClient(conn, after)) return;
    conn.onmessage = (txt) => {
      let m; try { m = JSON.parse(txt); } catch { return; }
      if (m.type === 'resync') conn.send(service.snapshotMessage(Number(m.after) || 0));
      else if (m.type === 'ping') conn.send(JSON.stringify({ type: 'pong', serverTime: Date.now(), tick: service.world.tick }));
    };
  });
  server.auth = auth;
  return server;
}
