import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { audit, companies, tenantId, users } from "./core.js";

export const currencies = pgTable("currencies", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  decimals: smallint("decimals").notNull().default(2),
});

export const currencyRates = pgTable("currency_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  currencyCode: text("currency_code")
    .notNull()
    .references(() => currencies.code),
  rateDate: date("rate_date").notNull(),
  rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
  createdAt: audit.createdAt,
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  /** Peran bawaan (admin/user): tidak bisa dihapus; admin tidak bisa diubah haknya. */
  isSystem: boolean("is_system").notNull().default(false),
  ...audit,
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    tenantId: tenantId(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  /** null = berlaku di semua perusahaan yang boleh diakses pengguna. */
  companyId: uuid("company_id"),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

/** Hak khusus per akun di atas peran: grant menambah, deny mencabut; company null = semua perusahaan. */
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
  effect: text("effect", { enum: ["grant", "deny"] }).notNull(),
  companyId: uuid("company_id"),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").references(() => companies.id),
  parentId: uuid("parent_id").references((): AnyPgColumn => partners.id),
  kind: text("kind", { enum: ["company", "person"] })
    .notNull()
    .default("company"),
  name: text("name").notNull(),
  isCustomer: boolean("is_customer").notNull().default(false),
  isSupplier: boolean("is_supplier").notNull().default(false),
  npwp: text("npwp"),
  email: text("email"),
  phone: text("phone"),
  street: text("street"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  icCompanyId: uuid("ic_company_id").references(() => companies.id),
  taxDocumentType: text("tax_document_type", { enum: ["TIN", "National ID", "Passport", "Other ID"] })
    .notNull()
    .default("TIN"),
  taxDocumentNumber: text("tax_document_number"),
  tku: text("tku").notNull().default("000000"),
  countryCode: text("country_code").notNull().default("IDN"),
  taxTrxCode: text("tax_trx_code").notNull().default("04"),
  paymentTermId: uuid("payment_term_id"),
  pricelistId: uuid("pricelist_id"),
  salespersonId: uuid("salesperson_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const uomCategories = pgTable("uom_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
});

export const uoms = pgTable("uoms", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => uomCategories.id),
  name: text("name").notNull(),
  factor: numeric("factor", { precision: 18, scale: 6 }).notNull().default("1"),
  isReference: boolean("is_reference").notNull().default(false),
  coretaxCode: text("coretax_code"),
  active: boolean("active").notNull().default(true),
});

export const productAttributes = pgTable("product_attributes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull().default(10),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const productAttributeValues = pgTable("product_attribute_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  attributeId: uuid("attribute_id").notNull(),
  name: text("name").notNull(),
  /** Kode pendek untuk SKU varian. */
  code: text("code"),
  sequence: integer("sequence").notNull().default(10),
  priceExtra: numeric("price_extra", { precision: 18, scale: 2 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

/** Akun portal pelanggan: login terpisah dari user internal, terbatas pada dokumen partnernya. */
export const portalUsers = pgTable("portal_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  partnerId: uuid("partner_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  inviteTokenHash: text("invite_token_hash"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  invitedBy: uuid("invited_by"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...audit,
});

export const productCategories = pgTable("product_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  parentId: uuid("parent_id").references((): AnyPgColumn => productCategories.id),
  name: text("name").notNull(),
  ...audit,
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").references(() => companies.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  productType: text("product_type", { enum: ["storable", "consumable", "service"] })
    .notNull()
    .default("storable"),
  categoryId: uuid("category_id").references(() => productCategories.id),
  uomId: uuid("uom_id")
    .notNull()
    .references(() => uoms.id),
  salePrice: numeric("sale_price", { precision: 18, scale: 2 }).notNull().default("0"),
  cost: numeric("cost", { precision: 18, scale: 2 }).notNull().default("0"),
  barcode: text("barcode"),
  tracking: text("tracking", { enum: ["none", "lot", "serial"] })
    .notNull()
    .default("none"),
  costMethod: text("cost_method", { enum: ["average", "fifo"] })
    .notNull()
    .default("average"),
  taxGoodsCode: text("tax_goods_code"),
  /** Tarif PPnBM (%); baris penjualan memakai PPN barang mewah + pajak PPnBM perusahaan bertarif ini. */
  luxuryTaxRate: numeric("luxury_tax_rate", { precision: 5, scale: 2 }),
  /** Satuan bawaan baris penjualan/pembelian (kosong = satuan produk), sekategori dengan `uomId`. */
  saleUomId: uuid("sale_uom_id"),
  purchaseUomId: uuid("purchase_uom_id"),
  /** Bawaan baris penjualan: dikirim langsung dari pemasok ke pelanggan. */
  dropship: boolean("dropship").notNull().default(false),
  /** Produk induk varian: hanya wadah atribut, tidak dipakai di dokumen. */
  isVariantTemplate: boolean("is_variant_template").notNull().default(false),
  variantOfId: uuid("variant_of_id").references((): AnyPgColumn => products.id),
  attributeValueIds: uuid("attribute_value_ids").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const sequences = pgTable("sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  prefix: text("prefix").notNull(),
  padding: smallint("padding").notNull().default(4),
  nextNumber: integer("next_number").notNull().default(1),
  resetYearly: boolean("reset_yearly").notNull().default(true),
  currentYear: smallint("current_year"),
  ...audit,
});

export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  resModel: text("res_model").notNull(),
  resId: uuid("res_id").notNull(),
  action: text("action").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  changes: jsonb("changes"),
  message: text("message"),
  createdAt: audit.createdAt,
});
