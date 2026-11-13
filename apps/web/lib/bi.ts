import type { DashboardWidget, PeriodPreset, ReportConfig } from "@erp/shared";

/** Label aplikasi pemilik dataset (pengelompokan pilihan data). */
export const DATASET_APPS: Record<string, [string, string]> = {
  sales: ["Penjualan", "Sales"],
  crm: ["CRM", "CRM"],
  accounting: ["Akuntansi", "Accounting"],
  purchase: ["Pembelian", "Purchase"],
  inventory: ["Persediaan", "Inventory"],
  mrp: ["Manufaktur", "Manufacturing"],
  hr: ["SDM", "Employees"],
  payroll: ["Payroll", "Payroll"],
};

export interface DatasetInfo {
  key: string;
  label: string;
  description: string;
  app: string;
  needsRun: boolean;
  columns: { key: string; header: string; group: string; numeric: boolean }[];
}

export interface WidgetResult {
  id: string;
  hidden?: boolean;
  error?: string;
  dataset?: string;
  columns?: { key: string; header: string; numeric?: boolean }[];
  rows?: Record<string, unknown>[];
  total?: number;
  value?: number;
  previous?: number | null;
  change?: number | null;
  chart?: ReportConfig["chart"];
}

export interface DashboardDoc {
  id?: string;
  key?: string;
  builtin?: boolean;
  name: string | [string, string];
  description?: string | [string, string] | null;
  period?: PeriodPreset;
  visibility?: "private" | "shared";
  mine?: boolean;
  widgets: (DashboardWidget & { hidden?: boolean })[];
}
