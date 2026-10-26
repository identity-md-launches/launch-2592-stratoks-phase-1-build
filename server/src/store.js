// Durable storage: atomic checksummed snapshots, bounded rotating event log, append-only lifecycle record, backups.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrate, CURRENT_SCHEMA } from './migrations.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const FILES = ['world.json', 'world.prev.json', 'lifecycle.jsonl', 'interventions.jsonl', 'world.id'];

export class Store {
  constructor(dir, pcfg) { this.dir = path.resolve(dir); this.p = pcfg; this.f = (n) => path.join(this.dir, n); }

  init() {
    fs.mkdirSync(this.dir, { recursive: true }); fs.mkdirSync(this.f('backups'), { recursive: true }); fs.mkdirSync(this.f('archive'), { recursive: true });
    const lock = this.f('server.lock');
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      let alive = false; try { process.kill(pid, 0); alive = pid !== process.pid; } catch { /* stale */ }
      if (alive) throw new Error(`data dir ${this.dir} is locked by running pid ${pid}`);
    }
    fs.writeFileSync(lock, String(process.pid));
  }
  release() { try { fs.unlinkSync(this.f('server.lock')); } catch { /* ignore */ } }

  worldExists() { return fs.existsSync(this.f('world.id')) || fs.existsSync(this.f('world.json')) || fs.existsSync(this.f('world.prev.json')); }

  readSnapshot(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (sha(JSON.stringify(raw.state)) !== raw.sha256) throw new Error(`checksum mismatch in ${file}`);
    return raw;
  }
  // Returns {state, savedAtWall, migratedFrom, usedFallback} or null if no world was ever created.
  // Throws if a world exists but cannot be read: NEVER silently starts a new world.
  load() {
    if (!this.worldExists()) return null;
    const errs = [];
    for (const [name, fb] of [['world.json', false], ['world.prev.json', true]]) {
      if (!fs.existsSync(this.f(name))) continue;
      try {
        const raw = this.readSnapshot(this.f(name));
        const m = migrate(raw);
        return { state: m.snap.state, savedAtWall: raw.savedAtWall, migratedFrom: m.from, usedFallback: fb };
      } catch (e) { errs.push(`${name}: ${e.message}`); }
    }
    throw new Error(`World data exists in ${this.dir} but no valid snapshot could be read (${errs.join('; ') || 'missing'}). Refusing to create a new world. Restore a backup with bin/restore.js.`);
  }
  save(state, savedAtWall = Date.now()) {
    const body = JSON.stringify({ schemaVersion: CURRENT_SCHEMA, savedAtWall, sha256: sha(JSON.stringify(state)), state });
    const tmp = this.f('world.json.tmp'), cur = this.f('world.json');
    const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd);
    if (fs.existsSync(cur)) fs.copyFileSync(cur, this.f('world.prev.json'));
    fs.renameSync(tmp, cur);
    fs.writeFileSync(this.f('world.id'), state.id);
    return body.length;
  }
  appendEvents(evs) {
    if (!evs.length) return;
    const f = this.f('events.jsonl');
    fs.appendFileSync(f, evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
    if (fs.statSync(f).size > this.p.eventLogMaxBytes) { // bounded: keep eventLogFiles generations
      for (let i = this.p.eventLogFiles - 1; i >= 1; i--) if (fs.existsSync(`${f}.${i}`)) fs.renameSync(`${f}.${i}`, `${f}.${i + 1}`);
      fs.renameSync(f, `${f}.1`);
      const old = `${f}.${this.p.eventLogFiles}`; if (fs.existsSync(old)) fs.unlinkSync(old);
    }
  }
  appendLifecycle(rec) { fs.appendFileSync(this.f('lifecycle.jsonl'), JSON.stringify(rec) + '\n'); }
  appendIntervention(rec) { fs.appendFileSync(this.f('interventions.jsonl'), JSON.stringify(rec) + '\n'); }
  readEvents(afterSeq, limit = 500) {
    const out = [];
    for (let i = this.p.eventLogFiles; i >= 0; i--) {
      const f = i ? `${this.f('events.jsonl')}.${i}` : this.f('events.jsonl');
      if (!fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line) continue; try { const e = JSON.parse(line); if (e.seq > afterSeq) out.push(e); } catch { /* torn line */ } }
    }
    return out.slice(0, limit);
  }
  archiveWorld(label) {
    const dest = this.f(path.join('archive', label)); fs.mkdirSync(dest, { recursive: true });
    for (const n of fs.readdirSync(this.dir)) if (n.startsWith('world') || n.endsWith('.jsonl') || /\.jsonl\.\d+$/.test(n)) fs.renameSync(this.f(n), path.join(dest, n));
    return dest;
  }

  // Backup = copy of the durable files + manifest with sha256. Safe while running (snapshot is written atomically).
  backup(label = new Date().toISOString().replace(/[:.]/g, '-')) {
    const dest = this.f(path.join('backups', label)); fs.mkdirSync(dest, { recursive: true });
    const manifest = { createdAt: new Date().toISOString(), schemaVersion: CURRENT_SCHEMA, files: {} };
    for (const n of fs.readdirSync(this.dir)) {
      if (!(FILES.includes(n) || n === 'events.jsonl' || /^events\.jsonl\.\d+$/.test(n))) continue;
      fs.copyFileSync(this.f(n), path.join(dest, n)); manifest.files[n] = sha(fs.readFileSync(path.join(dest, n)));
    }
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const all = fs.readdirSync(this.f('backups')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - this.p.backupKeep))) fs.rmSync(this.f(path.join('backups', old)), { recursive: true, force: true });
    return dest;
  }
}

// Restore (server must be stopped). Verifies checksums, moves the current data aside, never deletes it.
export function restoreBackup(dataDir, backupDir) {
  const dir = path.resolve(dataDir), src = path.resolve(backupDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  for (const [n, h] of Object.entries(manifest.files)) if (sha(fs.readFileSync(path.join(src, n))) !== h) throw new Error(`backup file ${n} failed checksum`);
  const lock = path.join(dir, 'server.lock');
  if (fs.existsSync(lock)) { try { process.kill(Number(fs.readFileSync(lock, 'utf8')), 0); throw new Error('server appears to be running; stop it before restoring'); } catch (e) { if (e.message.startsWith('server')) throw e; } }
  fs.mkdirSync(dir, { recursive: true });
  const aside = path.join(dir, 'archive', `pre-restore-${Date.now()}`); fs.mkdirSync(aside, { recursive: true });
  for (const n of fs.readdirSync(dir)) if (FILES.includes(n) || n.startsWith('events.jsonl')) fs.renameSync(path.join(dir, n), path.join(aside, n));
  for (const n of Object.keys(manifest.files)) fs.copyFileSync(path.join(src, n), path.join(dir, n));
  const st = new Store(dir, { eventLogFiles: 3 }); st.readSnapshot(path.join(dir, 'world.json')); // verify
  return { restoredFrom: src, previousMovedTo: aside };
}
