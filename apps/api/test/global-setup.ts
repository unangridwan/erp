/**
 * Migrasi dijalankan sekali sebelum semua file test. Di database kosong (CI) seluruh migrasi butuh lebih lama
 * daripada batas waktu `beforeAll`, jadi tidak boleh bergantung pada hook per file.
 */
export default async function setup() {
  const { loadEnv } = await import("@erp/db");
  loadEnv();
  if (!process.env.DATABASE_URL) return;
  const { migrate } = await import("@erp/db/migrate");
  await migrate(process.env.DATABASE_URL);
}
