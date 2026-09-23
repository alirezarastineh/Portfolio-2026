#!/usr/bin/env bash
set -euo pipefail

# Nightly entry point (see systemd/portfolio-backup.timer): a database dump and
# a media archive into BACKUP_DIR, then — when restic is configured — an
# encrypted copy of that directory off this machine. Local-only backups do not
# survive losing the server, which is the failure backups exist for.
#
# Offsite settings come from the environment (the systemd unit loads them from
# /etc/portfolio-backup.env, readable by root only):
#   RESTIC_REPOSITORY      e.g. sftp:u123456@u123456.your-storagebox.de:portfolio
#   RESTIC_PASSWORD_FILE   file holding the repository password — keep a copy
#                          somewhere safe: without it the backups are unreadable

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

bash "${SCRIPT_DIR}/backup-postgres.sh"
bash "${SCRIPT_DIR}/backup-media.sh"

if [[ -z "${RESTIC_REPOSITORY:-}" ]]; then
  echo "RESTIC_REPOSITORY not set — local backups only."
  exit 0
fi

# BACKUP_DIR may be overridden in the repo .env; read it the same way the
# backup scripts do.
# Read as data, the way docker compose reads it (see load-env.sh).
# shellcheck source=load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_env "${REPO_DIR}/.env"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/portfolio-postgres}"

restic backup --quiet --tag portfolio "${BACKUP_DIR}"
restic forget --quiet --tag portfolio --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune
# Reads a sample of the stored data back, so silent corruption surfaces as a
# failed unit instead of at restore time.
restic check --quiet --read-data-subset=5%

echo "Offsite backup complete."
