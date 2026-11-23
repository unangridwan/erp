/**
 * Tanggal bisnis "hari ini" untuk semua default dokumen/jurnal/laporan di server — satu sumber agar dokumen yang
 * dibuat bersamaan tidak terpecah ke dua tanggal.
 *
 * Saat ini UTC: banyak laporan menyaring cap waktu (created_at, dll.) per tanggal UTC, jadi zona lain baru aman
 * setelah kueri itu ikut dikonversi. Mencampur tanggal lokal (WIB) untuk sebagian dokumen dan UTC untuk sisanya
 * membuat transaksi jam 00:00–07:00 WIB terpecah (mis. WIP manufaktur tidak nol, laporan "hari ini" bolong).
 */
export const BUSINESS_TZ = "UTC";

/** Tanggal YYYY-MM-DD sebuah instan menurut zona waktu tertentu. */
export const dateInZone = (at: Date, timeZone: string = BUSINESS_TZ): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    at,
  );

/** Tanggal bisnis hari ini (atau instan `at`) — dipakai semua default tanggal server. */
export const businessToday = (at: Date = new Date()): string => dateInZone(at);
