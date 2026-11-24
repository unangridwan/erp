import { runVisual, type BiFilter, type BiMeasure, type BiVisual } from "./bi.js";
import type { ReportColumn } from "./reports.js";

/**
 * KPI pribadi otomatis. Tiap KPI adalah ukuran BI (dataset + agregat/rumus + filter) yang dihitung per pemilik
 * dokumen (`_userId` di baris dataset), sehingga angka KPI selalu sama dengan dashboard & laporan BI atas data yang
 * sama dan bisa ditelusuri sampai ke dokumen sumbernya.
 */
export type KpiUnit = "money" | "count" | "percent" | "days";
/** Arah yang lebih baik; `neutral` = tidak ada baik/buruk (mis. nilai pembelian). */
export type KpiBetter = "up" | "down" | "neutral";

export interface KpiDef {
  code: string;
  label: [string, string];
  description: [string, string];
  /** Fungsi/jobdesk. */
  area: [string, string];
  permission: string;
  dataset: string;
  /** Kolom tanggal (YYYY-MM-DD) penentu periode & tren bulanan. */
  date: string;
  /** Kunci pemilik di baris dataset. */
  owner: string;
  unit: KpiUnit;
  better: KpiBetter;
  /** Ukuran; yang terlihat pertama adalah nilai KPI, lainnya pembantu rumus (`hidden`). */
  measures: BiMeasure[];
  /** Filter baris dasar (mis. hanya faktur pelanggan). */
  filters?: BiFilter[];
  /** Filter baris yang ditampilkan sebagai rincian penyusun KPI (default: filter dasar + filter ukuran utama). */
  detailFilters?: BiFilter[];
}

const f = (column: string, values: string[], op: "in" | "notIn" = "in"): BiFilter => ({
  column,
  op,
  values,
  value: "",
  value2: "",
});
const m = (
  id: string,
  fn: BiMeasure["fn"],
  column: string | null,
  filters: BiFilter[] = [],
  extra: Partial<BiMeasure> = {},
): BiMeasure => ({
  id,
  label: "",
  column,
  fn,
  formula: null,
  showAs: "value",
  format: "auto",
  hidden: false,
  filters,
  ...extra,
});
const formula = (id: string, expr: string): BiMeasure => ({
  id,
  label: id,
  column: null,
  fn: "sum",
  formula: expr,
  showAs: "value",
  format: "auto",
  hidden: false,
  filters: [],
});
const helper = (id: string, fn: BiMeasure["fn"], column: string, filters: BiFilter[] = []) =>
  m(id, fn, column, filters, { label: id, hidden: true });

const SALES: [string, string] = ["Penjualan", "Sales"];
const CRM: [string, string] = ["CRM", "CRM"];
const PURCHASE: [string, string] = ["Pembelian", "Purchasing"];
const FINANCE: [string, string] = ["Keuangan", "Finance"];
const MFG: [string, string] = ["Produksi", "Production"];
const MAINT: [string, string] = ["Pemeliharaan", "Maintenance"];

export const KPI_CATALOG: KpiDef[] = [
  {
    code: "sales.revenue",
    label: ["Omzet pesanan", "Order revenue"],
    description: [
      "Nilai pesanan penjualan dikonfirmasi (sebelum pajak) yang Anda pegang.",
      "Value of confirmed sales orders (before tax) you own.",
    ],
    area: SALES,
    permission: "sales.read",
    dataset: "sales_orders",
    date: "dateOrder",
    owner: "_userId",
    unit: "money",
    better: "up",
    measures: [m("v", "sum", "amountUntaxed", [f("state", ["Pesanan"])])],
  },
  {
    code: "sales.orders",
    label: ["Pesanan dikonfirmasi", "Confirmed orders"],
    description: ["Banyaknya pesanan penjualan dikonfirmasi.", "Number of confirmed sales orders."],
    area: SALES,
    permission: "sales.read",
    dataset: "sales_orders",
    date: "dateOrder",
    owner: "_userId",
    unit: "count",
    better: "up",
    measures: [m("v", "count", "*", [f("state", ["Pesanan"])])],
  },
  {
    code: "sales.conversion",
    label: ["Konversi penawaran", "Quote conversion"],
    description: [
      "Persentase penawaran yang menjadi pesanan (di luar yang dibatalkan).",
      "Share of quotations that became orders (excluding cancelled).",
    ],
    area: SALES,
    permission: "sales.read",
    dataset: "sales_orders",
    date: "dateOrder",
    owner: "_userId",
    unit: "percent",
    better: "up",
    filters: [f("state", ["Batal"], "notIn")],
    measures: [
      formula("v", "DIVIDE([won], [all]) * 100"),
      helper("won", "count", "*", [f("state", ["Pesanan"])]),
      helper("all", "count", "*"),
    ],
  },
  {
    code: "crm.win_rate",
    label: ["Win rate peluang", "Opportunity win rate"],
    description: [
      "Persentase peluang yang dimenangkan dari yang ditutup (menang + kalah) dalam periode.",
      "Share of opportunities won out of those closed (won + lost) in the period.",
    ],
    area: CRM,
    permission: "crm.read",
    dataset: "crm_leads",
    date: "closed",
    owner: "_userId",
    unit: "percent",
    better: "up",
    filters: [f("state", ["Menang", "Kalah"])],
    measures: [
      formula("v", "DIVIDE([won], [all]) * 100"),
      helper("won", "count", "*", [f("state", ["Menang"])]),
      helper("all", "count", "*"),
    ],
  },
  {
    code: "crm.won_value",
    label: ["Nilai peluang dimenangkan", "Won opportunity value"],
    description: ["Nilai harapan peluang yang dimenangkan.", "Expected revenue of won opportunities."],
    area: CRM,
    permission: "crm.read",
    dataset: "crm_leads",
    date: "closed",
    owner: "_userId",
    unit: "money",
    better: "up",
    measures: [m("v", "sum", "expectedRevenue", [f("state", ["Menang"])])],
  },
  {
    code: "purchase.on_time",
    label: ["PO diterima tepat waktu", "POs received on time"],
    description: [
      "Persentase pesanan pembelian yang seluruh barangnya diterima paling lambat tanggal rencana.",
      "Share of purchase orders fully received by the planned date.",
    ],
    area: PURCHASE,
    permission: "purchase.read",
    dataset: "purchase_orders",
    date: "dateOrder",
    owner: "_userId",
    unit: "percent",
    better: "up",
    filters: [f("receivedOnTime", ["Ya", "Tidak"])],
    measures: [
      formula("v", "DIVIDE([ok], [all]) * 100"),
      helper("ok", "count", "*", [f("receivedOnTime", ["Ya"])]),
      helper("all", "count", "*"),
    ],
  },
  {
    code: "purchase.spend",
    label: ["Nilai pembelian", "Purchase value"],
    description: [
      "Nilai pesanan pembelian dikonfirmasi (sebelum pajak) yang Anda pegang.",
      "Value of confirmed purchase orders (before tax) you own.",
    ],
    area: PURCHASE,
    permission: "purchase.read",
    dataset: "purchase_orders",
    date: "dateOrder",
    owner: "_userId",
    unit: "money",
    better: "neutral",
    measures: [m("v", "sum", "amountUntaxed", [f("state", ["Pesanan"])])],
  },
  {
    code: "finance.invoices_posted",
    label: ["Faktur & tagihan diposting", "Invoices & bills posted"],
    description: [
      "Banyaknya faktur pelanggan & tagihan pemasok yang Anda posting.",
      "Number of customer invoices & vendor bills you posted.",
    ],
    area: FINANCE,
    permission: "accounting.read",
    dataset: "invoices",
    date: "date",
    owner: "_userId",
    unit: "count",
    better: "up",
    measures: [m("v", "count", "*")],
  },
  {
    code: "finance.collected",
    label: ["Faktur lunas", "Invoices paid"],
    description: [
      "Persentase nilai faktur pelanggan yang Anda posting dan sudah dibayar.",
      "Share of the customer invoice value you posted that has been paid.",
    ],
    area: FINANCE,
    permission: "accounting.read",
    dataset: "invoices",
    date: "date",
    owner: "_userId",
    unit: "percent",
    better: "up",
    filters: [f("moveType", ["Faktur pelanggan"])],
    measures: [
      formula("v", "DIVIDE([total] - [open], [total]) * 100"),
      helper("total", "sum", "amountTotal"),
      helper("open", "sum", "amountResidual"),
    ],
  },
  {
    code: "mfg.done",
    label: ["Order produksi selesai", "Production orders done"],
    description: ["Banyaknya order produksi yang selesai.", "Number of completed production orders."],
    area: MFG,
    permission: "mrp.read",
    dataset: "production_orders",
    date: "datePlanned",
    owner: "_userId",
    unit: "count",
    better: "up",
    measures: [m("v", "count", "*", [f("state", ["Selesai"])])],
  },
  {
    code: "mfg.on_time",
    label: ["Produksi tepat waktu", "Production on time"],
    description: [
      "Persentase order produksi selesai paling lambat tanggal rencananya.",
      "Share of production orders completed by their planned date.",
    ],
    area: MFG,
    permission: "mrp.read",
    dataset: "production_orders",
    date: "datePlanned",
    owner: "_userId",
    unit: "percent",
    better: "up",
    filters: [f("onTime", ["Ya", "Tidak"])],
    measures: [
      formula("v", "DIVIDE([ok], [all]) * 100"),
      helper("ok", "count", "*", [f("onTime", ["Ya"])]),
      helper("all", "count", "*"),
    ],
  },
  {
    code: "maintenance.done",
    label: ["Perawatan diselesaikan", "Maintenance completed"],
    description: [
      "Banyaknya permintaan perawatan yang Anda selesaikan sebagai teknisi.",
      "Number of maintenance requests you completed as technician.",
    ],
    area: MAINT,
    permission: "maintenance.read",
    dataset: "maintenance_requests",
    date: "finished",
    owner: "_userId",
    unit: "count",
    better: "up",
    measures: [m("v", "count", "*", [f("state", ["Selesai"])])],
  },
];

export const KPI_BY_CODE = new Map(KPI_CATALOG.map((k) => [k.code, k]));

// ---- Perhitungan ----

const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);

/** Visual kartu (satu angka) untuk KPI. */
export function kpiVisual(def: KpiDef): BiVisual {
  return {
    id: def.code,
    type: "card",
    title: "",
    dataset: def.dataset,
    reportId: null,
    params: {},
    axis: [],
    legend: null,
    values: def.measures,
    columns: [],
    filters: def.filters ?? [],
    sort: null,
    topN: null,
    options: {},
    layout: { x: 0, y: 0, w: 3, h: 2 },
    ignorePeriod: false,
    crossFilter: false,
  };
}

/** Nilai KPI atas sekumpulan baris (null bila tidak ada data penyusun). */
export function kpiMeasureValue(
  def: KpiDef,
  rows: Record<string, unknown>[],
  columns: ReportColumn[],
): number | null {
  if (!rows.length) return null;
  const r = runVisual(rows, columns, kpiVisual(def));
  if (!r.rowCount) return null;
  const v = r.card?.value ?? null;
  return v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
}

/** Baris dalam rentang tanggal [from, to] menurut kolom tanggal KPI. */
export function kpiRowsIn(def: KpiDef, rows: Record<string, unknown>[], from: string, to: string) {
  return rows.filter((r) => {
    const d = dayOf(r[def.date]);
    return d.length === 10 && d >= from && d <= to;
  });
}

const shiftDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthStart = (iso: string, back = 0) => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 10);
};
const monthEnd = (start: string) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

/** Periode sebelumnya yang sama panjang (mis. bulan ini → bulan lalu bila periode = satu bulan penuh). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const fullMonth = from.endsWith("-01") && to === monthEnd(from);
  if (fullMonth) {
    const start = monthStart(from, 1);
    return { from: start, to: monthEnd(start) };
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
  return { from: shiftDays(from, -days), to: shiftDays(from, -1) };
}

/** Rentang data yang perlu dimuat: periode, periode sebelumnya, dan tren `months` bulan sampai akhir periode. */
export function kpiLoadRange(from: string, to: string, months = 6) {
  const prev = previousPeriod(from, to);
  const trendStart = monthStart(to, months - 1);
  return { from: [prev.from, trendStart].sort()[0]!, to };
}

export interface KpiResult {
  code: string;
  label: [string, string];
  description: [string, string];
  area: [string, string];
  unit: KpiUnit;
  better: KpiBetter;
  value: number | null;
  previous: number | null;
  /** Perubahan vs periode sebelumnya (%), null bila tidak bisa dibandingkan. */
  change: number | null;
  /** Arah perubahan dinilai dari `better`: baik / buruk / netral. */
  trendTone: "good" | "bad" | "neutral";
  trend: { month: string; value: number | null }[];
  /** Pembanding dengan rekan yang punya data di periode yang sama. */
  team: { size: number; average: number | null; rank: number | null };
  rows: number;
}

/**
 * Hitung KPI untuk seorang pemilik: nilai periode, periode sebelumnya, tren bulanan, dan posisi di antara rekan
 * (semua pemilik yang punya data di periode itu).
 */
export function computeKpi(
  def: KpiDef,
  rows: Record<string, unknown>[],
  columns: ReportColumn[],
  opts: { userId: string; from: string; to: string; months?: number },
): KpiResult {
  const mine = rows.filter((r) => r[def.owner] === opts.userId);
  const inPeriod = kpiRowsIn(def, mine, opts.from, opts.to);
  const value = kpiMeasureValue(def, inPeriod, columns);
  const prev = previousPeriod(opts.from, opts.to);
  const previous = kpiMeasureValue(def, kpiRowsIn(def, mine, prev.from, prev.to), columns);
  const change =
    value !== null && previous !== null && previous !== 0
      ? Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10
      : null;
  const trendTone: KpiResult["trendTone"] =
    def.better === "neutral" || change === null || change === 0
      ? "neutral"
      : change > 0 === (def.better === "up")
        ? "good"
        : "bad";
  const months = opts.months ?? 6;
  const trend = Array.from({ length: months }, (_, i) => {
    const start = monthStart(opts.to, months - 1 - i);
    return {
      month: start.slice(0, 7),
      value: kpiMeasureValue(def, kpiRowsIn(def, mine, start, monthEnd(start)), columns),
    };
  });
  // Rekan: semua pemilik dengan data di periode.
  const byOwner = new Map<string, Record<string, unknown>[]>();
  for (const r of kpiRowsIn(def, rows, opts.from, opts.to)) {
    const o = String(r[def.owner] ?? "");
    if (!o) continue;
    const list = byOwner.get(o) ?? [];
    list.push(r);
    byOwner.set(o, list);
  }
  const values = [...byOwner.entries()]
    .map(([owner, list]) => ({ owner, value: kpiMeasureValue(def, list, columns) }))
    .filter((x): x is { owner: string; value: number } => x.value !== null);
  const average = values.length
    ? Math.round((values.reduce((s, x) => s + x.value, 0) / values.length) * 100) / 100
    : null;
  let rank: number | null = null;
  if (value !== null && def.better !== "neutral") {
    const better = values.filter((x) => (def.better === "up" ? x.value > value : x.value < value)).length;
    rank = better + 1;
  }
  return {
    code: def.code,
    label: def.label,
    description: def.description,
    area: def.area,
    unit: def.unit,
    better: def.better,
    value,
    previous,
    change,
    trendTone,
    trend,
    team: { size: values.length, average, rank },
    rows: inPeriod.length,
  };
}
