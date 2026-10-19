#!/bin/sh
# Penjadwal sederhana untuk container backup: jalankan backup.sh setiap BACKUP_INTERVAL_SECONDS.
set -u
while true; do
  /bin/sh /scripts/backup.sh || echo "backup GAGAL $(date -u)" >&2
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
