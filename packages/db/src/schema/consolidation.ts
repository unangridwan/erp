import { boolean, date, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

export const GROUP_ACCOUNT_ROLES = [
  "investment",
  "goodwill",
  "nci_equity",
  "nci_profit",
  "cta",
  "retained_earnings",
  "associate_investment",
  "associate_income",
  "ic_difference",
] as const;

export const CONSOLIDATION_ENTRY_KINDS = [
  "translation",
  "investment",
  "nci_profit",
  "intercompany",
  "equity_method",
  "manual",
] as const;

/** Bagan akun grup: tujuan pemetaan akun lokal semua perusahaan. */
export const groupAccounts = pgTable("group_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  accountType: text("account_type").notNull(),
  role: text("role", { enum: GROUP_ACCOUNT_ROLES }),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const consolidationAccountMap = pgTable("consolidation_account_map", {
  tenantId: tenantId(),
  accountId: uuid("account_id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  groupAccountId: uuid("group_account_id").notNull(),
});

export const consolidationRuns = pgTable("consolidation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  rootCompanyId: uuid("root_company_id").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  currencyCode: text("currency_code").notNull(),
  state: text("state", { enum: ["draft", "final"] })
    .notNull()
    .default("draft"),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  computedAt: timestamp("computed_at", { withTimezone: true }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  ...audit,
});

export const consolidationEntities = pgTable("consolidation_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  runId: uuid("run_id").notNull(),
  companyId: uuid("company_id").notNull(),
  method: text("method", { enum: ["full", "proportional", "equity"] }).notNull(),
  directPct: numeric("direct_pct", { precision: 7, scale: 4 }).notNull(),
  effectivePct: numeric("effective_pct", { precision: 7, scale: 4 }).notNull(),
  currencyCode: text("currency_code").notNull(),
  closingRate: numeric("closing_rate", { precision: 20, scale: 10 }).notNull().default("1"),
  averageRate: numeric("average_rate", { precision: 20, scale: 10 }).notNull().default("1"),
  historicalRate: numeric("historical_rate", { precision: 20, scale: 10 }).notNull().default("1"),
});

export const consolidationBalances = pgTable("consolidation_balances", {
  tenantId: tenantId(),
  runId: uuid("run_id").notNull(),
  companyId: uuid("company_id").notNull(),
  groupAccountId: uuid("group_account_id").notNull(),
  localAmount: numeric("local_amount", { precision: 20, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
});

export const consolidationEntries = pgTable("consolidation_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  runId: uuid("run_id").notNull(),
  kind: text("kind", { enum: CONSOLIDATION_ENTRY_KINDS }).notNull(),
  companyId: uuid("company_id"),
  description: text("description").notNull(),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const consolidationEntryLines = pgTable("consolidation_entry_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  entryId: uuid("entry_id").notNull(),
  groupAccountId: uuid("group_account_id").notNull(),
  companyId: uuid("company_id"),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
});
