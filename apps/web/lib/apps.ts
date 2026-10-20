import type { Me } from "./api";
import { L, type Text } from "./i18n";
import { can } from "./resources";

/** Satu entri menu: tautan langsung, atau dropdown berisi tautan. */
export interface MenuLink {
  label: Text;
  href: string;
  /** Permission yang dibutuhkan ("" = semua user). */
  permission: string;
}
export interface MenuGroup {
  label: Text;
  items: MenuLink[];
}
export type MenuEntry = MenuLink | MenuGroup;

/** Aplikasi (modul) seperti di layar beranda Odoo: ikon, warna, dan menu miliknya sendiri. */
export interface App {
  id: string;
  name: Text;
  /** Halaman pertama saat aplikasi dibuka. */
  home: string;
  menu: MenuEntry[];
  /** Awalan URL milik aplikasi ini (dipakai untuk mengenali aplikasi aktif dari URL). */
  prefixes: string[];
  /** Hanya untuk admin platform. */
  platformOnly?: boolean;
}

const link = (id: string, en: string, href: string, permission: string): MenuLink => ({
  label: L(id, en),
  href,
  permission,
});
const group = (id: string, en: string, items: MenuLink[]): MenuGroup => ({ label: L(id, en), items });

const PRODUCTS = link("Produk", "Products", "/products", "product.read");
const CATEGORIES = link("Kategori Produk", "Product Categories", "/product-categories", "product.read");
const ATTRIBUTES = link("Atribut Produk", "Product Attributes", "/product-attributes", "product.read");
const ATTRIBUTE_VALUES = link(
  "Nilai Atribut",
  "Attribute Values",
  "/product-attribute-values",
  "product.read",
);
const UOMS = link("Satuan", "Units of Measure", "/uoms", "uom.read");
const CUSTOMERS = link("Pelanggan", "Customers", "/partners", "partner.read");
const VENDORS = link("Pemasok", "Vendors", "/partners", "partner.read");
const SALES_TEAMS = link("Tim Penjualan", "Sales Teams", "/sales-teams", "crm.read");

export const APPS: App[] = [
  {
    id: "crm",
    name: L("CRM", "CRM"),
    home: "/crm/pipeline",
    prefixes: ["/crm", "/crm-stages", "/lost-reasons", "/sales-teams"],
    menu: [
      group("Penjualan", "Sales", [
        link("Pipeline", "My Pipeline", "/crm/pipeline", "crm.read"),
        link("Lead", "Leads", "/crm/leads", "crm.read"),
        link("Aktivitas Saya", "My Activities", "/crm/activities", "crm.read"),
        CUSTOMERS,
      ]),
      group("Laporan", "Reporting", [
        link("Analisis Pipeline", "Pipeline Analysis", "/crm/reports", "crm.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Tahap Pipeline", "Stages", "/crm-stages", "crm.read"),
        link("Alasan Kalah", "Lost Reasons", "/lost-reasons", "crm.read"),
        SALES_TEAMS,
      ]),
    ],
  },
  {
    id: "sales",
    name: L("Penjualan", "Sales"),
    home: "/sales/quotations",
    prefixes: ["/sales", "/payment-terms", "/commission-plans"],
    menu: [
      group("Pesanan", "Orders", [
        link("Penawaran", "Quotations", "/sales/quotations", "sales.read"),
        link("Pesanan Penjualan", "Orders", "/sales/orders", "sales.read"),
        CUSTOMERS,
      ]),
      link("Perlu Ditagih", "To Invoice", "/sales/to-invoice", "sales.read"),
      group("Produk", "Products", [
        PRODUCTS,
        link("Daftar Harga", "Pricelists", "/sales/pricelists", "sales.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Analisis Penjualan", "Sales Analysis", "/sales/reports", "sales.read"),
        link("Komisi Penjual", "Commissions", "/sales/commissions", "sales.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Termin Pembayaran", "Payment Terms", "/payment-terms", "sales.read"),
        link("Aturan Komisi", "Commission Plans", "/commission-plans", "sales.read"),
        SALES_TEAMS,
        CATEGORIES,
        ATTRIBUTES,
        ATTRIBUTE_VALUES,
        UOMS,
      ]),
    ],
  },
  {
    id: "purchase",
    name: L("Pembelian", "Purchase"),
    home: "/purchase/rfq",
    prefixes: ["/purchase", "/product-suppliers"],
    menu: [
      group("Pesanan", "Orders", [
        link("Permintaan Penawaran", "Requests for Quotation", "/purchase/rfq", "purchase.read"),
        link("Pesanan Pembelian", "Purchase Orders", "/purchase/orders", "purchase.read"),
        VENDORS,
      ]),
      group("Penagihan", "Billing", [
        link("Perlu Ditagihkan", "To Bill", "/purchase/to-bill", "purchase.read"),
        link("Pencocokan 3 Arah", "3-way Matching", "/purchase/matching", "purchase.read"),
      ]),
      group("Produk", "Products", [
        PRODUCTS,
        link("Harga Pemasok", "Vendor Pricelists", "/product-suppliers", "purchase.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Analisis Pembelian", "Purchase Analysis", "/purchase/reports", "purchase.read"),
      ]),
    ],
  },
  {
    id: "inventory",
    name: L("Persediaan", "Inventory"),
    home: "/inventory/overview",
    prefixes: ["/inventory", "/warehouses", "/stock-locations", "/reorder-rules"],
    menu: [
      link("Ringkasan", "Overview", "/inventory/overview", "inventory.read"),
      group("Operasi", "Operations", [
        link("Penerimaan", "Receipts", "/inventory/receipts", "inventory.read"),
        link("Pengiriman", "Deliveries", "/inventory/deliveries", "inventory.read"),
        link("Transfer Internal", "Internal Transfers", "/inventory/internal", "inventory.read"),
        link("Dropship", "Dropship", "/inventory/dropship", "inventory.read"),
        link("Stock Opname", "Physical Inventory", "/inventory/adjustments", "inventory.manage"),
        link("Pengadaan Ulang", "Replenishment", "/inventory/replenishment", "inventory.read"),
      ]),
      group("Produk", "Products", [
        PRODUCTS,
        link("Lot / Serial", "Lots / Serial Numbers", "/inventory/lots", "inventory.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Kartu Stok", "Stock Moves", "/inventory/card", "inventory.read"),
        link("Valuasi Persediaan", "Valuation", "/inventory/valuation", "inventory.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Gudang", "Warehouses", "/warehouses", "inventory.read"),
        link("Lokasi", "Locations", "/stock-locations", "inventory.read"),
        link("Aturan Pemesanan Ulang", "Reordering Rules", "/reorder-rules", "inventory.read"),
        CATEGORIES,
        ATTRIBUTES,
        ATTRIBUTE_VALUES,
        UOMS,
      ]),
    ],
  },
  {
    id: "accounting",
    name: L("Akuntansi", "Accounting"),
    home: "/accounting/invoices",
    prefixes: ["/accounting", "/accounts", "/journals", "/taxes", "/currency-rates"],
    menu: [
      group("Pelanggan", "Customers", [
        link("Faktur Penjualan", "Invoices", "/accounting/invoices", "accounting.read"),
        link("Pembayaran", "Payments", "/accounting/payments", "accounting.read"),
        CUSTOMERS,
      ]),
      group("Pemasok", "Vendors", [
        link("Tagihan Pembelian", "Bills", "/accounting/bills", "accounting.read"),
        VENDORS,
      ]),
      group("Akuntansi", "Accounting", [
        link("Jurnal Umum", "Journal Entries", "/accounting/entries", "accounting.read"),
        link("Mutasi Bank", "Bank Statements", "/accounting/bank", "accounting.read"),
        link("Aset Tetap", "Assets", "/accounting/assets", "accounting.read"),
        link("Revaluasi Kurs", "Currency Revaluation", "/accounting/fx-revaluation", "accounting.read"),
        link("Anggaran", "Budgets", "/accounting/budgets", "accounting.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Laporan Keuangan", "Financial Reports", "/accounting/reports", "accounting.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Pengaturan Akuntansi", "Settings", "/accounting/settings", "accounting.manage"),
        link("Bagan Akun", "Chart of Accounts", "/accounts", "accounting.read"),
        link("Jurnal", "Journals", "/journals", "accounting.read"),
        link("Pajak", "Taxes", "/taxes", "accounting.read"),
        link("Kurs Harian", "Currency Rates", "/currency-rates", "currency.read"),
        link("Sumber Kurs Otomatis", "Automatic Rates", "/accounting/fx-sources", "currency.read"),
      ]),
    ],
  },
  {
    id: "tax",
    name: L("Pajak", "Tax"),
    home: "/tax/invoices",
    prefixes: ["/tax"],
    menu: [
      link("Faktur Keluaran", "Output Invoices", "/tax/invoices", "tax.read"),
      link("Faktur Masukan", "Input Invoices", "/tax/input", "tax.read"),
      link("Nota Retur", "Returns", "/tax/returns", "tax.read"),
      link("Bukti Potong", "Withholding", "/tax/withholding", "tax.read"),
      group("Laporan", "Reporting", [link("Rekap PPN", "VAT Summary", "/tax/vat", "tax.read")]),
      group("Konfigurasi", "Configuration", [
        link("Pajak", "Taxes", "/taxes", "accounting.read"),
        link("Profil pajak perusahaan", "Company tax profile", "/onboarding", "company.write"),
        link("NSFP e-Faktur lama", "Legacy e-Faktur serials", "/tax/nsfp", "tax.read"),
      ]),
    ],
  },
  {
    id: "employees",
    name: L("Karyawan", "Employees"),
    home: "/employees",
    prefixes: [
      "/hr",
      "/employees",
      "/departments",
      "/job-positions",
      "/leave-allocations",
      "/leave-types",
      "/overtimes",
      "/public-holidays",
      "/work-schedules",
      "/shift-assignments",
      "/work-entries",
      "/salary-grades",
      "/expense-categories",
    ],
    menu: [
      group("Karyawan", "Employees", [
        link("Karyawan", "Employees", "/employees", "hr.read"),
        link("Kontrak Kerja", "Contracts", "/hr/contracts", "hr.manage"),
        link("Departemen", "Departments", "/departments", "hr.read"),
      ]),
      group("Kehadiran", "Attendance", [
        link("Absensi", "Attendances", "/hr/attendance", "hr.read"),
        link("Keterlambatan", "Lateness", "/hr/lateness", "hr.read"),
        link("Penugasan Shift", "Shift Assignments", "/shift-assignments", "hr.read"),
        link("Hasil Kerja Borongan", "Piece Work", "/work-entries", "hr.read"),
      ]),
      group("Cuti", "Time Off", [
        link("Pengajuan Cuti", "Requests", "/hr/leaves", "hr.read"),
        link("Jatah Cuti", "Allocations", "/leave-allocations", "hr.read"),
      ]),
      link("Lembur", "Overtime", "/overtimes", "hr.read"),
      link("Klaim Biaya", "Expenses", "/hr/expenses", "hr.read"),
      link("Persetujuan", "Approvals", "/hr/approvals", "hr.read"),
      link("Perubahan Data", "Data Changes", "/hr/change-requests", "hr.manage"),
      group("Konfigurasi", "Configuration", [
        link("Jadwal Kerja", "Work Schedules", "/work-schedules", "hr.read"),
        link("Jabatan", "Job Positions", "/job-positions", "hr.read"),
        link("Golongan Upah", "Salary Grades", "/salary-grades", "hr.read"),
        link("Struktur & Skala Upah", "Wage Scale", "/hr/wage-scale", "hr.manage"),
        link("Jenis Cuti", "Time Off Types", "/leave-types", "hr.read"),
        link("Kategori Klaim", "Expense Categories", "/expense-categories", "hr.read"),
        link("Hari Libur", "Public Holidays", "/public-holidays", "hr.read"),
      ]),
    ],
  },
  {
    id: "payroll",
    name: L("Payroll", "Payroll"),
    home: "/payroll/runs",
    prefixes: ["/payroll", "/salary-components"],
    menu: [
      link("Penggajian", "Payslip Batches", "/payroll/runs", "payroll.read"),
      link("Pinjaman Karyawan", "Employee Loans", "/payroll/loans", "payroll.read"),
      link("Biaya Tenaga Kerja", "Labour Cost", "/payroll/cost", "payroll.read"),
      group("Konfigurasi", "Configuration", [
        link("Komponen Gaji", "Salary Rules", "/salary-components", "payroll.read"),
        link("Pengaturan Payroll", "Settings", "/payroll/settings", "payroll.manage"),
      ]),
    ],
  },
  {
    id: "contacts",
    name: L("Kontak", "Contacts"),
    home: "/partners",
    prefixes: ["/partners"],
    menu: [
      link("Kontak", "Contacts", "/partners", "partner.read"),
      group("Konfigurasi", "Configuration", [PRODUCTS, CATEGORIES, UOMS]),
    ],
  },
  {
    id: "group",
    name: L("Struktur Grup", "Group Structure"),
    home: "/companies",
    prefixes: ["/companies", "/ownerships", "/business-units", "/branches"],
    menu: [
      link("Perusahaan", "Companies", "/companies", "company.read"),
      link("Kepemilikan", "Ownership", "/ownerships", "company.read"),
      link("Unit Bisnis", "Business Units", "/business-units", "company.read"),
      link("Cabang", "Branches", "/branches", "company.read"),
    ],
  },
  {
    id: "consolidation",
    name: L("Konsolidasi", "Consolidation"),
    home: "/consolidation/runs",
    prefixes: ["/consolidation", "/group-accounts"],
    menu: [
      link("Proses Konsolidasi", "Consolidation Runs", "/consolidation/runs", "consolidation.read"),
      group("Konfigurasi", "Configuration", [
        link("Bagan Akun Grup", "Group Accounts", "/group-accounts", "consolidation.read"),
        link("Pemetaan Akun", "Account Mapping", "/consolidation/mapping", "consolidation.read"),
        link("Kepemilikan", "Ownership", "/ownerships", "company.read"),
        link("Perusahaan", "Companies", "/companies", "company.read"),
      ]),
    ],
  },
  {
    id: "me",
    name: L("Portal Saya", "My Portal"),
    home: "/me",
    prefixes: ["/me"],
    menu: [
      link("Portal Saya", "My Portal", "/me", ""),
      link("Persetujuan", "Approvals", "/hr/approvals", ""),
    ],
  },
  {
    id: "settings",
    name: L("Pengaturan", "Settings"),
    home: "/settings/users",
    prefixes: ["/settings", "/onboarding"],
    menu: [
      link("Panduan Awal", "Getting Started", "/onboarding", "company.write"),
      link("Pengguna", "Users", "/settings/users", "user.read"),
      link("Langganan", "Subscription", "/settings/billing", "billing.manage"),
      link("Keamanan", "Security", "/settings/security", ""),
      link("SSO", "Single Sign-On", "/settings/sso", "settings.manage"),
    ],
  },
  {
    id: "platform",
    name: L("Admin Platform", "Platform Admin"),
    home: "/platform",
    prefixes: ["/platform"],
    platformOnly: true,
    menu: [link("Tenant & Tagihan", "Tenants & Invoices", "/platform", "")],
  },
];

/** Modul paket langganan dari permission (mis. "hr.read" → "hr"); null = fitur inti. */
const PLAN_MODULES = new Set([
  "accounting",
  "crm",
  "sales",
  "purchase",
  "inventory",
  "tax",
  "hr",
  "payroll",
  "consolidation",
]);
function planModule(permission: string) {
  const prefix = permission.split(".")[0] ?? "";
  return PLAN_MODULES.has(prefix) ? prefix : null;
}

/** Menu boleh tampil: user punya permission dan modulnya termasuk paket langganan. */
export function allowed(me: Me, permission: string) {
  const module = planModule(permission);
  return can(me.permissions, permission) && (!module || me.subscription.modules.includes(module));
}

/** Menu aplikasi yang terlihat untuk user ini (dropdown kosong disembunyikan). */
export function visibleMenu(me: Me, app: App): MenuEntry[] {
  return app.menu
    .map((entry) =>
      "items" in entry ? { ...entry, items: entry.items.filter((i) => allowed(me, i.permission)) } : entry,
    )
    .filter((entry) => ("items" in entry ? entry.items.length > 0 : allowed(me, entry.permission)));
}

const links = (app: App) => app.menu.flatMap((e) => ("items" in e ? e.items : [e]));

/** Aplikasi yang bisa dibuka user; halaman awalnya = menu pertama yang diizinkan. */
export function visibleApps(me: Me) {
  return APPS.filter((app) => (!app.platformOnly || me.platformAdmin) && visibleMenu(me, app).length > 0).map(
    (app) => {
      const permitted = links(app).filter((l) => allowed(me, l.permission));
      const home = permitted.find((l) => l.href === app.home) ?? permitted[0]!;
      return { ...app, home: home.href };
    },
  );
}

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Aplikasi aktif dari URL. Halaman bersama (mis. /products dipakai Penjualan, Pembelian, Persediaan)
 * mengikuti aplikasi yang terakhir dibuka bila cocok.
 */
export function appForPath(apps: App[], pathname: string, preferred: string | null): App | null {
  const owners = apps.filter((a) => a.prefixes.some((p) => matches(pathname, p)));
  const sharers = apps.filter((a) => links(a).some((l) => matches(pathname, l.href)));
  const candidates = [...owners, ...sharers.filter((a) => !owners.includes(a))];
  return candidates.find((a) => a.id === preferred) ?? candidates[0] ?? null;
}

const APP_KEY = "erp.app";

/** Aplikasi terakhir yang dibuka (per tab) — penentu aplikasi untuk halaman bersama. */
export function rememberedApp(): string | null {
  try {
    return sessionStorage.getItem(APP_KEY);
  } catch {
    return null;
  }
}

export function rememberApp(id: string) {
  try {
    sessionStorage.setItem(APP_KEY, id);
  } catch {
    // sessionStorage tidak tersedia (mode privat); aplikasi aktif ditebak dari URL saja.
  }
}
