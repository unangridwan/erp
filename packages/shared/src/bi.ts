import { z } from "zod";
import { evaluateFormula, FormulaError, formulaRefs, parseFormula, type FormulaNode } from "./bi-formula.js";
import {
  BUILTIN_DASHBOARDS,
  dashboardSchema,
  PERIOD_PRESETS,
  type DashboardWidget,
  type PeriodPreset,
} from "./dashboard.js";
import {
  matchesCondition,
  REPORT_AGGREGATE_LABEL,
  REPORT_OPERATORS,
  reportNumber,
  type ReportColumn,
} from "./reports.js";

/**
 * Model & mesin BI (dashboard v2): halaman berisi visual pada kanvas, tiap visual = dataset + sumbu (hierarki) +
 * legenda + ukuran (agregat atau rumus) + filter. Mesin berjalan di memori atas baris dataset, sama seperti laporan.
 */

// ---- Konstanta ----

export const DATE_LEVELS = ["year", "quarter", "month", "week", "day"] as const;
export type DateLevel = (typeof DATE_LEVELS)[number];
export const DATE_LEVEL_LABEL: Record<DateLevel, [string, string]> = {
  year: ["Tahun", "Year"],
  quarter: ["Kuartal", "Quarter"],
  month: ["Bulan", "Month"],
  week: ["Minggu", "Week"],
  day: ["Hari", "Day"],
};

export const BI_AGGREGATES = ["sum", "count", "distinct", "avg", "min", "max"] as const;
export type BiAggregate = (typeof BI_AGGREGATES)[number];
export const BI_AGGREGATE_LABEL: Record<BiAggregate, [string, string]> = {
  ...REPORT_AGGREGATE_LABEL,
  distinct: ["Banyaknya unik", "Distinct count"],
};

/** Cara menampilkan nilai ukuran. */
export const SHOW_AS = [
  "value",
  "pct_total",
  "running_total",
  "diff_prev",
  "pct_prev",
  "last_year",
  "yoy",
  "vs_prev_period",
] as const;
export type ShowAs = (typeof SHOW_AS)[number];
export const SHOW_AS_LABEL: Record<ShowAs, [string, string]> = {
  value: ["Nilai", "Value"],
  pct_total: ["% dari total", "% of grand total"],
  running_total: ["Total berjalan", "Running total"],
  diff_prev: ["Selisih vs sebelumnya", "Difference from previous"],
  pct_prev: ["% perubahan vs sebelumnya", "% change from previous"],
  last_year: ["Nilai tahun lalu", "Same period last year"],
  yoy: ["% vs tahun lalu (YoY)", "% vs last year (YoY)"],
  vs_prev_period: ["% vs periode lalu", "% vs previous period"],
};
const PERCENT_SHOW_AS: ShowAs[] = ["pct_total", "pct_prev", "yoy", "vs_prev_period"];

export const VALUE_FORMATS = ["auto", "number", "percent", "currency", "compact"] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];

export const VISUAL_TYPES = [
  "card",
  "multi_card",
  "kpi",
  "column",
  "bar",
  "line",
  "area",
  "combo",
  "pie",
  "donut",
  "funnel",
  "gauge",
  "treemap",
  "scatter",
  "table",
  "matrix",
  "slicer",
  "text",
] as const;
export type VisualType = (typeof VISUAL_TYPES)[number];
export const VISUAL_TYPE_LABEL: Record<VisualType, [string, string]> = {
  card: ["Kartu", "Card"],
  multi_card: ["Kartu multi-baris", "Multi-row card"],
  kpi: ["KPI", "KPI"],
  column: ["Kolom", "Column chart"],
  bar: ["Batang", "Bar chart"],
  line: ["Garis", "Line chart"],
  area: ["Area", "Area chart"],
  combo: ["Kolom + garis", "Line and column"],
  pie: ["Pai", "Pie chart"],
  donut: ["Donat", "Donut chart"],
  funnel: ["Corong", "Funnel"],
  gauge: ["Pengukur", "Gauge"],
  treemap: ["Treemap", "Treemap"],
  scatter: ["Sebar", "Scatter chart"],
  table: ["Tabel", "Table"],
  matrix: ["Matriks", "Matrix"],
  slicer: ["Slicer", "Slicer"],
  text: ["Teks", "Text box"],
};
/** Visual satu angka (tanpa sumbu). */
export const SINGLE_VALUE_VISUALS: VisualType[] = ["card", "multi_card", "kpi", "gauge"];

export const BI_FILTER_OPS = [...REPORT_OPERATORS, "in", "notIn", "between"] as const;
export type BiFilterOp = (typeof BI_FILTER_OPS)[number];

/** Grid kanvas: 12 kolom. */
export const CANVAS_COLUMNS = 12;
/** Batas titik/baris hasil agar respons tidak membengkak. */
export const BI_MAX_POINTS = 1000;
export const BI_MAX_ROWS = 5000;
const MAX_LEGEND = 12;
const MAX_MATRIX_COLUMNS = 50;
const OTHER_KEY = "\u0000other";

// ---- Skema ----

const columnKey = z.string().trim().min(1).max(100);
const id = z.string().trim().min(1).max(40);

export const biFieldSchema = z.object({ column: columnKey, level: z.enum(DATE_LEVELS).nullish() });
export type BiField = z.infer<typeof biFieldSchema>;

export const biMeasureSchema = z.object({
  id,
  label: z.string().trim().max(120).default(""),
  /** Kolom yang diagregasi; "*" = banyaknya baris. Kosong bila ukuran berupa rumus. */
  column: columnKey.nullish(),
  fn: z.enum(BI_AGGREGATES).default("sum"),
  formula: z.string().trim().max(500).nullish(),
  showAs: z.enum(SHOW_AS).default("value"),
  format: z.enum(VALUE_FORMATS).default("auto"),
  /** Dipakai rumus tetapi tidak ditampilkan. */
  hidden: z.boolean().default(false),
});
export type BiMeasure = z.infer<typeof biMeasureSchema>;

export const biFilterSchema = z.object({
  column: columnKey,
  level: z.enum(DATE_LEVELS).nullish(),
  op: z.enum(BI_FILTER_OPS).default("in"),
  value: z.string().max(200).default(""),
  value2: z.string().max(200).default(""),
  values: z.array(z.string().max(200)).max(500).default([]),
  /** Visual asal filter silang/slicer: tidak memfilter visual itu sendiri (disorot saja). */
  source: z.string().max(40).nullish(),
});
export type BiFilter = z.infer<typeof biFilterSchema>;

export const biLayoutSchema = z.object({
  x: z
    .number()
    .int()
    .min(0)
    .max(CANVAS_COLUMNS - 1),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(CANVAS_COLUMNS),
  h: z.number().int().min(1).max(60),
});
export type BiLayout = z.infer<typeof biLayoutSchema>;

export const biVisualOptionsSchema = z
  .object({
    stacked: z.boolean(),
    /** Bertumpuk 100%. */
    percent: z.boolean(),
    dataLabels: z.boolean(),
    legend: z.boolean(),
    min: z.number(),
    max: z.number(),
    target: z.number(),
    /** Kolom + garis: id ukuran yang digambar sebagai garis. */
    lineMeasures: z.array(z.string().max(40)).max(10),
    compare: z.enum(["none", "prev_period", "last_year"]),
    slicer: z.enum(["list", "dropdown", "range"]),
    conditional: z
      .array(z.object({ measure: z.string().max(40), kind: z.enum(["scale", "bar", "icon"]) }))
      .max(10),
    text: z.string().max(5000),
  })
  .partial();
export type BiVisualOptions = z.infer<typeof biVisualOptionsSchema>;

export const biVisualSchema = z
  .object({
    id,
    type: z.enum(VISUAL_TYPES),
    title: z.string().trim().max(120).default(""),
    dataset: z.string().trim().max(60).default(""),
    /** Visual dari laporan tersimpan (Pembuat Laporan). */
    reportId: z.string().uuid().nullish(),
    /** Parameter dataset (mis. kind=customer, departmentId, runId). */
    params: z.record(z.string(), z.string().max(200)).default({}),
    axis: z.array(biFieldSchema).max(4).default([]),
    legend: biFieldSchema.nullish(),
    values: z.array(biMeasureSchema).max(10).default([]),
    /** Tabel rincian (tanpa ringkasan): kolom yang ditampilkan apa adanya. */
    columns: z.array(columnKey).max(50).default([]),
    filters: z.array(biFilterSchema).max(20).default([]),
    sort: z.object({ by: columnKey, dir: z.enum(["asc", "desc"]).default("desc") }).nullish(),
    topN: z.number().int().min(1).max(BI_MAX_ROWS).nullish(),
    options: biVisualOptionsSchema.default({}),
    layout: biLayoutSchema,
    ignorePeriod: z.boolean().default(false),
    crossFilter: z.boolean().default(true),
  })
  .refine((v) => v.type === "text" || !!v.dataset || !!v.reportId, {
    message: "Pilih data untuk visual",
    path: ["dataset"],
  });
export type BiVisual = z.infer<typeof biVisualSchema>;
export type BiVisualInput = z.input<typeof biVisualSchema>;

export const biPageSchema = z.object({
  id,
  name: z.string().trim().min(1, "Nama halaman wajib diisi").max(60),
  filters: z.array(biFilterSchema).max(20).default([]),
  visuals: z.array(biVisualSchema).max(40).default([]),
});
export type BiPage = z.infer<typeof biPageSchema>;

export const biDocumentSchema = z.object({
  version: z.literal(2).default(2),
  period: z.enum(PERIOD_PRESETS).nullish(),
  /** Filter semua halaman. */
  filters: z.array(biFilterSchema).max(20).default([]),
  pages: z.array(biPageSchema).min(1).max(20),
});
export type BiDocument = z.infer<typeof biDocumentSchema>;

/** Simpan dashboard: dashboard lama (widgets) atau dokumen v2. */
export const dashboardInputSchema = dashboardSchema.extend({ document: biDocumentSchema.nullish() });
export type DashboardInputV2 = z.infer<typeof dashboardInputSchema>;

/** Jalankan visual BI (`POST /bi/query`). */
export const biQuerySchema = z
  .object({
    visuals: z.array(biVisualSchema).max(40).optional(),
    dashboardId: z.string().uuid().optional(),
    builtin: z.string().max(40).optional(),
    /** Halaman dokumen dashboard (bawaan: halaman pertama). */
    pageId: z.string().max(40).optional(),
    from: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    ),
    to: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    ),
    filters: z.array(biFilterSchema).max(50).default([]),
    drill: z
      .record(
        z.string().max(40),
        z.object({
          depth: z.number().int().min(0).max(3).default(0),
          path: z.array(z.string().max(200)).max(3).default([]),
          expandAll: z.boolean().default(false),
        }),
      )
      .default({}),
  })
  .refine((v) => [v.visuals, v.dashboardId, v.builtin].filter(Boolean).length === 1, {
    message: "Kirim salah satu: dashboardId, builtin, atau visuals",
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Tanggal awal harus sebelum tanggal akhir",
    path: ["to"],
  });
export type BiQueryInput = z.infer<typeof biQuerySchema>;

// ---- Field & tanggal ----

/** Kunci kolom hasil untuk field (kolom tanggal berlevel: `kolom@level`). */
export const fieldKey = (f: { column: string; level?: DateLevel | null }) =>
  f.level ? `${f.column}@${f.level}` : f.column;

const DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?/;

function isoWeek(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 864e5 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Nilai tanggal ("YYYY-MM-DD"/"YYYY-MM") pada level hierarki: 2026, 2026-Q1, 2026-03, 2026-W09, 2026-03-01. */
export function dateLevelValue(value: unknown, level: DateLevel): string {
  const m = DATE_RE.exec(String(value ?? ""));
  if (!m) return "";
  const y = m[1]!;
  const mm = Number(m[2]);
  switch (level) {
    case "year":
      return y;
    case "quarter":
      return `${y}-Q${Math.floor((mm - 1) / 3) + 1}`;
    case "month":
      return `${y}-${m[2]}`;
    case "week":
      return m[3] ? isoWeek(Number(y), mm, Number(m[3])) : "";
    default:
      return m[3] ? `${y}-${m[2]}-${m[3]}` : "";
  }
}

/** Kunci waktu (tahun/kuartal/bulan/minggu/tanggal) — diurutkan naik, bisa digeser setahun. */
const TIME_KEY = /^\d{4}(?:-(?:Q[1-4]|W\d{2}|\d{2}(?:-\d{2})?))?$/;
export const isTimeKey = (key: string) => TIME_KEY.test(key);

/** Geser kunci waktu `n` tahun (2026-03 → 2025-03; 29 Feb → 28 Feb). Kunci non-waktu tidak berubah. */
export function shiftTimeKey(key: string, years: number): string {
  if (!isTimeKey(key)) return key;
  const y = Number(key.slice(0, 4)) + years;
  const rest = key.slice(4);
  if (/^-02-29$/.test(rest))
    return `${y}-02-${y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? "29" : "28"}`;
  return `${y}${rest}`;
}

const fieldValue = (row: Record<string, unknown>, f: BiField) =>
  f.level ? dateLevelValue(row[f.column], f.level) : String(row[f.column] ?? "");

// ---- Filter ----

function matchFilter(row: Record<string, unknown>, f: BiFilter, numeric: boolean): boolean {
  const raw = f.level ? dateLevelValue(row[f.column], f.level) : row[f.column];
  const text = String(raw ?? "");
  const num = numeric && !f.level;
  switch (f.op) {
    case "in":
      return !f.values.length || f.values.includes(text);
    case "notIn":
      return !f.values.includes(text);
    case "between": {
      if (num) {
        const v = reportNumber(raw);
        const lo = f.value.trim() ? reportNumber(f.value) : -Infinity;
        const hi = f.value2.trim() ? reportNumber(f.value2) : Infinity;
        return !Number.isNaN(v) && v >= lo && v <= hi;
      }
      return (!f.value || text >= f.value) && (!f.value2 || text <= f.value2);
    }
    default:
      // Syarat yang nilainya belum diisi (sedang disusun) diabaikan.
      if (f.op !== "empty" && f.op !== "notEmpty" && !f.value.trim()) return true;
      return matchesCondition(raw, f.op, f.value, num);
  }
}

// ---- Ukuran ----

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function aggregate(rows: Record<string, unknown>[], column: string, fn: BiAggregate): number | null {
  if (fn === "count") {
    if (column === "*") return rows.length;
    return rows.filter((r) => String(r[column] ?? "").trim() !== "").length;
  }
  if (fn === "distinct") {
    const set = new Set<string>();
    for (const r of rows) {
      const v = String(r[column] ?? "").trim();
      if (v) set.add(v);
    }
    return set.size;
  }
  let sum = 0;
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const v = reportNumber(r[column]);
    if (Number.isNaN(v)) continue;
    sum += v;
    n++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (fn === "sum") return round(sum);
  if (!n) return null;
  if (fn === "avg") return round(sum / n);
  return fn === "min" ? min : max;
}

interface CompiledMeasure {
  m: BiMeasure;
  label: string;
  formula?: FormulaNode;
}

/** Urutkan ukuran: dasar dulu, rumus setelah ukuran yang dirujuknya; galat untuk rujukan tak dikenal/melingkar. */
function compileMeasures(
  measures: BiMeasure[],
  label: (m: BiMeasure) => string,
  /** Rujukan tak dikenal diabaikan (validasi simpan: nama otomatis ukuran baru diketahui saat dijalankan). */
  lenient = false,
): CompiledMeasure[] {
  const all = measures.map((m) => ({
    m,
    label: label(m),
    formula: m.formula ? parseFormula(m.formula) : undefined,
  }));
  const byName = new Map<string, CompiledMeasure>();
  for (const c of all) {
    byName.set(c.m.id.toLowerCase(), c);
    byName.set(c.label.toLowerCase(), c);
  }
  const ordered: CompiledMeasure[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (c: CompiledMeasure) => {
    const s = state.get(c.m.id);
    if (s === "done") return;
    if (s === "visiting") throw new FormulaError(`Rumus melingkar pada ukuran "${c.label}"`);
    state.set(c.m.id, "visiting");
    if (c.formula)
      for (const ref of formulaRefs(c.formula)) {
        const dep = byName.get(ref.toLowerCase());
        if (!dep) {
          if (lenient) continue;
          throw new FormulaError(`Rumus: ukuran [${ref}] tidak ditemukan di visual ini`);
        }
        visit(dep);
      }
    state.set(c.m.id, "done");
    ordered.push(c);
  };
  all.forEach(visit);
  return ordered;
}

function computeMeasures(
  rows: Record<string, unknown>[],
  compiled: CompiledMeasure[],
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const byName = new Map<string, string>();
  for (const c of compiled) {
    byName.set(c.m.id.toLowerCase(), c.m.id);
    byName.set(c.label.toLowerCase(), c.m.id);
  }
  for (const c of compiled) {
    if (c.formula) {
      const v = evaluateFormula(c.formula, (name) => out[byName.get(name.toLowerCase()) ?? ""] ?? null);
      out[c.m.id] = v === null ? null : round(v, 4);
    } else out[c.m.id] = aggregate(rows, c.m.column || "*", c.m.fn);
  }
  return out;
}

// ---- Hasil ----

export interface BiResultField {
  key: string;
  header: string;
  kind: "dimension" | "measure";
  numeric?: boolean;
  format?: ValueFormat;
  level?: DateLevel | null;
}
export interface BiCategory {
  key: string;
  label: string;
}
export interface BiSeries {
  id: string;
  label: string;
  measure: string;
  values: (number | null)[];
}
export interface BiMatrixRow {
  path: string[];
  depth: number;
  cells: Record<string, Record<string, number | null>>;
  total: Record<string, number | null>;
}
export interface BiResult {
  id: string;
  hidden?: boolean;
  error?: string;
  type?: VisualType;
  fields: BiResultField[];
  rows: Record<string, unknown>[];
  categories: BiCategory[];
  series: BiSeries[];
  totals: Record<string, number | null>;
  matrix?: {
    columns: BiCategory[];
    rows: BiMatrixRow[];
    columnTotals: Record<string, Record<string, number | null>>;
  };
  card?: { value: number | null; previous?: number | null; change?: number | null; target?: number | null };
  drill?: { depth: number; maxDepth: number; path: string[] };
  /** Kategori terpilih oleh filter silang dari visual ini sendiri (disorot). */
  highlight?: string[];
  /** Banyaknya baris data setelah filter. */
  rowCount: number;
  truncated?: boolean;
}

export interface BiRunContext {
  /** Filter dashboard, halaman, filter silang, slicer. Filter pada kolom yang tidak ada di dataset diabaikan. */
  filters?: BiFilter[];
  drill?: { depth?: number; path?: string[]; expandAll?: boolean };
  /** Baris periode yang sama tahun lalu (YoY) dan periode sebelumnya, bila dashboard memakai periode. */
  lastYear?: Record<string, unknown>[];
  previousPeriod?: Record<string, unknown>[];
}

const emptyLabel = "(Kosong)";
const label = (key: string) => (key === OTHER_KEY ? "Lainnya" : key || emptyLabel);
const changePct = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : round(((cur - prev) / Math.abs(prev)) * 100, 1);

function groupRows(rows: Record<string, unknown>[], key: (r: Record<string, unknown>) => string) {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/**
 * Jalankan satu visual atas baris dataset. Melempar galat bila visual merujuk kolom yang tidak ada atau rumusnya
 * rusak (pemanggil menampilkannya per visual).
 */
export function runVisual(
  data: Record<string, unknown>[],
  available: ReportColumn[],
  visual: BiVisual,
  ctx: BiRunContext = {},
): BiResult {
  const cols = new Map(available.map((c) => [c.key, c]));
  const need = (key: string) => {
    const c = cols.get(key);
    if (!c) throw new Error(`Kolom laporan tidak dikenal: ${key}`);
    return c;
  };
  const fieldHeader = (f: BiField) => {
    const h = need(f.column).header;
    return f.level ? `${h} (${DATE_LEVEL_LABEL[f.level][0]})` : h;
  };
  const measureLabel = (m: BiMeasure) =>
    m.label ||
    (m.formula
      ? m.id
      : `${BI_AGGREGATE_LABEL[m.fn][0]} ${!m.column || m.column === "*" ? "data" : (cols.get(m.column)?.header ?? m.column)}`);

  visual.axis.forEach((f) => need(f.column));
  if (visual.legend) need(visual.legend.column);
  visual.columns.forEach(need);
  for (const m of visual.values) if (!m.formula && m.column && m.column !== "*") need(m.column);
  visual.filters.forEach((f) => need(f.column));
  const compiled = compileMeasures(visual.values, measureLabel);
  const visible = compiled.filter((c) => !c.m.hidden);

  // Filter: milik visual (wajib dikenal) + konteks (dilewati bila kolomnya tidak ada di dataset ini).
  const external = (ctx.filters ?? []).filter((f) => cols.has(f.column));
  const own = external.filter((f) => f.source === visual.id);
  const applied = [...visual.filters, ...external.filter((f) => f.source !== visual.id)];
  const pass = (r: Record<string, unknown>) =>
    applied.every((f) => matchFilter(r, f, !!cols.get(f.column)?.numeric));
  const filtered = data.filter(pass);
  const filteredOf = (rows?: Record<string, unknown>[]) => (rows ? rows.filter(pass) : undefined);

  const measureFields: BiResultField[] = visible.map((c) => ({
    key: c.m.id,
    header: c.label,
    kind: "measure",
    numeric: true,
    format: c.m.format === "auto" && PERCENT_SHOW_AS.includes(c.m.showAs) ? "percent" : c.m.format,
  }));
  const totals = computeMeasures(filtered, compiled);
  const base: BiResult = {
    id: visual.id,
    type: visual.type,
    fields: [],
    rows: [],
    categories: [],
    series: [],
    totals: Object.fromEntries(visible.map((c) => [c.m.id, totals[c.m.id] ?? null])),
    rowCount: filtered.length,
  };

  if (visual.type === "text") return base;

  // ---- Satu angka ----
  if (SINGLE_VALUE_VISUALS.includes(visual.type)) {
    const first = visible[0];
    const value = first ? (totals[first.m.id] ?? null) : filtered.length;
    const compare = visual.options.compare ?? (visual.type === "kpi" ? "prev_period" : "none");
    const prevRows = filteredOf(compare === "last_year" ? ctx.lastYear : ctx.previousPeriod);
    const previous =
      compare !== "none" && prevRows && first
        ? (computeMeasures(prevRows, compiled)[first.m.id] ?? null)
        : undefined;
    // Pengukur: target dari opsi atau ukuran kedua.
    const second = visible[1];
    const target = visual.options.target ?? (second ? (totals[second.m.id] ?? null) : null);
    return {
      ...base,
      fields: measureFields,
      rows: [Object.fromEntries(visible.map((c) => [c.m.id, totals[c.m.id] ?? null]))],
      card: {
        value,
        ...(previous !== undefined ? { previous, change: changePct(value, previous) } : {}),
        target,
      },
    };
  }

  // ---- Tabel rincian (tanpa ringkasan) ----
  if (visual.type === "table" && !visible.length && visual.columns.length) {
    const columns = visual.columns.map(need);
    let rows = filtered;
    const sortCol = visual.sort ? cols.get(visual.sort.by) : undefined;
    if (visual.sort && sortCol) {
      const dir = visual.sort.dir === "desc" ? -1 : 1;
      rows = [...rows].sort((a, b) =>
        sortCol.numeric
          ? ((reportNumber(a[sortCol.key]) || 0) - (reportNumber(b[sortCol.key]) || 0)) * dir
          : String(a[sortCol.key] ?? "").localeCompare(String(b[sortCol.key] ?? ""), "id") * dir,
      );
    }
    const limit = Math.min(visual.topN ?? BI_MAX_ROWS, BI_MAX_ROWS);
    return {
      ...base,
      fields: columns.map((c) => ({
        key: c.key,
        header: c.header,
        kind: c.numeric ? "measure" : "dimension",
        numeric: !!c.numeric,
      })),
      rows: rows.slice(0, limit).map((r) => ({
        ...Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? ""])),
        ...(typeof r._model === "string" && typeof r._id === "string"
          ? { _model: r._model, _id: r._id }
          : {}),
      })),
      totals: Object.fromEntries(
        columns
          .filter((c) => c.numeric)
          .map((c) => [c.key, round(filtered.reduce((s, r) => s + (reportNumber(r[c.key]) || 0), 0))]),
      ),
      truncated: rows.length > limit,
    };
  }

  // ---- Urutan kategori ----
  const sortKeys = (
    entries: { key: string; values: Record<string, number | null> }[],
    fieldK: string,
  ): { key: string; values: Record<string, number | null> }[] => {
    const firstId = visible[0]?.m.id;
    const time = entries.every((e) => !e.key || isTimeKey(e.key));
    const by = visual.sort?.by;
    const dir = visual.sort ? (visual.sort.dir === "desc" ? -1 : 1) : time || !firstId ? 1 : -1;
    const byMeasure = by ? visible.some((c) => c.m.id === by) : !time && !!firstId;
    const measureId = by && byMeasure ? by : firstId;
    const sorted = [...entries].sort((a, b) => {
      if (a.key === OTHER_KEY) return 1;
      if (b.key === OTHER_KEY) return -1;
      if (byMeasure && measureId && (!by || by !== fieldK))
        return ((a.values[measureId] ?? -Infinity) - (b.values[measureId] ?? -Infinity)) * dir;
      return a.key.localeCompare(b.key, "id", { numeric: true }) * dir;
    });
    return sorted;
  };

  // ---- Matriks ----
  if (visual.type === "matrix") {
    if (!visual.axis.length) throw new Error("Matriks butuh minimal satu baris (sumbu)");
    const colField = visual.legend ?? null;
    const colGroups = colField ? groupRows(filtered, (r) => fieldValue(r, colField)) : null;
    let colKeys = colGroups
      ? sortKeys(
          [...colGroups.entries()].map(([key, rows]) => ({ key, values: computeMeasures(rows, compiled) })),
          fieldKey(colField!),
        ).map((e) => e.key)
      : [];
    const truncatedCols = colKeys.length > MAX_MATRIX_COLUMNS;
    colKeys = colKeys.slice(0, MAX_MATRIX_COLUMNS);
    const out: BiMatrixRow[] = [];
    const visit = (rows: Record<string, unknown>[], depth: number, path: string[]) => {
      if (depth >= visual.axis.length || out.length >= BI_MAX_ROWS) return;
      const f = visual.axis[depth]!;
      const groups = groupRows(rows, (r) => fieldValue(r, f));
      const entries = sortKeys(
        [...groups.entries()].map(([key, rs]) => ({ key, values: computeMeasures(rs, compiled) })),
        fieldKey(f),
      );
      for (const e of entries) {
        if (out.length >= BI_MAX_ROWS) return;
        const rs = groups.get(e.key)!;
        const cells: BiMatrixRow["cells"] = {};
        if (colField) {
          const byCol = groupRows(rs, (r) => fieldValue(r, colField));
          for (const ck of colKeys) {
            const sub = byCol.get(ck);
            if (sub) cells[ck] = pick(computeMeasures(sub, compiled));
          }
        }
        out.push({ path: [...path, e.key], depth, cells, total: pick(e.values) });
        visit(rs, depth + 1, [...path, e.key]);
      }
    };
    const pick = (vals: Record<string, number | null>) =>
      Object.fromEntries(visible.map((c) => [c.m.id, vals[c.m.id] ?? null]));
    visit(filtered, 0, []);
    // % dari total di matriks: relatif terhadap total keseluruhan.
    for (const c of visible.filter((x) => x.m.showAs === "pct_total")) {
      const grand = totals[c.m.id] ?? null;
      const pct = (v: number | null) => (v === null || !grand ? null : round((v / grand) * 100, 2));
      for (const r of out) {
        r.total[c.m.id] = pct(r.total[c.m.id] ?? null);
        for (const ck of Object.keys(r.cells)) r.cells[ck]![c.m.id] = pct(r.cells[ck]![c.m.id] ?? null);
      }
    }
    const columnTotals = Object.fromEntries(
      colKeys.map((ck) => [ck, pick(computeMeasures(colGroups!.get(ck) ?? [], compiled))]),
    );
    return {
      ...base,
      fields: [
        ...visual.axis.map((f) => ({
          key: fieldKey(f),
          header: fieldHeader(f),
          kind: "dimension" as const,
          level: f.level ?? null,
        })),
        ...measureFields,
      ],
      matrix: { columns: colKeys.map((k) => ({ key: k, label: label(k) })), rows: out, columnTotals },
      truncated: truncatedCols || out.length >= BI_MAX_ROWS,
    };
  }

  // ---- Tabel ringkasan, grafik, slicer ----
  const isTable = visual.type === "table";
  const maxDepth = Math.max(0, visual.axis.length - 1);
  const depth = isTable ? 0 : Math.min(Math.max(0, ctx.drill?.depth ?? 0), maxDepth);
  const path = (ctx.drill?.path ?? []).slice(0, depth);
  const expandAll = !isTable && !!ctx.drill?.expandAll;
  // Tabel memakai semua field sumbu sebagai kolom; grafik memakai level drill saat ini.
  const dims: BiField[] = isTable
    ? visual.axis
    : expandAll
      ? visual.axis.slice(0, depth + 1)
      : visual.axis.length
        ? [visual.axis[depth]!]
        : [];
  const scoped = path.length
    ? filtered.filter((r) => path.every((p, i) => fieldValue(r, visual.axis[i]!) === p))
    : filtered;
  const keyOf = (r: Record<string, unknown>) =>
    dims.length === 1 ? fieldValue(r, dims[0]!) : JSON.stringify(dims.map((d) => fieldValue(r, d)));
  const splitKey = (k: string): string[] =>
    dims.length === 0 ? [] : dims.length === 1 ? [k] : (JSON.parse(k) as string[]);
  const groups = dims.length ? groupRows(scoped, keyOf) : new Map([["", scoped]]);
  let entries = sortKeys(
    [...groups.entries()].map(([key, rows]) => ({ key, values: computeMeasures(rows, compiled) })),
    dims.length === 1 ? fieldKey(dims[0]!) : "",
  );
  const limit = Math.min(
    visual.topN ?? (isTable ? BI_MAX_ROWS : BI_MAX_POINTS),
    isTable ? BI_MAX_ROWS : BI_MAX_POINTS,
  );
  const truncated = entries.length > limit;
  entries = entries.slice(0, limit);
  const categoryLabel = (k: string) => (dims.length === 1 ? label(k) : splitKey(k).map(label).join(" · "));
  const categories = entries.map((e) => ({ key: e.key, label: categoryLabel(e.key) }));

  // Nilai pembanding (tahun lalu / periode lalu) per kategori, dari baris pembanding dengan filter & lingkup yang sama.
  const comparison = (rowsIn: Record<string, unknown>[] | undefined, shiftYears: number) => {
    if (!rowsIn) return undefined;
    // Kunci waktu baris pembanding digeser maju agar sejajar dengan kategori sekarang (2025-03 → 2026-03).
    const rs = filteredOf(rowsIn)!.filter((r) =>
      path.every((p, i) => shiftTimeKey(fieldValue(r, visual.axis[i]!), shiftYears) === p),
    );
    const g = dims.length ? groupRows(rs, keyOf) : new Map([["", rs]]);
    const out = new Map<string, Record<string, number | null>>();
    for (const [k, list] of g) {
      const shifted =
        dims.length === 1
          ? shiftTimeKey(k, shiftYears)
          : JSON.stringify(splitKey(k).map((x) => shiftTimeKey(x, shiftYears)));
      out.set(shifted, computeMeasures(list, compiled));
    }
    return out;
  };
  const needs = new Set(visible.map((c) => c.m.showAs));
  // Tanpa baris tahun lalu dari server (dashboard tanpa periode), bandingkan di data yang sama (riwayat penuh).
  const lastYear =
    needs.has("yoy") || needs.has("last_year") ? comparison(ctx.lastYear ?? data, 1) : undefined;
  const previous = needs.has("vs_prev_period") ? comparison(ctx.previousPeriod, 0) : undefined;
  const dimIsTime = categories.length > 0 && categories.every((c) => !c.key || isTimeKey(c.key));

  /** Terapkan "tampilkan sebagai" pada deret nilai berurutan kategori. */
  const transform = (
    c: CompiledMeasure,
    keys: string[],
    raw: (number | null)[],
    grand: number | null,
  ): (number | null)[] => {
    switch (c.m.showAs) {
      case "pct_total":
        return raw.map((v) => (v === null || !grand ? null : round((v / grand) * 100, 2)));
      case "running_total": {
        let acc = 0;
        return raw.map((v) => (acc = round(acc + (v ?? 0))));
      }
      case "diff_prev":
        return raw.map((v, i) =>
          i === 0 || v === null || raw[i - 1] === null ? null : round(v - raw[i - 1]!),
        );
      case "pct_prev":
        return raw.map((v, i) => (i === 0 ? null : changePct(v, raw[i - 1] ?? null)));
      case "last_year":
        return keys.map((k) => lastYear?.get(k)?.[c.m.id] ?? null);
      case "yoy":
        return keys.map((k, i) => changePct(raw[i] ?? null, lastYear?.get(k)?.[c.m.id] ?? null));
      case "vs_prev_period":
        // Sumbu waktu: periode lalu = kategori sebelumnya; selain itu nilai kategori yang sama di periode lalu.
        return dimIsTime || !previous
          ? raw.map((v, i) => (i === 0 ? null : changePct(v, raw[i - 1] ?? null)))
          : keys.map((k, i) => changePct(raw[i] ?? null, previous.get(k)?.[c.m.id] ?? null));
      default:
        return raw;
    }
  };

  const keys = entries.map((e) => e.key);
  const measureSeries = new Map(
    visible.map((c) => [
      c.m.id,
      transform(
        c,
        keys,
        entries.map((e) => e.values[c.m.id] ?? null),
        totals[c.m.id] ?? null,
      ),
    ]),
  );

  // Legenda: satu seri per nilai legenda (ukuran pertama); nilai di luar 12 teratas digabung "Lainnya".
  let series: BiSeries[];
  if (visual.legend && !isTable && visible.length) {
    const lf = visual.legend;
    const first = visible[0]!;
    const legendGroups = groupRows(scoped, (r) => fieldValue(r, lf));
    let legendKeys = sortKeys(
      [...legendGroups.entries()].map(([key, rows]) => ({ key, values: computeMeasures(rows, compiled) })),
      fieldKey(lf),
    ).map((e) => e.key);
    if (legendKeys.length > MAX_LEGEND) legendKeys = [...legendKeys.slice(0, MAX_LEGEND - 1), OTHER_KEY];
    const top = new Set(legendKeys.filter((k) => k !== OTHER_KEY));
    series = legendKeys.map((lk) => {
      const sub = scoped.filter((r) => {
        const v = fieldValue(r, lf);
        return lk === OTHER_KEY ? !top.has(v) : v === lk;
      });
      const byCat = dims.length ? groupRows(sub, keyOf) : new Map([["", sub]]);
      const raw = keys.map((k) => {
        const rs = byCat.get(k);
        return rs ? (computeMeasures(rs, compiled)[first.m.id] ?? null) : null;
      });
      return {
        id: `${first.m.id}:${lk}`,
        label: label(lk),
        measure: first.m.id,
        values: transform(first, keys, raw, totals[first.m.id] ?? null),
      };
    });
  } else
    series = visible.map((c) => ({
      id: c.m.id,
      label: c.label,
      measure: c.m.id,
      values: measureSeries.get(c.m.id)!,
    }));

  const dimFields: BiResultField[] = dims.map((f) => ({
    key: fieldKey(f),
    header: fieldHeader(f),
    kind: "dimension",
    level: f.level ?? null,
  }));
  const rows = entries.map((e, i) => {
    const parts = splitKey(e.key);
    return {
      ...Object.fromEntries(dimFields.map((f, j) => [f.key, parts[j] ?? ""])),
      ...Object.fromEntries(visible.map((c) => [c.m.id, measureSeries.get(c.m.id)![i] ?? null])),
    };
  });
  const highlight = own.length
    ? categories
        .filter((c) =>
          own.every((f) => !dims.length || fieldKey(dims[0]!) !== fieldKey(f) || matchFilterKey(c.key, f)),
        )
        .map((c) => c.key)
    : undefined;

  return {
    ...base,
    fields: [...dimFields, ...measureFields],
    rows,
    categories,
    series,
    ...(isTable ? {} : { drill: { depth, maxDepth, path } }),
    ...(highlight ? { highlight } : {}),
    truncated,
  };
}

const matchFilterKey = (key: string, f: BiFilter) =>
  f.op === "in"
    ? !f.values.length || f.values.includes(key)
    : f.op === "notIn"
      ? !f.values.includes(key)
      : true;

// ---- Rincian (lihat data) ----

/**
 * Baris data penyusun satu titik/kelompok visual: filter visual & konteks + nilai field yang diklik (`match`,
 * sadar level tanggal). Kolom field & ukuran didahulukan; maksimal 500 baris beserta `_model`/`_id`.
 */
export function drillVisual(
  data: Record<string, unknown>[],
  available: ReportColumn[],
  visual: BiVisual,
  ctx: Pick<BiRunContext, "filters">,
  match: { column: string; level?: DateLevel | null; value: string }[],
): {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  total: number;
  totals: Record<string, number>;
} {
  const cols = new Map(available.map((c) => [c.key, c]));
  for (const m of match) if (!cols.has(m.column)) throw new Error(`Kolom laporan tidak dikenal: ${m.column}`);
  visual.filters.forEach((f) => {
    if (!cols.has(f.column)) throw new Error(`Kolom laporan tidak dikenal: ${f.column}`);
  });
  const filters = [...visual.filters, ...(ctx.filters ?? []).filter((f) => cols.has(f.column))];
  const rows = data.filter(
    (r) =>
      filters.every((f) => matchFilter(r, f, !!cols.get(f.column)?.numeric)) &&
      match.every((m) => fieldValue(r, { column: m.column, level: m.level ?? null }) === m.value),
  );
  const first = [
    ...visual.axis.map((f) => f.column),
    ...(visual.legend ? [visual.legend.column] : []),
    ...visual.values.map((m) => m.column ?? "").filter((c) => c && c !== "*"),
    ...visual.columns,
  ].filter((k) => cols.has(k));
  const order = [...new Set([...first, ...available.map((c) => c.key)])];
  const columns = order.map((k) => {
    const c = cols.get(k)!;
    return { key: c.key, header: c.header, ...(c.numeric ? { numeric: true } : {}) };
  });
  const totals = Object.fromEntries(
    columns
      .filter((c) => c.numeric)
      .map((c) => [c.key, round(rows.reduce((s, r) => s + (reportNumber(r[c.key]) || 0), 0))]),
  );
  return {
    columns,
    rows: rows.slice(0, 500).map((r) => ({
      ...Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? ""])),
      ...(typeof r._model === "string" && typeof r._id === "string" ? { _model: r._model, _id: r._id } : {}),
    })),
    total: rows.length,
    totals,
  };
}

/** Rincian visual (`POST /bi/drill`). */
export const biDrillSchema = z.object({
  visual: biVisualSchema,
  from: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  ),
  to: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  ),
  filters: z.array(biFilterSchema).max(50).default([]),
  match: z
    .array(z.object({ column: columnKey, level: z.enum(DATE_LEVELS).nullish(), value: z.string().max(500) }))
    .max(6)
    .default([]),
});

// ---- Hasil laporan tersimpan → hasil visual ----

/** Hasil `runReport` (laporan tersimpan) sebagai hasil visual: tabel, atau grafik dari pengaturan grafik laporan. */
export function reportResultToVisual(
  visual: Pick<BiVisual, "id" | "type">,
  result: {
    columns: ReportColumn[];
    rows: Record<string, unknown>[];
    total: number;
    totals: Record<string, number>;
  },
  chart?: { x: string; y: string } | null,
): BiResult {
  const fields: BiResultField[] = result.columns.map((c) => ({
    key: c.key,
    header: c.header,
    kind: c.numeric ? "measure" : "dimension",
    numeric: !!c.numeric,
  }));
  const rows = result.rows.slice(0, BI_MAX_ROWS);
  const base: BiResult = {
    id: visual.id,
    type: visual.type,
    fields,
    rows,
    categories: [],
    series: [],
    totals: result.totals,
    rowCount: result.total,
    truncated: result.rows.length > BI_MAX_ROWS,
  };
  if (SINGLE_VALUE_VISUALS.includes(visual.type)) {
    const numeric = result.columns.find((c) => c.numeric);
    const value = numeric
      ? result.rows.reduce((s, r) => s + (reportNumber(r[numeric.key]) || 0), 0)
      : result.total;
    return { ...base, card: { value: round(value) } };
  }
  if (!chart) return base;
  const points = rows.slice(0, BI_MAX_POINTS);
  return {
    ...base,
    categories: points.map((r) => ({
      key: String(r[chart.x] ?? ""),
      label: label(String(r[chart.x] ?? "")),
    })),
    series: [
      {
        id: chart.y,
        label: result.columns.find((c) => c.key === chart.y)?.header ?? chart.y,
        measure: chart.y,
        values: points.map((r) => {
          const v = reportNumber(r[chart.y]);
          return Number.isNaN(v) ? null : v;
        }),
      },
    ],
  };
}

// ---- Validasi dokumen ----

/** Galat struktur dokumen yang tidak tertangkap skema: id ganda, rumus rusak. */
export function documentErrors(doc: BiDocument): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const pageIds = new Set<string>();
  const visualIds = new Set<string>();
  doc.pages.forEach((p, pi) => {
    if (pageIds.has(p.id)) errors.push({ path: `pages.${pi}.id`, message: "Id halaman ganda" });
    pageIds.add(p.id);
    p.visuals.forEach((v, vi) => {
      const at = `pages.${pi}.visuals.${vi}`;
      if (visualIds.has(v.id)) errors.push({ path: `${at}.id`, message: "Id visual ganda" });
      visualIds.add(v.id);
      const ids = new Set<string>();
      v.values.forEach((m, mi) => {
        if (ids.has(m.id)) errors.push({ path: `${at}.values.${mi}.id`, message: "Id ukuran ganda" });
        ids.add(m.id);
        if (!m.formula && !m.column)
          errors.push({ path: `${at}.values.${mi}.column`, message: "Ukuran butuh kolom atau rumus" });
      });
      try {
        compileMeasures(v.values, (m) => m.label || m.id, true);
      } catch (e) {
        errors.push({ path: `${at}.values`, message: e instanceof Error ? e.message : String(e) });
      }
    });
  });
  return errors;
}

// ---- Konversi widget dashboard lama ----

/** Widget dashboard v1 → visual v2 (tata letak diisi `layoutFlow`). */
export function widgetToVisual(w: DashboardWidget, layout: BiLayout): BiVisual {
  const type: VisualType =
    w.type === "kpi" ? "kpi" : w.type === "bar" ? "column" : w.type === "pie" ? "donut" : w.type;
  const common = {
    id: w.id,
    type,
    title: w.title,
    layout,
    ignorePeriod: w.ignorePeriod,
    crossFilter: true,
    options:
      w.type === "kpi" ? { compare: (w.compare ? "prev_period" : "none") as "prev_period" | "none" } : {},
  };
  if ("reportId" in w.source)
    return biVisualSchema.parse({ ...common, reportId: w.source.reportId, dataset: "" });
  const c = w.source.config;
  const aggKeyOf = (a: { column: string; fn: string }) => `${a.fn}__${a.column}`;
  let aggregates = c.aggregates;
  // Ukuran grafik (y) didahulukan agar menjadi seri utama.
  if (c.chart?.y) {
    const i = aggregates.findIndex((a) => aggKeyOf(a) === c.chart!.y);
    if (i > 0) aggregates = [aggregates[i]!, ...aggregates.filter((_, j) => j !== i)];
  }
  const values = aggregates.map((a, i) => ({ id: `m${i + 1}`, column: a.column, fn: a.fn }));
  if (type === "kpi" && !values.length) values.push({ id: "m1", column: "*", fn: "count" });
  const sortAgg = c.sort ? aggregates.findIndex((a) => aggKeyOf(a) === c.sort!.column) : -1;
  return biVisualSchema.parse({
    ...common,
    dataset: w.source.dataset,
    params: c.filters,
    axis: type === "kpi" ? [] : c.groupBy.map((g) => ({ column: g })),
    values,
    columns: values.length ? [] : c.columns,
    filters: c.conditions.map((x) => ({ column: x.column, op: x.op, value: x.value })),
    sort: c.sort ? { by: sortAgg >= 0 ? `m${sortAgg + 1}` : c.sort.column, dir: c.sort.dir } : null,
    topN: c.limit ?? null,
  });
}

/** Susun tata letak berurutan kiri→kanan pada grid 12 kolom. */
export function layoutFlow(items: { w: number; h: number }[]): BiLayout[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return items.map(({ w, h }) => {
    const width = Math.min(CANVAS_COLUMNS, Math.max(1, w));
    if (x + width > CANVAS_COLUMNS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const out = { x, y, w: width, h };
    x += width;
    rowH = Math.max(rowH, h);
    return out;
  });
}

/** Dokumen v2 dari widget dashboard lama (dashboard kustom lama & dashboard bawaan). */
export function legacyToDocument(widgets: DashboardWidget[], period?: PeriodPreset | null): BiDocument {
  const layouts = layoutFlow(widgets.map((w) => ({ w: w.width * 3, h: w.type === "kpi" ? 3 : 8 })));
  return {
    version: 2,
    period: period ?? null,
    filters: [],
    pages: [
      {
        id: "p1",
        name: "Halaman 1",
        filters: [],
        visuals: widgets.map((w, i) => widgetToVisual(w, layouts[i]!)),
      },
    ],
  };
}

/** Dokumen v2 dashboard bawaan. */
export function builtinDocument(key: string): BiDocument | null {
  const d = BUILTIN_DASHBOARDS.find((x) => x.key === key);
  return d ? legacyToDocument(d.widgets, d.period) : null;
}

/** Semua visual dokumen (lintas halaman). */
export const documentVisuals = (doc: BiDocument) => doc.pages.flatMap((p) => p.visuals);
