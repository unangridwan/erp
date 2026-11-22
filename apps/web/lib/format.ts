import type { Locale } from "./i18n";

/** Format angka uang dengan pemisah ribuan sesuai bahasa; desimal hanya ditampilkan bila ada. */
export function money(value: string | number | null | undefined, locale: Locale, decimals = 2): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : Math.min(2, decimals),
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Tanggal YYYY-MM-DD menurut zona waktu browser. `toISOString()` memakai UTC: pukul 00:00–07:00 WIB jadi kemarin. */
export function localDay(at: Date | string = new Date()): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const today = () => localDay();

/**
 * Format tanggal. Terima tanggal (YYYY-MM-DD) atau timestamp ISO; timestamp ditampilkan menurut tanggal lokal
 * (bukan dipotong 10 karakter pertama yang masih UTC).
 */
export function formatDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "";
  const date = value.length > 10 ? new Date(value) : new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" }).format(date);
}

/**
 * Angka ketikan pengguna → string desimal untuk API ("1234.5"). Format Indonesia memakai titik ribuan & koma desimal:
 * "15.000" = 15000, "15.000,50" = 15000.5, "2,5" = 2.5. Format Inggris: "15,000.50" = 15000.5. Titik tunggal seperti
 * "1.5" atau "0.250" tetap desimal. Teks yang bukan angka dikembalikan apa adanya agar validasi server menolaknya.
 */
export function parseNumberInput(raw: string, locale: Locale = "id"): string {
  const v = raw.trim().replace(/\s|Rp/gi, "");
  if (!v) return v;
  if (locale === "en") return v.replace(/,/g, "");
  if (v.includes(",")) return v.replace(/\./g, "").replace(",", ".");
  if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(v)) return v.replace(/\./g, "");
  return v;
}
