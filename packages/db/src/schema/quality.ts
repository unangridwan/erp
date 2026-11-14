import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export interface QualityItem {
  label: string;
  kind: "pass_fail" | "measure";
  min?: number | null;
  max?: number | null;
  unit?: string | null;
  photo?: boolean;
}
export interface QualityResult extends QualityItem {
  value: string | null;
  passed: boolean | null;
  note?: string | null;
}

/** Titik kontrol mutu: kapan (penerimaan/produksi), untuk apa (produk/kategori/pemasok), dan apa yang dicek. */
export const qualityPoints = pgTable("quality_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  trigger: text("trigger", { enum: ["receipt", "production"] }).notNull(),
  productId: uuid("product_id"),
  categoryId: uuid("category_id"),
  partnerId: uuid("partner_id"),
  sampling: text("sampling", { enum: ["all", "percent", "quantity"] })
    .notNull()
    .default("all"),
  sampleValue: numeric("sample_value", { precision: 12, scale: 2 }),
  items: jsonb("items").$type<QualityItem[]>().notNull().default([]),
  instructions: text("instructions"),
  quarantine: boolean("quarantine").notNull().default(true),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const qualityChecks = pgTable("quality_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  pointId: uuid("point_id"),
  trigger: text("trigger", { enum: ["receipt", "production"] }).notNull(),
  pickingId: uuid("picking_id"),
  stockMoveId: uuid("stock_move_id"),
  productionOrderId: uuid("production_order_id"),
  productId: uuid("product_id").notNull(),
  partnerId: uuid("partner_id"),
  lots: jsonb("lots").$type<{ lotId: string; quantity: string }[]>().notNull().default([]),
  quantity: numeric("quantity", { precision: 16, scale: 4 }).notNull(),
  sampleQty: numeric("sample_qty", { precision: 16, scale: 4 }).notNull(),
  locationId: uuid("location_id").notNull(),
  destLocationId: uuid("dest_location_id").notNull(),
  state: text("state", { enum: ["pending", "passed", "failed", "conditional"] })
    .notNull()
    .default("pending"),
  results: jsonb("results").$type<QualityResult[]>().notNull().default([]),
  decision: text("decision", { enum: ["accept", "conditional", "return", "scrap"] }),
  note: text("note"),
  inspectorId: uuid("inspector_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  returnPickingId: uuid("return_picking_id"),
  scrapMoveId: uuid("scrap_move_id"),
  ...audit,
});

export const qualityCheckPhotos = pgTable("quality_check_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  checkId: uuid("check_id").notNull(),
  itemIndex: integer("item_index"),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

/** Catatan ketidaksesuaian (NCR). */
export const qualityAlerts = pgTable("quality_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  checkId: uuid("check_id"),
  productId: uuid("product_id"),
  partnerId: uuid("partner_id"),
  title: text("title").notNull(),
  description: text("description"),
  rootCause: text("root_cause"),
  correctiveAction: text("corrective_action"),
  responsibleUserId: uuid("responsible_user_id"),
  state: text("state", { enum: ["open", "in_progress", "closed"] })
    .notNull()
    .default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  ...audit,
});
