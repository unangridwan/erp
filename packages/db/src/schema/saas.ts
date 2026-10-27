import { boolean, integer, numeric, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenants } from "./core.js";

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "cancelled", "suspended"] as const;

/** Global (tanpa RLS): katalog paket langganan. `null` pada batas = tanpa batas. */
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  priceMonthly: numeric("price_monthly", { precision: 20, scale: 2 }).notNull().default("0"),
  priceYearly: numeric("price_yearly", { precision: 20, scale: 2 }).notNull().default("0"),
  maxUsers: integer("max_users"),
  maxCompanies: integer("max_companies"),
  modules: text("modules").array().notNull(),
  public: boolean("public").notNull().default(true),
  sort: smallint("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...audit,
});

/** Satu langganan per tenant. Ditulis hanya lewat koneksi pemilik (layanan billing). */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
  billingCycle: text("billing_cycle", { enum: BILLING_CYCLES }).notNull().default("monthly"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** Gratis dari admin platform; `complimentaryUntil` null = tanpa batas waktu. */
  complimentary: boolean("complimentary").notNull().default(false),
  complimentaryUntil: timestamp("complimentary_until", { withTimezone: true }),
  complimentaryNote: text("complimentary_note"),
  complimentaryBy: uuid("complimentary_by"),
  ...audit,
});

export const billingInvoices = pgTable("billing_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  number: text("number").notNull().unique(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  billingCycle: text("billing_cycle", { enum: BILLING_CYCLES }).notNull(),
  purpose: text("purpose", { enum: ["new", "renewal"] }).notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  tax: numeric("tax", { precision: 20, scale: 2 }).notNull(),
  total: numeric("total", { precision: 20, scale: 2 }).notNull(),
  status: text("status", { enum: ["open", "paid", "void"] })
    .notNull()
    .default("open"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  provider: text("provider"),
  providerRef: text("provider_ref"),
  paymentUrl: text("payment_url"),
  ...audit,
});
