import { date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

export const PURCHASE_STATES = ["draft", "sent", "to_approve", "purchase", "cancel"] as const;

export const productSuppliers = pgTable("product_suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id"),
  partnerId: uuid("partner_id").notNull(),
  productId: uuid("product_id").notNull(),
  productCode: text("product_code"),
  price: numeric("price", { precision: 20, scale: 4 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("IDR"),
  minQty: numeric("min_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  delayDays: integer("delay_days").notNull().default(0),
  sequence: integer("sequence").notNull().default(10),
  ...audit,
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  state: text("state", { enum: PURCHASE_STATES }).notNull().default("draft"),
  partnerId: uuid("partner_id").notNull(),
  partnerRef: text("partner_ref"),
  dateOrder: date("date_order").notNull(),
  datePlanned: date("date_planned"),
  paymentTermId: uuid("payment_term_id"),
  currencyCode: text("currency_code").notNull(),
  userId: uuid("user_id"),
  warehouseId: uuid("warehouse_id"),
  note: text("note"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  amountUntaxed: numeric("amount_untaxed", { precision: 20, scale: 2 }).notNull().default("0"),
  amountTax: numeric("amount_tax", { precision: 20, scale: 2 }).notNull().default("0"),
  amountTotal: numeric("amount_total", { precision: 20, scale: 2 }).notNull().default("0"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  icSaleOrderId: uuid("ic_sale_order_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const purchaseOrderLines = pgTable("purchase_order_lines", {
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
  datePlanned: date("date_planned"),
  createdAt: audit.createdAt,
});
