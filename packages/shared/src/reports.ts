import { z } from "zod";

export const REPORT_AGGREGATES = ["sum", "count", "avg", "min", "max"] as const;
export type ReportAggregate = (typeof REPORT_AGGREGATES)[number];
export const REPORT_AGGREGATE_LABEL: Record<ReportAggregate, [string, string]> = {
  sum: ["Jumlah", "Sum"],
  count: ["Banyaknya", "Count"],
  avg: ["Rata-rata", "Average"],
  min: ["Minimum", "Minimum"],
  max: ["Maksimum", "Maximum"],
};
export const REPORT_OPERATORS = [
  "eq",
  "ne",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "notEmpty",
] as const;
export type ReportOperator = (typeof REPORT_OPERATORS)[number];
export const REPORT_OPERATOR_LABEL: Record<ReportOperator, [string, string]> = {
  eq: ["sama dengan", "equals"],
  ne: ["tidak sama dengan", "not equal"],
  contains: ["mengandung", "contains"],
  gt: [">", ">"],
  gte: ["≥", "≥"],
  lt: ["<", "<"],
  lte: ["≤", "≤"],
  empty: ["kosong", "is empty"],
  notEmpty: ["tidak kosong", "is not empty"],
};
export const REPORT_CHARTS = ["bar", "line", "pie"] as const;
export const REPORT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];
export const REPORT_FREQUENCY_LABEL: Record<ReportFrequency, [string, string]> = {
  daily: ["Harian", "Daily"],
  weekly: ["Mingguan", "Weekly"],
  monthly: ["Bulanan", "Monthly"],
};

const columnKey = z.string().trim().min(1).max(100);

export const reportConfigSchema = z.object({
  columns: z.array(columnKey).max(100).default([]),
  /** Filter bawaan dataset (mis. departmentId, from, to, runId = id payroll atau "latest"). */
  filters: z.record(z.string(), z.string().max(200)).default({}),
  conditions: z
    .array(
      z.object({
        column: columnKey,
        op: z.enum(REPORT_OPERATORS),
        value: z.string().max(200).default(""),
      }),
    )
    .max(20)
    .default([]),
  groupBy: z.array(columnKey).max(3).default([]),
  aggregates: z
    .array(z.object({ column: columnKey, fn: z.enum(REPORT_AGGREGATES) }))
    .max(10)
    .default([]),
  sort: z.object({ column: columnKey, dir: z.enum(["asc", "desc"]).default("asc") }).nullish(),
  limit: z.number().int().min(1).max(10_000).nullish(),
  chart: z.object({ type: z.enum(REPORT_CHARTS), x: columnKey, y: columnKey }).nullish(),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

export const savedReportSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  description: z.string().trim().max(500).nullish(),
  dataset: z.string().trim().min(1).max(60),
  config: reportConfigSchema,
  visibility: z.enum(["private", "shared"]).default("private"),
});
export type SavedReportInput = z.infer<typeof savedReportSchema>;

export const reportScheduleSchema = z
  .object({
    frequency: z.enum(REPORT_FREQUENCIES),
    hour: z.number().int().min(0).max(23).default(7),
    weekday: z.number().int().min(1).max(7).nullish(),
    monthday: z.number().int().min(1).max(28).nullish(),
    format: z.enum(["xlsx", "csv", "pdf"]).default("xlsx"),
    recipients: z
      .array(z.string().trim().toLowerCase().email("Email penerima tidak valid"))
      .min(1, "Isi minimal satu penerima")
      .max(20),
    active: z.boolean().default(true),
  })
  .superRefine((s, ctx) => {
    if (s.frequency === "weekly" && !s.weekday)
      ctx.addIssue({ code: "custom", path: ["weekday"], message: "Pilih hari pengiriman" });
    if (s.frequency === "monthly" && !s.monthday)
      ctx.addIssue({ code: "custom", path: ["monthday"], message: "Pilih tanggal pengiriman" });
  });
export type ReportScheduleInput = z.infer<typeof reportScheduleSchema>;

export interface ReportColumn {
  key: string;
  header: string;
  numeric?: boolean;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /** Jumlah baris sebelum batas. */
  total: number;
  /** Jumlah per kolom angka (baris hasil). */
  totals: Record<string, number>;
}

const isEmpty = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const toNumber = (v: unknown) => {
  if (typeof v === "number") return v;
  if (isEmpty(v)) return NaN;
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

function matches(value: unknown, op: ReportOperator, target: string, numeric: boolean) {
  if (op === "empty") return isEmpty(value);
  if (op === "notEmpty") return !isEmpty(value);
  if (numeric && op !== "contains") {
    const a = toNumber(value);
    const b = toNumber(target);
    if (Number.isNaN(a) || Number.isNaN(b)) return op === "ne";
    return { eq: a === b, ne: a !== b, gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[op];
  }
  const a = String(value ?? "").toLowerCase();
  const b = target.toLowerCase();
  switch (op) {
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "contains":
      return a.includes(b);
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    default:
      return a <= b;
  }
}

const aggKey = (a: { column: string; fn: ReportAggregate }) => `${a.fn}__${a.column}`;

function aggregate(values: unknown[], fn: ReportAggregate): number {
  if (fn === "count") return values.length;
  const nums = values.map(toNumber).filter((n) => !Number.isNaN(n));
  if (!nums.length) return 0;
  switch (fn) {
    case "sum":
      return round(nums.reduce((s, n) => s + n, 0));
    case "avg":
      return round(nums.reduce((s, n) => s + n, 0) / nums.length);
    case "min":
      return Math.min(...nums);
    default:
      return Math.max(...nums);
  }
}
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Jalankan konfigurasi laporan atas baris dataset: syarat per kolom, kelompok + agregasi (atau kolom terpilih),
 * urutan, batas. Kolom tak dikenal dilaporkan lewat error agar konfigurasi rusak tidak diam-diam kosong.
 */
export function runReport(
  data: Record<string, unknown>[],
  available: ReportColumn[],
  config: ReportConfig,
): ReportResult {
  const byKey = new Map(available.map((c) => [c.key, c]));
  const need = (key: string) => {
    const c = byKey.get(key);
    if (!c) throw new Error(`Kolom laporan tidak dikenal: ${key}`);
    return c;
  };
  // Syarat yang nilainya belum diisi (sedang disusun) diabaikan.
  const conds = config.conditions
    .filter((c) => c.op === "empty" || c.op === "notEmpty" || c.value.trim() !== "")
    .map((c) => ({ ...c, col: need(c.column) }));
  let rows = data.filter((r) => conds.every((c) => matches(r[c.column], c.op, c.value, !!c.col.numeric)));

  let columns: ReportColumn[];
  if (config.groupBy.length || config.aggregates.length) {
    const groups = config.groupBy.map(need);
    const aggs = config.aggregates.map((a) => ({
      ...a,
      key: aggKey(a),
      col: a.column === "*" ? { key: "*", header: "data" } : need(a.column),
    }));
    const buckets = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const k = JSON.stringify(groups.map((g) => r[g.key] ?? ""));
      const list = buckets.get(k) ?? [];
      list.push(r);
      buckets.set(k, list);
    }
    rows = [...buckets.entries()].map(([k, list]) => {
      const keys = JSON.parse(k) as unknown[];
      return {
        ...Object.fromEntries(groups.map((g, i) => [g.key, keys[i]])),
        ...Object.fromEntries(
          aggs.map((a) => [
            a.key,
            aggregate(
              list.map((r) => (a.column === "*" ? 1 : r[a.column])),
              a.fn,
            ),
          ]),
        ),
      };
    });
    columns = [
      ...groups.map((g) => ({ key: g.key, header: g.header })),
      ...aggs.map((a) => ({
        key: a.key,
        header: `${REPORT_AGGREGATE_LABEL[a.fn][0]} ${a.col.header}`,
        numeric: true,
      })),
    ];
  } else {
    columns = (config.columns.length ? config.columns.map(need) : available).map((c) => ({
      key: c.key,
      header: c.header,
      ...(c.numeric ? { numeric: true } : {}),
    }));
    rows = rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? ""])));
  }

  if (config.sort) {
    const col = columns.find((c) => c.key === config.sort!.column);
    if (!col) throw new Error(`Kolom laporan tidak dikenal: ${config.sort.column}`);
    const dir = config.sort.dir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a[col.key];
      const y = b[col.key];
      if (col.numeric) return (toNumber(x) - toNumber(y)) * dir;
      return String(x ?? "").localeCompare(String(y ?? ""), "id") * dir;
    });
  }
  const total = rows.length;
  if (config.limit) rows = rows.slice(0, config.limit);
  const totals = Object.fromEntries(
    columns
      .filter((c) => c.numeric)
      .map((c) => [c.key, round(rows.reduce((s, r) => s + (toNumber(r[c.key]) || 0), 0))]),
  );
  return { columns, rows, total, totals };
}

// ---- Jadwal ----

export interface ReportScheduleTiming {
  frequency: ReportFrequency;
  hour: number;
  weekday?: number | null;
  monthday?: number | null;
}

/** Bagian tanggal & jam lokal suatu instan di zona waktu. */
function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { y: +parts.year!, m: +parts.month!, d: +parts.day!, h: +parts.hour!, min: +parts.minute! };
}

/** Instan UTC untuk tanggal & jam lokal di zona waktu. */
function zonedInstant(y: number, m: number, d: number, h: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d, h);
  const p = localParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  return new Date(guess - offset);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Jadwal terakhir yang sudah lewat (≤ `now`) beserta kunci periodenya: harian `YYYY-MM-DD`, mingguan tanggal hari
 * kirim, bulanan `YYYY-MM`. Dipakai agar laporan terkirim tepat sekali per periode.
 */
export function latestOccurrence(s: ReportScheduleTiming, now: Date, timeZone: string) {
  const local = localParts(now, timeZone);
  // Mulai dari hari ini (tengah hari UTC agar aman dari pergeseran zona), mundur sampai cocok.
  for (let back = 0; back <= 62; back++) {
    const day = new Date(Date.UTC(local.y, local.m - 1, local.d - back, 12));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
    if (s.frequency === "weekly" && isoWeekday !== s.weekday) continue;
    if (s.frequency === "monthly" && d !== s.monthday) continue;
    const at = zonedInstant(y, m, d, s.hour, timeZone);
    if (at > now) continue;
    const period = s.frequency === "monthly" ? `${y}-${pad(m)}` : `${y}-${pad(m)}-${pad(d)}`;
    return { at, period };
  }
  return null;
}

/** Jadwal berikutnya setelah `now`. */
export function nextOccurrence(s: ReportScheduleTiming, now: Date, timeZone: string): Date {
  const local = localParts(now, timeZone);
  for (let ahead = 0; ahead <= 62; ahead++) {
    const day = new Date(Date.UTC(local.y, local.m - 1, local.d + ahead, 12));
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
    if (s.frequency === "weekly" && isoWeekday !== s.weekday) continue;
    if (s.frequency === "monthly" && day.getUTCDate() !== s.monthday) continue;
    const at = zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.hour, timeZone);
    if (at > now) return at;
  }
  throw new Error("Jadwal tidak valid");
}
