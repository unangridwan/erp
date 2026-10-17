/** Definisi tampilan list & form per resource — mirip "view" di Odoo. */
export type Field =
  | { name: string; label: string; type: "text" | "email" | "number" | "date"; required?: boolean }
  | { name: string; label: string; type: "boolean" }
  | { name: string; label: string; type: "select"; options: [string, string][]; required?: boolean }
  | {
      name: string;
      label: string;
      type: "ref";
      resource: string;
      display: string;
      valueKey?: string;
      required?: boolean;
    };

export interface Resource {
  path: string;
  model: string;
  title: string;
  singular: string;
  permission: string;
  columns: { name: string; label: string }[];
  fields: Field[];
  group: string;
}

const ENTITY_TYPES: [string, string][] = [
  ["holding", "Holding"],
  ["subsidiary", "Anak perusahaan"],
  ["associate", "Asosiasi"],
  ["joint_venture", "Ventura bersama"],
  ["other", "Lainnya"],
];

export const RESOURCES: Resource[] = [
  {
    path: "partners",
    model: "partner",
    title: "Kontak",
    singular: "Kontak",
    permission: "partner",
    group: "Master Data",
    columns: [
      { name: "name", label: "Nama" },
      { name: "city", label: "Kota" },
      { name: "phone", label: "Telepon" },
      { name: "email", label: "Email" },
    ],
    fields: [
      { name: "name", label: "Nama", type: "text", required: true },
      {
        name: "kind",
        label: "Jenis",
        type: "select",
        options: [
          ["company", "Perusahaan"],
          ["person", "Perorangan"],
        ],
      },
      { name: "isCustomer", label: "Pelanggan", type: "boolean" },
      { name: "isSupplier", label: "Pemasok", type: "boolean" },
      { name: "npwp", label: "NPWP", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Telepon", type: "text" },
      { name: "street", label: "Alamat", type: "text" },
      { name: "city", label: "Kota", type: "text" },
      { name: "province", label: "Provinsi", type: "text" },
      { name: "postalCode", label: "Kode pos", type: "text" },
      {
        name: "companyId",
        label: "Khusus perusahaan (kosong = seluruh grup)",
        type: "ref",
        resource: "companies",
        display: "name",
      },
    ],
  },
  {
    path: "products",
    model: "product",
    title: "Produk",
    singular: "Produk",
    permission: "product",
    group: "Master Data",
    columns: [
      { name: "sku", label: "SKU" },
      { name: "name", label: "Nama" },
      { name: "salePrice", label: "Harga jual" },
      { name: "cost", label: "Biaya" },
    ],
    fields: [
      { name: "sku", label: "SKU", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      {
        name: "productType",
        label: "Tipe",
        type: "select",
        options: [
          ["storable", "Barang stok"],
          ["consumable", "Habis pakai"],
          ["service", "Jasa"],
        ],
      },
      { name: "categoryId", label: "Kategori", type: "ref", resource: "product-categories", display: "name" },
      { name: "uomId", label: "Satuan", type: "ref", resource: "uoms", display: "name", required: true },
      { name: "salePrice", label: "Harga jual", type: "number" },
      { name: "cost", label: "Biaya", type: "number" },
      { name: "barcode", label: "Barcode", type: "text" },
      {
        name: "companyId",
        label: "Khusus perusahaan (kosong = seluruh grup)",
        type: "ref",
        resource: "companies",
        display: "name",
      },
    ],
  },
  {
    path: "product-categories",
    model: "product_category",
    title: "Kategori Produk",
    singular: "Kategori",
    permission: "product",
    group: "Master Data",
    columns: [{ name: "name", label: "Nama" }],
    fields: [
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "parentId", label: "Induk", type: "ref", resource: "product-categories", display: "name" },
    ],
  },
  {
    path: "uoms",
    model: "uom",
    title: "Satuan",
    singular: "Satuan",
    permission: "uom",
    group: "Master Data",
    columns: [
      { name: "name", label: "Nama" },
      { name: "factor", label: "Faktor" },
    ],
    fields: [
      { name: "name", label: "Nama", type: "text", required: true },
      {
        name: "categoryId",
        label: "Kategori",
        type: "ref",
        resource: "uom-categories",
        display: "name",
        required: true,
      },
      { name: "factor", label: "Faktor terhadap satuan referensi", type: "number", required: true },
      { name: "isReference", label: "Satuan referensi", type: "boolean" },
    ],
  },
  {
    path: "companies",
    model: "company",
    title: "Perusahaan",
    singular: "Perusahaan",
    permission: "company",
    group: "Struktur Grup",
    columns: [
      { name: "code", label: "Kode" },
      { name: "name", label: "Nama" },
      { name: "entityType", label: "Jenis" },
      { name: "currencyCode", label: "Mata uang" },
    ],
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "entityType", label: "Jenis entitas", type: "select", options: ENTITY_TYPES },
      { name: "parentId", label: "Induk", type: "ref", resource: "companies", display: "name" },
      { name: "npwp", label: "NPWP", type: "text" },
      {
        name: "currencyCode",
        label: "Mata uang",
        type: "ref",
        resource: "currencies",
        display: "code",
        valueKey: "code",
      },
      { name: "fiscalYearStartMonth", label: "Awal tahun fiskal (bulan)", type: "number" },
    ],
  },
  {
    path: "ownerships",
    model: "ownership",
    title: "Kepemilikan",
    singular: "Kepemilikan",
    permission: "company",
    group: "Struktur Grup",
    columns: [
      { name: "pct", label: "%" },
      { name: "method", label: "Metode" },
      { name: "validFrom", label: "Berlaku sejak" },
    ],
    fields: [
      {
        name: "parentCompanyId",
        label: "Pemilik",
        type: "ref",
        resource: "companies",
        display: "name",
        required: true,
      },
      {
        name: "childCompanyId",
        label: "Dimiliki",
        type: "ref",
        resource: "companies",
        display: "name",
        required: true,
      },
      { name: "pct", label: "Persentase", type: "number", required: true },
      {
        name: "method",
        label: "Metode konsolidasi",
        type: "select",
        required: true,
        options: [
          ["full", "Penuh"],
          ["proportional", "Proporsional"],
          ["equity", "Ekuitas"],
          ["none", "Tidak dikonsolidasi"],
        ],
      },
      { name: "validFrom", label: "Berlaku sejak", type: "date", required: true },
      { name: "validTo", label: "Berlaku sampai", type: "date" },
    ],
  },
  {
    path: "business-units",
    model: "business_unit",
    title: "Unit Bisnis",
    singular: "Unit Bisnis",
    permission: "company",
    group: "Struktur Grup",
    columns: [
      { name: "code", label: "Kode" },
      { name: "name", label: "Nama" },
    ],
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
    ],
  },
  {
    path: "branches",
    model: "branch",
    title: "Cabang",
    singular: "Cabang",
    permission: "company",
    group: "Struktur Grup",
    columns: [
      { name: "code", label: "Kode" },
      { name: "name", label: "Nama" },
      { name: "nitku", label: "NITKU" },
    ],
    fields: [
      {
        name: "companyId",
        label: "Perusahaan",
        type: "ref",
        resource: "companies",
        display: "name",
        required: true,
      },
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "nitku", label: "NITKU", type: "text" },
    ],
  },
];

export const findResource = (path: string) => RESOURCES.find((r) => r.path === path);

export function canWrite(permissions: string[], resource: Resource) {
  return permissions.includes("*") || permissions.includes(`${resource.permission}.write`);
}
