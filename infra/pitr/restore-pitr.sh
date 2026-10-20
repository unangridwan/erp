#!/bin/sh
# Siapkan direktori data PostgreSQL yang dipulihkan ke titik waktu tertentu (point-in-time recovery).
#   restore-pitr.sh <direktori base backup> <direktori data tujuan (kosong)> [waktu target, mis. "2026-10-20 09:30:00+07"]
# WAL diambil dari WAL_ARCHIVE_DIR (bawaan /backups/wal). Tanpa waktu target, pemulihan berjalan sampai WAL terakhir.
# Setelah itu jalankan postgres dengan direktori data tersebut; server promote otomatis setelah mencapai target.
set -eu
base="${1:?Pemakaian: restore-pitr.sh <base backup> <data dir tujuan> [waktu target]}"
data="${2:?direktori data tujuan}"
target="${3:-}"
wal_dir="${WAL_ARCHIVE_DIR:-/backups/wal}"
[ -f "$base/base.tar.gz" ] || { echo "$base/base.tar.gz tidak ada" >&2; exit 1; }
mkdir -p "$data"
if [ -n "$(ls -A "$data")" ]; then
  echo "Direktori $data tidak kosong" >&2
  exit 1
fi
chmod 700 "$data"
tar -xzf "$base/base.tar.gz" -C "$data"
mkdir -p "$data/pg_wal"
[ -f "$base/pg_wal.tar.gz" ] && tar -xzf "$base/pg_wal.tar.gz" -C "$data/pg_wal"
{
  echo ""
  echo "# --- pemulihan PITR ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ---"
  echo "restore_command = 'gzip -dc \"$wal_dir/%f.gz\" > \"%p\"'"
  [ -n "$target" ] && echo "recovery_target_time = '$target'"
  echo "recovery_target_action = 'promote'"
  # Arsip WAL tidak dilanjutkan dari server hasil pulihan sampai diperiksa operator.
  echo "archive_mode = 'off'"
} >> "$data/postgresql.auto.conf"
touch "$data/recovery.signal"
echo "Direktori data siap: $data${target:+ (target $target)}. Jalankan postgres dengan PGDATA=$data."
