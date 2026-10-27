import {
  boolean,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
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
  /** Undangan portal dari data karyawan: akun baru ditautkan ke karyawan ini. */
  employeeId: uuid("employee_id"),
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
  protocol: text("protocol", { enum: ["oidc", "saml"] })
    .notNull()
    .default("oidc"),
  issuer: text("issuer"),
  clientId: text("client_id"),
  clientSecretEnc: text("client_secret_enc"),
  samlEntryPoint: text("saml_entry_point"),
  samlIdpCert: text("saml_idp_cert"),
  samlIdpIssuer: text("saml_idp_issuer"),
  samlEmailAttribute: text("saml_email_attribute"),
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

/** Aplikasi terhubung: klien OpenID Connect (ERP sebagai penyedia login), akun layanan API, webhook keluar. */
export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  /** Publik, format `<tenant_id>.<acak>`. */
  clientId: text("client_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  redirectUris: text("redirect_uris").array().notNull().default([]),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array().notNull().default([]),
  /** Kosong = semua pengguna aktif boleh masuk. */
  allowedRoleIds: uuid("allowed_role_ids").array().notNull().default([]),
  serviceUserId: uuid("service_user_id").references(() => users.id, { onDelete: "set null" }),
  webhookUrl: text("webhook_url"),
  webhookSecretEnc: text("webhook_secret_enc"),
  webhookEvents: text("webhook_events").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  ...audit,
});

export const oauthCodes = pgTable("oauth_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  clientId: uuid("client_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id"),
  codeHash: text("code_hash").notNull().unique(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  nonce: text("nonce"),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: audit.createdAt,
});

export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  clientId: uuid("client_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id"),
  familyId: uuid("family_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: audit.createdAt,
});

/** Kunci tanda tangan id_token (global; kunci privat terenkripsi ENCRYPTION_KEY). */
export const oidcKeys = pgTable("oidc_keys", {
  kid: text("kid").primaryKey(),
  alg: text("alg").notNull().default("RS256"),
  privateJwkEnc: text("private_jwk_enc").notNull(),
  publicJwk: jsonb("public_jwk").$type<Record<string, unknown>>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: audit.createdAt,
});

/** Outbox webhook (diisi trigger database); isi event dibangun saat dikirim. */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  clientId: uuid("client_id").notNull(),
  event: text("event").notNull(),
  resModel: text("res_model").notNull(),
  resId: uuid("res_id").notNull(),
  state: text("state", { enum: ["pending", "sent", "failed"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  responseStatus: integer("response_status"),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: audit.createdAt,
});
