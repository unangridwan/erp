#!/bin/sh
# archive_command PostgreSQL: `archive_command = '/pitr/archive-wal.sh %p %f'`.
# Menyalin segmen WAL terkompresi ke WAL_ARCHIVE_DIR (bawaan /wal-archive) secara atomik. Bila berkas sudah ada
# (mis. arsip diulang setelah crash) dan isinya sama, dianggap sukses; bila berbeda, gagal agar tidak menimpa arsip.
set -eu
src="${1:?path WAL}"
name="${2:?nama WAL}"
dir="${WAL_ARCHIVE_DIR:-/wal-archive}"
dest="$dir/$name.gz"
if [ -f "$dest" ]; then
  if gzip -dc "$dest" | cmp -s - "$src"; then exit 0; fi
  echo "archive-wal: $dest sudah ada dengan isi berbeda" >&2
  exit 1
fi
gzip -c "$src" > "$dest.partial"
mv "$dest.partial" "$dest"
