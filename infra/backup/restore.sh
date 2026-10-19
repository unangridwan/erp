#!/bin/sh
# Pulihkan backup ke database KOSONG: `infra/backup/restore.sh backups/erp-20261019T000000Z.dump`
# Variabel koneksi sama dengan backup.sh (PGHOST PGUSER PGPASSWORD PGDATABASE).
set -eu
file="${1:?Pemakaian: restore.sh <berkas.dump>}"
tables="$(psql -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$tables" != "0" ]; then
  echo "Database $PGDATABASE tidak kosong ($tables tabel). Buat database baru lalu ulangi." >&2
  exit 1
fi
# Role app_user dipakai policy RLS; buat dulu bila belum ada di server tujuan.
psql -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'app_user') then create role app_user nologin; end if; end \$\$;"
psql -c "grant app_user to current_user"
pg_restore --no-owner --exit-on-error --dbname="$PGDATABASE" "$file"
echo "restore selesai dari $file"
