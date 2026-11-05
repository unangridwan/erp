import { allowedFor, CORETAX_UOM_CODES, TRX_CODES as CORETAX_TRX_CODES } from "@erp/shared";
import { L, type Text } from "./i18n";

/** Definisi tampilan list & form per resource — mirip "view" di Odoo. */
export type Field = (
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
    }
) & {
  /** Judul seksi form yang dimulai dari field ini (form panjang, mis. karyawan). */
  section?: Text;
  /** Teks bantuan di bawah field. */
  help?: Text;
  placeholder?: Text;
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
  /** Permission untuk membuat data baru bila berbeda dari hak menulis (mis. karyawan: butuh hak kontrak). */
  createPermission?: string;
  /** Data tidak bisa dihapus (cukup dinonaktifkan). */
  noDelete?: boolean;
  /** Tampilan kartu (kanban) — menjadi tampilan bawaan seperti di Odoo. */
  kanban?: {
    title: string;
    lines: string[];
    tag?: string;
    /** Gambar kartu dari API (`{id}` diganti id baris) bila kolom `flag` bernilai benar. */
    image?: { path: string; flag: string };
  };
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
export const FLEET = L("Armada", "Fleet");

const VEHICLE_STATES: [string, Text][] = [
  ["new_request", L("Permintaan baru", "New request")],
  ["to_order", L("Dipesan", "To order")],
  ["registered", L("Terdaftar", "Registered")],
  ["downgraded", L("Nonaktif", "Downgraded")],
];
const VEHICLE_CATEGORIES: [string, Text][] = [
  ["car", L("Mobil", "Car")],
  ["motorcycle", L("Sepeda motor", "Motorcycle")],
  ["pickup", L("Pikap", "Pickup")],
  ["truck", L("Truk", "Truck")],
  ["bus", L("Bus", "Bus")],
  ["other", L("Lainnya", "Other")],
];
const FUEL_TYPES: [string, Text][] = [
  ["gasoline", L("Bensin", "Gasoline")],
  ["diesel", L("Solar", "Diesel")],
  ["electric", L("Listrik", "Electric")],
  ["hybrid", L("Hybrid", "Hybrid")],
  ["lpg", L("LPG", "LPG")],
  ["other", L("Lainnya", "Other")],
];
const INTERVALS: [string, Text][] = [
  ["none", L("Tidak berulang", "None")],
  ["daily", L("Harian", "Daily")],
  ["weekly", L("Mingguan", "Weekly")],
  ["monthly", L("Bulanan", "Monthly")],
  ["yearly", L("Tahunan", "Yearly")],
];
const CONTRACT_STATES: [string, Text][] = [
  ["new", L("Baru", "New")],
  ["running", L("Berjalan", "Running")],
  ["expired", L("Kedaluwarsa", "Expired")],
  ["closed", L("Ditutup", "Closed")],
];
const SERVICE_STATES: [string, Text][] = [
  ["new", L("Baru", "New")],
  ["running", L("Dikerjakan", "Running")],
  ["done", L("Selesai", "Done")],
  ["cancelled", L("Dibatalkan", "Cancelled")],
];

const name = (required = true): Field => ({ name: "name", label: L("Nama", "Name"), type: "text", required });
const code: Field = { name: "code", label: L("Kode", "Code"), type: "text", required: true };
const companyScope: Field = {
  name: "companyId",
  label: L("Khusus perusahaan (kosong = seluruh grup)", "Company only (empty = whole group)"),
  type: "ref",
  resource: "companies",
  display: "name",
};

const HOLIDAY_KINDS: [string, Text][] = [
  ["national", L("Libur nasional", "National holiday")],
  ["collective", L("Cuti bersama", "Collective leave")],
  ["company", L("Libur perusahaan", "Company holiday")],
];

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
  {
    path: "fleet-vehicles",
    model: "fleet_vehicle",
    title: L("Kendaraan", "Vehicles"),
    singular: L("Kendaraan", "Vehicle"),
    permission: "fleet",
    group: FLEET,
    csv: true,
    kanban: { title: "licensePlate", lines: ["location", "color"], tag: "state" },
    columns: [
      { name: "licensePlate", label: L("Nomor polisi", "License plate") },
      { name: "modelYear", label: L("Tahun", "Year") },
      { name: "state", label: L("Status", "Status") },
      { name: "odometer", label: L("Odometer", "Odometer") },
      { name: "stnkExpiry", label: L("STNK berlaku s.d.", "Registration valid until") },
      { name: "active", label: L("Aktif", "Active") },
    ],
    fields: [
      {
        name: "licensePlate",
        label: L("Nomor polisi (mis. B 1234 XYZ)", "License plate (e.g. B 1234 XYZ)"),
        type: "text",
        required: true,
      },
      {
        name: "modelId",
        label: L("Model", "Model"),
        type: "ref",
        resource: "fleet-models",
        display: "name",
        required: true,
      },
      {
        name: "state",
        label: L("Status", "Status"),
        type: "select",
        options: VEHICLE_STATES,
        required: true,
      },
      { name: "modelYear", label: L("Tahun pembuatan", "Model year"), type: "number" },
      { name: "color", label: L("Warna", "Color"), type: "text" },
      { name: "vin", label: L("Nomor rangka", "Chassis no. (VIN)"), type: "text" },
      { name: "engineNo", label: L("Nomor mesin", "Engine no."), type: "text" },
      { name: "location", label: L("Lokasi", "Location"), type: "text" },
      {
        name: "odometerUnit",
        label: L("Satuan odometer", "Odometer unit"),
        type: "select",
        options: [
          ["km", L("Kilometer", "Kilometers")],
          ["mi", L("Mil", "Miles")],
        ],
      },
      {
        name: "driverEmployeeId",
        label: L("Pengemudi", "Driver"),
        type: "ref",
        resource: "employees",
        display: "name",
        section: L("Pengemudi & Pengelola", "Driver & Manager"),
      },
      {
        name: "nextDriverEmployeeId",
        label: L("Pengemudi berikutnya", "Next driver"),
        type: "ref",
        resource: "employees",
        display: "name",
      },
      {
        name: "managerUserId",
        label: L("Fleet manager", "Fleet manager"),
        type: "ref",
        resource: "users/options",
        display: "name",
      },
      {
        name: "branchId",
        label: L("Cabang (pembebanan biaya)", "Branch (cost allocation)"),
        type: "ref",
        resource: "branches",
        display: "name",
      },
      {
        name: "businessUnitId",
        label: L("Unit bisnis", "Business unit"),
        type: "ref",
        resource: "business-units",
        display: "name",
      },
      {
        name: "stnkNo",
        label: L("Nomor STNK", "Vehicle registration (STNK) no."),
        type: "text",
        section: L("Dokumen", "Documents"),
      },
      {
        name: "stnkExpiry",
        label: L("STNK berlaku s.d. (5 tahunan)", "STNK valid until (5-yearly)"),
        type: "date",
      },
      { name: "taxDueDate", label: L("Jatuh tempo pajak tahunan", "Annual vehicle tax due"), type: "date" },
      { name: "bpkbNo", label: L("Nomor BPKB", "Ownership book (BPKB) no."), type: "text" },
      { name: "kirNo", label: L("Nomor KIR (kendaraan niaga)", "KIR test no. (commercial)"), type: "text" },
      { name: "kirExpiry", label: L("KIR berlaku s.d.", "KIR valid until"), type: "date" },
      {
        name: "orderDate",
        label: L("Tanggal pesan", "Order date"),
        type: "date",
        section: L("Nilai & Siklus", "Value & Lifecycle"),
      },
      { name: "registrationDate", label: L("Tanggal registrasi", "Registration date"), type: "date" },
      { name: "catalogValue", label: L("Nilai katalog", "Catalog value"), type: "number" },
      { name: "purchaseValue", label: L("Nilai beli", "Purchase value"), type: "number" },
      { name: "residualValue", label: L("Nilai residu", "Residual value"), type: "number" },
      { name: "replacementDate", label: L("Rencana penggantian", "Planned replacement"), type: "date" },
      {
        name: "assetId",
        label: L("Aset tetap", "Fixed asset"),
        type: "ref",
        resource: "assets",
        display: "name",
      },
      { name: "note", label: L("Catatan", "Notes"), type: "text" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "fleet-contracts",
    model: "fleet_contract",
    title: L("Kontrak Kendaraan", "Vehicle Contracts"),
    singular: L("Kontrak kendaraan", "Vehicle contract"),
    permission: "fleet",
    group: FLEET,
    columns: [
      { name: "reference", label: L("Referensi", "Reference") },
      { name: "startDate", label: L("Mulai", "Start") },
      { name: "endDate", label: L("Berakhir", "End") },
      { name: "recurringCost", label: L("Biaya berulang", "Recurring cost") },
      { name: "state", label: L("Status", "Status") },
    ],
    fields: [
      {
        name: "vehicleId",
        label: L("Kendaraan", "Vehicle"),
        type: "ref",
        resource: "fleet-vehicles",
        display: "licensePlate",
        required: true,
      },
      {
        name: "serviceTypeId",
        label: L("Jenis kontrak", "Contract type"),
        type: "ref",
        resource: "fleet-service-types",
        display: "name",
        required: true,
      },
      { name: "vendorId", label: L("Vendor", "Vendor"), type: "ref", resource: "partners", display: "name" },
      { name: "reference", label: L("Referensi / nomor polis", "Reference / policy no."), type: "text" },
      { name: "startDate", label: L("Tanggal mulai", "Start date"), type: "date", required: true },
      { name: "endDate", label: L("Tanggal berakhir", "End date"), type: "date" },
      { name: "initialCost", label: L("Biaya awal", "Initial cost"), type: "number" },
      { name: "recurringCost", label: L("Biaya berulang", "Recurring cost"), type: "number" },
      { name: "recurringInterval", label: L("Frekuensi", "Frequency"), type: "select", options: INTERVALS },
      { name: "state", label: L("Status", "Status"), type: "select", options: CONTRACT_STATES },
      {
        name: "reminderDays",
        label: L("Ingatkan (hari sebelum berakhir)", "Remind (days before end)"),
        type: "number",
      },
      { name: "includedServices", label: L("Layanan termasuk", "Included services"), type: "text" },
      { name: "note", label: L("Catatan", "Notes"), type: "text" },
    ],
  },
  {
    path: "fleet-services",
    model: "fleet_service",
    title: L("Servis Kendaraan", "Vehicle Services"),
    singular: L("Servis kendaraan", "Vehicle service"),
    permission: "fleet",
    group: FLEET,
    columns: [
      { name: "date", label: L("Tanggal", "Date") },
      { name: "description", label: L("Keterangan", "Description") },
      { name: "cost", label: L("Biaya", "Cost") },
      { name: "state", label: L("Status", "Status") },
    ],
    fields: [
      {
        name: "vehicleId",
        label: L("Kendaraan", "Vehicle"),
        type: "ref",
        resource: "fleet-vehicles",
        display: "licensePlate",
        required: true,
      },
      {
        name: "serviceTypeId",
        label: L("Jenis layanan", "Service type"),
        type: "ref",
        resource: "fleet-service-types",
        display: "name",
        required: true,
      },
      { name: "date", label: L("Tanggal", "Date"), type: "date", required: true },
      {
        name: "vendorId",
        label: L("Vendor / bengkel", "Vendor / workshop"),
        type: "ref",
        resource: "partners",
        display: "name",
      },
      { name: "cost", label: L("Biaya", "Cost"), type: "number" },
      { name: "odometer", label: L("Odometer saat servis", "Odometer at service"), type: "number" },
      {
        name: "driverEmployeeId",
        label: L("Pengemudi", "Driver"),
        type: "ref",
        resource: "employees",
        display: "name",
      },
      { name: "state", label: L("Status", "Status"), type: "select", options: SERVICE_STATES },
      { name: "description", label: L("Keterangan", "Description"), type: "text" },
    ],
  },
  {
    path: "fleet-models",
    model: "fleet_model",
    title: L("Model Kendaraan", "Vehicle Models"),
    singular: L("Model kendaraan", "Vehicle model"),
    permission: "fleet",
    writePermission: "fleet.manage",
    group: FLEET,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "category", label: L("Kategori", "Category") },
      { name: "seats", label: L("Kursi", "Seats") },
      { name: "fuelType", label: L("Bahan bakar", "Fuel") },
    ],
    fields: [
      {
        name: "manufacturerId",
        label: L("Produsen", "Manufacturer"),
        type: "ref",
        resource: "fleet-manufacturers",
        display: "name",
        required: true,
      },
      name(),
      {
        name: "category",
        label: L("Kategori", "Category"),
        type: "select",
        options: VEHICLE_CATEGORIES,
        required: true,
      },
      { name: "seats", label: L("Jumlah kursi", "Seats"), type: "number" },
      { name: "doors", label: L("Jumlah pintu", "Doors"), type: "number" },
      {
        name: "transmission",
        label: L("Transmisi", "Transmission"),
        type: "select",
        options: [
          ["manual", L("Manual", "Manual")],
          ["automatic", L("Otomatis", "Automatic")],
        ],
      },
      { name: "fuelType", label: L("Bahan bakar", "Fuel type"), type: "select", options: FUEL_TYPES },
      { name: "horsepower", label: L("Tenaga (HP)", "Horsepower"), type: "number" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "fleet-manufacturers",
    model: "fleet_manufacturer",
    title: L("Produsen", "Manufacturers"),
    singular: L("Produsen", "Manufacturer"),
    permission: "fleet",
    writePermission: "fleet.manage",
    group: FLEET,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "active", label: L("Aktif", "Active") },
    ],
    fields: [name(), { name: "active", label: L("Aktif", "Active"), type: "boolean" }],
  },
  {
    path: "fleet-service-types",
    model: "fleet_service_type",
    title: L("Jenis Layanan & Kontrak", "Service & Contract Types"),
    singular: L("Jenis layanan", "Service type"),
    permission: "fleet",
    writePermission: "fleet.manage",
    group: FLEET,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "category", label: L("Dipakai untuk", "Used for") },
      { name: "active", label: L("Aktif", "Active") },
    ],
    fields: [
      name(),
      {
        name: "category",
        label: L("Dipakai untuk", "Used for"),
        type: "select",
        options: [
          ["contract", L("Kontrak", "Contracts")],
          ["service", L("Servis", "Services")],
          ["both", L("Keduanya", "Both")],
        ],
        required: true,
      },
      {
        name: "accountId",
        label: L("Akun beban (tagihan vendor)", "Expense account (vendor bills)"),
        type: "ref",
        resource: "accounts",
        display: "name",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
];

export const findResource = (path: string) => RESOURCES.find((r) => r.path === path);

/** Permission kosong = cukup login (mis. portal karyawan). */
export const can = (permissions: string[], perm: string) =>
  perm === "" || permissions.includes("*") || permissions.includes(perm);
/** Hak per path (modul → fitur pemilik halaman); DELETE butuh aksi hapus, ekspor butuh aksi ekspor. */
export const canPath = (permissions: string[], perm: string, path: string, method = "GET") =>
  perm === "" || allowedFor(permissions, perm, { path, method, side: "web" });
export const canWrite = (permissions: string[], resource: Resource) =>
  canPath(
    permissions,
    resource.writePermission ?? `${resource.permission}.write`,
    `/${resource.path}`,
    "POST",
  );
export const canCreate = (permissions: string[], resource: Resource) =>
  canWrite(permissions, resource) &&
  (!resource.createPermission ||
    canPath(permissions, resource.createPermission, `/${resource.path}`, "POST"));
export const canDelete = (permissions: string[], resource: Resource) =>
  canPath(
    permissions,
    resource.writePermission ?? `${resource.permission}.write`,
    `/${resource.path}`,
    "DELETE",
  );
export const canExport = (permissions: string[], resource: Resource) =>
  canPath(permissions, `${resource.permission}.read`, `/${resource.path}/export`);

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

export const RELIGION_OPTIONS: [string, Text][] = [
  ["islam", L("Islam", "Islam")],
  ["protestant", L("Kristen Protestan", "Protestant")],
  ["catholic", L("Katolik", "Catholic")],
  ["hindu", L("Hindu", "Hindu")],
  ["buddha", L("Buddha", "Buddhism")],
  ["confucian", L("Konghucu", "Confucianism")],
  ["other", L("Lainnya", "Other")],
];

export const MARITAL_OPTIONS: [string, Text][] = [
  ["single", L("Belum kawin", "Single")],
  ["married", L("Kawin", "Married")],
  ["divorced", L("Cerai hidup", "Divorced")],
  ["widowed", L("Cerai mati", "Widowed")],
];

RESOURCES.push(
  {
    path: "employees",
    kanban: {
      title: "name",
      lines: ["jobName", "workEmail", "workPhone"],
      tag: "departmentName",
      image: { path: "employees/{id}/photo", flag: "hasPhoto" },
    },
    model: "employee",
    title: L("Karyawan", "Employees"),
    singular: L("Karyawan", "Employee"),
    permission: "hr",
    // Karyawan baru dibuat bersama kontrak kerjanya (tanggal masuk = mulai kontrak).
    createPermission: "hr.manage",
    group: HR,
    columns: [
      { name: "employeeNumber", label: L("No. karyawan", "Employee no.") },
      { name: "name", label: L("Nama", "Name") },
      { name: "departmentName", label: L("Departemen", "Department") },
      { name: "jobName", label: L("Jabatan", "Job position") },
      { name: "workEmail", label: L("Email kerja", "Work email") },
    ],
    fields: [
      { ...name(), section: L("Pekerjaan", "Work") },
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
        name: "gradeId",
        label: L("Golongan", "Grade"),
        type: "ref",
        resource: "salary-grades",
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
        name: "workLocationId",
        label: L("Lokasi kerja (geofence absensi)", "Work location (attendance geofence)"),
        type: "ref",
        resource: "work-locations",
        display: "name",
      },
      {
        name: "badgeCode",
        label: L("Kode badge (kiosk/mesin absensi)", "Badge code (kiosk/device)"),
        type: "text",
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
      {
        name: "nik",
        label: L("NIK (KTP)", "National ID (NIK)"),
        type: "text",
        section: L("Identitas & Pajak", "Identity & Tax"),
      },
      { name: "kkNo", label: L("No. Kartu Keluarga", "Family card no."), type: "text" },
      { name: "npwp", label: L("NPWP", "Tax ID (NPWP)"), type: "text" },
      { name: "ptkpStatus", label: L("Status PTKP", "PTKP status"), type: "select", options: PTKP },

      {
        name: "bpjsKesNo",
        label: L("No. kartu BPJS Kesehatan", "BPJS Health card no."),
        type: "text",
        section: L("BPJS Kesehatan", "BPJS Health"),
      },
      {
        name: "bpjsKesEnrolled",
        label: L("Peserta BPJS Kesehatan", "Enrolled in BPJS Health"),
        type: "boolean",
      },
      { name: "bpjsKesDate", label: L("Tanggal kepesertaan", "Enrolment date"), type: "date" },
      {
        name: "bpjsKesClass",
        label: L("Kelas rawat", "Ward class"),
        type: "select",
        options: [
          ["1", L("Kelas 1", "Class 1")],
          ["2", L("Kelas 2", "Class 2")],
          ["3", L("Kelas 3", "Class 3")],
        ],
      },
      { name: "bpjsKesFacility", label: L("Faskes tingkat 1", "Primary health facility"), type: "text" },
      {
        name: "bpjsTkNo",
        label: L("No. BPJS Ketenagakerjaan (KPJ)", "BPJS Employment no. (KPJ)"),
        type: "text",
        section: L("BPJS Ketenagakerjaan", "BPJS Employment"),
      },
      {
        name: "bpjsTkEnrolled",
        label: L(
          "Peserta BPJS Ketenagakerjaan (JHT, JKK, JKM)",
          "Enrolled in BPJS Employment (JHT, JKK, JKM)",
        ),
        type: "boolean",
      },
      { name: "bpjsTkDate", label: L("Tanggal kepesertaan", "Enrolment date"), type: "date" },
      {
        name: "bpjsJpEnrolled",
        label: L("Ikut Jaminan Pensiun (JP)", "Enrolled in pension (JP)"),
        type: "boolean",
      },
      {
        name: "retirementAge",
        label: L(
          "Usia pensiun khusus (kosong = ikut kebijakan perusahaan)",
          "Specific retirement age (empty = company policy)",
        ),
        type: "number",
      },
      {
        name: "overtimeEligible",
        label: L("Berhak upah lembur", "Entitled to overtime pay"),
        type: "boolean",
      },
      {
        name: "birthPlace",
        label: L("Tempat lahir", "Place of birth"),
        type: "text",
        section: L("Biodata", "Personal"),
      },
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
      { name: "religion", label: L("Agama", "Religion"), type: "select", options: RELIGION_OPTIONS },
      {
        name: "maritalStatus",
        label: L("Status pernikahan", "Marital status"),
        type: "select",
        options: MARITAL_OPTIONS,
      },
      {
        name: "bloodType",
        label: L("Golongan darah", "Blood type"),
        type: "select",
        options: ["A", "B", "AB", "O"].map((b) => [b, L(b, b)]),
      },
      {
        name: "rhesus",
        label: L("Rhesus", "Rhesus"),
        type: "select",
        options: [
          ["+", L("Positif (+)", "Positive (+)")],
          ["-", L("Negatif (−)", "Negative (−)")],
        ],
      },
      { name: "nationality", label: L("Kewarganegaraan", "Nationality"), type: "text" },
      { name: "heightCm", label: L("Tinggi badan (cm)", "Height (cm)"), type: "number" },
      { name: "weightKg", label: L("Berat badan (kg)", "Weight (kg)"), type: "number" },
      {
        name: "address",
        label: L("Alamat sesuai KTP", "Address (ID card)"),
        type: "text",
        section: L("Kontak", "Contact"),
      },
      { name: "domicileAddress", label: L("Alamat domisili", "Current address"), type: "text" },
      { name: "personalPhone", label: L("No. HP pribadi", "Personal phone"), type: "text" },
      { name: "personalEmail", label: L("Email pribadi", "Personal email"), type: "email" },
      { name: "emergencyContact", label: L("Kontak darurat", "Emergency contact"), type: "text" },
      { name: "emergencyPhone", label: L("Telepon kontak darurat", "Emergency phone"), type: "text" },
      { name: "bankName", label: L("Bank", "Bank"), type: "text", section: L("Rekening", "Bank account") },
      { name: "bankAccount", label: L("No. rekening", "Account number"), type: "text" },
      { name: "bankAccountName", label: L("Nama pemilik rekening", "Account holder"), type: "text" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "departments",
    model: "department",
    csv: true,
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
    csv: true,
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
    csv: true,
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
      { name: "targetDate", label: L("Target terisi", "Target fill date"), type: "date" },
      { name: "wageMin", label: L("Gaji minimum", "Minimum wage"), type: "number" },
      { name: "wageMax", label: L("Gaji maksimum", "Maximum wage"), type: "number" },
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
    csv: true,
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
    csv: true,
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
      { name: "baseWage", label: L("Gaji pokok", "Base wage") },
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
      {
        name: "baseWage",
        label: L("Gaji pokok", "Base wage"),
        type: "number",
        help: L(
          "Gaji pokok standar golongan (di antara minimum & maksimum): terisi otomatis saat membuat kontrak dan tetap bisa diubah.",
          "Standard base wage of the grade (between minimum & maximum): filled in automatically when creating a contract and can still be changed.",
        ),
      },
      { name: "sequence", label: L("Urutan", "Sequence"), type: "number" },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "leave-allocations",
    model: "leave_allocation",
    csv: true,
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
    csv: true,
    title: L("Jenis Cuti", "Leave Types"),
    singular: L("Jenis cuti", "Leave type"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "paid", label: L("Dibayar", "Paid") },
      { name: "requiresAllocation", label: L("Pakai saldo", "Uses balance") },
      { name: "requiresAttachment", label: L("Wajib lampiran", "Attachment") },
    ],
    fields: [
      name(),
      {
        name: "paid",
        label: L("Dibayar (tidak memotong gaji)", "Paid (no salary deduction)"),
        type: "boolean",
      },
      { name: "requiresAllocation", label: L("Memakai jatah/saldo", "Requires allocation"), type: "boolean" },
      { name: "code", label: L("Kode payroll", "Payroll code"), type: "text" },
      { name: "allowHalfDay", label: L("Boleh setengah hari", "Half days allowed"), type: "boolean" },
      {
        name: "maxConsecutiveDays",
        label: L("Maks. hari per pengajuan (kosong = bebas)", "Max days per request (empty = no limit)"),
        type: "number",
      },
      { name: "allowNegative", label: L("Boleh saldo minus", "Negative balance allowed"), type: "boolean" },
      {
        name: "negativeLimit",
        label: L("Batas saldo minus (hari)", "Negative limit (days)"),
        type: "number",
      },
      {
        name: "requiresAttachment",
        label: L("Wajib lampiran (mis. surat dokter)", "Attachment required (e.g. doctor's note)"),
        type: "boolean",
      },
      {
        name: "countCalendarDays",
        label: L("Hitung hari kalender (bukan hari kerja)", "Count calendar days (not working days)"),
        type: "boolean",
      },
      {
        name: "employeeRequestable",
        label: L("Bisa diajukan karyawan (portal)", "Employees can request (portal)"),
        type: "boolean",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "work-locations",
    model: "work_location",
    title: L("Lokasi Kerja", "Work Locations"),
    singular: L("Lokasi kerja", "Work location"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "name", label: L("Nama", "Name") },
      { name: "radiusM", label: L("Radius (m)", "Radius (m)") },
      { name: "enforceGeofence", label: L("Wajib di area", "Enforced") },
      { name: "active", label: L("Aktif", "Active") },
    ],
    fields: [
      name(),
      {
        name: "branchId",
        label: L("Cabang", "Branch"),
        type: "ref",
        resource: "branches",
        display: "name",
      },
      {
        name: "latitude",
        label: L("Latitude (mis. -6.200000)", "Latitude (e.g. -6.200000)"),
        type: "number",
        required: true,
      },
      {
        name: "longitude",
        label: L("Longitude (mis. 106.816666)", "Longitude (e.g. 106.816666)"),
        type: "number",
        required: true,
      },
      {
        name: "radiusM",
        label: L("Radius absen (meter)", "Check-in radius (meters)"),
        type: "number",
        required: true,
      },
      {
        name: "enforceGeofence",
        label: L("Tolak absen di luar radius", "Reject check-ins outside the radius"),
        type: "boolean",
      },
      { name: "active", label: L("Aktif", "Active"), type: "boolean" },
    ],
  },
  {
    path: "leave-block-dates",
    model: "leave_block_date",
    title: L("Tanggal Blok Cuti", "Time Off Blackout Dates"),
    singular: L("Tanggal blok cuti", "Blackout date"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "dateFrom", label: L("Dari", "From") },
      { name: "dateTo", label: L("Sampai", "To") },
      { name: "departmentId", label: L("Departemen", "Department") },
      { name: "reason", label: L("Alasan", "Reason") },
    ],
    fields: [
      { name: "dateFrom", label: L("Dari", "From"), type: "date", required: true },
      { name: "dateTo", label: L("Sampai", "To"), type: "date", required: true },
      {
        name: "departmentId",
        label: L("Departemen (kosong = semua)", "Department (empty = all)"),
        type: "ref",
        resource: "departments",
        display: "name",
      },
      {
        name: "reason",
        label: L("Alasan (tampil ke karyawan)", "Reason (shown to employees)"),
        type: "text",
        required: true,
      },
    ],
  },
  {
    path: "overtimes",
    model: "overtime",
    csv: true,
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
    csv: true,
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
    csv: true,
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
    csv: true,
    title: L("Hari Libur", "Public Holidays"),
    singular: L("Hari libur", "Public holiday"),
    permission: "hr",
    writePermission: "hr.manage",
    group: HR,
    columns: [
      { name: "date", label: L("Tanggal", "Date") },
      { name: "name", label: L("Nama", "Name") },
    ],
    fields: [
      { name: "date", label: L("Tanggal", "Date"), type: "date", required: true },
      name(),
      { name: "kind", label: L("Jenis", "Type"), type: "select", options: HOLIDAY_KINDS, required: true },
      companyScope,
    ],
  },
  {
    path: "salary-components",
    model: "salary_component",
    csv: true,
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
      {
        name: "calc",
        label: L("Cara hitung", "Computation"),
        type: "select",
        section: L("Berbasis kehadiran", "Attendance based"),
        options: [
          ["fixed_amount", L("Nilai tetap", "Fixed amount")],
          [
            "per_attendance_day",
            L("Per hari hadir (uang makan/transport)", "Per attendance day (meal/transport)"),
          ],
          ["attendance_premium", L("Premi kehadiran", "Attendance premium")],
        ],
      },
      {
        name: "rate",
        label: L(
          "Nilai bawaan (tarif per hari / premi; nilai di kontrak menimpa)",
          "Default value (daily rate / premium; contract value overrides)",
        ),
        type: "number",
      },
      {
        name: "autoAssign",
        label: L(
          "Berlaku otomatis untuk semua karyawan (tanpa ditambahkan ke kontrak)",
          "Applies to all employees automatically (no need to add to contracts)",
        ),
        type: "boolean",
      },
      {
        name: "premiumMaxLate",
        label: L("Premi hilang bila terlambat lebih dari … kali", "Premium lost if late more than … times"),
        type: "number",
      },
      {
        name: "premiumMaxAbsent",
        label: L(
          "Premi hilang bila tidak hadir lebih dari … hari",
          "Premium lost if absent more than … days",
        ),
        type: "number",
      },
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

export const APPRAISAL_STATE_LABEL: Record<string, Text> = {
  self: L("Penilaian diri", "Self-assessment"),
  manager: L("Menunggu atasan", "Awaiting manager"),
  calibration: L("Kalibrasi HR", "HR calibration"),
  done: L("Selesai", "Done"),
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
  complimentary: L("Gratis", "Complimentary"),
  past_due: L("Lewat jatuh tempo", "Past due"),
  cancelling: L("Berakhir di akhir periode", "Ends at period end"),
  expired: L("Berakhir", "Expired"),
  suspended: L("Ditangguhkan", "Suspended"),
};
