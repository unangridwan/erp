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
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm install
DATABASE_URL=postgres://erp:erp@localhost:5432/erp pnpm --filter @erp/db migrate
pnpm dev            # api di :3001 (GET /health), web di :3000
```

## Pemeriksaan

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Test RLS di `packages/db` berjalan bila `DATABASE_URL` di-set (dilewati jika tidak).
