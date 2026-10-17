import type { Locale } from "./i18n";

/** Format angka uang dengan pemisah ribuan sesuai bahasa; desimal hanya ditampilkan bila ada. */
export function money(value: string | number | null | undefined, locale: Locale, decimals = 2): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : Math.min(2, decimals),
    maximumFractionDigits: decimals,
  }).format(n);
}

export const today = () => new Date().toISOString().slice(0, 10);

export function formatDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" }).format(
    new Date(`${value}T12:00:00`),
  );
}
