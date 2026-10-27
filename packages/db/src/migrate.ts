import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATION_LOCK = 727_073_690;

/** Runner migrasi SQL sederhana: menjalankan file migrations/*.sql berurutan, sekali saja. */
export async function migrate(url: string, dir = join(import.meta.dirname, "..", "migrations")) {
  const sql = postgres(url, { onnotice: () => {} });
  try {
    // Satu transaksi + advisory lock: proses lain (mis. test paralel) menunggu, lalu melihat migrasi sudah diterapkan.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
      await tx`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
      const applied = new Set(
        (await tx<{ name: string }[]>`select name from _migrations`).map((r) => r.name),
      );
      const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        if (applied.has(file)) continue;
        try {
          await tx.unsafe(await readFile(join(dir, file), "utf8"));
        } catch (e) {
          // Semua migrasi tertunda berjalan dalam satu transaksi: sebut file yang gagal agar mudah ditelusuri.
          const err = e as Error;
          throw new Error(`Migrasi ${file} gagal (tidak ada migrasi yang diterapkan): ${err.message}`, {
            cause: e,
          });
        }
        await tx`insert into _migrations (name) values (${file})`;
        console.log(`applied ${file}`);
      }
    });
  } finally {
    await sql.end();
  }
}

/**
 * Nama file migrasi yang belum diterapkan di database (tabel `_migrations` belum ada = semua tertunda).
 * Dipakai API saat start untuk memperingatkan bila `pnpm db:setup` belum dijalankan setelah update.
 */
export async function pendingMigrations(url: string, dir = join(import.meta.dirname, "..", "migrations")) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const sql = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    const [row] = await sql<{ exists: boolean }[]>`select to_regclass('_migrations') is not null as exists`;
    if (!row?.exists) return files;
    const applied = new Set((await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name));
    return files.filter((f) => !applied.has(f));
  } finally {
    await sql.end();
  }
}
