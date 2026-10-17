-- Aplikasi terhubung sebagai pemilik schema lalu `set local role app_user` di setiap transaksi tenant
-- (lihat withTenant di packages/db/src/client.ts). Role app_user dibuat oleh migrasi.
select 1;
