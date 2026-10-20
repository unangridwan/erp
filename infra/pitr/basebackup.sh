#!/bin/sh
# Base backup fisik untuk PITR + retensi. Dijalankan dari container yang berbagi jaringan dengan postgres
# (koneksi replication lewat 127.0.0.1). Variabel: PGHOST PGPORT PGUSER PGPASSWORD, PITR_BASE_DIR (bawaan
# /backups/base), WAL_ARCHIVE_DIR (bawaan /backups/wal), PITR_BASE_KEEP (jumlah base backup disimpan, bawaan 2).
set -eu
base_dir="${PITR_BASE_DIR:-/backups/base}"
wal_dir="${WAL_ARCHIVE_DIR:-/backups/wal}"
keep="${PITR_BASE_KEEP:-2}"
mkdir -p "$base_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$base_dir/base-$stamp"
pg_basebackup --pgdata="$target.partial" --format=tar --gzip --wal-method=stream --checkpoint=fast \
  --label="erp-pitr-$stamp" --no-password
mv "$target.partial" "$target"
# pg_verifybackup belum bisa membaca format tar di PG 16; periksa manifest & integritas arsip gzip.
test -s "$target/backup_manifest"
for f in "$target"/*.tar.gz; do gzip -t "$f"; done
echo "base backup ok: $target ($(du -sh "$target" | cut -f1))"

# Retensi: simpan PITR_BASE_KEEP base backup terbaru, hapus sisanya dan WAL yang lebih tua dari base tertua.
ls -1d "$base_dir"/base-* 2>/dev/null | grep -v '\.partial$' | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  echo "hapus base backup lama: $old"
  rm -rf "$old"
done
oldest="$(ls -1d "$base_dir"/base-* 2>/dev/null | grep -v '\.partial$' | sort | head -n 1)"
[ -n "$oldest" ] || exit 0
# Segmen WAL awal base tertua dari backup_manifest ("Timeline": n, "Start-LSN": "X/Y").
tli="$(sed -n 's/.*"Timeline": *\([0-9]*\).*/\1/p' "$oldest/backup_manifest" | head -n 1)"
lsn="$(sed -n 's/.*"Start-LSN": *"\([0-9A-Fa-f]*\/[0-9A-Fa-f]*\)".*/\1/p' "$oldest/backup_manifest" | head -n 1)"
[ -n "$tli" ] && [ -n "$lsn" ] || { echo "manifest $oldest tanpa WAL-Ranges; WAL tidak dibersihkan" >&2; exit 0; }
hi=$((0x${lsn%/*}))
lo=$((0x${lsn#*/}))
segment="$(printf '%08X%08X%08X' "$tli" "$hi" "$((lo >> 24))")"
if [ -d "$wal_dir" ]; then
  pg_archivecleanup -x .gz "$wal_dir" "$segment"
  # Berkas riwayat backup (*.backup.gz) tidak disentuh pg_archivecleanup.
  for f in "$wal_dir"/*.backup.gz; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    if expr "${name%%.*}" \< "$segment" >/dev/null; then rm -f "$f"; fi
  done
  echo "WAL sebelum $segment dibersihkan"
fi
