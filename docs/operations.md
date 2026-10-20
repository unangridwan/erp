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

| Variabel                                         | Wajib | Keterangan                                                                           |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                   | ya    | Koneksi pemilik schema (bukan superuser bila memungkinkan; harus anggota `app_user`) |
| `JWT_SECRET`, `ENCRYPTION_KEY`                   | ya    | Masing-masing ≥ 32 karakter acak, berbeda. API menolak nilai contoh `.env.example`   |
| `WEB_ORIGIN`                                     | ya    | URL web `https://…` (beberapa dipisah koma) — dipakai CORS & tautan email            |
| `MAIL_TRANSPORT`, `MAIL_FROM`                    | ya    | `smtp://user:pass@host:587`                                                          |
| `TRIAL_PLAN`, `TRIAL_DAYS`, `BILLING_GRACE_DAYS` |       | Bawaan `enterprise`, 14 hari, 7 hari                                                 |
| `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN`     |       | Aktifkan pembayaran Xendit; tanpa ini tagihan dibayar transfer manual                |
| `BILLING_BANK_INFO`                              |       | Instruksi transfer manual yang ditampilkan ke pelanggan                              |
| `METRICS_TOKEN`                                  |       | Aktifkan `GET /metrics`                                                              |
| `LOG_FORMAT`                                     |       | `json` (bawaan di image), `pretty`, `off`                                            |
| `BODY_LIMIT`                                     |       | Batas body JSON, bawaan `10mb` (impor CSV/Excel)                                     |
| `API_ORIGIN`                                     | SSO   | URL publik API `https://…` untuk redirect URI SSO (`/auth/sso/callback`)             |
| `REDIS_URL` / `RATE_LIMIT_REDIS_URL`             |       | Rate limit bersama antar-instance (produksi memakai `REDIS_URL` bila ada)            |
| `FX_FRANKFURTER_URL`, `FX_SCHEDULER`             |       | Sumber kurs otomatis (bawaan `https://api.frankfurter.app`); `off` mematikan jadwal  |

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

- Untuk RPO < 24 jam gunakan PostgreSQL terkelola dengan point-in-time recovery (WAL archiving), atau pgBackRest/WAL-G.

## 4. Monitoring

- `GET /health` (liveness) dan `GET /health/ready` (database & jumlah migrasi; 503 bila DB tidak terjangkau) untuk
  load balancer/orkestrator.
- `GET /metrics` (Prometheus, `Authorization: Bearer $METRICS_TOKEN`): `http_requests_total`,
  `http_request_duration_seconds` per route, memori & uptime proses. Peringatan yang disarankan: rasio 5xx > 1%,
  p95 latensi > 2 dtk, readiness gagal, backup terakhir > 26 jam.
- Log JSON satu baris per request (`reqId`, `method`, `route`, `status`, `ms`, `tenantId`, `userId`, `ip`; body tidak
  pernah dicatat). Header `X-Request-Id` dikembalikan ke klien untuk korelasi laporan error. Kirim stdout ke
  Loki/ELK/CloudWatch.

## 5. Keamanan

- RLS PostgreSQL (`FORCE`) memisahkan tenant; NIK/NPWP/rekening karyawan & secret 2FA terenkripsi AES-256-GCM dengan
  `ENCRYPTION_KEY` — **simpan kunci ini di secret manager dan backup terpisah**; tanpa kunci data tersebut tidak bisa
  dibuka. Rotasi kunci belum otomatis.
- Header keamanan API: `nosniff`, `X-Frame-Options: DENY`, CSP `default-src 'none'`, `Cache-Control: no-store`,
  HSTS (produksi). Web: `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Rate limit login/refresh/undangan/SSO disimpan di Redis bila `REDIS_URL` di-set (berlaku lintas instance); tanpa
  Redis berbasis memori per instance (pakai sticky session bila menjalankan lebih dari satu instance).
- Pengguna dapat melihat & mencabut sesi login di **Pengaturan → Keamanan**.
- Kepatuhan UU PDP: data pribadi karyawan tersamar tanpa `hr.manage`; ekspor XML/CSV yang memuat NIK/NPWP butuh
  `tax.manage`/`payroll.manage`; hosting di region Indonesia disarankan.

## 6. Langganan SaaS

- Paket awal (migrasi `0009`): Starter, Bisnis, Enterprise — ubah harga/batas/modul di **Admin Platform** atau
  `PUT /platform/plans`. Paket `public: false` bisa dipakai untuk penawaran khusus.
- Tagihan perpanjangan dibuat otomatis 7 hari sebelum periode berakhir (penjadwal dalam proses API, setiap jam;
  matikan dengan `BILLING_SCHEDULER=off` bila menjalankan lebih dari satu instance, lalu panggil
  `POST /platform/billing/run` dari cron).
- Status efektif dihitung saat diakses: uji coba/periode lewat → `past_due` selama masa toleransi → `expired`
  (baca saja). Admin platform dapat memperpanjang uji coba atau menangguhkan tenant.
