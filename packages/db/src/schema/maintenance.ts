import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

/** Tim perawatan (anggota = pengguna). */
export const maintenanceTeams = pgTable("maintenance_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  memberIds: uuid("member_ids").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  ...audit,
});

/** Peralatan/mesin yang dirawat (bisa terhubung aset tetap & stasiun kerja). */
export const equipment = pgTable("equipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category"),
  assetId: uuid("asset_id"),
  workCenterId: uuid("work_center_id"),
  location: text("location"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  costCenterId: uuid("cost_center_id"),
  serialNo: text("serial_no"),
  vendorId: uuid("vendor_id"),
  warrantyUntil: date("warranty_until"),
  teamId: uuid("team_id"),
  technicianUserId: uuid("technician_user_id"),
  meterUnit: text("meter_unit", { enum: ["hours", "km", "cycles"] }),
  meter: numeric("meter", { precision: 14, scale: 1 }).notNull().default("0"),
  state: text("state", { enum: ["operational", "down", "retired"] })
    .notNull()
    .default("operational"),
  criticality: text("criticality", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  note: text("note"),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  ...audit,
});

export const equipmentMeterReadings = pgTable("equipment_meter_readings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  equipmentId: uuid("equipment_id").notNull(),
  date: date("date").notNull(),
  value: numeric("value", { precision: 14, scale: 1 }).notNull(),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

/** Rencana perawatan berkala: per N hari dan/atau per N satuan meter. */
export const maintenancePlans = pgTable("maintenance_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  equipmentId: uuid("equipment_id").notNull(),
  name: text("name").notNull(),
  intervalDays: integer("interval_days"),
  intervalMeter: numeric("interval_meter", { precision: 14, scale: 1 }),
  leadDays: integer("lead_days").notNull().default(0),
  startDate: date("start_date").notNull(),
  lastDoneDate: date("last_done_date"),
  lastDoneMeter: numeric("last_done_meter", { precision: 14, scale: 1 }),
  tasks: jsonb("tasks").$type<{ label: string }[]>().notNull().default([]),
  durationHours: numeric("duration_hours", { precision: 8, scale: 2 }),
  teamId: uuid("team_id"),
  technicianUserId: uuid("technician_user_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

/** Permintaan/work order perawatan (preventif dari rencana atau korektif dari laporan kerusakan). */
export const maintenanceRequests = pgTable("maintenance_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  kind: text("kind", { enum: ["preventive", "corrective"] })
    .notNull()
    .default("corrective"),
  planId: uuid("plan_id"),
  planCycle: text("plan_cycle"),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
    .notNull()
    .default("normal"),
  requestedBy: uuid("requested_by"),
  teamId: uuid("team_id"),
  technicianUserId: uuid("technician_user_id"),
  scheduledDate: date("scheduled_date"),
  state: text("state", { enum: ["new", "scheduled", "in_progress", "done", "cancelled"] })
    .notNull()
    .default("new"),
  breakdownAt: timestamp("breakdown_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  downtimeHours: numeric("downtime_hours", { precision: 10, scale: 2 }),
  checklist: jsonb("checklist").$type<{ label: string; done: boolean }[]>().notNull().default([]),
  resolution: text("resolution"),
  laborHours: numeric("labor_hours", { precision: 8, scale: 2 }),
  laborCost: numeric("labor_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  vendorId: uuid("vendor_id"),
  vendorCost: numeric("vendor_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  moveId: uuid("move_id"),
  partsCost: numeric("parts_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  partsMoveId: uuid("parts_move_id"),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid("created_by"),
  ...audit,
});

export const maintenanceParts = pgTable("maintenance_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  requestId: uuid("request_id").notNull(),
  productId: uuid("product_id").notNull(),
  quantity: numeric("quantity", { precision: 16, scale: 4 }).notNull(),
  locationId: uuid("location_id"),
  lotName: text("lot_name"),
  cost: numeric("cost", { precision: 20, scale: 2 }),
});

export const maintenanceSettings = pgTable(
  "maintenance_settings",
  {
    tenantId: tenantId(),
    companyId: uuid("company_id").notNull(),
    expenseAccountId: uuid("expense_account_id"),
    partsLocationId: uuid("parts_location_id"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.companyId] })],
);
