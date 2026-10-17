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

export const userRoles = pgTable(
  "user_roles",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

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
  active: boolean("active").notNull().default(true),
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
