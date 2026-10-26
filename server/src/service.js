// Tick loop, persistence cadence, broadcast hub, overload accounting. The simulation (world.js) knows nothing about this.
import os from 'node:os';
import { World } from './world.js';
import { Store } from './store.js';
import { buildView, tileRows, worldMeta } from './view.js';

export class Service {
  constructor(cfg, { log = () => {} } = {}) {
    this.cfg = cfg; this.log = log; this.store = new Store(cfg.server.dataDir, cfg.persistence);
    this.clients = new Set(); this.cache = new Map(); this.outEvents = []; this.msgN = 0;
    this.lat = []; this.latMax = 0; this.lagMs = 0; this.overloaded = false; this.skippedBroadcasts = 0;
    this.cpuPrev = process.cpuUsage(); this.cpuPrevT = process.hrtime.bigint(); this.cpuPct = 0;
    this.running = false; this.startedAt = Date.now();
  }

  start() {
    this.store.init();
    const loaded = this.store.load();
    if (loaded) {
      this.world = World.fromState(this.cfg, loaded.state);
      this.log('info', `loaded world ${this.world.id} at tick ${this.world.tick}${loaded.usedFallback ? ' (from previous snapshot)' : ''}${loaded.migratedFrom !== undefined && loaded.migratedFrom < 1 ? ' (migrated)' : ''}`);
      this.#catchup(loaded.savedAtWall);
    } else {
      this.world = World.create(this.cfg);
      this.log('info', `created NEW world ${this.world.id} with ${this.world.creatures.length} initial Stratoks`);
      this.store.save(this.world.toState());
    }
    this.#wire();
    this.#flushEvents();
    this.#prime();
    this.running = true;
    this.due = performance.now() + this.cfg.world.tickMs;
    this.timer = setTimeout(() => this.#loop(), this.cfg.world.tickMs);
    this.snapTimer = setInterval(() => this.snapshot(), this.cfg.persistence.snapshotEveryMs);
    this.snapTimer.unref?.();
  }
  #prime() { this.cache = new Map(); for (const [k, v] of buildView(this.world)) this.cache.set(k, { s: JSON.stringify(v), v }); }
  #wire() {
    this.world.onRecord = (r) => { if (r.kind === 'intervention') this.store.appendIntervention(r); else this.store.appendLifecycle(r); };
  }
  // Downtime policy: world time is PAUSED while the server is down. On restart at most catchup.maxTicks ticks are
  // simulated, with non-lethal damage and no births, so an outage can never kill the population in one burst.
  #catchup(savedAtWall) {
    const down = Math.max(0, Date.now() - savedAtWall), c = this.cfg.world.catchup;
    const n = Math.min(c.maxTicks, Math.floor(down / this.cfg.world.tickMs));
    if (down > this.cfg.world.tickMs * 5) {
      for (let i = 0; i < n; i++) this.world.step({ catchup: !c.lethal });
      this.world.catchup = false;
      this.world.emit('downtime', { downSeconds: Math.round(down / 1000), ticksSimulated: n, maxTicks: c.maxTicks, policy: 'world time paused during downtime; capped non-lethal catch-up' });
      this.log('warn', `downtime ${Math.round(down / 1000)}s: simulated ${n} catch-up ticks (cap ${c.maxTicks}), remaining downtime not simulated`);
    }
  }

  #loop() {
    if (!this.running) return;
    const t0 = performance.now();
    this.tickOnce();
    const t1 = performance.now(), cost = t1 - t0, T = this.cfg.world.tickMs;
    this.#record(cost);
    // Overload policy: never burst-catch-up, never drop creatures. If late, the world simply runs slower (time dilation).
    this.due += T; this.lagMs = Math.max(0, t1 - this.due);
    if (this.lagMs > T) this.due = t1;
    this.timer = setTimeout(() => this.#loop(), Math.max(0, this.due - performance.now()));
  }
  tickOnce() {
    this.world.step();
    this.#flushEvents();
    const p95 = this.#pct(0.95);
    this.overloaded = p95 > this.cfg.world.tickMs * 0.8 || this.lagMs > this.cfg.world.tickMs;
    if (this.overloaded && this.world.tick % 2 === 1) { this.skippedBroadcasts++; return; } // shed rendering work, not simulation
    this.broadcast();
  }
  #flushEvents() { const evs = this.world.drainEvents(); if (evs.length) { this.store.appendEvents(evs); this.outEvents.push(...evs); } }
  #record(ms) {
    this.lat.push(ms); if (this.lat.length > 600) this.lat.shift(); this.latMax = Math.max(this.latMax, ms);
    const now = process.hrtime.bigint(), cpu = process.cpuUsage(this.cpuPrev);
    if (now - this.cpuPrevT > 5_000_000_000n) { this.cpuPct = Math.round(((cpu.user + cpu.system) / 1000) / (Number(now - this.cpuPrevT) / 1e6) * 1000) / 10; this.cpuPrev = process.cpuUsage(); this.cpuPrevT = now; }
  }
  #pct(p) { if (!this.lat.length) return 0; const s = [...this.lat].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

  broadcast() {
    const next = buildView(this.world), upsert = [], rm = [], newCache = new Map();
    for (const [k, v] of next) { const str = JSON.stringify(v); newCache.set(k, { s: str, v }); if (this.cache.get(k)?.s !== str) upsert.push(v); }
    for (const k of this.cache.keys()) if (!newCache.has(k)) rm.push(k);
    this.cache = newCache;
    const events = this.outEvents; this.outEvents = [];
    if (!this.clients.size) return;
    const msg = JSON.stringify({ type: 'delta', n: ++this.msgN, tick: this.world.tick, seq: this.world.seq, serverTime: Date.now(), upsert, remove: rm, events, meta: worldMeta(this.world, this.cfg), health: this.health() });
    for (const c of this.clients) {
      if (c.backlog > this.cfg.server.maxWsBufferBytes) { c.close(1013); this.clients.delete(c); continue; } // drop slow viewer, never creatures
      c.send(msg);
    }
  }
  snapshotMessage(afterSeq = 0) {
    const w = this.world;
    const entities = [...this.cache.values()].map((e) => e.v);
    const events = w.events.filter((e) => e.seq > afterSeq).slice(-200);
    return JSON.stringify({ type: 'snapshot', n: this.msgN, tick: w.tick, seq: w.seq, serverTime: Date.now(), world: { ...worldMeta(w, this.cfg), tiles: tileRows(w) }, entities, events, history: w.history.slice(-300), health: this.health(), demoMode: this.cfg.server.demoMode });
  }
  addClient(conn, afterSeq) {
    if (this.clients.size >= this.cfg.server.maxWsClients) { conn.close(1013); return false; }
    this.clients.add(conn); conn.onclose = () => this.clients.delete(conn);
    conn.send(this.snapshotMessage(afterSeq));
    return true;
  }

  health() {
    const mem = process.memoryUsage();
    return {
      ok: this.running, tick: this.world?.tick, status: this.world?.status, uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      tickLatencyMs: { p50: r(this.#pct(0.5)), p95: r(this.#pct(0.95)), p99: r(this.#pct(0.99)), max: r(this.latMax), budget: this.cfg.world.tickMs },
      lagMs: Math.round(this.lagMs), overloaded: this.overloaded, skippedBroadcasts: this.skippedBroadcasts,
      cpuPercent: this.cpuPct, rssMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576),
      clients: this.clients.size, population: this.world?.creatures.length, loadavg: os.loadavg()[0],
      overloadPolicy: 'simulation slows (time dilation) and broadcasts are thinned; creatures are never removed to save CPU',
    };
  }
  snapshot() { try { return this.store.save(this.world.toState()); } catch (e) { this.log('error', 'snapshot failed: ' + e.message); } }
  resetWorld(opts) { // authenticated developer reset only (caller checks auth + confirmation)
    const old = this.world;
    this.snapshot();
    const archived = this.store.archiveWorld(`${old.id}-${Date.now()}`);
    const nw = World.create(this.cfg, { resetCount: old.resetCount + 1, seed: opts.seed ?? this.cfg.world.seed + old.resetCount + 1, initialCount: opts.initialSeedCount, id: `world-${Date.now()}-${old.resetCount + 1}` });
    this.world = nw; this.#wire(); this.store.save(nw.toState()); this.#flushEvents(); this.#prime();
    nw.emit('reset', { previous: old.id, archived: archived.split('/').pop() });
    return { worldId: nw.id, archived };
  }
  stop() {
    this.running = false; clearTimeout(this.timer); clearInterval(this.snapTimer);
    if (this.world) { this.#flushEvents(); this.snapshot(); }
    for (const c of this.clients) c.close(1001);
    this.store.release();
  }
}
const r = (x) => Math.round(x * 100) / 100;
