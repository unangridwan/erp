#!/bin/sh
# Backup logis PostgreSQL (format custom, terkompresi) + hapus backup lebih tua dari retensi.
# Variabel: PGHOST PGUSER PGPASSWORD PGDATABASE, BACKUP_DIR (bawaan ./backups), BACKUP_RETENTION_DAYS (bawaan 14).
set -eu
dir="${BACKUP_DIR:-./backups}"
keep="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dir/erp-$stamp.dump"
pg_dump --format=custom --compress=9 --no-owner --file="$file.partial"
mv "$file.partial" "$file"
# Verifikasi berkas bisa dibaca (daftar isi), agar backup rusak ketahuan saat itu juga.
pg_restore --list "$file" >/dev/null
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
find "$dir" -name 'erp-*.dump' -type f -mtime +"$keep" -print -delete
