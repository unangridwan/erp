import {
  jsonb,
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

// FK di database berbentuk komposit (tenant_id, id); di sini cukup dideklarasikan kolomnya.

export const LEAD_SOURCES = ["website", "referral", "event", "ads", "social", "cold_call", "other"] as const;
export const FORECAST_CATEGORIES = ["pipeline", "best_case", "commit", "omitted"] as const;
export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified"] as const;
export const CONTACT_ROLES = [
  "decision_maker",
  "influencer",
  "champion",
  "evaluator",
  "buyer",
  "user",
  "other",
] as const;
export const ACTIVITY_TYPES = ["call", "meeting", "email", "todo"] as const;

export const crmStages = pgTable("crm_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull().default(10),
  probability: numeric("probability", { precision: 5, scale: 2 }).notNull().default("10"),
  isWon: boolean("is_won").notNull().default(false),
  fold: boolean("fold").notNull().default(false),
  forecastCategory: text("forecast_category", { enum: FORECAST_CATEGORIES }).notNull().default("pipeline"),
  ...audit,
});

export interface TerritoryRules {
  provinces?: string[];
  cities?: string[];
  industries?: string[];
}

export const crmTerritories = pgTable("crm_territories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull().default(10),
  rules: jsonb("rules").$type<TerritoryRules>().notNull().default({}),
  managerId: uuid("manager_id"),
  memberIds: uuid("member_ids").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const crmQuotas = pgTable("crm_quotas", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id"),
  teamId: uuid("team_id"),
  periodStart: date("period_start").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  ...audit,
});

export const crmForecastAdjustments = pgTable("crm_forecast_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id").notNull(),
  periodStart: date("period_start").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  note: text("note"),
  adjustedBy: uuid("adjusted_by"),
  updatedAt: audit.updatedAt,
});

export const crmLostReasons = pgTable("crm_lost_reasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const salesTeams = pgTable("sales_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id"),
  name: text("name").notNull(),
  leaderId: uuid("leader_id"),
  memberIds: uuid("member_ids").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const paymentTerms = pgTable("payment_terms", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  days: integer("days").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const pricelists = pgTable("pricelists", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id"),
  name: text("name").notNull(),
  currencyCode: text("currency_code").notNull().default("IDR"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const pricelistItems = pgTable("pricelist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  pricelistId: uuid("pricelist_id").notNull(),
  productId: uuid("product_id"),
  categoryId: uuid("category_id"),
  minQuantity: numeric("min_quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  compute: text("compute", { enum: ["fixed", "discount"] })
    .notNull()
    .default("discount"),
  fixedPrice: numeric("fixed_price", { precision: 20, scale: 4 }),
  discount: numeric("discount", { precision: 7, scale: 4 }).notNull().default("0"),
  dateStart: date("date_start"),
  dateEnd: date("date_end"),
  createdAt: audit.createdAt,
});

export const crmLeads = pgTable("crm_leads", {
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  leadType: text("lead_type", { enum: ["lead", "opportunity"] })
    .notNull()
    .default("opportunity"),
  name: text("name").notNull(),
  partnerId: uuid("partner_id"),
  contactName: text("contact_name"),
  partnerName: text("partner_name"),
  email: text("email"),
  phone: text("phone"),
  source: text("source", { enum: LEAD_SOURCES }),
  stageId: uuid("stage_id"),
  userId: uuid("user_id"),
  teamId: uuid("team_id"),
  expectedRevenue: numeric("expected_revenue", { precision: 20, scale: 2 }).notNull().default("0"),
  probability: numeric("probability", { precision: 5, scale: 2 }).notNull().default("10"),
  expectedClose: date("expected_close"),
  priority: smallint("priority").notNull().default(0),
  state: text("state", { enum: ["open", "won", "lost"] })
    .notNull()
    .default("open"),
  lostReasonId: uuid("lost_reason_id"),
  lostNote: text("lost_note"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  description: text("description"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  leadStatus: text("lead_status", { enum: LEAD_STATUSES }).notNull().default("new"),
  title: text("title"),
  industry: text("industry"),
  website: text("website"),
  employeeCount: integer("employee_count"),
  annualRevenue: numeric("annual_revenue", { precision: 20, scale: 2 }),
  street: text("street"),
  city: text("city"),
  province: text("province"),
  nextStep: text("next_step"),
  contactId: uuid("contact_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  forecastCategory: text("forecast_category", { enum: FORECAST_CATEGORIES }),
  territoryId: uuid("territory_id"),
  ...audit,
});

export const crmLeadProducts = pgTable("crm_lead_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  leadId: uuid("lead_id").notNull(),
  sequence: integer("sequence").notNull().default(10),
  productId: uuid("product_id").notNull(),
  name: text("name"),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
  priceUnit: numeric("price_unit", { precision: 20, scale: 4 }).notNull().default("0"),
  discount: numeric("discount", { precision: 7, scale: 4 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 20, scale: 2 }).notNull().default("0"),
  createdAt: audit.createdAt,
});

export const crmContactRoles = pgTable("crm_contact_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  leadId: uuid("lead_id").notNull(),
  partnerId: uuid("partner_id").notNull(),
  role: text("role", { enum: CONTACT_ROLES }).notNull().default("other"),
  isPrimary: boolean("is_primary").notNull().default(false),
  note: text("note"),
  createdAt: audit.createdAt,
});

export const crmStageHistory = pgTable("crm_stage_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  leadId: uuid("lead_id").notNull(),
  fromStageId: uuid("from_stage_id"),
  toStageId: uuid("to_stage_id"),
  state: text("state", { enum: ["open", "won", "lost"] })
    .notNull()
    .default("open"),
  expectedRevenue: numeric("expected_revenue", { precision: 20, scale: 2 }).notNull().default("0"),
  probability: numeric("probability", { precision: 5, scale: 2 }).notNull().default("0"),
  userId: uuid("user_id"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledActivities = pgTable("scheduled_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  resModel: text("res_model").notNull(),
  resId: uuid("res_id").notNull(),
  activityType: text("activity_type", { enum: ACTIVITY_TYPES }).notNull().default("todo"),
  summary: text("summary").notNull(),
  note: text("note"),
  dueDate: date("due_date").notNull(),
  userId: uuid("user_id").notNull(),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const saleOrders = pgTable("sale_orders", {
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  state: text("state", { enum: ["draft", "sent", "sale", "cancel"] })
    .notNull()
    .default("draft"),
  partnerId: uuid("partner_id").notNull(),
  dateOrder: date("date_order").notNull(),
  validityDate: date("validity_date"),
  paymentTermId: uuid("payment_term_id"),
  pricelistId: uuid("pricelist_id"),
  currencyCode: text("currency_code").notNull(),
  userId: uuid("user_id"),
  teamId: uuid("team_id"),
  leadId: uuid("lead_id"),
  warehouseId: uuid("warehouse_id"),
  clientOrderRef: text("client_order_ref"),
  note: text("note"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  profitCenterId: uuid("profit_center_id"),
  amountUntaxed: numeric("amount_untaxed", { precision: 20, scale: 2 }).notNull().default("0"),
  amountTax: numeric("amount_tax", { precision: 20, scale: 2 }).notNull().default("0"),
  amountTotal: numeric("amount_total", { precision: 20, scale: 2 }).notNull().default("0"),
  invoiceStatus: text("invoice_status", { enum: ["no", "to_invoice", "invoiced"] })
    .notNull()
    .default("no"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  icPurchaseOrderId: uuid("ic_purchase_order_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const saleOrderLines = pgTable("sale_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  productId: uuid("product_id"),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
  priceUnit: numeric("price_unit", { precision: 20, scale: 4 }).notNull().default("0"),
  discount: numeric("discount", { precision: 7, scale: 4 }).notNull().default("0"),
  taxIds: uuid("tax_ids").array().notNull().default([]),
  priceSubtotal: numeric("price_subtotal", { precision: 20, scale: 2 }).notNull().default("0"),
  isDownpayment: boolean("is_downpayment").notNull().default(false),
  /** Satuan baris & rasionya ke satuan produk (faktor baris ÷ faktor produk). */
  uomId: uuid("uom_id"),
  uomRatio: numeric("uom_ratio", { precision: 18, scale: 6 }).notNull().default("1"),
  dropship: boolean("dropship").notNull().default(false),
  createdAt: audit.createdAt,
});

/** Aturan komisi: khusus penjual, lalu tim penjualan, lalu bawaan perusahaan (penjual & tim kosong). */
export const commissionPlans = pgTable("commission_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 7, scale: 4 }).notNull(),
  basis: text("basis", { enum: ["invoiced", "paid"] })
    .notNull()
    .default("invoiced"),
  userId: uuid("user_id"),
  teamId: uuid("team_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});
