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
}

const MASTER = L("Master Data", "Master Data");
const GROUP = L("Struktur Grup", "Group Structure");
const ACCOUNTING = L("Keuangan", "Finance");

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
  can(permissions, `${resource.permission}.write`);
