import {
  jsonb,
  boolean,
  date,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

// FK di database berbentuk komposit (tenant_id, id); di sini cukup dideklarasikan kolomnya.

export const LOCATION_USAGES = [
  "view",
  "internal",
  "supplier",
  "customer",
  "inventory",
  "transit",
  "production",
] as const;
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
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
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
  productionOrderId: uuid("production_order_id"),
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

/** Landed cost: biaya tambahan penerimaan (angkut, bea masuk, asuransi) yang menambah nilai persediaan. */
export const landedCosts = pgTable("landed_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  date: date("date").notNull(),
  state: text("state", { enum: ["draft", "posted", "cancel"] })
    .notNull()
    .default("draft"),
  vendorBillId: uuid("vendor_bill_id"),
  moveId: uuid("move_id"),
  reversalMoveId: uuid("reversal_move_id"),
  note: text("note"),
  createdBy: uuid("created_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  ...audit,
});

export const landedCostPickings = pgTable("landed_cost_pickings", {
  tenantId: tenantId(),
  landedCostId: uuid("landed_cost_id").notNull(),
  pickingId: uuid("picking_id").notNull(),
});

export const LANDED_COST_SPLIT = ["value", "quantity", "weight", "volume", "equal"] as const;

export const landedCostLines = pgTable("landed_cost_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  landedCostId: uuid("landed_cost_id").notNull(),
  sequence: smallint("sequence").notNull().default(0),
  name: text("name").notNull(),
  accountId: uuid("account_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  splitMethod: text("split_method", { enum: LANDED_COST_SPLIT }).notNull().default("value"),
});

export const landedCostAdjustments = pgTable("landed_cost_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  landedCostId: uuid("landed_cost_id").notNull(),
  lineId: uuid("line_id").notNull(),
  stockMoveId: uuid("stock_move_id").notNull(),
  productId: uuid("product_id").notNull(),
  layerId: uuid("layer_id"),
  basis: numeric("basis", { precision: 24, scale: 6 }).notNull(),
  addition: numeric("addition", { precision: 20, scale: 2 }).notNull(),
  stockPortion: numeric("stock_portion", { precision: 20, scale: 2 }).notNull(),
  soldPortion: numeric("sold_portion", { precision: 20, scale: 2 }).notNull(),
  remainingQtyAtPost: numeric("remaining_qty_at_post", { precision: 18, scale: 4 }).notNull().default("0"),
});

export const STOCK_COUNT_STATES = ["draft", "counting", "in_approval", "approved", "done", "cancel"] as const;

/** Sesi stock opname: snapshot stok sistem, hitung fisik, persetujuan selisih, posting penyesuaian. */
export const stockCounts = pgTable("stock_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  locationId: uuid("location_id").notNull(),
  categoryId: uuid("category_id"),
  date: date("date").notNull(),
  state: text("state", { enum: STOCK_COUNT_STATES }).notNull().default("draft"),
  approvalRequestId: uuid("approval_request_id"),
  note: text("note"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  ...audit,
});

export const stockCountLines = pgTable("stock_count_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  countId: uuid("count_id").notNull(),
  productId: uuid("product_id").notNull(),
  locationId: uuid("location_id").notNull(),
  lotId: uuid("lot_id"),
  lotName: text("lot_name"),
  systemQty: numeric("system_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  countedQty: numeric("counted_qty", { precision: 18, scale: 4 }),
  unitCost: numeric("unit_cost", { precision: 20, scale: 4 }).notNull().default("0"),
  note: text("note"),
  countedBy: uuid("counted_by"),
  countedAt: timestamp("counted_at", { withTimezone: true }),
});
