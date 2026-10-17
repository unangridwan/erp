# ERP

ERP SaaS multi-tenant (mirip Odoo) dengan lokalisasi Indonesia dan konsolidasi grup usaha.
Rencana lengkap: [docs/PLAN.md](docs/PLAN.md) · Keputusan arsitektur: [docs/adr](docs/adr).

## Struktur

| Path              | Isi                                                             |
| ----------------- | --------------------------------------------------------------- |
| `apps/api`        | Backend NestJS                                                  |
| `apps/web`        | Frontend Next.js                                                |
| `packages/db`     | Skema Drizzle, migrasi SQL, Row-Level Security                  |
| `packages/shared` | Tipe & util bersama (mis. perhitungan kepemilikan efektif grup) |
| `infra`           | docker-compose untuk Postgres, Redis, MinIO, Mailpit            |

## Menjalankan lokal

Prasyarat: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env            # isi JWT_SECRET & ENCRYPTION_KEY (masing-masing ≥ 32 karakter)
docker compose -f infra/docker-compose.yml up -d
pnpm install
set -a && . ./.env && set +a
pnpm build --filter=@erp/db --filter=@erp/shared
pnpm --filter @erp/db migrate
pnpm --filter @erp/db seed:regions   # wilayah Indonesia (provinsi s.d. desa), opsional
pnpm dev                        # api di :3001, web di :3000
```

Buka http://localhost:3000/signup untuk mendaftarkan perusahaan (tenant) pertama. Signup otomatis membuat
perusahaan holding (`HQ`), role `admin` & `user`, satuan (UoM) bawaan, dan user admin.

## API (Fase 0)

Semua endpoint selain `/health` dan endpoint auth publik butuh header `Authorization: Bearer <token>`.
Access token berlaku singkat (default 15 menit); perbarui dengan `POST /auth/refresh` (refresh token berotasi,
pemakaian ulang token lama mencabut seluruh sesi).
Header opsional `X-Company-Id` memilih perusahaan aktif (harus termasuk perusahaan yang boleh diakses user).

| Endpoint                                                                                 | Keterangan                                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`      | Sesi (JWT + refresh token), profil, permission, perusahaan |
| `POST /auth/2fa/setup`, `/auth/2fa/enable`, `/auth/2fa/disable`                          | 2FA TOTP (Google Authenticator, Authy, dll.)               |
| `POST /users/invite`, `GET /invitations`, `POST /auth/invitation`, `/auth/accept-invite` | Undangan user via email                                    |
| `/companies`, `/ownerships`, `/business-units`, `/branches`                              | Struktur grup                                              |
| `/partners`, `/products`, `/product-categories`, `/uoms`, `/uom-categories`              | Master data                                                |
| `GET /currencies`, `/currency-rates`, `GET /fx/convert?from=USD&to=IDR&amount=&date=`    | Mata uang, kurs harian, konversi                           |
| `GET /regions?level=1&parent=&q=`                                                        | Wilayah Indonesia (Kepmendagri 2025)                       |
| `GET/POST /users`, `GET /roles`                                                          | Manajemen user                                             |
| `GET /activity/:model/:id`                                                               | Riwayat perubahan (chatter)                                |
| `GET /sequences`                                                                         | Penomoran dokumen perusahaan aktif                         |

### Akuntansi (Fase 1)

| Endpoint                                                                                   | Keterangan                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `/accounts`, `/journals`, `/taxes`                                                         | Bagan akun, jurnal, pajak (per perusahaan aktif; dipasang otomatis)              |
| `POST /accounting/setup`, `GET/PATCH /accounting/settings`                                 | Pasang COA standar, lock date                                                    |
| `GET/POST /moves`, `GET/PATCH/DELETE /moves/:id`                                           | Draft jurnal umum atau faktur/tagihan (`moveType`)                               |
| `POST /moves/:id/post`, `POST /moves/:id/reverse`                                          | Posting (nomor `INV/2026/0001`), jurnal balik / nota kredit                      |
| `GET/POST /payments`, `POST /reconcile`                                                    | Pembayaran (melunasi faktur), rekonsiliasi manual                                |
| `GET /reports/trial-balance`, `/general-ledger`, `/balance-sheet`, `/profit-loss`, `/aged` | Laporan; filter `dateFrom`, `dateTo`, `companyIds`, `branchId`, `businessUnitId` |

Resource master mendukung `GET /x?q=&limit=&offset=&active=all|false`, `GET/PATCH/DELETE /x/:id`, `POST /x`,
`GET /x/export` (CSV) dan `POST /x/import` (`{ "csv": "..." }`; baris ber-`id` diperbarui, tanpa `id` dibuat; satu baris
gagal membatalkan seluruh impor).

Login dibatasi 10 percobaan gagal per akun dan 50 per IP per 15 menit (penyimpanan memori; pindah ke Redis saat
berjalan lebih dari satu instance).

## Pemeriksaan

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Test RLS di `packages/db` berjalan bila `DATABASE_URL` di-set (dilewati jika tidak).
