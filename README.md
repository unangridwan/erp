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
cp .env.example .env            # isi JWT_SECRET (minimal 32 karakter)
docker compose -f infra/docker-compose.yml up -d
pnpm install
set -a && . ./.env && set +a
pnpm build --filter=@erp/db --filter=@erp/shared
pnpm --filter @erp/db migrate
pnpm dev                        # api di :3001, web di :3000
```

Buka http://localhost:3000/signup untuk mendaftarkan perusahaan (tenant) pertama. Signup otomatis membuat
perusahaan holding (`HQ`), role `admin` & `user`, satuan (UoM) bawaan, dan user admin.

## API (Fase 0)

Semua endpoint selain `/health`, `/auth/signup`, `/auth/login` butuh header `Authorization: Bearer <token>`.
Header opsional `X-Company-Id` memilih perusahaan aktif (harus termasuk perusahaan yang boleh diakses user).

| Endpoint                                                                    | Keterangan                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`                     | Autentikasi (JWT), profil, permission, daftar perusahaan |
| `/companies`, `/ownerships`, `/business-units`, `/branches`                 | Struktur grup                                            |
| `/partners`, `/products`, `/product-categories`, `/uoms`, `/uom-categories` | Master data                                              |
| `GET /currencies`                                                           | Mata uang (master global)                                |
| `GET/POST /users`, `GET /roles`                                             | Manajemen user                                           |
| `GET /activity/:model/:id`                                                  | Riwayat perubahan (chatter)                              |
| `GET /sequences`                                                            | Penomoran dokumen perusahaan aktif                       |

Resource master mendukung `GET /x?q=&limit=&offset=&active=all|false`, `GET/PATCH/DELETE /x/:id`, `POST /x`.

## Pemeriksaan

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Test RLS di `packages/db` berjalan bila `DATABASE_URL` di-set (dilewati jika tidak).
