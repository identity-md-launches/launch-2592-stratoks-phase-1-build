#!/usr/bin/env bash
# Online backup into the data volume (keeps the newest 10), then copies the newest one to ./backups-offsite/.
# Cron example (daily 03:15):  15 3 * * * cd /opt/stratoks/deploy && ./backup.sh >> backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
docker compose exec -T world node bin/backup.js
mkdir -p backups-offsite
latest=$(docker compose exec -T world sh -c 'ls -1 /data/backups | tail -1' | tr -d '\r')
docker compose cp "world:/data/backups/${latest}" "backups-offsite/${latest}"
echo "copied ${latest}"
