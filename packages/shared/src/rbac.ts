/**
 * RBAC: katalog modul → fitur → aksi, perhitungan hak efektif (peran per perusahaan + tambah/cabut per akun), pengecekan
 * akses per path, dan aturan delegasi admin.
 *
 * Kode hak:
 * - Modul: `modul.aksi` (permission lama, mis. `accounting.read`, `hr.manage`) + `modul.export` / `modul.delete`.
 * - Fitur: `modul.fitur.aksi` (mis. `hr.recruitment.write`, `accounting.payments.export`).
 * - Khusus: kode yang bukan aksi standar (mis. `sales.all`, `purchase.approve`, `accounting.post`), diberikan apa adanya.
 * Hak modul menurunkan semua fitur di dalamnya; cabut (deny) pada fitur hanya menutup fitur itu.
 */
import { ALL_PERMISSIONS, PERMISSIONS } from "./permissions.js";

export const ACCESS_LEVELS = ["read", "export", "write", "delete", "manage"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
const isLevel = (x: string): x is AccessLevel => (ACCESS_LEVELS as readonly string[]).includes(x);

/** Aksi yang menjadi syarat aksi lain (ekspor & ubah butuh lihat; hapus & kelola butuh ubah). */
const REQUIRES: Record<AccessLevel, AccessLevel | null> = {
  read: null,
  export: "read",
  write: "read",
  delete: "write",
  manage: "write",
};

/** Aksi yang ikut diberikan: memberi lihat = lihat + ekspor; memberi ubah = + hapus; kelola = semua. */
export function grantedLevels(level: AccessLevel): AccessLevel[] {
  const out = new Set<AccessLevel>();
  for (let l: AccessLevel | null = level; l; l = REQUIRES[l]) out.add(l);
  if (out.has("read")) out.add("export");
  if (out.has("write")) out.add("delete");
  return ACCESS_LEVELS.filter((l) => out.has(l));
}

/** Aksi yang ikut tertutup bila sebuah aksi dicabut (semua aksi yang bergantung padanya). */
export function deniedLevels(level: AccessLevel): AccessLevel[] {
  const depends = (l: AccessLevel): boolean => {
    for (let x: AccessLevel | null = l; x; x = REQUIRES[x]) if (x === level) return true;
    return false;
  };
  return ACCESS_LEVELS.filter(depends);
}

type Text2 = readonly [id: string, en: string];

export interface FeatureDef {
  key: string;
  label: Text2;
  /** Awalan path API (`/moves`) & halaman web (`/accounting/entries`) milik fitur ini. */
  api: readonly string[];
  web: readonly string[];
}

export interface ModuleDef {
  key: string;
  label: Text2;
  features: readonly FeatureDef[];
  /** Hak khusus modul (di luar aksi standar). */
  specials: readonly { code: string; label: Text2 }[];
}

const f = (key: string, id: string, en: string, api: string[], web: string[] = api): FeatureDef => ({
  key,
  label: [id, en],
  api,
  web,
});

export const PERMISSION_CATALOG: readonly ModuleDef[] = [
  {
    key: "accounting",
    label: ["Akuntansi", "Accounting"],
    features: [
      f(
        "moves",
        "Jurnal, faktur & tagihan",
        "Entries, invoices & bills",
        ["/moves", "/journals"],
        ["/accounting/entries", "/accounting/invoices", "/accounting/bills", "/journals"],
      ),
      f("payments", "Pembayaran", "Payments", ["/payments"], ["/accounting/payments"]),
      f(
        "bank",
        "Bank & rekonsiliasi",
        "Bank & reconciliation",
        ["/bank-statements", "/bank-statement-lines", "/reconcile"],
        ["/accounting/bank"],
      ),
      f("assets", "Aset tetap", "Fixed assets", ["/assets"], ["/accounting/assets"]),
      f("budgets", "Anggaran", "Budgets", ["/budgets"], ["/accounting/budgets"]),
      f("reports", "Laporan keuangan", "Financial reports", ["/reports"], ["/accounting/reports"]),
      f("chart", "Bagan akun & pajak", "Chart of accounts & taxes", ["/accounts", "/taxes"]),
      f(
        "settings",
        "Pengaturan, tutup buku & revaluasi",
        "Settings, closing & revaluation",
        ["/accounting"],
        ["/accounting/settings", "/accounting/fx-revaluation"],
      ),
    ],
    specials: [{ code: "accounting.post", label: ["Posting jurnal & dokumen", "Post entries & documents"] }],
  },
  {
    key: "tax",
    label: ["Pajak", "Tax"],
    features: [
      f(
        "invoices",
        "Faktur keluaran",
        "Output tax invoices",
        ["/tax-invoices"],
        ["/tax/invoices", "/tax/nsfp"],
      ),
      f("input", "Faktur masukan", "Input tax invoices", ["/input-tax-invoices"], ["/tax/input"]),
      f("withholding", "Bukti potong", "Withholding slips", ["/withholding-slips"], ["/tax/withholding"]),
      f("returns", "Nota retur", "Tax returns notes", ["/tax-returns"], ["/tax/returns"]),
      f("vat", "Rekap PPN", "VAT recap", ["/tax"], ["/tax/vat"]),
    ],
    specials: [],
  },
  {
    key: "crm",
    label: ["CRM", "CRM"],
    features: [
      f(
        "leads",
        "Lead & pipeline",
        "Leads & pipeline",
        ["/leads"],
        ["/crm/leads", "/crm/pipeline", "/crm/reports"],
      ),
      f("activities", "Aktivitas", "Activities", ["/activities"], ["/crm/activities"]),
      f("config", "Konfigurasi CRM", "CRM configuration", ["/crm-stages", "/lost-reasons", "/sales-teams"]),
    ],
    specials: [{ code: "crm.all", label: ["Lihat lead semua salesperson", "See all salespeople's leads"] }],
  },
  {
    key: "sales",
    label: ["Penjualan", "Sales"],
    features: [
      f(
        "orders",
        "Penawaran & pesanan",
        "Quotations & orders",
        ["/sale-orders", "/sales"],
        ["/sales/orders", "/sales/quotations", "/sales/to-invoice", "/sales/reports"],
      ),
      f("pricelists", "Daftar harga", "Pricelists", ["/pricelists"], ["/sales/pricelists"]),
      f("commissions", "Komisi", "Commissions", ["/sales/commissions", "/commission-plans"]),
      f("config", "Termin pembayaran", "Payment terms", ["/payment-terms"]),
    ],
    specials: [
      { code: "sales.all", label: ["Lihat penjualan semua salesperson", "See all salespeople's sales"] },
    ],
  },
  {
    key: "purchase",
    label: ["Pembelian", "Purchase"],
    features: [
      f(
        "orders",
        "RFQ & pesanan pembelian",
        "RFQs & purchase orders",
        ["/purchase-orders"],
        ["/purchase/orders", "/purchase/rfq", "/purchase/to-bill", "/purchase/matching", "/purchase/reports"],
      ),
      f("suppliers", "Harga pemasok", "Vendor prices", ["/product-suppliers"]),
    ],
    specials: [{ code: "purchase.approve", label: ["Setujui PO di atas batas", "Approve POs above limit"] }],
  },
  {
    key: "inventory",
    label: ["Persediaan", "Inventory"],
    features: [
      f(
        "transfers",
        "Penerimaan, pengiriman & transfer",
        "Receipts, deliveries & transfers",
        ["/pickings"],
        ["/inventory/receipts", "/inventory/deliveries", "/inventory/internal", "/inventory/dropship"],
      ),
      f(
        "stock",
        "Stok, valuasi & stock opname",
        "Stock, valuation & counts",
        ["/stock"],
        [
          "/inventory/overview",
          "/inventory/card",
          "/inventory/lots",
          "/inventory/valuation",
          "/inventory/adjustments",
        ],
      ),
      f(
        "replenishment",
        "Pengadaan ulang",
        "Replenishment",
        ["/replenishment", "/reorder-rules"],
        ["/inventory/replenishment", "/reorder-rules"],
      ),
      f("config", "Gudang & lokasi", "Warehouses & locations", ["/warehouses", "/stock-locations"]),
    ],
    specials: [],
  },
  {
    key: "hr",
    label: ["Karyawan (SDM)", "Employees (HR)"],
    features: [
      f(
        "employees",
        "Data karyawan, kontrak & mutasi",
        "Employees, contracts & movements",
        [
          "/employees",
          "/contracts",
          "/hr-documents",
          "/employee-movements",
          "/employee-warnings",
          "/employee-change-requests",
          "/employee-notes",
          "/departments",
          "/job-positions",
        ],
        [
          "/employees",
          "/hr/contracts",
          "/hr/movements",
          "/hr/warnings",
          "/hr/change-requests",
          "/hr/org-chart",
          "/hr/dashboard",
          "/departments",
          "/job-positions",
        ],
      ),
      f(
        "attendance",
        "Absensi, jadwal & shift",
        "Attendance, schedules & shifts",
        [
          "/attendance",
          "/attendance-devices",
          "/attendance-requests",
          "/shift-requests",
          "/shift-assignments",
          "/work-schedules",
          "/work-locations",
          "/public-holidays",
          "/work-entries",
        ],
        [
          "/hr/attendance",
          "/hr/attendance-devices",
          "/hr/attendance-requests",
          "/hr/lateness",
          "/hr/kiosk",
          "/shift-assignments",
          "/work-schedules",
          "/work-locations",
          "/public-holidays",
          "/work-entries",
        ],
      ),
      f(
        "leave",
        "Cuti",
        "Time off",
        ["/leaves", "/leave-allocations", "/leave-types", "/leave-block-dates", "/leave-accrual-plans"],
        [
          "/hr/leaves",
          "/hr/leave-balances",
          "/hr/leave-plans",
          "/hr/whos-off",
          "/leave-allocations",
          "/leave-types",
          "/leave-block-dates",
        ],
      ),
      f("overtime", "Lembur", "Overtime", ["/overtimes"]),
      f(
        "expenses",
        "Klaim biaya",
        "Expense claims",
        ["/expense-claims", "/expense-categories"],
        ["/hr/expenses", "/expense-categories"],
      ),
      f(
        "recruitment",
        "Rekrutmen",
        "Recruitment",
        [
          "/job-openings",
          "/applicants",
          "/offer-templates",
          "/job-offers",
          "/refuse-reasons",
          "/recruitment",
        ],
        ["/job-openings", "/hr/recruitment", "/hr/recruitment-report", "/hr/recruitment-settings"],
      ),
      f(
        "performance",
        "Kinerja & pelatihan",
        "Performance & training",
        [
          "/appraisals",
          "/appraisal-cycles",
          "/appraisal-templates",
          "/goals",
          "/feedback-requests",
          "/trainings",
        ],
        ["/hr/appraisals", "/hr/appraisal-templates", "/hr/goals", "/hr/trainings"],
      ),
      f(
        "approvals",
        "Persetujuan",
        "Approvals",
        ["/approval-requests", "/approvals", "/approval-categories", "/approval-delegations"],
        ["/hr/approvals", "/hr/approval-requests", "/hr/approval-categories", "/hr/approval-delegations"],
      ),
      f(
        "checklists",
        "Onboarding/offboarding & pengingat",
        "On/offboarding & reminders",
        ["/hr-checklists", "/hr-checklist-templates", "/hr/reminders"],
        ["/hr/checklists", "/hr/checklist-templates", "/hr/reminders"],
      ),
      f("announcements", "Pengumuman", "Announcements", ["/announcements"], ["/hr/announcements"]),
      f(
        "wages",
        "Golongan & skala upah",
        "Salary grades & wage scale",
        ["/salary-grades", "/hr/wage-scale"],
        ["/salary-grades", "/hr/wage-scale"],
      ),
      f("data", "Impor & ekspor data SDM", "HR data import & export", ["/data-transfer"], ["/hr/data"]),
    ],
    specials: [],
  },
  {
    key: "payroll",
    label: ["Payroll", "Payroll"],
    features: [
      f(
        "runs",
        "Penggajian & slip",
        "Payslip batches & payslips",
        ["/payroll-runs", "/payslips"],
        ["/payroll/runs", "/payroll/cost"],
      ),
      f("loans", "Pinjaman karyawan", "Employee loans", ["/employee-loans"], ["/payroll/loans"]),
      f("components", "Komponen gaji", "Salary rules", ["/salary-components"]),
      f(
        "settings",
        "Pengaturan & data payroll",
        "Payroll settings & data",
        ["/payroll"],
        ["/payroll/settings", "/payroll/data"],
      ),
    ],
    specials: [],
  },
  {
    key: "fleet",
    label: ["Armada", "Fleet"],
    features: [
      f(
        "vehicles",
        "Kendaraan & odometer",
        "Vehicles & odometer",
        ["/fleet-vehicles", "/fleet/vehicles", "/fleet/employees"],
        ["/fleet-vehicles"],
      ),
      f(
        "contracts",
        "Kontrak kendaraan",
        "Vehicle contracts",
        ["/fleet-contracts", "/fleet/contracts"],
        ["/fleet-contracts"],
      ),
      f(
        "services",
        "Servis kendaraan",
        "Vehicle services",
        ["/fleet-services", "/fleet/services"],
        ["/fleet-services"],
      ),
      f("reports", "Laporan & pengingat", "Reports & reminders", ["/fleet/reports", "/fleet/reminders"]),
      f("config", "Konfigurasi armada", "Fleet configuration", [
        "/fleet-manufacturers",
        "/fleet-models",
        "/fleet-service-types",
        "/fleet/settings",
      ]),
    ],
    specials: [],
  },
  {
    key: "consolidation",
    label: ["Konsolidasi", "Consolidation"],
    features: [
      f(
        "runs",
        "Proses konsolidasi & pemetaan",
        "Consolidation runs & mapping",
        ["/consolidation"],
        ["/consolidation/runs", "/consolidation/mapping"],
      ),
      f("accounts", "Bagan akun grup", "Group chart of accounts", ["/group-accounts"]),
    ],
    specials: [],
  },
  { key: "company", label: ["Perusahaan & struktur grup", "Companies & group"], features: [], specials: [] },
  { key: "partner", label: ["Kontak", "Contacts"], features: [], specials: [] },
  { key: "product", label: ["Produk", "Products"], features: [], specials: [] },
  { key: "uom", label: ["Satuan", "Units of measure"], features: [], specials: [] },
  { key: "currency", label: ["Mata uang & kurs", "Currencies & rates"], features: [], specials: [] },
  {
    key: "user",
    label: ["Pengguna & hak akses", "Users & access"],
    features: [],
    specials: [{ code: "role.manage", label: ["Kelola peran", "Manage roles"] }],
  },
  { key: "settings", label: ["Pengaturan sistem", "System settings"], features: [], specials: [] },
  { key: "billing", label: ["Langganan", "Subscription"], features: [], specials: [] },
];

const MODULES = new Map(PERMISSION_CATALOG.map((m) => [m.key, m]));

/** Aksi standar yang tersedia untuk modul (dari daftar permission + ekspor/hapus turunan). */
export function moduleLevels(moduleKey: string): AccessLevel[] {
  const base = new Set(
    (PERMISSIONS as readonly string[])
      .filter((p) => p.startsWith(`${moduleKey}.`))
      .map((p) => p.slice(moduleKey.length + 1))
      .filter(isLevel),
  );
  if (base.has("read")) base.add("export");
  if (base.has("write")) base.add("delete");
  return ACCESS_LEVELS.filter((l) => base.has(l));
}

/** Semua kode hak yang sah (untuk validasi input peran/override). */
export const ALL_PERMISSION_CODES: ReadonlySet<string> = new Set([
  ...PERMISSIONS,
  ...PERMISSION_CATALOG.flatMap((m) => [
    ...moduleLevels(m.key).map((l) => `${m.key}.${l}`),
    ...m.features.flatMap((ft) => moduleLevels(m.key).map((l) => `${m.key}.${ft.key}.${l}`)),
    ...m.specials.map((s) => s.code),
  ]),
]);

interface ParsedCode {
  module: string;
  feature: string | null;
  level: AccessLevel | null;
}

function parse(code: string): ParsedCode {
  const parts = code.split(".");
  const last = parts.at(-1)!;
  if (parts.length === 3 && isLevel(last)) return { module: parts[0]!, feature: parts[1]!, level: last };
  if (parts.length === 2 && isLevel(last)) return { module: parts[0]!, feature: null, level: last };
  return { module: parts[0]!, feature: null, level: null };
}

/** Kode yang ikut diberikan oleh satu kode (modul → semua fitur; aksi → aksi turunannya). */
function expand(code: string): string[] {
  const p = parse(code);
  if (!p.level) return [code];
  const levels = grantedLevels(p.level).filter((l) => moduleLevels(p.module).includes(l));
  if (p.feature) return levels.map((l) => `${p.module}.${p.feature}.${l}`);
  const mod = MODULES.get(p.module);
  return [
    ...levels.map((l) => `${p.module}.${l}`),
    ...(mod?.features ?? []).flatMap((ft) => levels.map((l) => `${p.module}.${ft.key}.${l}`)),
  ];
}

/** Kode yang ikut tertutup oleh satu cabut. */
function denyExpand(code: string): string[] {
  const p = parse(code);
  if (!p.level) return [code];
  const levels = deniedLevels(p.level);
  if (p.feature) return levels.map((l) => `${p.module}.${p.feature}.${l}`);
  const mod = MODULES.get(p.module);
  return [
    ...levels.map((l) => `${p.module}.${l}`),
    ...(mod?.features ?? []).flatMap((ft) => levels.map((l) => `${p.module}.${ft.key}.${l}`)),
  ];
}

export interface AccessGrants {
  /** Peran pengguna; `companyId` null = berlaku di semua perusahaan yang boleh diakses. */
  roles: { permissions: readonly string[]; companyId: string | null }[];
  overrides: { permission: string; effect: "grant" | "deny"; companyId: string | null }[];
}

/**
 * Hak efektif di satu perusahaan: gabungan peran yang berlaku + tambahan per akun, lalu dikurangi cabutan per akun.
 * Admin penuh (`*`) tidak bisa dicabut agar tidak ada yang terkunci dari sistemnya sendiri.
 */
export function effectivePermissions(grants: AccessGrants, companyId: string): string[] {
  const applies = (c: string | null) => c === null || c === companyId;
  const raw = grants.roles.filter((r) => applies(r.companyId)).flatMap((r) => r.permissions);
  if (raw.includes(ALL_PERMISSIONS)) return [ALL_PERMISSIONS];
  const overrides = grants.overrides.filter((o) => applies(o.companyId));
  const out = new Set<string>();
  for (const code of [...raw, ...overrides.filter((o) => o.effect === "grant").map((o) => o.permission)])
    for (const c of expand(code)) out.add(c);
  for (const o of overrides.filter((x) => x.effect === "deny"))
    for (const c of denyExpand(o.permission)) out.delete(c);
  return [...out].sort();
}

/** Fitur pemilik sebuah path (awalan terpanjang) di modul tertentu. */
export function featureForPath(moduleKey: string, path: string, side: "api" | "web" = "api") {
  const mod = MODULES.get(moduleKey);
  let best: { feature: FeatureDef; len: number } | null = null;
  for (const ft of mod?.features ?? [])
    for (const prefix of ft[side])
      if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best.len))
        best = { feature: ft, len: prefix.length };
  return best?.feature ?? null;
}

/**
 * Apakah hak efektif cukup untuk `required` pada path & metode tertentu. Permission modul standar (read/write/manage)
 * diterjemahkan ke fitur pemilik path; DELETE juga butuh aksi hapus, path `/export` juga butuh aksi ekspor. Kode khusus dicek apa
 * adanya.
 */
export function allowedFor(
  perms: readonly string[],
  required: string,
  request: { path: string; method?: string; side?: "api" | "web" },
) {
  if (perms.includes(ALL_PERMISSIONS)) return true;
  const p = parse(required);
  if (!p.level || p.feature) return perms.includes(required);
  const method = (request.method ?? "GET").toUpperCase();
  const path = request.path.split("?")[0]!.replace(/\/+$/, "") || "/";
  const levels = new Set<AccessLevel>([p.level]);
  // DELETE selalu butuh aksi hapus (selain aksi yang diminta endpoint); path /export butuh aksi ekspor.
  if (method === "DELETE" && moduleLevels(p.module).includes("delete")) levels.add("delete");
  if (p.level === "read" && /\/export(\/|$)/.test(path)) levels.add("export");
  const feature = featureForPath(p.module, path, request.side ?? "api");
  const prefix = feature ? `${p.module}.${feature.key}` : p.module;
  return [...levels].every((l) => perms.includes(`${prefix}.${l}`));
}

/** Hak yang hanya boleh diberikan/dicabut oleh admin penuh (`*`). */
export const ADMIN_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([
  ALL_PERMISSIONS,
  "user.write",
  "user.manage",
  "role.manage",
  "settings.manage",
  "billing.manage",
]);

/**
 * Admin terdelegasi (punya `user.write` tapi bukan `*`) hanya boleh memberi/mencabut hak yang ia miliki sendiri di
 * perusahaan tersebut (anti eskalasi); hak tingkat admin hanya oleh admin penuh.
 */
export function canDelegate(granterPerms: readonly string[], code: string) {
  if (granterPerms.includes(ALL_PERMISSIONS)) return true;
  if (ADMIN_ONLY_PERMISSIONS.has(code)) return false;
  const held = new Set(granterPerms);
  return expand(code).every((c) => held.has(c));
}

const readAll = (PERMISSIONS as readonly string[]).filter((p) => p.endsWith(".read"));

/** Templat peran siap pakai. */
export const ROLE_TEMPLATES: readonly {
  code: string;
  name: Text2;
  description: Text2;
  permissions: readonly string[];
}[] = [
  {
    code: "accountant",
    name: ["Akuntan", "Accountant"],
    description: [
      "Akuntansi & pajak penuh, lihat penjualan/pembelian",
      "Full accounting & tax, view sales/purchase",
    ],
    permissions: [
      "accounting.manage",
      "accounting.post",
      "tax.manage",
      "currency.write",
      "partner.write",
      "product.read",
      "sales.read",
      "purchase.read",
      "inventory.read",
      "company.read",
    ],
  },
  {
    code: "cashier",
    name: ["Kasir / Keuangan", "Cashier / Finance"],
    description: ["Pembayaran & rekonsiliasi bank", "Payments & bank reconciliation"],
    permissions: [
      "accounting.read",
      "accounting.payments.write",
      "accounting.bank.write",
      "partner.read",
      "currency.read",
      "company.read",
    ],
  },
  {
    code: "sales",
    name: ["Sales", "Salesperson"],
    description: ["Lead, penawaran & pesanan milik sendiri", "Own leads, quotations & orders"],
    permissions: [
      "crm.write",
      "sales.write",
      "partner.write",
      "product.read",
      "inventory.read",
      "company.read",
    ],
  },
  {
    code: "sales_manager",
    name: ["Manajer Sales", "Sales manager"],
    description: [
      "Semua lead & penjualan tim, konfigurasi CRM/penjualan",
      "All team leads & sales, configuration",
    ],
    permissions: [
      "crm.manage",
      "crm.all",
      "sales.manage",
      "sales.all",
      "partner.write",
      "product.write",
      "inventory.read",
      "company.read",
    ],
  },
  {
    code: "purchasing",
    name: ["Pembelian", "Purchasing"],
    description: ["RFQ & PO, harga pemasok", "RFQs & POs, vendor prices"],
    permissions: ["purchase.write", "partner.write", "product.read", "inventory.read", "company.read"],
  },
  {
    code: "warehouse",
    name: ["Gudang", "Warehouse"],
    description: [
      "Penerimaan, pengiriman, transfer & stock opname",
      "Receipts, deliveries, transfers & counts",
    ],
    permissions: [
      "inventory.manage",
      "product.read",
      "uom.read",
      "purchase.read",
      "sales.read",
      "company.read",
    ],
  },
  {
    code: "hr_staff",
    name: ["Staf SDM", "HR officer"],
    description: ["Data karyawan, absensi, cuti, rekrutmen", "Employees, attendance, time off, recruitment"],
    permissions: ["hr.write", "company.read"],
  },
  {
    code: "hr_manager",
    name: ["Manajer SDM", "HR manager"],
    description: ["SDM penuh termasuk data sensitif & pengaturan", "Full HR incl. sensitive data & settings"],
    permissions: ["hr.manage", "payroll.read", "fleet.read", "company.read"],
  },
  {
    code: "payroll",
    name: ["Payroll", "Payroll officer"],
    description: ["Penggajian, posting & pembayaran gaji", "Payroll runs, posting & payment"],
    permissions: ["payroll.manage", "hr.read", "accounting.read", "company.read"],
  },
  {
    code: "tax_officer",
    name: ["Petugas Pajak", "Tax officer"],
    description: ["Faktur pajak, bukti potong, rekap PPN", "Tax invoices, withholding, VAT recap"],
    permissions: ["tax.manage", "accounting.read", "partner.read", "company.read"],
  },
  {
    code: "fleet_manager",
    name: ["Fleet Manager", "Fleet manager"],
    description: ["Armada penuh", "Full fleet management"],
    permissions: ["fleet.manage", "hr.read", "partner.read", "company.read"],
  },
  {
    code: "auditor",
    name: ["Auditor", "Auditor"],
    description: ["Lihat & ekspor semua modul tanpa mengubah", "View & export all modules, read-only"],
    permissions: readAll,
  },
  {
    code: "employee",
    name: ["Karyawan (portal)", "Employee (portal)"],
    description: ["Hanya portal karyawan", "Employee portal only"],
    permissions: [],
  },
];
