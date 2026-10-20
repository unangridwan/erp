import { CORETAX_UOM_CODES, TRX_CODES as CORETAX_TRX_CODES } from "@erp/shared";
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
  /** Data tidak bisa dihapus (cukup dinonaktifkan). */
  noDelete?: boolean;
  /** Tampilan kartu (kanban) — menjadi tampilan bawaan seperti di Odoo. */
  kanban?: { title: string; lines: string[]; tag?: string };
}

const MASTER = L("Master Data", "Master Data");
const GROUP = L("Struktur Grup", "Group Structure");
export const ACCOUNTING = L("Akuntansi", "Accounting");
export const CRM = L("CRM", "CRM");
export const SALES = L("Penjualan", "Sales");
export const INVENTORY = L("Persediaan", "Inventory");
export const PURCHASE = L("Pembelian", "Purchase");
export const HR = L("SDM", "Employees");
export const PAYROLL = L("Payroll", "Payroll");

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

const TAX_DOCUMENTS: [string, Text][] = [
  ["TIN", L("NPWP", "NPWP (TIN)")],
  ["National ID", L("NIK", "National ID (NIK)")],
  ["Passport", L("Paspor", "Passport")],
  ["Other ID", L("Lainnya", "Other")],
];
export const TRX_CODES: [string, Text][] = Object.entries(CORETAX_TRX_CODES).map(([k, v]) => [k, L(v, v)]);
const UOM_CODES: [string, Text][] = Object.entries(CORETAX_UOM_CODES).map(([k, v]) => [
  k,
  L(`${k} ${v}`, `${k} ${v}`),
]);
const TAX_KINDS: [string, Text][] = [
  ["vat", L("PPN (DPP nilai lain)", "VAT (other tax base)")],
  ["vat_luxury", L("PPN barang mewah", "VAT luxury goods")],
  ["ppnbm", L("PPnBM (pajak penjualan barang mewah)", "Luxury goods sales tax (PPnBM)")],
  ["pph23", L("PPh 23", "Income tax art. 23")],
  ["pph4_2", L("PPh 4 ayat 2", "Final income tax 4(2)")],
  ["pph22", L("PPh 22", "Income tax art. 22")],
  ["other", L("Lainnya", "Other")],
];

export const RESOURCES: Resource[] = [
  {
    path: "partners",
    kanban: { title: "name", lines: ["city", "email", "phone"] },
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
        name: "taxDocumentType",
        label: L("Identitas pajak pembeli", "Buyer tax identity"),
        type: "select",
        options: TAX_DOCUMENTS,
      },
      {
        name: "taxDocumentNumber",
        label: L("Nomor NIK/paspor (bila bukan NPWP)", "ID/passport number (if not NPWP)"),
        type: "text",
      },
      {
        name: "tku",
        label: L("Kode tempat usaha (000000 = pusat)", "Branch code (000000 = HQ)"),
        type: "text",
      },
      {
        name: "countryCode",
        label: L("Negara (ISO-3, mis. IDN)", "Country (ISO-3, e.g. IDN)"),
        type: "text",
      },
      {
        name: "taxTrxCode",
        label: L("Kode transaksi faktur", "Tax invoice code"),
        type: "select",
        options: TRX_CODES,
      },
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
    kanban: { title: "name", lines: ["sku", "salePrice"], tag: "productType" },
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
      {
        name: "saleUomId",
        label: L("Satuan jual (bawaan; sekategori)", "Sales unit (default; same category)"),
        type: "ref",
        resource: "uoms",
        display: "name",
      },
      {
        name: "purchaseUomId",
        label: L("Satuan beli (bawaan; sekategori)", "Purchase unit (default; same category)"),
        type: "ref",
        resource: "uoms",
        display: "name",
      },
      {
        name: "dropship",
        label: L(
          "Dropship: dikirim pemasok langsung ke pelanggan",
          "Dropship: vendor ships directly to customer",
        ),
        type: "boolean",
      },
      {
        name: "salePrice",
        label: L("Harga jual (per satuan produk)", "Sales price (per product unit)"),
        type: "number",
      },
      { name: "cost", label: L("Biaya", "Cost"), type: "number" },
      { name: "barcode", label: L("Barcode", "Barcode"), type: "text" },
      {
        name: "taxGoodsCode",
        label: L("Kode barang/jasa Coretax (6 digit)", "Coretax goods/service code (6 digits)"),
        type: "text",
      },
      {
        name: "luxuryTaxRate",
        label: L(
          "Tarif PPnBM % (barang mewah; kosong = tidak kena)",
          "PPnBM rate % (luxury goods; empty = none)",
        ),
        type: "number",
      },
      {
        name: "tracking",
        label: L("Pelacakan", "Tracking"),
        type: "select",
        options: [
          ["none", L("Tanpa lot/serial", "No tracking")],
          ["lot", L("Per lot", "By lot")],
          ["serial", L("Per nomor serial", "By serial number")],
        ],
      },
      {
        name: "costMethod",
        label: L("Metode biaya", "Costing method"),
        type: "select",
        options: [
          ["average", L("Rata-rata tertimbang", "Average cost")],
          ["fifo", L("FIFO", "FIFO")],
        ],
      },
      companyScope,
    ],
  },
  {
    path: "product-attributes",
    model: "product_attribute",
    title: L("Atribut Produk", "Product Attributes"),
    singular: L("Atribut", "Attribute"),
    permission: "product",
    group: MASTER,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "sequence", label: L("Urutan", "Sequence") },
    ],
    fields: [
      name(),
      {
        name: "sequence",
        label: L("Urutan (posisi di nama/SKU varian)", "Sequence (position in variant name/SKU)"),
        type: "number",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "product-attribute-values",
    model: "product_attribute_value",
    title: L("Nilai Atribut", "Attribute Values"),
    singular: L("Nilai atribut", "Attribute value"),
    permission: "product",
    group: MASTER,
    columns: [
      { name: "name", label: L("Nilai", "Value") },
      { name: "code", label: L("Kode", "Code") },
      { name: "priceExtra", label: L("Tambahan harga", "Price extra") },
    ],
    fields: [
      {
        name: "attributeId",
        label: L("Atribut", "Attribute"),
        type: "ref",
        resource: "product-attributes",
        display: "name",
        required: true,
      },
      name(),
      { name: "code", label: L("Kode SKU (mis. M, MRH)", "SKU code (e.g. M, RED)"), type: "text" },
      { name: "priceExtra", label: L("Tambahan harga jual", "Sales price extra"), type: "number" },
      { name: "sequence", label: L("Urutan", "Sequence"), type: "number" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
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
      {
        name: "coretaxCode",
        label: L("Kode satuan Coretax", "Coretax unit code"),
        type: "select",
        options: UOM_CODES,
      },
    ],
  },
  {
    path: "companies",
    kanban: { title: "name", lines: ["code", "npwp", "city"], tag: "entityType" },
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
      { name: "pkp", label: L("Pengusaha Kena Pajak (PKP)", "VAT-registered (PKP)"), type: "boolean" },
      { name: "nitku", label: L("ID TKU (22 digit)", "Branch tax ID (22 digits)"), type: "text" },
      { name: "street", label: L("Alamat", "Street"), type: "text" },
      { name: "city", label: L("Kota", "City"), type: "text" },
      { name: "province", label: L("Provinsi", "Province"), type: "text" },
      { name: "postalCode", label: L("Kode pos", "Postal code"), type: "text" },
      { name: "phone", label: L("Telepon", "Phone"), type: "text" },
      { name: "email", label: L("Email", "Email"), type: "email" },
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
      {
        name: "icAutoDocuments",
        label: L(
          "Dokumen antar perusahaan otomatis (SO → RFQ, PO → penawaran, faktur → tagihan)",
          "Automatic intercompany documents (SO → RFQ, PO → quotation, invoice → bill)",
        ),
        type: "boolean",
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
      {
        name: "consideration",
        label: L(
          "Harga perolehan (atau hasil penjualan bila % turun), mata uang grup",
          "Cost paid (or proceeds if % decreases), group currency",
        ),
        type: "number",
      },
      {
        name: "acquiredNetAssets",
        label: L(
          "Nilai wajar aset bersih entitas anak pada tanggal ini (kosong = nilai buku)",
          "Fair value of subsidiary net assets at this date (empty = book value)",
        ),
        type: "number",
      },
      {
        name: "previousInterestFairValue",
        label: L(
          "Akuisisi bertahap: nilai wajar kepemilikan sebelumnya saat pengendalian diperoleh (diukur ulang, PSAK 22)",
          "Step acquisition: fair value of the previously held interest when control is obtained (remeasured)",
        ),
        type: "number",
      },
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

/** Permission kosong = cukup login (mis. portal karyawan). */
export const can = (permissions: string[], perm: string) =>
  perm === "" || permissions.includes("*") || permissions.includes(perm);
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
    path: "group-accounts",
    model: "group_account",
    title: L("Bagan Akun Grup", "Group Chart of Accounts"),
    singular: L("Akun Grup", "Group Account"),
    permission: "consolidation",
    writePermission: "consolidation.manage",
    group: GROUP,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "accountType", label: L("Jenis", "Type") },
      { name: "role", label: L("Peran konsolidasi", "Consolidation role") },
    ],
    fields: [
      code,
      name(),
      {
        name: "accountType",
        label: L("Jenis", "Type"),
        type: "select",
        required: true,
        options: ACCOUNT_TYPES,
      },
      {
        name: "role",
        label: L("Peran konsolidasi", "Consolidation role"),
        type: "select",
        options: [
          ["investment", L("Investasi pada entitas anak", "Investment in subsidiaries")],
          ["goodwill", L("Goodwill", "Goodwill")],
          ["nci_equity", L("Kepentingan non-pengendali", "Non-controlling interest")],
          ["nci_profit", L("Laba diatribusikan ke KNP", "Profit attributable to NCI")],
          ["cta", L("Selisih kurs penjabaran", "Translation reserve")],
          ["retained_earnings", L("Saldo laba", "Retained earnings")],
          ["associate_investment", L("Investasi pada asosiasi", "Investment in associates")],
          ["associate_income", L("Bagian laba asosiasi", "Share of associates' profit")],
          ["ic_difference", L("Selisih eliminasi antar perusahaan", "Intercompany elimination difference")],
          ["inventory", L("Persediaan (laba belum terealisasi)", "Inventory (unrealized profit)")],
          ["cost_of_sales", L("Harga pokok penjualan", "Cost of sales")],
          ["dividends", L("Dividen", "Dividends")],
          ["equity_transactions", L("Selisih transaksi dengan KNP", "Transactions with NCI")],
          ["disposal_gain", L("Laba/rugi pelepasan investasi", "Gain/loss on disposal of investments")],
        ],
      },
    ],
  },
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
      {
        name: "branchClearing",
        label: L("Rekening antar kantor (RK pusat–cabang)", "Inter-office account (branch clearing)"),
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
        name: "taxKind",
        label: L("Jenis pajak (Coretax)", "Tax kind (Coretax)"),
        type: "select",
        options: TAX_KINDS,
      },
      {
        name: "taxObjectCode",
        label: L("Kode objek pajak (PPh potong, mis. 24-104-14)", "Tax object code (withholding)"),
        type: "text",
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
    path: "commission-plans",
    model: "commission_plan",
    title: L("Aturan Komisi", "Commission Plans"),
    singular: L("Aturan komisi", "Commission plan"),
    permission: "sales",
    writePermission: "sales.manage",
    group: SALES,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "rate", label: L("Tarif %", "Rate %") },
      { name: "basis", label: L("Dasar", "Basis") },
    ],
    fields: [
      name(),
      {
        name: "rate",
        label: L("Tarif (% penjualan bersih)", "Rate (% of net sales)"),
        type: "number",
        required: true,
      },
      {
        name: "basis",
        label: L("Dasar komisi", "Commission basis"),
        type: "select",
        options: [
          ["invoiced", L("Faktur diposting", "Posted invoices")],
          ["paid", L("Faktur lunas", "Paid invoices")],
        ],
      },
      {
        name: "userId",
        label: L("Penjual (kosongkan untuk tim/bawaan)", "Salesperson (empty for team/default)"),
        type: "ref",
        resource: "users/options",
        display: "name",
      },
      {
        name: "teamId",
        label: L("Tim penjualan", "Sales team"),
        type: "ref",
        resource: "sales-teams",
        display: "name",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
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

RESOURCES.push(
  {
    path: "warehouses",
    model: "warehouse",
    title: L("Gudang", "Warehouses"),
    singular: L("Gudang", "Warehouse"),
    permission: "inventory",
    writePermission: "inventory.manage",
    group: INVENTORY,
    noDelete: true,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "stockLocationName", label: L("Lokasi stok", "Stock location") },
    ],
    fields: [
      {
        name: "code",
        label: L("Kode (tidak bisa diubah)", "Code (cannot be changed)"),
        type: "text",
        required: true,
      },
      name(),
      { name: "branchId", label: L("Cabang", "Branch"), type: "ref", resource: "branches", display: "name" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "stock-locations",
    model: "stock_location",
    title: L("Lokasi", "Locations"),
    singular: L("Lokasi", "Location"),
    permission: "inventory",
    writePermission: "inventory.manage",
    group: INVENTORY,
    noDelete: true,
    columns: [
      { name: "completeName", label: L("Lokasi", "Location") },
      { name: "usage", label: L("Jenis", "Type") },
    ],
    fields: [
      {
        name: "parentId",
        label: L("Lokasi induk", "Parent location"),
        type: "ref",
        resource: "stock-locations?usage=view",
        display: "completeName",
        required: true,
      },
      name(),
      {
        name: "usage",
        label: L("Jenis", "Type"),
        type: "select",
        options: [
          ["internal", L("Internal (menyimpan stok)", "Internal (holds stock)")],
          ["view", L("Induk (view)", "View")],
        ],
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "reorder-rules",
    model: "stock_reorder_rule",
    title: L("Aturan Pemesanan Ulang", "Reordering Rules"),
    singular: L("Aturan pemesanan ulang", "Reordering rule"),
    permission: "inventory",
    writePermission: "inventory.manage",
    group: INVENTORY,
    columns: [
      { name: "productId", label: L("Produk", "Product") },
      { name: "warehouseId", label: L("Gudang", "Warehouse") },
      { name: "minQty", label: L("Minimum", "Min") },
      { name: "maxQty", label: L("Maksimum", "Max") },
      { name: "qtyMultiple", label: L("Kelipatan", "Multiple") },
    ],
    fields: [
      {
        name: "warehouseId",
        label: L("Gudang", "Warehouse"),
        type: "ref",
        resource: "warehouses",
        display: "name",
        required: true,
      },
      {
        name: "productId",
        label: L("Produk", "Product"),
        type: "ref",
        resource: "products",
        display: "name",
        required: true,
      },
      { name: "minQty", label: L("Stok minimum", "Min quantity"), type: "number" },
      { name: "maxQty", label: L("Stok maksimum", "Max quantity"), type: "number" },
      { name: "qtyMultiple", label: L("Kelipatan pesanan", "Order multiple"), type: "number" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "product-suppliers",
    model: "product_supplier",
    title: L("Harga Pemasok", "Vendor Pricelists"),
    singular: L("Harga pemasok", "Vendor price"),
    permission: "purchase",
    writePermission: "purchase.manage",
    group: PURCHASE,
    columns: [
      { name: "productId", label: L("Produk", "Product") },
      { name: "partnerId", label: L("Pemasok", "Vendor") },
      { name: "price", label: L("Harga", "Price") },
      { name: "currencyCode", label: L("Mata uang", "Currency") },
      { name: "minQty", label: L("Min. qty", "Min. qty") },
      { name: "delayDays", label: L("Lead time (hari)", "Lead time (days)") },
    ],
    fields: [
      {
        name: "partnerId",
        label: L("Pemasok", "Vendor"),
        type: "ref",
        resource: "partners",
        display: "name",
        required: true,
      },
      {
        name: "productId",
        label: L("Produk", "Product"),
        type: "ref",
        resource: "products",
        display: "name",
        required: true,
      },
      { name: "productCode", label: L("Kode produk di pemasok", "Vendor product code"), type: "text" },
      { name: "price", label: L("Harga", "Price"), type: "number", required: true },
      {
        name: "currencyCode",
        label: L("Mata uang", "Currency"),
        type: "ref",
        resource: "currencies",
        display: "code",
        valueKey: "code",
      },
      { name: "minQty", label: L("Minimum kuantitas", "Minimum quantity"), type: "number" },
      { name: "delayDays", label: L("Lead time (hari)", "Lead time (days)"), type: "number" },
      {
        name: "sequence",
        label: L("Prioritas (kecil = utama)", "Priority (lower = preferred)"),
        type: "number",
      },
      companyScope,
    ],
  },
);

const PTKP: [string, Text][] = ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"].map((s) => [
  s,
  L(s, s),
]);

RESOURCES.push(
  {
    path: "employees",
    kanban: { title: "name", lines: ["jobName", "workEmail", "workPhone"], tag: "departmentName" },
    model: "employee",
    title: L("Karyawan", "Employees"),
    singular: L("Karyawan", "Employee"),
    permission: "hr",
    group: HR,
    columns: [
      { name: "employeeNumber", label: L("No. karyawan", "Employee no.") },
      { name: "name", label: L("Nama", "Name") },
      { name: "departmentName", label: L("Departemen", "Department") },
      { name: "jobName", label: L("Jabatan", "Job position") },
      { name: "workEmail", label: L("Email kerja", "Work email") },
    ],
    fields: [
      name(),
      {
        name: "employeeNumber",
        label: L("No. karyawan (kosong = otomatis)", "Employee no. (empty = automatic)"),
        type: "text",
      },
      {
        name: "departmentId",
        label: L("Departemen", "Department"),
        type: "ref",
        resource: "departments",
        display: "name",
      },
      {
        name: "jobId",
        label: L("Jabatan", "Job position"),
        type: "ref",
        resource: "job-positions",
        display: "name",
      },
      {
        name: "managerId",
        label: L("Atasan", "Manager"),
        type: "ref",
        resource: "employees",
        display: "name",
      },
      {
        name: "scheduleId",
        label: L("Jadwal kerja", "Work schedule"),
        type: "ref",
        resource: "work-schedules",
        display: "name",
      },
      {
        name: "userId",
        label: L("Akun login (portal)", "User account (portal)"),
        type: "ref",
        resource: "users/options",
        display: "name",
      },
      { name: "workEmail", label: L("Email kerja", "Work email"), type: "email" },
      { name: "workPhone", label: L("Telepon kerja", "Work phone"), type: "text" },
      { name: "branchId", label: L("Cabang", "Branch"), type: "ref", resource: "branches", display: "name" },
      {
        name: "businessUnitId",
        label: L("Unit bisnis", "Business unit"),
        type: "ref",
        resource: "business-units",
        display: "name",
      },
      { name: "joinDate", label: L("Tanggal masuk", "Join date"), type: "date", required: true },
      { name: "resignDate", label: L("Tanggal keluar", "Resign date"), type: "date" },
      { name: "nik", label: L("NIK (KTP)", "National ID (NIK)"), type: "text" },
      { name: "npwp", label: L("NPWP", "Tax ID (NPWP)"), type: "text" },
      { name: "ptkpStatus", label: L("Status PTKP", "PTKP status"), type: "select", options: PTKP },
      { name: "birthDate", label: L("Tanggal lahir", "Birth date"), type: "date" },
      {
        name: "gender",
        label: L("Jenis kelamin", "Gender"),
        type: "select",
        options: [
          ["male", L("Laki-laki", "Male")],
          ["female", L("Perempuan", "Female")],
        ],
      },
      { name: "bpjsKesNo", label: L("No. BPJS Kesehatan", "BPJS Health no."), type: "text" },
      { name: "bpjsTkNo", label: L("No. BPJS Ketenagakerjaan", "BPJS Employment no."), type: "text" },
      { name: "bankName", label: L("Bank", "Bank"), type: "text" },
      { name: "bankAccount", label: L("No. rekening", "Account number"), type: "text" },
      { name: "bankAccountName", label: L("Nama pemilik rekening", "Account holder"), type: "text" },
      { name: "address", label: L("Alamat", "Address"), type: "text" },
      { name: "emergencyContact", label: L("Kontak darurat", "Emergency contact"), type: "text" },
      { name: "emergencyPhone", label: L("Telepon kontak darurat", "Emergency phone"), type: "text" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "departments",
    model: "department",
    title: L("Departemen", "Departments"),
    singular: L("Departemen", "Department"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "managerId", label: L("Kepala", "Manager") },
    ],
    fields: [
      name(),
      {
        name: "parentId",
        label: L("Induk", "Parent"),
        type: "ref",
        resource: "departments",
        display: "name",
      },
      {
        name: "managerId",
        label: L("Kepala departemen", "Manager"),
        type: "ref",
        resource: "employees",
        display: "name",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "job-positions",
    model: "job_position",
    title: L("Jabatan", "Job Positions"),
    singular: L("Jabatan", "Job position"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [{ name: "name", label: L("Nama", "Name") }],
    fields: [
      name(),
      {
        name: "gradeId",
        label: L("Golongan upah", "Salary grade"),
        type: "ref",
        resource: "salary-grades",
        display: "name",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "job-openings",
    model: "job_opening",
    title: L("Lowongan", "Job Openings"),
    singular: L("Lowongan", "Job opening"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "quota", label: L("Kuota", "Quota") },
      { name: "state", label: L("Status", "Status") },
      { name: "dateOpen", label: L("Dibuka", "Opened") },
    ],
    fields: [
      name(),
      {
        name: "jobId",
        label: L("Jabatan", "Job position"),
        type: "ref",
        resource: "job-positions",
        display: "name",
      },
      {
        name: "departmentId",
        label: L("Departemen", "Department"),
        type: "ref",
        resource: "departments",
        display: "name",
      },
      { name: "quota", label: L("Kuota", "Quota"), type: "number" },
      {
        name: "state",
        label: L("Status", "Status"),
        type: "select",
        options: [
          ["open", L("Dibuka", "Open")],
          ["closed", L("Ditutup", "Closed")],
        ],
      },
      { name: "dateOpen", label: L("Tanggal dibuka", "Opening date"), type: "date" },
      { name: "dateClose", label: L("Tanggal ditutup", "Closing date"), type: "date" },
      {
        name: "description",
        label: L("Deskripsi & kualifikasi", "Description & requirements"),
        type: "text",
      },
    ],
  },
  {
    path: "expense-categories",
    model: "expense_category",
    title: L("Kategori Klaim", "Expense Categories"),
    singular: L("Kategori klaim", "Expense category"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "annualLimit", label: L("Plafon per tahun", "Annual limit") },
    ],
    fields: [
      name(),
      {
        name: "accountId",
        label: L("Akun beban", "Expense account"),
        type: "ref",
        resource: "accounts",
        display: "name",
        required: true,
      },
      {
        name: "annualLimit",
        label: L(
          "Plafon per karyawan per tahun (kosong = tanpa plafon)",
          "Annual limit per employee (empty = none)",
        ),
        type: "number",
      },
      {
        name: "taxable",
        label: L("Objek PPh 21 bila dibayar lewat slip", "Subject to PPh 21 when paid via payslip"),
        type: "boolean",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "salary-grades",
    model: "salary_grade",
    title: L("Golongan Upah", "Salary Grades"),
    singular: L("Golongan upah", "Salary grade"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "minWage", label: L("Upah minimum", "Minimum wage") },
      { name: "maxWage", label: L("Upah maksimum", "Maximum wage") },
    ],
    fields: [
      code,
      name(),
      {
        name: "minWage",
        label: L("Upah pokok minimum", "Minimum base wage"),
        type: "number",
        required: true,
      },
      {
        name: "maxWage",
        label: L("Upah pokok maksimum", "Maximum base wage"),
        type: "number",
        required: true,
      },
      { name: "sequence", label: L("Urutan", "Sequence"), type: "number" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "leave-allocations",
    model: "leave_allocation",
    title: L("Jatah Cuti", "Leave Allocations"),
    singular: L("Jatah cuti", "Leave allocation"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "employeeId", label: L("Karyawan", "Employee") },
      { name: "leaveTypeId", label: L("Jenis cuti", "Leave type") },
      { name: "days", label: L("Hari", "Days") },
      { name: "dateFrom", label: L("Berlaku dari", "Valid from") },
      { name: "dateTo", label: L("Sampai", "To") },
    ],
    fields: [
      {
        name: "employeeId",
        label: L("Karyawan", "Employee"),
        type: "ref",
        resource: "employees",
        display: "name",
        required: true,
      },
      {
        name: "leaveTypeId",
        label: L("Jenis cuti", "Leave type"),
        type: "ref",
        resource: "leave-types",
        display: "name",
        required: true,
      },
      { name: "days", label: L("Jumlah hari", "Days"), type: "number", required: true },
      { name: "dateFrom", label: L("Berlaku dari", "Valid from"), type: "date", required: true },
      { name: "dateTo", label: L("Berlaku sampai", "Valid to"), type: "date", required: true },
      { name: "note", label: L("Catatan", "Note"), type: "text" },
    ],
  },
  {
    path: "leave-types",
    model: "leave_type",
    title: L("Jenis Cuti", "Leave Types"),
    singular: L("Jenis cuti", "Leave type"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [{ name: "name", label: L("Nama", "Name") }],
    fields: [
      name(),
      {
        name: "paid",
        label: L("Dibayar (tidak memotong gaji)", "Paid (no salary deduction)"),
        type: "boolean",
      },
      { name: "requiresAllocation", label: L("Memakai jatah/saldo", "Requires allocation"), type: "boolean" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "overtimes",
    model: "overtime",
    title: L("Lembur", "Overtime"),
    singular: L("Lembur", "Overtime"),
    permission: "hr",
    group: HR,
    columns: [
      { name: "employeeId", label: L("Karyawan", "Employee") },
      { name: "date", label: L("Tanggal", "Date") },
      { name: "hours", label: L("Jam", "Hours") },
      { name: "dayType", label: L("Jenis hari", "Day type") },
      { name: "state", label: L("Status", "Status") },
    ],
    fields: [
      {
        name: "employeeId",
        label: L("Karyawan", "Employee"),
        type: "ref",
        resource: "employees",
        display: "name",
        required: true,
      },
      { name: "date", label: L("Tanggal", "Date"), type: "date", required: true },
      { name: "hours", label: L("Jumlah jam", "Hours"), type: "number", required: true },
      {
        name: "dayType",
        label: L("Jenis hari", "Day type"),
        type: "select",
        options: [
          ["workday", L("Hari kerja (1,5× jam pertama, 2× berikutnya)", "Workday")],
          ["rest_day", L("Hari istirahat/libur (2×/3×/4×)", "Rest day / holiday")],
        ],
      },
      { name: "description", label: L("Keterangan", "Description"), type: "text" },
    ],
  },
  {
    path: "work-schedules",
    model: "work_schedule",
    title: L("Jadwal Kerja", "Work Schedules"),
    singular: L("Jadwal kerja", "Work schedule"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "startTime", label: L("Masuk", "Start") },
      { name: "endTime", label: L("Pulang", "End") },
      { name: "toleranceMinutes", label: L("Toleransi (menit)", "Grace (min)") },
      { name: "penaltyPerMinute", label: L("Denda / menit", "Penalty / min") },
      { name: "penaltyPerOccurrence", label: L("Denda / kejadian", "Penalty / occurrence") },
    ],
    fields: [
      name(),
      {
        name: "startTime",
        label: L("Jam masuk (HH:MM)", "Start time (HH:MM)"),
        type: "text",
        required: true,
      },
      { name: "endTime", label: L("Jam pulang (HH:MM)", "End time (HH:MM)"), type: "text", required: true },
      {
        name: "toleranceMinutes",
        label: L("Toleransi terlambat (menit)", "Late grace period (minutes)"),
        type: "number",
      },
      {
        name: "penaltyPerMinute",
        label: L(
          "Potongan per menit terlambat (setelah toleransi)",
          "Deduction per late minute (after grace)",
        ),
        type: "number",
      },
      {
        name: "penaltyPerOccurrence",
        label: L("Potongan per kejadian terlambat", "Deduction per late occurrence"),
        type: "number",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "shift-assignments",
    model: "shift_assignment",
    title: L("Penugasan Shift", "Shift Assignments"),
    singular: L("Penugasan shift", "Shift assignment"),
    permission: "hr",
    group: HR,
    columns: [
      { name: "employeeId", label: L("Karyawan", "Employee") },
      { name: "scheduleId", label: L("Jadwal", "Schedule") },
      { name: "dateFrom", label: L("Dari", "From") },
      { name: "dateTo", label: L("Sampai", "To") },
    ],
    fields: [
      {
        name: "employeeId",
        label: L("Karyawan", "Employee"),
        type: "ref",
        resource: "employees",
        display: "name",
        required: true,
      },
      {
        name: "scheduleId",
        label: L("Jadwal / shift", "Schedule / shift"),
        type: "ref",
        resource: "work-schedules",
        display: "name",
        required: true,
      },
      { name: "dateFrom", label: L("Dari tanggal", "From"), type: "date", required: true },
      { name: "dateTo", label: L("Sampai tanggal", "To"), type: "date", required: true },
    ],
  },
  {
    path: "work-entries",
    model: "work_entry",
    title: L("Hasil Kerja Borongan", "Piece Work"),
    singular: L("Hasil kerja", "Work entry"),
    permission: "hr",
    group: HR,
    csv: true,
    columns: [
      { name: "employeeId", label: L("Karyawan", "Employee") },
      { name: "date", label: L("Tanggal", "Date") },
      { name: "quantity", label: L("Jumlah satuan", "Quantity") },
      { name: "description", label: L("Keterangan", "Description") },
    ],
    fields: [
      {
        name: "employeeId",
        label: L("Karyawan (kontrak borongan)", "Employee (piece-rate contract)"),
        type: "ref",
        resource: "employees",
        display: "name",
        required: true,
      },
      { name: "date", label: L("Tanggal", "Date"), type: "date", required: true },
      { name: "quantity", label: L("Jumlah satuan hasil", "Units produced"), type: "number", required: true },
      { name: "description", label: L("Keterangan", "Description"), type: "text" },
    ],
  },
  {
    path: "public-holidays",
    model: "public_holiday",
    title: L("Hari Libur", "Public Holidays"),
    singular: L("Hari libur", "Public holiday"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "date", label: L("Tanggal", "Date") },
      { name: "name", label: L("Nama", "Name") },
    ],
    fields: [{ name: "date", label: L("Tanggal", "Date"), type: "date", required: true }, name()],
  },
  {
    path: "salary-components",
    model: "salary_component",
    title: L("Komponen Gaji", "Salary Components"),
    singular: L("Komponen gaji", "Salary component"),
    permission: "payroll",
    writePermission: "payroll.manage",
    group: PAYROLL,
    columns: [
      { name: "code", label: L("Kode", "Code") },
      { name: "name", label: L("Nama", "Name") },
      { name: "kind", label: L("Jenis", "Kind") },
    ],
    fields: [
      code,
      name(),
      {
        name: "kind",
        label: L("Jenis", "Kind"),
        type: "select",
        required: true,
        options: [
          ["allowance", L("Tunjangan / pendapatan", "Allowance / earning")],
          ["deduction", L("Potongan", "Deduction")],
        ],
      },
      {
        name: "fixed",
        label: L("Tunjangan tetap (dasar BPJS & lembur)", "Fixed allowance (BPJS & overtime base)"),
        type: "boolean",
      },
      { name: "taxable", label: L("Objek PPh 21", "Subject to PPh 21"), type: "boolean" },
      {
        name: "accountId",
        label: L("Akun (kosong = bawaan payroll)", "Account (empty = payroll default)"),
        type: "ref",
        resource: "accounts",
        display: "name",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
);

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

/** Halaman daftar transfer stok. */
export const PICKING_KINDS = {
  receipts: { type: "incoming", title: L("Penerimaan", "Receipts") },
  deliveries: { type: "outgoing", title: L("Pengiriman", "Deliveries") },
  internal: { type: "internal", title: L("Transfer Internal", "Internal Transfers") },
  dropship: { type: "dropship", title: L("Dropship", "Dropship") },
} as const;
export type PickingKind = keyof typeof PICKING_KINDS;

export const PICKING_STATE_LABEL: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  ready: L("Siap", "Ready"),
  done: L("Selesai", "Done"),
  cancel: L("Batal", "Cancelled"),
};

export const PICKING_TYPE_LABEL: Record<string, Text> = {
  incoming: L("Penerimaan", "Receipt"),
  outgoing: L("Pengiriman", "Delivery"),
  internal: L("Transfer internal", "Internal transfer"),
  dropship: L("Dropship", "Dropship"),
};

/** Halaman daftar dokumen pembelian. */
export const PURCHASE_KINDS = {
  rfq: {
    state: "draft,sent,to_approve",
    billStatus: "",
    title: L("Permintaan Penawaran", "Requests for Quotation"),
  },
  orders: { state: "purchase", billStatus: "", title: L("Pesanan Pembelian", "Purchase Orders") },
  "to-bill": { state: "purchase", billStatus: "to_invoice", title: L("Perlu Ditagihkan", "To Bill") },
} as const;
export type PurchaseKind = keyof typeof PURCHASE_KINDS;

export const PURCHASE_STATE_LABEL: Record<string, Text> = {
  draft: L("RFQ", "RFQ"),
  sent: L("RFQ terkirim", "RFQ sent"),
  to_approve: L("Menunggu persetujuan", "To approve"),
  purchase: L("Pesanan pembelian", "Purchase order"),
  cancel: L("Batal", "Cancelled"),
};

export const RECEIPT_STATUS_LABEL: Record<string, Text> = {
  no: L("—", "—"),
  pending: L("Belum diterima", "Not received"),
  partial: L("Diterima sebagian", "Partially received"),
  full: L("Diterima penuh", "Fully received"),
};

export const DELIVERY_STATUS_LABEL: Record<string, Text> = {
  no: L("—", "—"),
  pending: L("Belum dikirim", "Not delivered"),
  partial: L("Dikirim sebagian", "Partially delivered"),
  full: L("Terkirim penuh", "Fully delivered"),
};

export const LEAVE_STATE_LABEL: Record<string, Text> = {
  confirm: L("Menunggu persetujuan", "To approve"),
  approved: L("Disetujui", "Approved"),
  refused: L("Ditolak", "Refused"),
  cancel: L("Dibatalkan", "Cancelled"),
};

export const APPLICANT_STAGE_LABEL: Record<string, Text> = {
  new: L("Lamaran baru", "New"),
  screening: L("Screening", "Screening"),
  interview: L("Wawancara", "Interview"),
  offer: L("Penawaran", "Offer"),
  hired: L("Diterima", "Hired"),
  refused: L("Ditolak", "Refused"),
};

export const EXPENSE_STATE_LABEL: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  confirm: L("Menunggu persetujuan", "To approve"),
  approved: L("Disetujui", "Approved"),
  refused: L("Ditolak", "Refused"),
  paid: L("Dibayar", "Paid"),
  cancel: L("Dibatalkan", "Cancelled"),
};

export const PAYROLL_STATE_LABEL: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  done: L("Diposting", "Posted"),
  paid: L("Dibayar", "Paid"),
  cancel: L("Batal", "Cancelled"),
};

export const CONTRACT_STATE_LABEL: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  running: L("Berjalan", "Running"),
  closed: L("Berakhir", "Expired"),
  cancel: L("Batal", "Cancelled"),
};

export const TAX_DOC_STATE_LABEL: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  exported: L("Diekspor", "Exported"),
  approved: L("Terbit", "Approved"),
  replaced: L("Diganti", "Replaced"),
  cancelled: L("Batal", "Cancelled"),
};

export const INPUT_TAX_STATE_LABEL: Record<string, Text> = {
  new: L("Baru", "New"),
  credited: L("Dikreditkan", "Credited"),
  not_credited: L("Tidak dikreditkan", "Not credited"),
};

export const SUBSCRIPTION_STATUS_LABEL: Record<string, Text> = {
  trialing: L("Masa uji coba", "Trial"),
  active: L("Aktif", "Active"),
  past_due: L("Lewat jatuh tempo", "Past due"),
  cancelling: L("Berakhir di akhir periode", "Ends at period end"),
  expired: L("Berakhir", "Expired"),
  suspended: L("Ditangguhkan", "Suspended"),
};
