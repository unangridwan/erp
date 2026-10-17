import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

/** Runner migrasi SQL sederhana: menjalankan file migrations/*.sql berurutan, sekali saja. */
export async function migrate(url: string, dir = join(import.meta.dirname, "..", "migrations")) {
  const sql = postgres(url, { onnotice: () => {} });
  try {
    await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into _migrations (name) values (${file})`;
      });
      console.log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.filename === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum di-set");
  await migrate(url);
}
