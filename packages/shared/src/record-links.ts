/**
 * Registri dokumen lintas modul: label, halaman web, dan hak baca (permission + path API) tiap model. Dipakai panel
 * "Dokumen terkait", drilldown laporan, dan tautan notifikasi agar semua modul menunjuk ke halaman yang sama.
 */
export interface RecordModelDef {
  label: [string, string];
  /** Halaman detail (`/x/` + id) atau halaman daftar bila model tidak punya halaman detail. */
  web: string;
  detail: boolean;
  /** Hak baca yang dinilai seperti guard (`allowedFor`) terhadap `apiPath`. */
  permission: string;
  apiPath: string;
}

const def = (
  label: [string, string],
  web: string,
  permission: string,
  apiPath: string,
  detail = true,
): RecordModelDef => ({ label, web, detail, permission, apiPath });

export const RECORD_MODELS = {
  account_move: def(["Jurnal/faktur", "Entry/invoice"], "/accounting/moves/", "accounting.read", "/moves"),
  payment: def(["Pembayaran", "Payment"], "/accounting/payments", "accounting.read", "/payments", false),
  bank_statement: def(
    ["Rekening koran", "Bank statement"],
    "/accounting/bank/",
    "accounting.read",
    "/bank-statements",
  ),
  asset: def(["Aset tetap", "Fixed asset"], "/accounting/assets/", "accounting.read", "/assets"),
  fx_revaluation: def(
    ["Revaluasi kurs", "FX revaluation"],
    "/accounting/fx-revaluation",
    "accounting.read",
    "/accounting/fx-revaluations",
    false,
  ),
  allocation_run: def(
    ["Alokasi biaya", "Cost allocation"],
    "/accounting/allocation",
    "accounting.read",
    "/allocation-runs",
    false,
  ),
  payment_run: def(
    ["Proses pembayaran", "Payment run"],
    "/accounting/payment-runs/",
    "accounting.read",
    "/payment-runs",
  ),
  sale_order: def(["Pesanan penjualan", "Sales order"], "/sales/orders/", "sales.read", "/sale-orders"),
  purchase_order: def(
    ["Pesanan pembelian", "Purchase order"],
    "/purchase/orders/",
    "purchase.read",
    "/purchase-orders",
  ),
  stock_picking: def(
    ["Transfer stok", "Stock transfer"],
    "/inventory/pickings/",
    "inventory.read",
    "/pickings",
  ),
  landed_cost: def(
    ["Biaya pendaratan", "Landed cost"],
    "/inventory/landed-costs/",
    "inventory.read",
    "/landed-costs",
  ),
  production_order: def(
    ["Order produksi", "Manufacturing order"],
    "/manufacturing/orders/",
    "mrp.read",
    "/production-orders",
  ),
  quality_check: def(
    ["Pemeriksaan mutu", "Quality check"],
    "/quality/checks/",
    "quality.read",
    "/quality-checks",
  ),
  maintenance_request: def(
    ["Permintaan perawatan", "Maintenance request"],
    "/maintenance/requests/",
    "maintenance.read",
    "/maintenance-requests",
  ),
  fleet_service: def(
    ["Servis kendaraan", "Vehicle service"],
    "/fleet-services/",
    "fleet.read",
    "/fleet-services",
  ),
  payroll_run: def(["Proses penggajian", "Payroll run"], "/payroll/runs/", "payroll.read", "/payroll-runs"),
  payslip: def(["Slip gaji", "Payslip"], "/payroll/payslips/", "payroll.read", "/payslips"),
  employee_loan: def(
    ["Pinjaman karyawan", "Employee loan"],
    "/payroll/loans",
    "payroll.read",
    "/employee-loans",
    false,
  ),
  severance: def(["Pesangon", "Severance"], "/hr/retirement", "payroll.read", "/employees", false),
  expense_claim: def(["Klaim biaya", "Expense claim"], "/hr/expenses/", "hr.read", "/expense-claims"),
  tax_invoice: def(["Faktur pajak", "Tax invoice"], "/tax/invoices", "tax.read", "/tax-invoices", false),
  input_tax_invoice: def(
    ["Faktur pajak masukan", "Input tax invoice"],
    "/tax/input",
    "tax.read",
    "/input-tax-invoices",
    false,
  ),
  withholding_slip: def(
    ["Bukti potong", "Withholding slip"],
    "/tax/withholding",
    "tax.read",
    "/withholding-slips",
    false,
  ),
  tax_return: def(["Retur pajak", "Tax return"], "/tax/returns", "tax.read", "/tax-returns", false),
  equipment: def(["Peralatan", "Equipment"], "/equipment/", "maintenance.read", "/equipment"),
  fleet_vehicle: def(["Kendaraan", "Vehicle"], "/fleet-vehicles/", "fleet.read", "/fleet-vehicles"),
  fleet_contract: def(
    ["Kontrak kendaraan", "Vehicle contract"],
    "/fleet-contracts/",
    "fleet.read",
    "/fleet-contracts",
  ),
  partner: def(["Kontak", "Contact"], "/partners/", "partner.read", "/partners"),
  product: def(["Produk", "Product"], "/products/", "product.read", "/products"),
  employee: def(["Karyawan", "Employee"], "/employees/", "hr.read", "/employees"),
  crm_lead: def(["Peluang", "Opportunity"], "/crm/leads/", "crm.read", "/leads"),
  support_ticket: def(["Tiket", "Ticket"], "/support/tickets/", "support.read", "/tickets"),
} as const satisfies Record<string, RecordModelDef>;

export type RecordModel = keyof typeof RECORD_MODELS;
export const RECORD_MODEL_KEYS = Object.keys(RECORD_MODELS) as RecordModel[];

export const isRecordModel = (v: unknown): v is RecordModel =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(RECORD_MODELS, v);

/** Halaman web sebuah dokumen; model tanpa halaman detail → halaman daftarnya. */
export function recordHref(model: string, id: string | null | undefined): string | null {
  if (!isRecordModel(model)) return null;
  const m: RecordModelDef = RECORD_MODELS[model];
  if (!m.detail) return m.web;
  return id ? `${m.web}${id}` : null;
}

/** Satu dokumen terkait. */
export interface LinkedRecord {
  model: RecordModel;
  id: string;
  name: string | null;
  date?: string | null;
  amount?: string | null;
  state?: string | null;
  /** Arah relasi: dokumen asal (`upstream`) atau turunan (`downstream`). */
  direction: "upstream" | "downstream";
}

/** Rentang umur piutang/utang (sama dengan laporan umur). */
export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "over90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const agingBucket = (days: number): AgingBucket =>
  days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "over90";
/** Batas hari (inklusif) tiap rentang, untuk filter SQL. */
export const AGING_RANGES: Record<AgingBucket, [number | null, number | null]> = {
  current: [null, 0],
  d1_30: [1, 30],
  d31_60: [31, 60],
  d61_90: [61, 90],
  over90: [91, null],
};
