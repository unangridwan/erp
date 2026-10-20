import { boolean, pgTable, smallint, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { audit, tenantId, users } from "./core.js";

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  familyId: uuid("family_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: audit.createdAt,
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  roleIds: uuid("role_ids").array().notNull().default([]),
  companyIds: uuid("company_ids").array().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: audit.createdAt,
});

/** Wilayah administrasi Indonesia (global). Level 1 provinsi, 2 kab/kota, 3 kecamatan, 4 desa/kelurahan. */
export const regions = pgTable("regions", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  level: smallint("level").notNull(),
  parentCode: text("parent_code").references((): AnyPgColumn => regions.code),
});

/** Konfigurasi SSO OpenID Connect per tenant. */
export const tenantSso = pgTable("tenant_sso", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  label: text("label").notNull().default("SSO"),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc"),
  allowedDomains: text("allowed_domains").array().notNull().default([]),
  autoProvision: boolean("auto_provision").notNull().default(false),
  defaultRoleId: uuid("default_role_id"),
  enforce: boolean("enforce").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ...audit,
});

/** Sumber kurs otomatis per tenant. */
export const fxSettings = pgTable("fx_settings", {
  tenantId: tenantId().primaryKey(),
  source: text("source", { enum: ["manual", "frankfurter"] })
    .notNull()
    .default("manual"),
  currencies: text("currencies").array().notNull().default(["USD"]),
  daily: boolean("daily").notNull().default(false),
  lastFetchAt: timestamp("last_fetch_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: audit.updatedAt,
});
