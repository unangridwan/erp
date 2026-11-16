import { loadEnv } from "../src/load-env.js";
import { migrate } from "../src/migrate.js";

/**
 * Migrasi dijalankan sekali sebelum semua file test. Di database kosong (CI) seluruh migrasi butuh lebih lama
 * daripada batas waktu `beforeAll`, jadi tidak boleh bergantung pada hook per file.
 */
export default async function setup() {
  loadEnv();
  if (process.env.DATABASE_URL) await migrate(process.env.DATABASE_URL);
}
