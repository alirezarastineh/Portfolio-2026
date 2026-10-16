#!/usr/bin/env bash
# Nightly copy of Woodpecker's SQLite database on the production host, run by
# systemd/woodpecker-backup.timer (README.md, "Backups"). The database holds
# the repo settings, secrets and pipeline history; the agent keeps nothing that
# needs a backup.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/woodpecker}
KEEP_DAYS=${KEEP_DAYS:-14}
# Compose project "woodpecker" (deploy/woodpecker/docker-compose.server.yml).
DATA_VOLUME=${DATA_VOLUME:-woodpecker_woodpecker-server-data}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 "$BACKUP_DIR"

# sqlite3's .backup copies through SQLite's backup API, so the copy is
# consistent while the server keeps writing. The server image has no shell or
# sqlite3, hence the throwaway container. Not mounted read-only: SQLite may
# need its -shm file even to read.
docker run --rm \
  -v "$DATA_VOLUME":/data \
  -v "$BACKUP_DIR":/backup \
  alpine:3.22 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/woodpecker.sqlite \".backup '/backup/woodpecker-$stamp.sqlite'\""
gzip "$BACKUP_DIR/woodpecker-$stamp.sqlite"
find "$BACKUP_DIR" -name 'woodpecker-*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup: $BACKUP_DIR/woodpecker-$stamp.sqlite.gz"
ls $BACKUP_DIR
