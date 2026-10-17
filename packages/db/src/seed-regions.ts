import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import postgres from "postgres";

// Sama untuk src/ dan dist/: keduanya satu tingkat di bawah folder paket.
const FILE = join(import.meta.dirname, "..", "data", "regions.csv.gz");
const BATCH = 5000;

/** Satu baris CSV `code,name` (nama boleh dikutip dan berisi koma). */
function parseLine(line: string): [string, string] {
  const comma = line.indexOf(",");
  const code = line.slice(0, comma);
  let name = line.slice(comma + 1);
  if (name.startsWith('"')) name = name.slice(1, -1).replace(/""/g, '"');
  return [code, name];
}

/** Muat wilayah Indonesia (provinsi s.d. desa) ke tabel `regions`. Aman dijalankan ulang. */
export async function seedRegions(url: string): Promise<number> {
  const sql = postgres(url, { onnotice: () => {} });
  try {
    const lines = createInterface({ input: createReadStream(FILE).pipe(createGunzip()) });
    let batch: { code: string; name: string; level: number; parent_code: string | null }[] = [];
    let total = 0;
    const flush = async () => {
      if (!batch.length) return;
      await sql`insert into regions ${sql(batch)} on conflict (code) do update set name = excluded.name`;
      total += batch.length;
      batch = [];
    };
    let header = true;
    // File terurut berdasarkan kode, sehingga induk selalu dimasukkan sebelum anaknya.
    for await (const line of lines) {
      if (header || !line) {
        header = false;
        continue;
      }
      const [code, name] = parseLine(line);
      const parts = code.split(".");
      batch.push({
        code,
        name,
        level: parts.length,
        parent_code: parts.length > 1 ? parts.slice(0, -1).join(".") : null,
      });
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    return total;
  } finally {
    await sql.end();
  }
}
