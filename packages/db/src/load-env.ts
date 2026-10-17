import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Muat `.env` terdekat (folder kerja atau induknya, maks. 4 tingkat) ke `process.env`.
 * Variabel yang sudah di-set di environment tidak ditimpa. Tidak melakukan apa-apa bila file tidak ada —
 * sehingga CI/produksi tetap memakai environment biasa, sementara di Windows tidak perlu `set -a`.
 */
export function loadEnv(start = process.cwd()): string | undefined {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    const file = join(dir, ".env");
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
