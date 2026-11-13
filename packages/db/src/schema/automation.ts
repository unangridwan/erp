import { boolean, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

/** Aturan otomatis: pemicu → syarat → aksi berurutan. */
export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  model: text("model").notNull(),
  trigger: text("trigger", { enum: ["created", "updated", "date", "scheduled"] }).notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>[]>().notNull().default([]),
  onlyWhenChanges: boolean("only_when_changes").notNull().default(false),
  dateField: text("date_field"),
  offsetDays: integer("offset_days").notNull().default(0),
  frequency: text("frequency", { enum: ["daily", "weekly", "monthly"] }),
  hour: smallint("hour").notNull().default(7),
  weekday: smallint("weekday"),
  monthday: smallint("monthday"),
  actions: jsonb("actions").$type<Record<string, unknown>[]>().notNull().default([]),
  webhookSecretEnc: text("webhook_secret_enc"),
  active: boolean("active").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  ...audit,
});

/** Outbox perubahan data dari trigger DB, diproses job setelah commit. */
export const automationEvents = pgTable("automation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id"),
  model: text("model").notNull(),
  resId: uuid("res_id").notNull(),
  kind: text("kind", { enum: ["created", "updated"] }).notNull(),
  old: jsonb("old").$type<Record<string, unknown>>(),
  new: jsonb("new").$type<Record<string, unknown>>().notNull(),
  depth: smallint("depth").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

/** Log eksekusi aturan. */
export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  ruleId: uuid("rule_id").notNull(),
  resId: uuid("res_id"),
  trigger: text("trigger").notNull(),
  periodKey: text("period_key"),
  status: text("status", { enum: ["success", "failed", "skipped"] }).notNull(),
  message: text("message"),
  results: jsonb("results").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
