# Operasional & Go-Live

Panduan menjalankan ERP di produksi (satu server). Untuk skala lebih besar, komponen yang sama bisa dipindah ke
Kubernetes/ECS; lihat catatan di akhir.

## 1. Build & deploy

```bash
cp .env.example .env.prod            # isi nilai produksi (lihat tabel di bawah)
export POSTGRES_PASSWORD=... PUBLIC_API_URL=https://api.erpku.id
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build
```

- `migrate` berjalan sekali setiap deploy sebelum `api` menyala (migrasi bersifat maju; tidak ada rollback otomatis —
  backup dulu sebelum deploy yang memuat migrasi baru).
- `api` (port 3001) dan `web` (port 3000) hanya terbuka di `127.0.0.1`; pasang reverse proxy TLS (Caddy/nginx/load
  balancer) di depannya. Set `TRUST_PROXY=1` (sudah di compose) agar IP klien & rate limit benar.
- Data wilayah: `docker compose ... run --rm api node packages/db/dist/bin/seed-regions.js` sekali setelah deploy pertama.
- Admin platform: `docker compose ... run --rm api node packages/db/dist/bin/platform-admin.js <slug> <email>`.

## 2. Variabel lingkungan produksi

| Variabel                                                                                                                                                         | Wajib | Keterangan                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                                                                   | ya    | Koneksi pemilik schema (bukan superuser bila memungkinkan; harus anggota `app_user`)                                                                                                                                                                                |
| `JWT_SECRET`, `ENCRYPTION_KEY`                                                                                                                                   | ya    | Masing-masing ≥ 32 karakter acak, berbeda. API menolak nilai contoh `.env.example`                                                                                                                                                                                  |
| `WEB_ORIGIN`                                                                                                                                                     | ya    | URL web `https://…` (beberapa dipisah koma) — dipakai CORS & tautan email                                                                                                                                                                                           |
| `MAIL_TRANSPORT`, `MAIL_FROM`                                                                                                                                    | ya    | `smtp://user:pass@host:587`                                                                                                                                                                                                                                         |
| `TRIAL_PLAN`, `TRIAL_DAYS`, `BILLING_GRACE_DAYS`                                                                                                                 |       | Bawaan `enterprise`, 14 hari, 7 hari                                                                                                                                                                                                                                |
| `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN`                                                                                                                     |       | Aktifkan pembayaran Xendit; tanpa ini tagihan dibayar transfer manual                                                                                                                                                                                               |
| `BILLING_BANK_INFO`                                                                                                                                              |       | Instruksi transfer manual yang ditampilkan ke pelanggan                                                                                                                                                                                                             |
| `METRICS_TOKEN`                                                                                                                                                  |       | Aktifkan `GET /metrics`                                                                                                                                                                                                                                             |
| `LOG_FORMAT`                                                                                                                                                     |       | `json` (bawaan di image), `pretty`, `off`                                                                                                                                                                                                                           |
| `BODY_LIMIT`                                                                                                                                                     |       | Batas body JSON, bawaan `10mb` (impor CSV/Excel)                                                                                                                                                                                                                    |
| `API_ORIGIN`                                                                                                                                                     | SSO   | URL publik API `https://…`: redirect URI SSO (`/auth/sso/callback`) dan issuer OIDC Aplikasi Terhubung                                                                                                                                                              |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`                                                                                                                     |       | Umur access token (bawaan `15m`) dan refresh token (bawaan 30 hari)                                                                                                                                                                                                 |
| `BILLING_SCHEDULER`, `HR_REMINDER_SCHEDULER`, `WEBHOOK_SCHEDULER`, `REPORT_SCHEDULER`, `NOTIFY_EMAIL_SCHEDULER`, `AUTOMATION_SCHEDULER`, `MAINTENANCE_SCHEDULER` |       | `off` mematikan penjadwal dalam proses API: tagihan, pengingat SDM (juga akrual cuti, auto-checkout absensi, pengingat armada), pengiriman webhook, laporan terjadwal, email notifikasi (tiap menit), aturan otomatis (tiap 30 detik), rencana perawatan (tiap jam) |
| `REDIS_URL` / `RATE_LIMIT_REDIS_URL`                                                                                                                             |       | Rate limit bersama antar-instance (produksi memakai `REDIS_URL` bila ada)                                                                                                                                                                                           |
| `FX_FRANKFURTER_URL`, `FX_SCHEDULER`                                                                                                                             |       | Sumber kurs otomatis (bawaan `https://api.frankfurter.app`); `off` mematikan jadwal                                                                                                                                                                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`                                                                                                               |       | Tracing OpenTelemetry (OTLP/HTTP, mis. `http://otel-collector:4318`); nama bawaan `erp-api`                                                                                                                                                                         |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`                                                                                                                 |       | Sampling, mis. `parentbased_traceidratio` + `0.1` (bawaan semua trace)                                                                                                                                                                                              |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`                                                                                                             |       | Laporan error 5xx & job latar ke Sentry (atau GlitchTip yang kompatibel)                                                                                                                                                                                            |
| `WEB_SENTRY_DSN` (build web: `NEXT_PUBLIC_SENTRY_DSN`)                                                                                                           |       | Laporan error browser (error render & tak tertangani); ditanam saat build image web                                                                                                                                                                                 |
| `PITR_BASE_KEEP`, `PITR_BASE_INTERVAL_SECONDS`, `PITR_ARCHIVE_TIMEOUT`                                                                                           |       | Base backup PITR yang disimpan (2), jarak (7 hari), batas detik ganti WAL (300)                                                                                                                                                                                     |

Callback Xendit: arahkan _Invoice paid_ ke `https://api.erpku.id/billing/webhooks/xendit` dengan token verifikasi yang
sama dengan `XENDIT_CALLBACK_TOKEN`.

## 3. Backup & pemulihan

- Container `backup` menjalankan `infra/backup/backup.sh` setiap `BACKUP_INTERVAL_SECONDS` (bawaan 24 jam):
  `pg_dump` format custom terkompresi, diverifikasi dengan `pg_restore --list`, retensi `BACKUP_RETENTION_DAYS`
  (bawaan 14). Berkas di `BACKUP_PATH` (bawaan `./backups`).
- **Salin backup ke luar server** (object storage di region Indonesia, mis. bucket dengan versioning & lifecycle) —
  backup di disk yang sama tidak melindungi dari kerusakan server.
- Uji pemulihan minimal sebulan sekali ke database kosong:

  ```bash
  createdb erp_restore_test
  PGDATABASE=erp_restore_test infra/backup/restore.sh backups/erp-20261019T000000Z.dump
  ```

### Point-in-time recovery (PITR)

Selain dump harian, compose produksi mengarsipkan WAL terus-menerus sehingga database bisa dipulihkan ke detik
tertentu (mis. sesaat sebelum data terhapus). RPO ≈ `PITR_ARCHIVE_TIMEOUT` (bawaan 5 menit).

- `postgres` menjalankan `archive_mode=on` dengan `infra/pitr/archive-wal.sh`: setiap segmen WAL dikompresi ke
  `BACKUP_PATH/wal` secara atomik (arsip ulang dengan isi sama dianggap sukses, isi berbeda ditolak).
- Container `pitr` membuat base backup fisik (`pg_basebackup`, tar.gz + WAL) ke `BACKUP_PATH/base` setiap
  `PITR_BASE_INTERVAL_SECONDS`, menyimpan `PITR_BASE_KEEP` base terbaru, dan menghapus WAL yang lebih tua dari base
  tertua. Pantau ukuran `BACKUP_PATH/wal`: bila terus membesar, `archive_command` atau container `pitr` bermasalah
  (cek `select * from pg_stat_archiver`).
- Seperti dump, sinkronkan `BACKUP_PATH` (base + wal) ke object storage di luar server.

Pemulihan ke titik waktu (pada server/volume baru, jangan menimpa data yang sedang berjalan):

```bash
docker compose -f infra/docker-compose.prod.yml stop api web
docker run --rm -v "$PWD/backups:/backups" -v "$PWD/infra/pitr:/pitr:ro" -v erp_restored:/restored \
  postgres:16-alpine sh -c 'sh /pitr/restore-pitr.sh /backups/base/base-20261019T000000Z /restored/data \
    "2026-10-20 09:30:00+07" && chown -R postgres:postgres /restored/data'
# Jalankan postgres dengan PGDATA=/restored/data; server memutar ulang WAL sampai waktu target lalu promote.
# Periksa data, lalu arahkan DATABASE_URL ke server hasil pemulihan (atau dump → restore ke server utama).
```

Pilih base backup terbaru yang dibuat **sebelum** waktu target. Tanpa argumen waktu, pemulihan berjalan sampai WAL
terakhir yang terarsip. Server hasil pemulihan menonaktifkan `archive_mode` sampai operator mengaktifkannya lagi.

## 4. Monitoring

- `GET /health` (liveness) dan `GET /health/ready` (database & jumlah migrasi; 503 bila DB tidak terjangkau) untuk
  load balancer/orkestrator.
- `GET /metrics` (Prometheus, `Authorization: Bearer $METRICS_TOKEN`): `http_requests_total`,
  `http_request_duration_seconds` per route, memori & uptime proses. Peringatan yang disarankan: rasio 5xx > 1%,
  p95 latensi > 2 dtk, readiness gagal, backup terakhir > 26 jam.
- Log JSON satu baris per request (`reqId`, `method`, `route`, `status`, `ms`, `tenantId`, `userId`, `ip`; body tidak
  pernah dicatat). Header `X-Request-Id` dikembalikan ke klien untuk korelasi laporan error. Kirim stdout ke
  Loki/ELK/CloudWatch.
- **Tracing (OpenTelemetry)**: isi `OTEL_EXPORTER_OTLP_ENDPOINT` agar setiap request menghasilkan trace (HTTP →
  Express → controller Nest → query Postgres & Redis) yang dikirim ke collector OTLP/HTTP (Jaeger, Tempo, Honeycomb,
  Grafana Cloud, dsb.). Log request memuat `traceId` untuk lompat dari log ke trace. Teks SQL dicatat tanpa nilai
  parameter; `/health` dan `/metrics` tidak dilacak. Instrumentasi dimuat lewat `node --import ./dist/instrument.js`
  (sudah dipakai `pnpm start` dan image Docker); tanpa variabel OTEL tidak ada yang dimuat.
- **Sentry**: isi `SENTRY_DSN` untuk menerima error tak tertangani (respons 500) dan kegagalan job latar (kurs
  harian, perpanjangan langganan) dengan tag `tenant_id`, `request_id`, `route`, dan ID user — tanpa body request,
  header, atau data pribadi lainnya.
- **Sentry di web**: isi `WEB_SENTRY_DSN` (DSN proyek browser, boleh berbeda dari API) sebelum build image web. Error
  render (batas error halaman) dan error JavaScript tak tertangani dilaporkan dengan ID user & tenant; fragmen URL dan
  parameter token (refresh SSO, undangan, reset password, SAML) dihapus sebelum dikirim. Tanpa DSN, SDK tidak dimuat.

## 5. Keamanan

- RLS PostgreSQL (`FORCE`) memisahkan tenant; NIK/NPWP/rekening karyawan (juga pada permintaan perubahan data),
  secret 2FA, client secret SSO, dan secret webhook Aplikasi Terhubung terenkripsi AES-256-GCM dengan
  `ENCRYPTION_KEY` — **simpan kunci ini di secret manager dan backup terpisah**; tanpa kunci data tersebut tidak bisa
  dibuka. Rotasi kunci belum otomatis.
- Header keamanan API: `nosniff`, `X-Frame-Options: DENY`, CSP `default-src 'none'`, `Cache-Control: no-store`,
  HSTS (produksi). Web: `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`.
- URL yang diisi tenant (webhook aplikasi terhubung, webhook aturan otomatis, issuer SSO OpenID) hanya boleh menuju
  alamat publik: loopback, jaringan privat, link-local (metadata cloud), dan nama host internal ditolak saat disimpan
  **dan** saat koneksi dibuat (aman dari DNS rebinding); redirect tidak diikuti; produksi wajib `https`. Untuk
  pengembangan lokal set `ALLOW_PRIVATE_WEBHOOKS=true` — **jangan** di produksi.
- Riwayat perubahan data (`/activity/:model/:id`) hanya bisa dibaca oleh yang berhak membaca data itu. PIN kiosk
  absensi terkunci 15 menit setelah 5 percobaan salah; endpoint publik verifikasi kontrak & push mesin absensi dibatasi
  per IP.
- Web mengirim `Content-Security-Policy` (skrip & koneksi hanya ke asal sendiri + `NEXT_PUBLIC_API_URL`) dan HSTS di
  produksi. Bila API dipindah domain, build ulang web dengan `NEXT_PUBLIC_API_URL` yang baru.
- Dependensi: `pnpm audit --prod` dijalankan di CI. Sisa yang butuh upgrade mayor (dijadwalkan terpisah): zod 3 → 4
  (DoS memori pada koleksi sangat besar — dibatasi `BODY_LIMIT` 10 MB), NestJS 10 → 11, uuid bawaan exceljs.
- Rate limit login/refresh/undangan/SSO disimpan di Redis bila `REDIS_URL` di-set (berlaku lintas instance); tanpa
  Redis berbasis memori per instance (pakai sticky session bila menjalankan lebih dari satu instance).
- Pengguna dapat melihat & mencabut sesi login di **Pengaturan → Keamanan**.
- Kepatuhan UU PDP: data pribadi karyawan tersamar tanpa `hr.manage`; ekspor XML/CSV yang memuat NIK/NPWP butuh
  `tax.manage`/`payroll.manage`; hosting di region Indonesia disarankan.

## 6. Langganan SaaS

- Paket awal (migrasi `0009`): Starter, Bisnis, Enterprise — ubah harga/batas/modul di **Admin Platform** atau
  `PUT /platform/plans`. Paket `public: false` bisa dipakai untuk penawaran khusus.
- Tagihan perpanjangan dibuat otomatis 7 hari sebelum periode berakhir (penjadwal dalam proses API, setiap jam).
- **Lebih dari satu instance API**: biarkan penjadwal hanya di satu instance; di instance lain set `BILLING_SCHEDULER`,
  `FX_SCHEDULER`, `HR_REMINDER_SCHEDULER`, `WEBHOOK_SCHEDULER`, `REPORT_SCHEDULER`, `NOTIFY_EMAIL_SCHEDULER`, `AUTOMATION_SCHEDULER`, dan `MAINTENANCE_SCHEDULER` ke `off` (atau matikan semua dan
  panggil `POST /platform/billing/run` dari cron untuk tagihan).
- Admin platform dapat memberi tenant **langganan gratis** (paket apa pun, tanpa batas waktu atau sampai tanggal;
  migrasi `0037`, `PATCH /platform/tenants/:id/subscription`).
- Status efektif dihitung saat diakses: uji coba/periode lewat → `past_due` selama masa toleransi → `expired`
  (baca saja). Admin platform dapat memperpanjang uji coba atau menangguhkan tenant.
