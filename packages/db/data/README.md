# Data referensi

## `regions.csv.gz` — kode wilayah administrasi Indonesia

Kolom `code,name`. Tingkat ditentukan dari jumlah segmen kode:
`11` provinsi · `11.01` kabupaten/kota · `11.01.01` kecamatan · `11.01.01.2001` desa/kelurahan
(38 · 514 · 7.285 · 83.762 baris).

Sumber: [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) (`db/wilayah.sql`, edit 2026-02-13), sesuai
Kepmendagri No 300.2.2-2138 Tahun 2025. Lisensi MIT, copyright (c) 2017-2025 Cahya DSN.

Dimuat dengan `pnpm --filter @erp/db seed:regions` (idempoten).
