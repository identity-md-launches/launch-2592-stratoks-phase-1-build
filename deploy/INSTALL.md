# Installing the Stratoks world server on your own VPS

Target: Ubuntu (ARM64), 2 shared vCPU, 4 GB RAM, 40 GB SSD. You run these steps yourself; nobody else needs access to your server. **Status: the Docker files have NOT been built or run by the author (no Docker on the build machine); see `../tests/RESULTS.md`.**

1. **DNS**: point an A/AAAA record (e.g. `world.example.com`) at the VPS. Open ports 80 and 443.
2. **Docker**: `curl -fsSL https://get.docker.com | sh` (Docker Engine + compose plugin), then `sudo usermod -aG docker $USER` and re-login.
3. **Get the code**: `git clone <repository-url> /opt/stratoks && cd /opt/stratoks/deploy`
4. **Configure**: `cp env.example stratoks.env` and edit:
   * `ALLOWED_ORIGINS` = the exact origin of the IMD-hosted client (e.g. `https://yourname.imd.example`).
   * `DEV_WALLETS` = your developer wallet address(es), lowercase.
   * Export the hostname for the proxy: `echo "SERVER_HOSTNAME=world.example.com" > .env`
5. **Start**: `docker compose up -d --build` — builds for `linux/arm64`, starts the server and Caddy (automatic HTTPS/WSS).
6. **Check**: `curl https://world.example.com/health` → `{"ok":true,...}`; `docker compose ps` should show `healthy`.
7. **Point the client** at `https://world.example.com` and `wss://world.example.com/ws` (the client's server-URL setting). Until it is set the client shows "World server not connected".
8. **Backups**: `./backup.sh` (also via cron, see script). Restore: `./restore.sh backups-offsite/<name>`.
9. **Upgrade**: `git pull && docker compose up -d --build`. Snapshots are migrated automatically (`src/migrations.js`); a newer-than-supported snapshot is refused.

## Operations
* Logs: `docker compose logs -f world` (container logs rotate at 10 MB × 3).
* Health: `/health` (liveness), `/api/status` (tick latency p50/p95/p99, lag, `overloaded`, CPU, RSS, clients). Watch `overloaded`.
* Stop/restart safely: `docker compose stop world` (30 s grace, writes a final snapshot). Crash/power loss: loses at most the last ~30 s of simulation (snapshot interval), except interventions, which are snapshotted before they are acknowledged.
* **Downtime behaviour**: world time pauses while the server is down. On start at most 600 ticks of non-lethal, birth-free catch-up are simulated, a `downtime` event is logged, and the rest of the outage is skipped. An outage never kills the population.
* **Overload**: the world slows down and broadcasts are thinned; creatures are never deleted to save CPU.
* Reset (destructive, developer wallet only): `POST /api/dev/reset {"confirm":"RESET <worldId>"}`; the old world is archived under `/data/archive`.
* Manual restore without scripts: stop the container, then `docker compose run --rm --no-deps -v <dir>:/restore:ro world node bin/restore.js /restore`.

## Remaining operator setup / not done
* Domain, TLS, firewall (`ufw allow 80,443/tcp`), developer wallet list, client URL configuration.
* Real ARM64 VPS verification (CPU/RAM/tick latency) — only local x86_64 numbers exist so far.
* Off-site copy of `backups-offsite/` (e.g. rsync to another host).
* Phase 2+: payments, polished client art, public extinction/recovery policy (not part of this phase).
