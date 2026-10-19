import {
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
export const ACTIVITY_TYPES = ["call", "meeting", "email", "todo"] as const;

export const crmStages = pgTable("crm_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull().default(10),
  probability: numeric("probability", { precision: 5, scale: 2 }).notNull().default("10"),
  isWon: boolean("is_won").notNull().default(false),
  fold: boolean("fold").notNull().default(false),
  ...audit,
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
  ...audit,
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
