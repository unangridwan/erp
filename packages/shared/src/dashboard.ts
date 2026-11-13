import { z } from "zod";
import { reportConfigSchema, type ReportConfig, type ReportResult } from "./reports.js";

export const WIDGET_TYPES = ["kpi", "bar", "line", "pie", "table"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const WIDGET_TYPE_LABEL: Record<WidgetType, [string, string]> = {
  kpi: ["Angka (KPI)", "Number (KPI)"],
  bar: ["Grafik batang", "Bar chart"],
  line: ["Grafik garis", "Line chart"],
  pie: ["Grafik pai", "Pie chart"],
  table: ["Tabel", "Table"],
};

export const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "last_12_months",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_LABEL: Record<PeriodPreset, [string, string]> = {
  this_month: ["Bulan ini", "This month"],
  last_month: ["Bulan lalu", "Last month"],
  this_quarter: ["Kuartal ini", "This quarter"],
  this_year: ["Tahun ini", "This year"],
  last_12_months: ["12 bulan terakhir", "Last 12 months"],
};

const widgetSource = z.union([
  z.object({ reportId: z.string().uuid() }),
  z.object({ dataset: z.string().trim().min(1).max(60), config: reportConfigSchema }),
]);

export const dashboardWidgetSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1, "Judul widget wajib diisi").max(120),
  type: z.enum(WIDGET_TYPES),
  /** Lebar dalam kolom grid (1–4). */
  width: z.number().int().min(1).max(4).default(2),
  source: widgetSource,
  /** KPI: bandingkan dengan periode sebelumnya yang sama panjang. */
  compare: z.boolean().default(false),
  /** Abaikan periode dashboard (mis. saldo piutang saat ini, stok saat ini). */
  ignorePeriod: z.boolean().default(false),
});
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;

export const dashboardSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  description: z.string().trim().max(500).nullish(),
  visibility: z.enum(["private", "shared"]).default("private"),
  widgets: z.array(dashboardWidgetSchema).max(40).default([]),
});
export type DashboardInput = z.infer<typeof dashboardSchema>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const dashboardRunSchema = z
  .object({
    dashboardId: z.string().uuid().optional(),
    builtin: z.string().max(40).optional(),
    widgets: z.array(dashboardWidgetSchema).max(40).optional(),
    from: z.string().regex(ISO).optional(),
    to: z.string().regex(ISO).optional(),
  })
  .refine((v) => [v.dashboardId, v.builtin, v.widgets].filter(Boolean).length === 1, {
    message: "Kirim salah satu: dashboardId, builtin, atau widgets",
  });

export const dashboardPinsSchema = z.object({ refs: z.array(z.string().min(1).max(80)).max(20) });

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Rentang tanggal (inklusif) untuk preset relatif terhadap `today` (YYYY-MM-DD). */
export function periodRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const t = new Date(`${today}T00:00:00Z`);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (preset) {
    case "this_month":
      return { from: iso(utc(y, m, 1)), to: iso(utc(y, m + 1, 0)) };
    case "last_month":
      return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
    case "this_quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(utc(y, q, 1)), to: iso(utc(y, q + 3, 0)) };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_12_months":
      return { from: iso(utc(y, m - 11, 1)), to: iso(utc(y, m + 1, 0)) };
  }
}

/**
 * Periode pembanding dengan panjang sama tepat sebelum `from`. Rentang satu/beberapa bulan penuh dibandingkan dengan
 * bulan-bulan sebelumnya (bukan hitungan hari) agar Februari vs Januari tetap bulan penuh.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const fullMonths =
    f.getUTCDate() === 1 && utc(t.getUTCFullYear(), t.getUTCMonth() + 1, 0).getTime() === t.getTime();
  if (fullMonths) {
    const months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth() + 1;
    return {
      from: iso(utc(f.getUTCFullYear(), f.getUTCMonth() - months, 1)),
      to: iso(utc(f.getUTCFullYear(), f.getUTCMonth(), 0)),
    };
  }
  const days = Math.round((t.getTime() - f.getTime()) / 864e5) + 1;
  return { from: iso(new Date(f.getTime() - days * 864e5)), to: iso(new Date(f.getTime() - 864e5)) };
}

/** Nilai KPI: kolom angka pertama baris pertama (agregasi tanpa kelompok) — atau jumlah baris. */
export function kpiValue(result: Pick<ReportResult, "columns" | "rows" | "total">): number {
  const numeric = result.columns.find((c) => c.numeric);
  if (!numeric) return result.total;
  if (result.rows.length <= 1) return Number(result.rows[0]?.[numeric.key] ?? 0) || 0;
  return result.rows.reduce((s, r) => s + (Number(r[numeric.key]) || 0), 0);
}

/** Perubahan % terhadap pembanding (null bila pembanding 0). */
export function changePercent(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

// ---- Dashboard bawaan ----

const cfg = (c: Partial<ReportConfig>): ReportConfig => ({
  columns: [],
  filters: {},
  conditions: [],
  groupBy: [],
  aggregates: [],
  sort: null,
  limit: null,
  chart: null,
  ...c,
});
const eqc = (column: string, value: string) => ({ column, op: "eq" as const, value });
const nec = (column: string, value: string) => ({ column, op: "ne" as const, value });
let seq = 0;
const w = (
  title: string,
  type: WidgetType,
  dataset: string,
  config: Partial<ReportConfig>,
  extra: Partial<Pick<DashboardWidget, "width" | "compare" | "ignorePeriod">> = {},
): DashboardWidget => ({
  id: `w${++seq}`,
  title,
  type,
  width: type === "kpi" ? 1 : 2,
  source: { dataset, config: cfg(config) },
  compare: false,
  ignorePeriod: false,
  ...extra,
});
const sumBy = (
  group: string,
  column: string,
  chart?: "bar" | "line" | "pie",
  limit?: number,
  sortGroup = false,
) =>
  cfg({
    groupBy: [group],
    aggregates: [{ column, fn: "sum" }],
    sort: sortGroup ? { column: group, dir: "asc" } : { column: `sum__${column}`, dir: "desc" },
    limit: limit ?? null,
    chart: chart ? { type: chart, x: group, y: `sum__${column}` } : null,
  });

export interface BuiltinDashboard {
  key: string;
  name: [string, string];
  description: [string, string];
  /** Default periode saat dibuka. */
  period: PeriodPreset;
  widgets: DashboardWidget[];
}

const ORDERED = eqc("state", "Pesanan");
const OPEN_LEAD = eqc("state", "Terbuka");

export const BUILTIN_DASHBOARDS: BuiltinDashboard[] = [
  {
    key: "sales",
    name: ["Penjualan & CRM", "Sales & CRM"],
    description: [
      "Omzet, pelanggan & produk teratas, pipeline peluang.",
      "Revenue, top customers & products, pipeline.",
    ],
    period: "this_year",
    widgets: [
      w(
        "Omzet (sebelum pajak)",
        "kpi",
        "sales_orders",
        {
          conditions: [ORDERED],
          aggregates: [{ column: "amountUntaxed", fn: "sum" }],
        },
        { compare: true },
      ),
      w(
        "Jumlah pesanan",
        "kpi",
        "sales_orders",
        { conditions: [ORDERED], aggregates: [{ column: "*", fn: "count" }] },
        {
          compare: true,
        },
      ),
      w(
        "Pipeline terbuka",
        "kpi",
        "crm_leads",
        {
          conditions: [OPEN_LEAD],
          aggregates: [{ column: "expectedRevenue", fn: "sum" }],
        },
        { ignorePeriod: true },
      ),
      w(
        "Pipeline tertimbang",
        "kpi",
        "crm_leads",
        {
          conditions: [OPEN_LEAD],
          aggregates: [{ column: "weighted", fn: "sum" }],
        },
        { ignorePeriod: true },
      ),
      w(
        "Omzet per bulan",
        "bar",
        "sales_orders",
        {
          ...sumBy("month", "amountUntaxed", "bar", undefined, true),
          conditions: [ORDERED],
        },
        { width: 4 },
      ),
      w("10 pelanggan teratas", "bar", "sales_orders", {
        ...sumBy("partner", "amountUntaxed", "bar", 10),
        conditions: [ORDERED],
      }),
      w(
        "Pipeline per tahap",
        "pie",
        "crm_leads",
        { ...sumBy("stage", "expectedRevenue", "pie"), conditions: [OPEN_LEAD] },
        {
          ignorePeriod: true,
        },
      ),
      w(
        "10 produk terlaris",
        "table",
        "sales_lines",
        {
          groupBy: ["product"],
          aggregates: [
            { column: "quantity", fn: "sum" },
            { column: "subtotal", fn: "sum" },
          ],
          sort: { column: "sum__subtotal", dir: "desc" },
          limit: 10,
        },
        { width: 4 },
      ),
    ],
  },
  {
    key: "finance",
    name: ["Keuangan", "Finance"],
    description: [
      "Laba rugi, kas & bank, umur piutang dan utang.",
      "Profit & loss, cash & bank, receivable & payable aging.",
    ],
    period: "this_year",
    widgets: [
      w(
        "Pendapatan",
        "kpi",
        "journal_items",
        {
          conditions: [eqc("plGroup", "Pendapatan")],
          aggregates: [{ column: "plAmount", fn: "sum" }],
        },
        { compare: true },
      ),
      w(
        "Beban",
        "kpi",
        "journal_items",
        {
          conditions: [eqc("plGroup", "Beban")],
          aggregates: [{ column: "plAmount", fn: "sum" }],
        },
        { compare: true },
      ),
      w(
        "Laba bersih",
        "kpi",
        "journal_items",
        {
          conditions: [nec("plGroup", "Neraca")],
          aggregates: [{ column: "plAmount", fn: "sum" }],
        },
        { compare: true },
      ),
      w(
        "Piutang terbuka",
        "kpi",
        "invoices",
        {
          filters: { kind: "customer" },
          aggregates: [{ column: "amountResidual", fn: "sum" }],
        },
        { ignorePeriod: true },
      ),
      w(
        "Laba rugi per bulan",
        "line",
        "journal_items",
        {
          ...sumBy("month", "plAmount", "line", undefined, true),
          conditions: [nec("plGroup", "Neraca")],
        },
        { width: 4 },
      ),
      w(
        "Umur piutang",
        "bar",
        "invoices",
        {
          ...sumBy("aging", "amountResidual", "bar", undefined, true),
          filters: { kind: "customer" },
          conditions: [nec("aging", "Lunas")],
        },
        { ignorePeriod: true },
      ),
      w(
        "Umur utang",
        "bar",
        "invoices",
        {
          ...sumBy("aging", "amountResidual", "bar", undefined, true),
          filters: { kind: "vendor" },
          conditions: [nec("aging", "Lunas")],
        },
        { ignorePeriod: true },
      ),
      w(
        "Saldo kas & bank",
        "table",
        "journal_items",
        {
          groupBy: ["account"],
          conditions: [eqc("accountType", "Kas & bank")],
          aggregates: [{ column: "balance", fn: "sum" }],
          sort: { column: "account", dir: "asc" },
        },
        { ignorePeriod: true },
      ),
      w("Beban terbesar", "table", "journal_items", {
        groupBy: ["account"],
        conditions: [eqc("plGroup", "Beban")],
        aggregates: [{ column: "balance", fn: "sum" }],
        sort: { column: "sum__balance", dir: "desc" },
        limit: 10,
      }),
    ],
  },
  {
    key: "inventory",
    name: ["Persediaan & Pembelian", "Inventory & Purchasing"],
    description: [
      "Nilai stok, stok di bawah minimum, pembelian per pemasok.",
      "Stock value, below-minimum stock, purchases by vendor.",
    ],
    period: "this_year",
    widgets: [
      w(
        "Nilai stok",
        "kpi",
        "stock_quants",
        { aggregates: [{ column: "value", fn: "sum" }] },
        { ignorePeriod: true },
      ),
      w(
        "Lokasi stok di bawah minimum",
        "kpi",
        "stock_quants",
        {
          conditions: [eqc("belowMin", "Ya")],
          aggregates: [{ column: "*", fn: "count" }],
        },
        { ignorePeriod: true },
      ),
      w(
        "Pembelian (sebelum pajak)",
        "kpi",
        "purchase_orders",
        {
          conditions: [ORDERED],
          aggregates: [{ column: "amountUntaxed", fn: "sum" }],
        },
        { compare: true },
      ),
      w(
        "RFQ menunggu persetujuan",
        "kpi",
        "purchase_orders",
        {
          conditions: [eqc("state", "Menunggu persetujuan")],
          aggregates: [{ column: "*", fn: "count" }],
        },
        { ignorePeriod: true },
      ),
      w("Nilai stok per kategori", "pie", "stock_quants", sumBy("category", "value", "pie"), {
        ignorePeriod: true,
      }),
      w("Pembelian per pemasok", "bar", "purchase_orders", {
        ...sumBy("partner", "amountUntaxed", "bar", 10),
        conditions: [ORDERED],
      }),
      w(
        "Stok di bawah minimum",
        "table",
        "stock_quants",
        {
          columns: ["sku", "product", "warehouse", "quantity", "minQty"],
          conditions: [eqc("belowMin", "Ya")],
          sort: { column: "product", dir: "asc" },
          limit: 50,
        },
        { width: 4, ignorePeriod: true },
      ),
    ],
  },
  {
    key: "people",
    name: ["SDM & Produksi", "People & Manufacturing"],
    description: [
      "Karyawan aktif, biaya gaji, order & biaya produksi.",
      "Active employees, payroll cost, manufacturing orders & cost.",
    ],
    period: "this_year",
    widgets: [
      w(
        "Karyawan aktif",
        "kpi",
        "employees",
        {
          filters: { active: "active" },
          aggregates: [{ column: "*", fn: "count" }],
        },
        { ignorePeriod: true },
      ),
      w(
        "Biaya gaji perusahaan",
        "kpi",
        "payslips_history",
        {
          aggregates: [{ column: "employerCost", fn: "sum" }],
        },
        { compare: true },
      ),
      w(
        "Order produksi selesai",
        "kpi",
        "production_orders",
        {
          conditions: [eqc("state", "Selesai")],
          aggregates: [{ column: "*", fn: "count" }],
        },
        { compare: true },
      ),
      w(
        "Biaya produksi",
        "kpi",
        "production_orders",
        {
          conditions: [eqc("state", "Selesai")],
          aggregates: [{ column: "totalCost", fn: "sum" }],
        },
        { compare: true },
      ),
      w(
        "Karyawan per departemen",
        "bar",
        "employees",
        {
          filters: { active: "active" },
          groupBy: ["department"],
          aggregates: [{ column: "*", fn: "count" }],
          sort: { column: "count__*", dir: "desc" },
          chart: { type: "bar", x: "department", y: "count__*" },
        },
        { ignorePeriod: true },
      ),
      w(
        "Biaya gaji per bulan",
        "line",
        "payslips_history",
        sumBy("month", "employerCost", "line", undefined, true),
      ),
      w(
        "Order produksi berjalan",
        "table",
        "production_orders",
        {
          columns: ["name", "product", "state", "datePlanned", "quantity"],
          conditions: [nec("state", "Selesai"), nec("state", "Batal"), nec("state", "Draft")],
          sort: { column: "datePlanned", dir: "asc" },
          limit: 20,
        },
        { ignorePeriod: true },
      ),
      w("Biaya produksi per produk", "bar", "production_orders", {
        ...sumBy("product", "totalCost", "bar", 10),
        conditions: [eqc("state", "Selesai")],
      }),
    ],
  },
];

export const builtinDashboard = (key: string) => BUILTIN_DASHBOARDS.find((d) => d.key === key);
