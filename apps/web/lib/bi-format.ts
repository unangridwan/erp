import type { DateLevel, ValueFormat } from "@erp/shared";

/** Informasi dataset untuk editor BI (`GET /reports/datasets`). */
export interface BiDatasetInfo {
  key: string;
  label: string;
  description: string;
  app: string;
  needsRun: boolean;
  filters: { key: string; label: string; type: "date" | "select" | "ref"; options?: [string, string][] }[];
  columns: { key: string; header: string; group: string; numeric: boolean }[];
}

/** Kolom tanggal/periode (nilai YYYY-MM-DD atau YYYY-MM) — bisa dipecah menjadi hierarki tahun → hari. */
const DATE_KEY = /date|month|period|created|closed|scheduled|finished|breakdown|due|join|birth|resign/i;
const DATE_HEADER = /tanggal|tgl|bulan|periode|jatuh tempo|berlaku|mulai|berakhir/i;
export const isDateColumn = (c: { key: string; header: string; numeric?: boolean }) =>
  !c.numeric && (DATE_KEY.test(c.key) || DATE_HEADER.test(c.header));
/** Kolom berisi bulan saja (YYYY-MM): level hari/minggu tidak berlaku. */
export const isMonthColumn = (c: { key: string; header: string }) =>
  /month|period/i.test(c.key) || /^bulan|periode/i.test(c.header);

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Label kunci waktu yang ramah dibaca: 2026-03 → "Mar 2026", 2026-Q1 → "Q1 2026", 2026-W09 → "Mg 9 2026". */
export function prettyKey(key: string, locale: string): string {
  const months = locale === "id" ? MONTHS_ID : MONTHS_EN;
  let m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m) return `${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (m) return `Q${m[2]} ${m[1]}`;
  m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (m) return `${locale === "id" ? "Mg" : "Wk"} ${Number(m[2])} ${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (m) return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  return key;
}

/** Label kategori: kunci "(Kosong)"/"Lainnya" dari mesin diterjemahkan; kunci waktu dipercantik. */
export function categoryLabel(label: string, locale: string): string {
  if (label === "(Kosong)") return locale === "id" ? "(Kosong)" : "(Blank)";
  if (label === "Lainnya") return locale === "id" ? "Lainnya" : "Other";
  return label
    .split(" · ")
    .map((p) => prettyKey(p, locale))
    .join(" · ");
}

/** Format angka sesuai format ukuran (persen = nilai sudah dalam %). */
export function formatValue(
  v: number | null | undefined,
  format: ValueFormat | undefined,
  locale: string,
  compact = false,
): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const loc = locale === "id" ? "id-ID" : "en-US";
  if (format === "percent") return `${v.toLocaleString(loc, { maximumFractionDigits: 1 })}%`;
  const big = Math.abs(v) >= 1e6;
  const opts: Intl.NumberFormatOptions = {
    maximumFractionDigits: 2,
    ...((compact && big) || format === "compact" ? { notation: "compact" as const } : {}),
  };
  const text = v.toLocaleString(loc, opts);
  return format === "currency" ? `Rp${text}` : text;
}

export const DATE_LEVEL_ORDER: DateLevel[] = ["year", "quarter", "month", "week", "day"];
