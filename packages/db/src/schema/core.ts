import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  numeric,
  smallint,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { CONSOLIDATION_METHODS, ENTITY_TYPES } from "@erp/shared";

const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Kolom tenant: default diambil dari `app.tenant_id` sesi, ditegakkan oleh RLS. */
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`)
    .references(() => tenants.id, { onDelete: "cascade" });

export const entityType = pgEnum("entity_type", ENTITY_TYPES);
export const consolidationMethod = pgEnum("consolidation_method", CONSOLIDATION_METHODS);

/** Global (tanpa RLS): satu baris per pelanggan SaaS. */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...audit,
});

/** Entitas legal dalam grup: holding, anak, cucu, asosiasi, JV. */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    parentId: uuid("parent_id").references((): AnyPgColumn => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    entityType: entityType("entity_type").notNull().default("subsidiary"),
    npwp: text("npwp"),
    currencyCode: text("currency_code").notNull().default("IDR"),
    fiscalYearStartMonth: smallint("fiscal_year_start_month").notNull().default(1),
    active: boolean("active").notNull().default(true),
    ...audit,
  },
  (t) => [uniqueIndex("companies_tenant_code_uq").on(t.tenantId, t.code)],
);

/** Riwayat kepemilikan bertanggal antar perusahaan grup (dasar konsolidasi). */
export const ownershipHistory = pgTable("ownership_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  parentCompanyId: uuid("parent_company_id")
    .notNull()
    .references(() => companies.id),
  childCompanyId: uuid("child_company_id")
    .notNull()
    .references(() => companies.id),
  pct: numeric("pct", { precision: 7, scale: 4 }).notNull(),
  method: consolidationMethod("method").notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  ...audit,
});

/** Unit bisnis / divisi — dimensi pelaporan segmen, bisa lintas perusahaan. */
export const businessUnits = pgTable(
  "business_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    ...audit,
  },
  (t) => [uniqueIndex("business_units_tenant_code_uq").on(t.tenantId, t.code)],
);

/** Cabang operasional milik satu perusahaan; `nitku` untuk faktur pajak cabang. */
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nitku: text("nitku"),
    active: boolean("active").notNull().default(true),
    ...audit,
  },
  (t) => [uniqueIndex("branches_company_code_uq").on(t.companyId, t.code)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    active: boolean("active").notNull().default(true),
    ...audit,
  },
  (t) => [uniqueIndex("users_tenant_email_uq").on(t.tenantId, t.email)],
);

/** Perusahaan yang boleh diakses user (multi-company switcher). */
export const userCompanies = pgTable(
  "user_companies",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companyId] })],
);
