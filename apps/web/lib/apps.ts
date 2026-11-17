import type { Me } from "./api";
import { L, type Text } from "./i18n";
import { canPath } from "./resources";

/** Satu entri menu: tautan langsung, atau dropdown berisi tautan. */
export interface MenuLink {
  label: Text;
  href: string;
  /** Permission yang dibutuhkan ("" = semua user). */
  permission: string;
  /** Subjudul dropdown (tampilan saja): tautan berurutan dengan subjudul sama dikelompokkan. */
  section?: Text;
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
/** Beri subjudul pada sekelompok tautan di dalam dropdown (hanya pengelompokan tampilan). */
const section = (id: string, en: string, items: MenuLink[]): MenuLink[] =>
  items.map((i) => ({ ...i, section: L(id, en) }));

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
/** Daftar kontak terfilter (bukan daftar semua kontak dengan nama berbeda). */
const CUSTOMERS = link("Pelanggan", "Customers", "/partners?role=customer", "partner.read");
const VENDORS = link("Pemasok", "Vendors", "/partners?role=supplier", "partner.read");
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
        link("Peluang", "Opportunities", "/crm/opportunities", "crm.read"),
        link("Akun", "Accounts", "/crm/accounts", "crm.read"),
        link("Kontak Person", "Contact Persons", "/crm/contacts", "crm.read"),
        link("Aktivitas Saya", "My Activities", "/crm/activities", "crm.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Analisis Pipeline", "Pipeline Analysis", "/crm/reports", "crm.read"),
        link("Corong & Kecepatan", "Funnel & Velocity", "/crm/funnel", "crm.read"),
      ]),
      group("Marketing", "Marketing", [
        link("Kampanye", "Campaigns", "/crm/campaigns", "crm.read"),
        link("Formulir Web", "Web Forms", "/crm/web-forms", "crm.read"),
        link("Skor & Penugasan Lead", "Lead Scoring & Assignment", "/crm/lead-rules", "crm.read"),
      ]),
      group("Forecast", "Forecast", [
        link("Forecast", "Forecast", "/crm/forecast", "crm.read"),
        link("Kuota & Pencapaian", "Quotas & Attainment", "/crm/quotas", "crm.read"),
        link("Wilayah", "Territories", "/crm/territories", "crm.read"),
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
        link("Kontrak Pembelian", "Purchase Contracts", "/purchase/contracts", "purchase.read"),
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
        // Penyesuaian stok cepat ada sebagai tab di halaman yang sama (satu tempat koreksi stok).
        link(
          "Stock Opname & Penyesuaian",
          "Physical Inventory & Adjustments",
          "/inventory/counts",
          "inventory.read",
        ),
        link("Pengadaan Ulang", "Replenishment", "/inventory/replenishment", "inventory.read"),
      ]),
      group("Produk", "Products", [
        PRODUCTS,
        link("Lot / Serial", "Lots / Serial Numbers", "/inventory/lots", "inventory.read"),
        link("Label Barcode", "Barcode Labels", "/inventory/labels", "inventory.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Kartu Stok", "Stock Moves", "/inventory/card", "inventory.read"),
        link("Valuasi Persediaan", "Valuation", "/inventory/valuation", "inventory.read"),
        link("Landed Cost", "Landed Costs", "/inventory/landed-costs", "inventory.read"),
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
    prefixes: [
      "/accounting",
      "/accounts",
      "/journals",
      "/taxes",
      "/currency-rates",
      "/cost-centers",
      "/profit-centers",
    ],
    menu: [
      group("Pelanggan", "Customers", [
        link("Faktur Penjualan", "Invoices", "/accounting/invoices", "accounting.read"),
        link("Pembayaran", "Payments", "/accounting/payments", "accounting.read"),
        link("Penagihan (Dunning)", "Dunning", "/accounting/dunning", "accounting.read"),
        CUSTOMERS,
      ]),
      group("Pemasok", "Vendors", [
        link("Tagihan Pembelian", "Bills", "/accounting/bills", "accounting.read"),
        link("Payment Run", "Payment Runs", "/accounting/payment-runs", "accounting.read"),
        VENDORS,
      ]),
      group("Akuntansi", "Accounting", [
        link("Jurnal Umum", "Journal Entries", "/accounting/entries", "accounting.read"),
        link("Jurnal Berulang", "Recurring Entries", "/accounting/recurring", "accounting.read"),
        link("Mutasi Bank", "Bank Statements", "/accounting/bank", "accounting.read"),
        link("Aset Tetap", "Assets", "/accounting/assets", "accounting.read"),
        link("Revaluasi Kurs", "Currency Revaluation", "/accounting/fx-revaluation", "accounting.read"),
        link("Anggaran", "Budgets", "/accounting/budgets", "accounting.read"),
        link("Alokasi Biaya", "Cost Allocation", "/accounting/allocation", "accounting.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Laporan Keuangan", "Financial Reports", "/accounting/reports", "accounting.read"),
        link("Laporan Controlling", "Controlling Reports", "/accounting/controlling", "accounting.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Pengaturan Akuntansi", "Settings", "/accounting/settings", "accounting.manage"),
        link("Bagan Akun", "Chart of Accounts", "/accounts", "accounting.read"),
        link("Cost Center", "Cost Centers", "/cost-centers", "accounting.read"),
        link("Profit Center", "Profit Centers", "/profit-centers", "accounting.read"),
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
        link("Profil Perusahaan & Pajak", "Company & Tax Profile", "/onboarding", "company.write"),
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
      "/leave-block-dates",
      "/work-locations",
      "/overtimes",
      "/public-holidays",
      "/work-schedules",
      "/shift-assignments",
      "/work-entries",
      "/salary-grades",
      "/expense-categories",
      "/job-openings",
    ],
    menu: [
      group("Karyawan", "Employees", [
        link("Karyawan", "Employees", "/employees", "hr.read"),
        link("Kontrak Kerja", "Contracts", "/hr/contracts", "hr.manage"),
        link("Departemen", "Departments", "/departments", "hr.read"),
        link("Promosi & Mutasi", "Promotions & Transfers", "/hr/movements", "hr.read"),
        link("Surat Peringatan", "Warning Letters", "/hr/warnings", "hr.manage"),
        link("Checklist Onboarding/Offboarding", "Onboarding/Offboarding", "/hr/checklists", "hr.read"),
        link("Perubahan Data", "Data Changes", "/hr/change-requests", "hr.manage"),
      ]),
      group("Kehadiran", "Attendance", [
        link("Absensi", "Attendances", "/hr/attendance", "hr.read"),
        link("Koreksi & Tukar Shift", "Corrections & Shift Changes", "/hr/attendance-requests", "hr.read"),
        link("Mode Kiosk", "Kiosk Mode", "/hr/kiosk", "hr.write"),
        link("Keterlambatan", "Lateness", "/hr/lateness", "hr.read"),
        link("Lembur", "Overtime", "/overtimes", "hr.read"),
        link("Penugasan Shift", "Shift Assignments", "/shift-assignments", "hr.read"),
        link("Hasil Kerja Borongan", "Piece Work", "/work-entries", "hr.read"),
      ]),
      group("Cuti & Klaim", "Time Off & Expenses", [
        link("Pengajuan Cuti", "Time Off Requests", "/hr/leaves", "hr.read"),
        link("Jatah Cuti", "Allocations", "/leave-allocations", "hr.read"),
        link("Saldo Cuti", "Time Off Balances", "/hr/leave-balances", "hr.read"),
        link("Klaim Biaya", "Expenses", "/hr/expenses", "hr.read"),
      ]),
      group("Persetujuan", "Approvals", [
        link("Kotak Persetujuan", "Approval Inbox", "/hr/approvals", "hr.read"),
        link("Permintaan Persetujuan", "Approval Requests", "/hr/approval-requests", "hr.read"),
        link("Delegasi", "Delegations", "/hr/approval-delegations", "hr.read"),
      ]),
      group("Talenta", "Talent", [
        link("Pelamar", "Applicants", "/hr/recruitment", "hr.read"),
        link("Lowongan", "Job Openings", "/job-openings", "hr.read"),
        link("Laporan Rekrutmen & Turnover", "Recruitment & Turnover", "/hr/recruitment-report", "hr.read"),
        link("Penilaian Kinerja", "Appraisals", "/hr/appraisals", "hr.read"),
        link("Sasaran & KRA", "Goals & KRAs", "/hr/goals", "hr.read"),
        link("Pengumuman", "Announcements", "/hr/announcements", "hr.read"),
        link("Pelatihan", "Trainings", "/hr/trainings", "hr.read"),
      ]),
      group("Perencanaan", "Planning", [
        link("Man Power Planning", "Manpower Planning", "/hr/manpower-plans", "hr.read"),
        link("Usulan Penambahan (FPK)", "Hiring Requests", "/hr/hiring-requests", "hr.read"),
        link("Anggaran Tenaga Kerja", "Manpower Budget", "/hr/manpower-budget", "hr.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Pembuat Laporan", "Report Builder", "/bi/reports", "hr.read"),
        link("Dashboard & Analitik SDM", "HR Dashboard & Analytics", "/hr/analytics", "hr.read"),
        link("Struktur Organisasi", "Org Chart", "/hr/org-chart", "hr.read"),
        link("Pengingat", "Reminders", "/hr/reminders", "hr.read"),
        link("Masa Percobaan", "Probations", "/hr/probations", "hr.read"),
        link("Log Akses Data Pribadi", "Personal Data Access Log", "/hr/privacy-log", "hr.manage"),
        link("Siapa yang Cuti", "Who's Off", "/hr/whos-off", "hr.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        ...section("Karyawan", "Employees", [
          link("Jabatan", "Job Positions", "/job-positions", "hr.read"),
          link("Golongan Upah", "Salary Grades", "/salary-grades", "hr.read"),
          link("Struktur & Skala Upah", "Wage Scale", "/hr/wage-scale", "hr.manage"),
          link("Jenis Kontrak", "Contract Types", "/hr/contract-types", "hr.read"),
          link("Template Kontrak", "Contract Templates", "/hr/contract-templates", "hr.read"),
          link("Template Checklist", "Checklist Templates", "/hr/checklist-templates", "hr.read"),
          link("Usia Pensiun", "Retirement Age", "/hr/retirement", "hr.read"),
          link("Lokasi Kerja", "Work Locations", "/work-locations", "hr.read"),
        ]),
        ...section("Manajemen Waktu", "Time Management", [
          link("Jadwal Kerja", "Work Schedules", "/work-schedules", "hr.read"),
          link("Hari Libur", "Holidays", "/hr/holidays", "hr.read"),
          link("Mesin Absensi", "Attendance Devices", "/hr/attendance-devices", "hr.read"),
          link("Jenis Cuti", "Time Off Types", "/leave-types", "hr.read"),
          link("Rencana Akrual Cuti", "Accrual Plans", "/hr/leave-plans", "hr.read"),
          link("Tanggal Blok Cuti", "Blackout Dates", "/leave-block-dates", "hr.read"),
        ]),
        ...section("Perekrutan & Kinerja", "Recruitment & Performance", [
          link("Penawaran & Alasan Tolak", "Offers & Refusal Reasons", "/hr/recruitment-settings", "hr.read"),
          link("Template KPI", "KPI Templates", "/hr/appraisal-templates", "hr.read"),
        ]),
        ...section("Klaim & Persetujuan", "Expenses & Approvals", [
          link("Kategori Klaim", "Expense Categories", "/expense-categories", "hr.read"),
          link("Kategori Persetujuan", "Approval Categories", "/hr/approval-categories", "hr.manage"),
        ]),
        ...section("Data", "Data", [
          link("Impor & Ekspor Data", "Data Import & Export", "/hr/data", "hr.read"),
        ]),
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
      link("Kenaikan Gaji", "Salary Review", "/payroll/compensation", "payroll.read"),
      link("Pembuat Laporan", "Report Builder", "/bi/reports", "payroll.read"),
      group("Konfigurasi", "Configuration", [
        link("Komponen Gaji", "Salary Rules", "/salary-components", "payroll.read"),
        link("Paket Benefit", "Benefit Plans", "/payroll/benefits", "payroll.read"),
        link("Impor & Ekspor Data", "Data Import & Export", "/payroll/data", "payroll.read"),
        link("Pengaturan Payroll", "Settings", "/payroll/settings", "payroll.manage"),
      ]),
    ],
  },
  {
    id: "bi",
    name: L("Laporan & Dashboard", "Reports & Dashboards"),
    home: "/bi",
    prefixes: ["/bi"],
    menu: [
      link("Dashboard", "Dashboards", "/bi", ""),
      link("Pembuat Laporan", "Report Builder", "/bi/reports", ""),
    ],
  },
  {
    id: "manufacturing",
    name: L("Manufaktur", "Manufacturing"),
    home: "/manufacturing/orders",
    prefixes: ["/manufacturing", "/work-centers"],
    menu: [
      group("Operasi", "Operations", [
        link("Order Produksi", "Production Orders", "/manufacturing/orders", "mrp.read"),
        link("Perencanaan (MRP)", "Planning (MRP)", "/manufacturing/mrp", "mrp.read"),
      ]),
      group("Produk", "Products", [
        link("Bill of Materials", "Bills of Materials", "/manufacturing/boms", "mrp.read"),
        PRODUCTS,
      ]),
      group("Laporan", "Reporting", [
        link("Biaya Produksi", "Production Costs", "/manufacturing/reports", "mrp.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Stasiun Kerja", "Work Centers", "/work-centers", "mrp.read"),
      ]),
    ],
  },
  {
    id: "support",
    name: L("Layanan", "Helpdesk"),
    home: "/support/tickets",
    prefixes: ["/support"],
    menu: [
      link("Tiket", "Tickets", "/support/tickets", "support.read"),
      link("Basis Pengetahuan", "Knowledge Base", "/support/articles", "support.read"),
      link("Laporan", "Reporting", "/support/reports", "support.read"),
      link("Pengaturan", "Settings", "/support/settings", "support.read"),
    ],
  },
  {
    id: "maintenance",
    name: L("Maintenance", "Maintenance"),
    home: "/maintenance/requests",
    prefixes: ["/maintenance", "/equipment", "/maintenance-plans", "/maintenance-teams"],
    menu: [
      group("Perawatan", "Maintenance", [
        link("Permintaan", "Requests", "/maintenance/requests", "maintenance.read"),
        link("Peralatan", "Equipment", "/equipment", "maintenance.read"),
        link("Rencana Perawatan", "Maintenance Plans", "/maintenance-plans", "maintenance.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Keandalan & Biaya", "Reliability & Cost", "/maintenance/reports", "maintenance.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Tim Perawatan", "Maintenance Teams", "/maintenance-teams", "maintenance.read"),
        link("Pengaturan", "Settings", "/maintenance/settings", "maintenance.manage"),
      ]),
    ],
  },
  {
    id: "quality",
    name: L("Mutu", "Quality"),
    home: "/quality/checks",
    prefixes: ["/quality"],
    menu: [
      group("Mutu", "Quality", [
        link("Pemeriksaan", "Quality Checks", "/quality/checks", "quality.read"),
        link("Ketidaksesuaian (NCR)", "Non-conformances", "/quality/alerts", "quality.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Mutu Pemasok & Produk", "Supplier & Product Quality", "/quality/reports", "quality.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Titik Kontrol", "Control Points", "/quality/points", "quality.read"),
      ]),
    ],
  },
  {
    id: "fleet",
    name: L("Armada", "Fleet"),
    home: "/fleet-vehicles",
    prefixes: [
      "/fleet",
      "/fleet-vehicles",
      "/fleet-contracts",
      "/fleet-services",
      "/fleet-models",
      "/fleet-manufacturers",
      "/fleet-service-types",
    ],
    menu: [
      group("Armada", "Fleet", [
        link("Kendaraan", "Vehicles", "/fleet-vehicles", "fleet.read"),
        link("Kontrak", "Contracts", "/fleet-contracts", "fleet.read"),
        link("Servis", "Services", "/fleet-services", "fleet.read"),
      ]),
      group("Laporan", "Reporting", [
        link("Biaya & Odometer", "Costs & Odometer", "/fleet/reports", "fleet.read"),
        link("Pengingat Dokumen", "Document Reminders", "/fleet/reminders", "fleet.read"),
      ]),
      group("Konfigurasi", "Configuration", [
        link("Produsen", "Manufacturers", "/fleet-manufacturers", "fleet.read"),
        link("Model Kendaraan", "Vehicle Models", "/fleet-models", "fleet.read"),
        link("Jenis Layanan & Kontrak", "Service & Contract Types", "/fleet-service-types", "fleet.read"),
        link("Pengaturan Armada", "Fleet Settings", "/fleet/settings", "fleet.manage"),
      ]),
    ],
  },
  {
    id: "contacts",
    name: L("Kontak", "Contacts"),
    home: "/partners",
    prefixes: ["/partners"],
    menu: [link("Kontak", "Contacts", "/partners", "partner.read")],
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
      link("Permintaan Saya", "My Requests", "/hr/approval-requests", ""),
      link("Delegasi", "Delegations", "/hr/approval-delegations", ""),
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
      link("Peran & Hak Akses", "Roles & Permissions", "/settings/roles", "user.read"),
      link("Aturan Persetujuan", "Approval Rules", "/settings/approval-rules", "approval.manage"),
      link("Langganan", "Subscription", "/settings/billing", "billing.manage"),
      link("Keamanan", "Security", "/settings/security", ""),
      link("SSO", "Single Sign-On", "/settings/sso", "settings.manage"),
      link("Aplikasi Terhubung", "Connected Apps", "/settings/connected-apps", "integration.manage"),
      link("Field Kustom", "Custom Fields", "/settings/custom-fields", "customization.manage"),
      link("Aturan Otomatis", "Automation Rules", "/settings/automation", "customization.manage"),
    ],
  },
  {
    id: "platform",
    name: L("Admin Platform", "Platform Admin"),
    home: "/platform",
    prefixes: ["/platform"],
    platformOnly: true,
    menu: [link("Tenant, Paket & Tagihan", "Tenants, Plans & Invoices", "/platform", "")],
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
export function allowed(me: Me, permission: string, href = "") {
  const module = planModule(permission);
  return (
    canPath(me.permissions, permission, href.split("?")[0]!) &&
    (!module || me.subscription.modules.includes(module))
  );
}

/** Menu aplikasi yang terlihat untuk user ini (dropdown kosong disembunyikan). */
export function visibleMenu(me: Me, app: App): MenuEntry[] {
  return app.menu
    .map((entry) =>
      "items" in entry
        ? { ...entry, items: entry.items.filter((i) => allowed(me, i.permission, i.href)) }
        : entry,
    )
    .filter((entry) =>
      "items" in entry ? entry.items.length > 0 : allowed(me, entry.permission, entry.href),
    );
}

const links = (app: App) => app.menu.flatMap((e) => ("items" in e ? e.items : [e]));

/** Aplikasi yang bisa dibuka user; halaman awalnya = menu pertama yang diizinkan. */
export function visibleApps(me: Me) {
  return APPS.filter((app) => (!app.platformOnly || me.platformAdmin) && visibleMenu(me, app).length > 0).map(
    (app) => {
      const permitted = links(app).filter((l) => allowed(me, l.permission, l.href));
      const home = permitted.find((l) => l.href === app.home) ?? permitted[0]!;
      return { ...app, home: home.href };
    },
  );
}

/** Tautan menu boleh membawa query (mis. `/partners?role=customer`); yang dicocokkan hanya path-nya. */
const matches = (path: string, href: string) => {
  const prefix = href.split("?")[0]!;
  return path === prefix || path.startsWith(`${prefix}/`);
};

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
