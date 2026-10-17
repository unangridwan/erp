# ADR 0002 — Multi-tenancy dengan PostgreSQL Row-Level Security

- Status: Diterima
- Tanggal: 2026-10-17

## Konteks

Aplikasi dijual sebagai SaaS. Data antar pelanggan (tenant) tidak boleh bocor, termasuk karena bug query.
Satu tenant dapat berisi grup usaha: holding, anak perusahaan, unit bisnis, cabang.

## Keputusan

- Shared database, shared schema. Setiap tabel bisnis punya `tenant_id` dengan default
  `current_setting('app.tenant_id')`.
- RLS `ENABLE` + `FORCE` dengan policy `tenant_isolation` di setiap tabel bisnis.
- Aplikasi berjalan sebagai role tanpa `BYPASSRLS` (`app_user`) dan men-set `app.tenant_id` per transaksi
  (`set_config(..., true)`, lihat `withTenant` di `packages/db/src/client.ts`).
- Di dalam tenant, entitas legal = `companies` (hierarki `parent_id` + `ownership_history`); unit bisnis &
  cabang adalah dimensi. Pembatasan akses per perusahaan ditangani di lapisan aplikasi (`user_companies`).

## Konsekuensi

- Isolasi ditegakkan database, diuji di `packages/db/test/rls.test.ts`.
- Migrasi dan job lintas tenant (billing, maintenance) memakai role pemilik secara eksplisit.
- Tenant sangat besar dapat dipindah ke database terpisah di kemudian hari tanpa ubah skema.
