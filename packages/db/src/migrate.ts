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
        await tx.unsafe(await readFile(join(dir, file), "utf8"));
        await tx`insert into _migrations (name) values (${file})`;
        console.log(`applied ${file}`);
      }
    });
  } finally {
    await sql.end();
  }
}
