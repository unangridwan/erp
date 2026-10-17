import { loadEnv } from "../load-env.js";

/** Kode error koneksi yang berarti tidak ada server Postgres di alamat tujuan. */
const UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH"]);

/**
 * Jalankan skrip CLI database dengan DATABASE_URL dari .env; error koneksi dijelaskan dengan
 * langkah perbaikan alih-alih stack trace mentah.
 */
export async function runWithDatabase(fn: (url: string) => Promise<void>) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL belum di-set. Salin .env.example menjadi .env lalu ulangi.");
    process.exit(1);
  }
  try {
    await fn(url);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!code || !UNREACHABLE.has(code)) throw error;
    const target = (() => {
      try {
        const u = new URL(url);
        return `${u.hostname}:${u.port || "5432"}`;
      } catch {
        return url;
      }
    })();
    console.error(
      [
        `Tidak bisa terhubung ke PostgreSQL di ${target} (${code}).`,
        "Pastikan database berjalan:",
        "  1. Docker Desktop sudah terbuka (ikon di system tray).",
        "  2. docker compose -f infra/docker-compose.yml up -d",
        "  3. docker compose -f infra/docker-compose.yml ps   → postgres berstatus 'healthy' dengan port 0.0.0.0:5433->5432",
        "Port di DATABASE_URL (.env) harus sama dengan port Postgres Docker (bawaan 5433).",
      ].join("\n"),
    );
    process.exit(1);
  }
}
