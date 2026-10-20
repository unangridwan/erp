#!/bin/sh
# Penjadwal container pitr: base backup setiap PITR_BASE_INTERVAL_SECONDS (bawaan 7 hari).
set -u
until pg_isready -q; do sleep 2; done
while true; do
  /bin/sh /pitr/basebackup.sh || echo "base backup GAGAL $(date -u)" >&2
  sleep "${PITR_BASE_INTERVAL_SECONDS:-604800}"
done
