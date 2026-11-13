import { boolean, date, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

export const workCenters = pgTable("work_centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  costPerHour: numeric("cost_per_hour", { precision: 20, scale: 2 }).notNull().default("0"),
  capacityHoursPerDay: numeric("capacity_hours_per_day", { precision: 6, scale: 2 }).notNull().default("8"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const BOM_TYPES = ["normal", "phantom"] as const;

export const boms = pgTable("boms", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  productId: uuid("product_id").notNull(),
  code: text("code"),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
  bomType: text("bom_type", { enum: BOM_TYPES }).notNull().default("normal"),
  /** Lead time produksi (hari) untuk MRP. */
  leadDays: integer("lead_days").notNull().default(0),
  active: boolean("active").notNull().default(true),
  note: text("note"),
  ...audit,
});

export const bomLines = pgTable("bom_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  bomId: uuid("bom_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  productId: uuid("product_id").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  uomId: uuid("uom_id"),
  uomRatio: numeric("uom_ratio", { precision: 18, scale: 6 }).notNull().default("1"),
});

export const bomOperations = pgTable("bom_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  bomId: uuid("bom_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  name: text("name").notNull(),
  workCenterId: uuid("work_center_id").notNull(),
  minutes: numeric("minutes", { precision: 10, scale: 2 }).notNull().default("0"),
});

export const PRODUCTION_STATES = ["draft", "confirmed", "in_progress", "done", "cancel"] as const;

export const productionOrders = pgTable("production_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  productId: uuid("product_id").notNull(),
  bomId: uuid("bom_id").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  locationId: uuid("location_id").notNull(),
  locationDestId: uuid("location_dest_id").notNull(),
  datePlanned: date("date_planned").notNull(),
  state: text("state", { enum: PRODUCTION_STATES }).notNull().default("draft"),
  qtyProduced: numeric("qty_produced", { precision: 18, scale: 4 }).notNull().default("0"),
  lotName: text("lot_name"),
  origin: text("origin"),
  note: text("note"),
  materialCost: numeric("material_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  conversionCost: numeric("conversion_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  unitCost: numeric("unit_cost", { precision: 20, scale: 4 }).notNull().default("0"),
  accountMoveId: uuid("account_move_id"),
  dateDone: timestamp("date_done", { withTimezone: true }),
  createdBy: uuid("created_by"),
  ...audit,
});

export const productionComponents = pgTable("production_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  productId: uuid("product_id").notNull(),
  qtyRequired: numeric("qty_required", { precision: 18, scale: 4 }).notNull(),
  qtyConsumed: numeric("qty_consumed", { precision: 18, scale: 4 }),
  lots: jsonb("lots").$type<{ lotId: string; quantity: string }[]>().notNull().default([]),
  value: numeric("value", { precision: 20, scale: 2 }),
  stockMoveId: uuid("stock_move_id"),
});

export const OPERATION_STATES = ["pending", "running", "done"] as const;

export const productionOperations = pgTable("production_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  name: text("name").notNull(),
  workCenterId: uuid("work_center_id").notNull(),
  plannedMinutes: numeric("planned_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
  actualMinutes: numeric("actual_minutes", { precision: 10, scale: 2 }),
  costPerHour: numeric("cost_per_hour", { precision: 20, scale: 2 }).notNull().default("0"),
  state: text("state", { enum: OPERATION_STATES }).notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  cost: numeric("cost", { precision: 20, scale: 2 }).notNull().default("0"),
});

export const mrpRuns = pgTable("mrp_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  horizonDate: date("horizon_date").notNull(),
  proposals: integer("proposals").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const MRP_PROPOSAL_KINDS = ["manufacture", "purchase"] as const;
export const MRP_PROPOSAL_STATES = ["proposed", "done", "ignored"] as const;

export const mrpProposals = pgTable("mrp_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  runId: uuid("run_id").notNull(),
  productId: uuid("product_id").notNull(),
  kind: text("kind", { enum: MRP_PROPOSAL_KINDS }).notNull(),
  level: integer("level").notNull().default(0),
  demand: numeric("demand", { precision: 18, scale: 4 }).notNull().default("0"),
  available: numeric("available", { precision: 18, scale: 4 }).notNull().default("0"),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  dateNeeded: date("date_needed").notNull(),
  dateStart: date("date_start").notNull(),
  bomId: uuid("bom_id"),
  supplierId: uuid("supplier_id"),
  reason: text("reason"),
  state: text("state", { enum: MRP_PROPOSAL_STATES }).notNull().default("proposed"),
  productionOrderId: uuid("production_order_id"),
  purchaseOrderId: uuid("purchase_order_id"),
});
