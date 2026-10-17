import { L, type Text } from "./i18n";

/** Definisi tampilan list & form per resource — mirip "view" di Odoo. */
export type Field =
  | { name: string; label: Text; type: "text" | "email" | "number" | "date"; required?: boolean }
  | { name: string; label: Text; type: "boolean" }
  | { name: string; label: Text; type: "select"; options: [string, Text][]; required?: boolean }
  | {
      name: string;
      label: Text;
      type: "ref";
      /** Path API, boleh dengan query string (mis. "regions?level=1"). */
      resource: string;
      display: string;
      valueKey?: string;
      required?: boolean;
    };

export interface Resource {
  path: string;
  model: string;
  title: Text;
  singular: Text;
  permission: string;
  columns: { name: string; label: Text }[];
  fields: Field[];
  group: Text;
  /** Tampilkan tombol impor/ekspor CSV. */
  csv?: boolean;
  /** Permission untuk menulis bila berbeda dari `<permission>.write`. */
  writePermission?: string;
}

const MASTER = L("Master Data", "Master Data");
const GROUP = L("Struktur Grup", "Group Structure");
export const ACCOUNTING = L("Akuntansi", "Accounting");
export const CRM = L("CRM", "CRM");
export const SALES = L("Penjualan", "Sales");

const name = (required = true): Field => ({ name: "name", label: L("Nama", "Name"), type: "text", required });
const code: Field = { name: "code", label: L("Kode", "Code"), type: "text", required: true };
const companyScope: Field = {
  name: "companyId",
  label: L("Khusus perusahaan (kosong = seluruh grup)", "Company only (empty = whole group)"),
  type: "ref",
  resource: "companies",
  display: "name",
};

const ENTITY_TYPES: [string, Text][] = [
  ["holding", L("Holding", "Holding")],
  ["subsidiary", L("Anak perusahaan", "Subsidiary")],
  ["associate", L("Asosiasi", "Associate")],
  ["joint_venture", L("Ventura bersama", "Joint venture")],
  ["other", L("Lainnya", "Other")],
];

export const RESOURCES: Resource[] = [
  {
    path: "partners",
    model: "partner",
    title: L("Kontak", "Contacts"),
    singular: L("Kontak", "Contact"),
    permission: "partner",
    group: MASTER,
    csv: true,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "city", label: L("Kota", "City") },
      { name: "phone", label: L("Telepon", "Phone") },
      { name: "email", label: L("Email", "Email") },
    ],
    fields: [
      name(),
      {
        name: "kind",
        label: L("Jenis", "Type"),
        type: "select",
        options: [
          ["company", L("Perusahaan", "Company")],
          ["person", L("Perorangan", "Individual")],
        ],
      },
      { name: "isCustomer", label: L("Pelanggan", "Customer"), type: "boolean" },
      { name: "isSupplier", label: L("Pemasok", "Supplier"), type: "boolean" },
      { name: "npwp", label: L("NPWP", "Tax ID (NPWP)"), type: "text" },
      { name: "email", label: L("Email", "Email"), type: "email" },
      { name: "phone", label: L("Telepon", "Phone"), type: "text" },
      { name: "street", label: L("Alamat", "Street"), type: "text" },
      { name: "city", label: L("Kota", "City"), type: "text" },
      {
        name: "province",
        label: L("Provinsi", "Province"),
        type: "ref",
        resource: "regions?level=1",
        display: "name",
        valueKey: "name",
      },
      { name: "postalCode", label: L("Kode pos", "Postal code"), type: "text" },
      {
        name: "paymentTermId",
        label: L("Termin pembayaran", "Payment terms"),
        type: "ref",
        resource: "payment-terms",
        display: "name",
      },
      {
        name: "pricelistId",
        label: L("Daftar harga", "Pricelist"),
        type: "ref",
        resource: "pricelists",
        display: "name",
      },
      {
        name: "salespersonId",
        label: L("Penjual", "Salesperson"),
        type: "ref",
        resource: "users/options",
        display: "name",
      },
      companyScope,
    ],
  },
  {
    path: "products",
    model: "product",
    title: L("Produk", "Products"),
    singular: L("Produk", "Product"),
    permission: "product",
    group: MASTER,
    csv: true,
    columns: [
      { name: "sku", label: L("SKU", "SKU") },
      { name: "name", label: L("Nama", "Name") },
      { name: "salePrice", label: L("Harga jual", "Sales price") },
      { name: "cost", label: L("Biaya", "Cost") },
    ],
    fields: [
      { name: "sku", label: L("SKU", "SKU"), type: "text", required: true },
      name(),
      {
        name: "productType",
        label: L("Tipe", "Type"),
        type: "select",
        options: [
          ["storable", L("Barang stok", "Storable")],
          ["consumable", L("Habis pakai", "Consumable")],
          ["service", L("Jasa", "Service")],
        ],
      },
      {
        name: "categoryId",
        label: L("Kategori", "Category"),
        type: "ref",
        resource: "product-categories",
        display: "name",
      },
      {
        name: "uomId",
        label: L("Satuan", "Unit"),
        type: "ref",
        resource: "uoms",
        display: "name",
        required: true,
      },
      { name: "salePrice", label: L("Harga jual", "Sales price"), type: "number" },
      { name: "cost", label: L("Biaya", "Cost"), type: "number" },
      { name: "barcode", label: L("Barcode", "Barcode"), type: "text" },
      companyScope,
    ],
  },
  {
    path: "product-categories",
    model: "product_category",
    title: L("Kategori Produk", "Product Categories"),
    singular: L("Kategori", "Category"),
    permission: "product",
    group: MASTER,
    csv: true,
    columns: [{ name: "name", label: L("Nama", "Name") }],
    fields: [
      name(),
      {
        name: "parentId",
        label: L("Induk", "Parent"),
        type: "ref",
        resource: "product-categories",
        display: "name",
      },
    ],
  },
  {
    path: "uoms",
    model: "uom",
    title: L("Satuan", "Units of Measure"),
    singular: L("Satuan", "Unit"),
    permission: "uom",
    group: MASTER,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "factor", label: L("Faktor", "Factor") },
    ],
    fields: [
      name(),
      {
        name: "categoryId",
        label: L("Kategori", "Category"),
        type: "ref",
        resource: "uom-categories",
        display: "name",
        required: true,
      },
      {
        name: "factor",
        label: L("Faktor terhadap satuan referensi", "Factor to reference unit"),
        type: "number",
        required: true,
      },
      { name: "isReference", label: L("Satuan referensi", "Reference unit"), type: "boolean" },
    ],
  },
  {
    path: "companies",
    model: "company",
    title: L("Perusahaan", "Companies"),
    singular: L("Perusahaan", "Company"),
    permission: "company",
    group: GROUP,
    csv: true,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "entityType", label: L("Jenis", "Type") },
      { name: "currencyCode", label: L("Mata uang", "Currency") },
    ],
    fields: [
      code,
      name(),
      { name: "entityType", label: L("Jenis entitas", "Entity type"), type: "select", options: ENTITY_TYPES },
      { name: "parentId", label: L("Induk", "Parent"), type: "ref", resource: "companies", display: "name" },
      { name: "npwp", label: L("NPWP", "Tax ID (NPWP)"), type: "text" },
      {
        name: "currencyCode",
        label: L("Mata uang", "Currency"),
        type: "ref",
        resource: "currencies",
        display: "code",
        valueKey: "code",
      },
      {
        name: "fiscalYearStartMonth",
        label: L("Awal tahun fiskal (bulan)", "Fiscal year start (month)"),
        type: "number",
      },
    ],
  },
  {
    path: "ownerships",
    model: "ownership",
    title: L("Kepemilikan", "Ownership"),
    singular: L("Kepemilikan", "Ownership"),
    permission: "company",
    group: GROUP,
    columns: [
      { name: "pct", label: L("%", "%") },
      { name: "method", label: L("Metode", "Method") },
      { name: "validFrom", label: L("Berlaku sejak", "Valid from") },
    ],
    fields: [
      {
        name: "parentCompanyId",
        label: L("Pemilik", "Owner"),
        type: "ref",
        resource: "companies",
        display: "name",
        required: true,
      },
      {
        name: "childCompanyId",
        label: L("Dimiliki", "Owned"),
        type: "ref",
        resource: "companies",
        display: "name",
        required: true,
      },
      { name: "pct", label: L("Persentase", "Percentage"), type: "number", required: true },
      {
        name: "method",
        label: L("Metode konsolidasi", "Consolidation method"),
        type: "select",
        required: true,
        options: [
          ["full", L("Penuh", "Full")],
          ["proportional", L("Proporsional", "Proportional")],
          ["equity", L("Ekuitas", "Equity method")],
          ["none", L("Tidak dikonsolidasi", "Not consolidated")],
        ],
      },
      { name: "validFrom", label: L("Berlaku sejak", "Valid from"), type: "date", required: true },
      { name: "validTo", label: L("Berlaku sampai", "Valid to"), type: "date" },
    ],
  },
  {
    path: "business-units",
    model: "business_unit",
    title: L("Unit Bisnis", "Business Units"),
    singular: L("Unit Bisnis", "Business Unit"),
    permission: "company",
    group: GROUP,
    csv: true,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
    ],
    fields: [code, name()],
  },
  {
    path: "branches",
    model: "branch",
    title: L("Cabang", "Branches"),
    singular: L("Cabang", "Branch"),
    permission: "company",
    group: GROUP,
    csv: true,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "nitku", label: L("NITKU", "NITKU") },
    ],
    fields: [
      {
        name: "companyId",
        label: L("Perusahaan", "Company"),
        type: "ref",
        resource: "companies",
        display: "name",
        required: true,
      },
      code,
      name(),
      { name: "nitku", label: L("NITKU", "NITKU"), type: "text" },
    ],
  },
  {
    path: "currency-rates",
    model: "currency_rate",
    title: L("Kurs Harian", "Exchange Rates"),
    singular: L("Kurs", "Rate"),
    permission: "currency",
    group: ACCOUNTING,
    csv: true,
    columns: [
      { name: "currencyCode", label: L("Mata uang", "Currency") },
      { name: "rateDate", label: L("Tanggal", "Date") },
      { name: "rate", label: L("Kurs (IDR)", "Rate (IDR)") },
    ],
    fields: [
      {
        name: "currencyCode",
        label: L("Mata uang", "Currency"),
        type: "ref",
        resource: "currencies",
        display: "code",
        valueKey: "code",
        required: true,
      },
      { name: "rateDate", label: L("Tanggal", "Date"), type: "date", required: true },
      {
        name: "rate",
        label: L("Nilai 1 unit dalam IDR", "Value of 1 unit in IDR"),
        type: "number",
        required: true,
      },
    ],
  },
];

export const findResource = (path: string) => RESOURCES.find((r) => r.path === path);

export const can = (permissions: string[], perm: string) =>
  permissions.includes("*") || permissions.includes(perm);
export const canWrite = (permissions: string[], resource: Resource) =>
  can(permissions, resource.writePermission ?? `${resource.permission}.write`);

const ACCOUNT_TYPES: [string, Text][] = [
  ["asset_receivable", L("Piutang", "Receivable")],
  ["asset_cash", L("Kas & bank", "Bank & cash")],
  ["asset_current", L("Aset lancar", "Current assets")],
  ["asset_non_current", L("Aset tidak lancar", "Non-current assets")],
  ["asset_fixed", L("Aset tetap", "Fixed assets")],
  ["liability_payable", L("Utang usaha", "Payable")],
  ["liability_current", L("Liabilitas jangka pendek", "Current liabilities")],
  ["liability_non_current", L("Liabilitas jangka panjang", "Non-current liabilities")],
  ["equity", L("Ekuitas", "Equity")],
  ["equity_unaffected", L("Laba tahun berjalan", "Current year earnings")],
  ["income", L("Pendapatan", "Income")],
  ["income_other", L("Pendapatan lain-lain", "Other income")],
  ["expense", L("Beban", "Expenses")],
  ["expense_direct_cost", L("Harga pokok penjualan", "Cost of revenue")],
  ["expense_depreciation", L("Penyusutan", "Depreciation")],
  ["expense_other", L("Beban lain-lain", "Other expenses")],
];

RESOURCES.push(
  {
    path: "accounts",
    model: "account",
    title: L("Bagan Akun", "Chart of Accounts"),
    singular: L("Akun", "Account"),
    permission: "accounting",
    writePermission: "accounting.manage",
    group: ACCOUNTING,
    csv: true,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "accountType", label: L("Jenis", "Type") },
    ],
    fields: [
      code,
      name(),
      {
        name: "accountType",
        label: L("Jenis akun", "Account type"),
        type: "select",
        options: ACCOUNT_TYPES,
        required: true,
      },
      {
        name: "reconcile",
        label: L("Dapat direkonsiliasi (piutang/utang)", "Allow reconciliation"),
        type: "boolean",
      },
    ],
  },
  {
    path: "journals",
    model: "journal",
    title: L("Jurnal", "Journals"),
    singular: L("Jurnal", "Journal"),
    permission: "accounting",
    writePermission: "accounting.manage",
    group: ACCOUNTING,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "journalType", label: L("Tipe", "Type") },
    ],
    fields: [
      code,
      name(),
      {
        name: "journalType",
        label: L("Tipe", "Type"),
        type: "select",
        required: true,
        options: [
          ["sale", L("Penjualan", "Sales")],
          ["purchase", L("Pembelian", "Purchase")],
          ["bank", L("Bank", "Bank")],
          ["cash", L("Kas", "Cash")],
          ["general", L("Umum", "Miscellaneous")],
        ],
      },
      {
        name: "defaultAccountId",
        label: L("Akun bawaan", "Default account"),
        type: "ref",
        resource: "accounts",
        display: "name",
      },
    ],
  },
  {
    path: "taxes",
    model: "tax",
    title: L("Pajak", "Taxes"),
    singular: L("Pajak", "Tax"),
    permission: "accounting",
    writePermission: "accounting.manage",
    group: ACCOUNTING,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "typeTaxUse", label: L("Penggunaan", "Usage") },
      { name: "amount", label: L("Tarif %", "Rate %") },
      { name: "baseRatio", label: L("Rasio DPP", "Base ratio") },
    ],
    fields: [
      name(),
      {
        name: "typeTaxUse",
        label: L("Penggunaan", "Usage"),
        type: "select",
        required: true,
        options: [
          ["sale", L("Penjualan", "Sales")],
          ["purchase", L("Pembelian", "Purchase")],
        ],
      },
      {
        name: "amount",
        label: L("Tarif % (negatif = dipotong)", "Rate % (negative = withheld)"),
        type: "number",
        required: true,
      },
      {
        name: "baseRatio",
        label: L("Rasio DPP (mis. 0.9166666667 = 11/12)", "Tax base ratio (e.g. 11/12)"),
        type: "number",
      },
      {
        name: "accountId",
        label: L("Akun pajak", "Tax account"),
        type: "ref",
        resource: "accounts",
        display: "name",
        required: true,
      },
    ],
  },
);

RESOURCES.push(
  {
    path: "crm-stages",
    model: "crm_stage",
    title: L("Tahap Pipeline", "Pipeline Stages"),
    singular: L("Tahap", "Stage"),
    permission: "crm",
    writePermission: "crm.manage",
    group: CRM,
    columns: [
      { name: "sequence", label: L("Urutan", "Sequence") },
      { name: "name", label: L("Nama", "Name") },
      { name: "probability", label: L("Probabilitas %", "Probability %") },
    ],
    fields: [
      name(),
      { name: "sequence", label: L("Urutan", "Sequence"), type: "number" },
      { name: "probability", label: L("Probabilitas %", "Probability %"), type: "number" },
      { name: "isWon", label: L("Tahap menang", "Won stage"), type: "boolean" },
      { name: "fold", label: L("Dilipat di kanban", "Folded in kanban"), type: "boolean" },
    ],
  },
  {
    path: "lost-reasons",
    model: "crm_lost_reason",
    title: L("Alasan Kalah", "Lost Reasons"),
    singular: L("Alasan kalah", "Lost reason"),
    permission: "crm",
    writePermission: "crm.manage",
    group: CRM,
    columns: [{ name: "name", label: L("Nama", "Name") }],
    fields: [name(), { name: "active", label: L("Aktif", "Active"), type: "boolean" }],
  },
  {
    path: "sales-teams",
    model: "sales_team",
    title: L("Tim Penjualan", "Sales Teams"),
    singular: L("Tim penjualan", "Sales team"),
    permission: "crm",
    writePermission: "crm.manage",
    group: CRM,
    columns: [{ name: "name", label: L("Nama", "Name") }],
    fields: [
      name(),
      {
        name: "leaderId",
        label: L("Ketua tim", "Team leader"),
        type: "ref",
        resource: "users/options",
        display: "name",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
      companyScope,
    ],
  },
  {
    path: "payment-terms",
    model: "payment_term",
    title: L("Termin Pembayaran", "Payment Terms"),
    singular: L("Termin pembayaran", "Payment term"),
    permission: "sales",
    writePermission: "sales.manage",
    group: SALES,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "days", label: L("Hari", "Days") },
    ],
    fields: [
      name(),
      { name: "days", label: L("Jatuh tempo (hari)", "Due in (days)"), type: "number", required: true },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
);

/** Halaman modul khusus (bukan CRUD generik) yang tampil di menu samping. */
export interface Page {
  href: string;
  label: Text;
  group: Text;
  permission: string;
}

export const PAGES: Page[] = [
  { href: "/crm/pipeline", label: L("Pipeline", "Pipeline"), group: CRM, permission: "crm.read" },
  { href: "/crm/leads", label: L("Lead", "Leads"), group: CRM, permission: "crm.read" },
  {
    href: "/crm/activities",
    label: L("Aktivitas Saya", "My Activities"),
    group: CRM,
    permission: "crm.read",
  },
  {
    href: "/crm/reports",
    label: L("Analisis Pipeline", "Pipeline Analysis"),
    group: CRM,
    permission: "crm.read",
  },
  {
    href: "/sales/quotations",
    label: L("Penawaran", "Quotations"),
    group: SALES,
    permission: "sales.read",
  },
  {
    href: "/sales/orders",
    label: L("Pesanan Penjualan", "Sales Orders"),
    group: SALES,
    permission: "sales.read",
  },
  {
    href: "/sales/to-invoice",
    label: L("Perlu Ditagih", "To Invoice"),
    group: SALES,
    permission: "sales.read",
  },
  {
    href: "/sales/pricelists",
    label: L("Daftar Harga", "Pricelists"),
    group: SALES,
    permission: "sales.read",
  },
  {
    href: "/sales/reports",
    label: L("Analisis Penjualan", "Sales Analysis"),
    group: SALES,
    permission: "sales.read",
  },
  {
    href: "/accounting/invoices",
    label: L("Faktur Penjualan", "Customer Invoices"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/bills",
    label: L("Tagihan Pembelian", "Vendor Bills"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/entries",
    label: L("Jurnal Umum", "Journal Entries"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/payments",
    label: L("Pembayaran", "Payments"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/reports",
    label: L("Laporan Keuangan", "Financial Reports"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/bank",
    label: L("Mutasi Bank", "Bank Statements"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/assets",
    label: L("Aset Tetap", "Fixed Assets"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/budgets",
    label: L("Anggaran", "Budgets"),
    group: ACCOUNTING,
    permission: "accounting.read",
  },
  {
    href: "/accounting/settings",
    label: L("Pengaturan Akuntansi", "Accounting Settings"),
    group: ACCOUNTING,
    permission: "accounting.manage",
  },
];

/** Jenis dokumen per halaman daftar. */
export const MOVE_KINDS = {
  invoices: {
    types: ["out_invoice", "out_refund"],
    newType: "out_invoice",
    title: L("Faktur Penjualan", "Customer Invoices"),
  },
  bills: {
    types: ["in_invoice", "in_refund"],
    newType: "in_invoice",
    title: L("Tagihan Pembelian", "Vendor Bills"),
  },
  entries: { types: ["entry"], newType: "entry", title: L("Jurnal Umum", "Journal Entries") },
} as const;
export type MoveKind = keyof typeof MOVE_KINDS;

export const MOVE_TYPE_LABEL: Record<string, Text> = {
  entry: L("Jurnal", "Entry"),
  out_invoice: L("Faktur", "Invoice"),
  out_refund: L("Nota kredit", "Credit note"),
  in_invoice: L("Tagihan", "Bill"),
  in_refund: L("Nota debit", "Refund"),
};

export const PAYMENT_STATE_LABEL: Record<string, Text> = {
  not_paid: L("Belum dibayar", "Not paid"),
  partial: L("Dibayar sebagian", "Partially paid"),
  paid: L("Lunas", "Paid"),
  reversed: L("Dibalik", "Reversed"),
};

/** Halaman daftar dokumen penjualan. */
export const ORDER_KINDS = {
  quotations: { state: "draft,sent", invoiceStatus: "", title: L("Penawaran", "Quotations") },
  orders: { state: "sale", invoiceStatus: "", title: L("Pesanan Penjualan", "Sales Orders") },
  "to-invoice": { state: "sale", invoiceStatus: "to_invoice", title: L("Perlu Ditagih", "To Invoice") },
} as const;
export type OrderKind = keyof typeof ORDER_KINDS;

export const ORDER_STATE_LABEL: Record<string, Text> = {
  draft: L("Penawaran", "Quotation"),
  sent: L("Penawaran terkirim", "Quotation sent"),
  sale: L("Pesanan", "Sales order"),
  cancel: L("Batal", "Cancelled"),
};

export const INVOICE_STATUS_LABEL: Record<string, Text> = {
  no: L("Tidak ada", "Nothing to invoice"),
  to_invoice: L("Perlu ditagih", "To invoice"),
  invoiced: L("Sudah ditagih", "Fully invoiced"),
};

export const LEAD_STATE_LABEL: Record<string, Text> = {
  open: L("Terbuka", "Open"),
  won: L("Menang", "Won"),
  lost: L("Kalah", "Lost"),
};

export const LEAD_SOURCES: [string, Text][] = [
  ["website", L("Website", "Website")],
  ["referral", L("Referensi", "Referral")],
  ["event", L("Acara/pameran", "Event")],
  ["ads", L("Iklan", "Advertising")],
  ["social", L("Media sosial", "Social media")],
  ["cold_call", L("Telepon langsung", "Cold call")],
  ["other", L("Lainnya", "Other")],
];

export const ACTIVITY_TYPES: [string, Text][] = [
  ["call", L("Telepon", "Call")],
  ["meeting", L("Rapat", "Meeting")],
  ["email", L("Email", "Email")],
  ["todo", L("To-do", "To-do")],
];
