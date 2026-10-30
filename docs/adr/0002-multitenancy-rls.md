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
- Aplikasi terhubung sebagai pemilik schema, lalu di setiap transaksi tenant menjalankan `set local role app_user`
  (tanpa `BYPASSRLS`) dan men-set `app.tenant_id` (`set_config(..., true)`), lihat `withTenant` di
  `packages/db/src/client.ts`. Koneksi pemilik tanpa role ini hanya dipakai untuk signup & lookup tenant saat login.
- Di dalam tenant, entitas legal = `companies` (hierarki `parent_id` + `ownership_history`); unit bisnis &
  cabang adalah dimensi. Pembatasan akses per perusahaan ditangani di lapisan aplikasi (`user_companies`).

## Konsekuensi

- Isolasi ditegakkan database, diuji di `packages/db/test/rls.test.ts` dan `apps/api/test/foundation.test.ts`.
- Pemeriksaan foreign key Postgres **tidak** tunduk pada RLS, sehingga tenant bisa saja merujuk id milik tenant
  lain. Karena itu semua FK antar tabel ber-tenant berbentuk komposit `(tenant_id, kolom) → (tenant_id, id)`
  (migrasi `0003`), sehingga database sendiri menolak rujukan lintas tenant. Aplikasi tetap mengecek rujukan
  (`refs` di `apps/api/src/common/crud.ts`) untuk pesan error per field yang lebih jelas.
- Tabel baru wajib mengikuti pola yang sama: kolom `tenant_id`, policy `tenant_isolation`, dan FK komposit.
  Pengecualian yang disengaja: tabel fondasi `sequences` (migrasi `0002`) dan turunannya `sequence_years` (`0046`)
  memakai FK satu kolom ke `id`; baris hanya dibuat oleh `SequenceService` dari perusahaan aktif, tidak dari input user.
- Migrasi dan job lintas tenant (billing, maintenance) memakai role pemilik secara eksplisit.
- Tenant sangat besar dapat dipindah ke database terpisah di kemudian hari tanpa ubah skema.
