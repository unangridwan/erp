import { boolean, date, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

// FK di database berbentuk komposit (tenant_id, id); di sini cukup dideklarasikan kolomnya.

export const LOCATION_USAGES = ["view", "internal", "supplier", "customer", "inventory", "transit"] as const;
export const PICKING_TYPES = ["incoming", "outgoing", "internal", "dropship"] as const;
export const PICKING_STATES = ["draft", "ready", "done", "cancel"] as const;

export const stockLocations = pgTable("stock_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  parentId: uuid("parent_id"),
  name: text("name").notNull(),
  completeName: text("complete_name").notNull(),
  usage: text("usage", { enum: LOCATION_USAGES }).notNull(),
  warehouseId: uuid("warehouse_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  branchId: uuid("branch_id"),
  viewLocationId: uuid("view_location_id").notNull(),
  lotStockId: uuid("lot_stock_id").notNull(),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const stockLots = pgTable("stock_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  productId: uuid("product_id").notNull(),
  name: text("name").notNull(),
  expirationDate: date("expiration_date"),
  note: text("note"),
  createdAt: audit.createdAt,
});

export const stockPickings = pgTable("stock_pickings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  pickingType: text("picking_type", { enum: PICKING_TYPES }).notNull(),
  state: text("state", { enum: PICKING_STATES }).notNull().default("draft"),
  warehouseId: uuid("warehouse_id").notNull(),
  partnerId: uuid("partner_id"),
  locationId: uuid("location_id").notNull(),
  locationDestId: uuid("location_dest_id").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  dateDone: timestamp("date_done", { withTimezone: true }),
  origin: text("origin"),
  saleOrderId: uuid("sale_order_id"),
  purchaseOrderId: uuid("purchase_order_id"),
  returnOfId: uuid("return_of_id"),
  backorderOfId: uuid("backorder_of_id"),
  note: text("note"),
  accountMoveId: uuid("account_move_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const stockMoves = pgTable("stock_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  pickingId: uuid("picking_id"),
  productId: uuid("product_id").notNull(),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  quantityDone: numeric("quantity_done", { precision: 18, scale: 4 }).notNull().default("0"),
  /** Dicadangkan dari stok lokasi asal selama pergerakan siap. */
  quantityReserved: numeric("quantity_reserved", { precision: 18, scale: 4 }).notNull().default("0"),
  locationId: uuid("location_id").notNull(),
  locationDestId: uuid("location_dest_id").notNull(),
  state: text("state", { enum: PICKING_STATES }).notNull().default("draft"),
  priceUnit: numeric("price_unit", { precision: 20, scale: 4 }),
  unitCost: numeric("unit_cost", { precision: 20, scale: 4 }),
  value: numeric("value", { precision: 20, scale: 2 }),
  saleLineId: uuid("sale_line_id"),
  purchaseLineId: uuid("purchase_line_id"),
  originReturnMoveId: uuid("origin_return_move_id"),
  isInventory: boolean("is_inventory").notNull().default(false),
  reference: text("reference"),
  date: timestamp("date", { withTimezone: true }),
  createdAt: audit.createdAt,
});

export const stockMoveLines = pgTable("stock_move_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  moveId: uuid("move_id").notNull(),
  lotId: uuid("lot_id").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
});

export const stockQuants = pgTable("stock_quants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  productId: uuid("product_id").notNull(),
  locationId: uuid("location_id").notNull(),
  lotId: uuid("lot_id"),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  updatedAt: audit.updatedAt,
});

export const stockValuationLayers = pgTable("stock_valuation_layers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  productId: uuid("product_id").notNull(),
  stockMoveId: uuid("stock_move_id"),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 20, scale: 4 }).notNull(),
  value: numeric("value", { precision: 20, scale: 2 }).notNull(),
  remainingQty: numeric("remaining_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  remainingValue: numeric("remaining_value", { precision: 20, scale: 2 }).notNull().default("0"),
  description: text("description"),
  accountMoveId: uuid("account_move_id"),
  createdAt: audit.createdAt,
});

export const productCompanyCosts = pgTable(
  "product_company_costs",
  {
    tenantId: tenantId(),
    companyId: uuid("company_id").notNull(),
    productId: uuid("product_id").notNull(),
    averageCost: numeric("average_cost", { precision: 20, scale: 4 }).notNull().default("0"),
    updatedAt: audit.updatedAt,
  },
  (t) => [primaryKey({ columns: [t.companyId, t.productId] })],
);

export const stockReorderRules = pgTable("stock_reorder_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  productId: uuid("product_id").notNull(),
  minQty: numeric("min_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  maxQty: numeric("max_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  qtyMultiple: numeric("qty_multiple", { precision: 18, scale: 4 }).notNull().default("1"),
  active: boolean("active").notNull().default(true),
  ...audit,
});
