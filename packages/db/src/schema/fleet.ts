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

// ---- Armada ----

export const fleetManufacturers = pgTable("fleet_manufacturers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const fleetModels = pgTable("fleet_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  manufacturerId: uuid("manufacturer_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: ["car", "motorcycle", "pickup", "truck", "bus", "other"] })
    .notNull()
    .default("car"),
  seats: smallint("seats"),
  doors: smallint("doors"),
  transmission: text("transmission", { enum: ["manual", "automatic"] }),
  fuelType: text("fuel_type", { enum: ["gasoline", "diesel", "electric", "hybrid", "lpg", "other"] }),
  horsepower: integer("horsepower"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const fleetServiceTypes = pgTable("fleet_service_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: ["contract", "service", "both"] })
    .notNull()
    .default("service"),
  accountId: uuid("account_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const fleetVehicles = pgTable("fleet_vehicles", {
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  licensePlate: text("license_plate").notNull(),
  modelId: uuid("model_id").notNull(),
  state: text("state", { enum: ["new_request", "to_order", "registered", "downgraded"] })
    .notNull()
    .default("registered"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  costCenterId: uuid("cost_center_id"),
  managerUserId: uuid("manager_user_id"),
  driverEmployeeId: uuid("driver_employee_id"),
  nextDriverEmployeeId: uuid("next_driver_employee_id"),
  vin: text("vin"),
  engineNo: text("engine_no"),
  modelYear: smallint("model_year"),
  color: text("color"),
  location: text("location"),
  odometer: numeric("odometer", { precision: 12, scale: 1 }).notNull().default("0"),
  odometerUnit: text("odometer_unit", { enum: ["km", "mi"] })
    .notNull()
    .default("km"),
  orderDate: date("order_date"),
  registrationDate: date("registration_date"),
  catalogValue: numeric("catalog_value", { precision: 20, scale: 2 }),
  purchaseValue: numeric("purchase_value", { precision: 20, scale: 2 }),
  residualValue: numeric("residual_value", { precision: 20, scale: 2 }),
  replacementDate: date("replacement_date"),
  assetId: uuid("asset_id"),
  stnkNo: text("stnk_no"),
  stnkExpiry: date("stnk_expiry"),
  taxDueDate: date("tax_due_date"),
  bpkbNo: text("bpkb_no"),
  kirNo: text("kir_no"),
  kirExpiry: date("kir_expiry"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const fleetDriverAssignments = pgTable("fleet_driver_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  vehicleId: uuid("vehicle_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const fleetContracts = pgTable("fleet_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  serviceTypeId: uuid("service_type_id").notNull(),
  vendorId: uuid("vendor_id"),
  reference: text("reference"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  initialCost: numeric("initial_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  recurringCost: numeric("recurring_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  recurringInterval: text("recurring_interval", { enum: ["none", "daily", "weekly", "monthly", "yearly"] })
    .notNull()
    .default("monthly"),
  includedServices: text("included_services"),
  state: text("state", { enum: ["new", "running", "expired", "closed"] })
    .notNull()
    .default("running"),
  reminderDays: smallint("reminder_days"),
  note: text("note"),
  renewedFromId: uuid("renewed_from_id"),
  ...audit,
});

export const fleetServices = pgTable("fleet_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  serviceTypeId: uuid("service_type_id").notNull(),
  vendorId: uuid("vendor_id"),
  date: date("date").notNull(),
  odometer: numeric("odometer", { precision: 12, scale: 1 }),
  driverEmployeeId: uuid("driver_employee_id"),
  cost: numeric("cost", { precision: 20, scale: 2 }).notNull().default("0"),
  description: text("description"),
  state: text("state", { enum: ["new", "running", "done", "cancelled"] })
    .notNull()
    .default("new"),
  moveId: uuid("move_id"),
  ...audit,
});

export const fleetOdometers = pgTable("fleet_odometers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  vehicleId: uuid("vehicle_id").notNull(),
  date: date("date").notNull(),
  value: numeric("value", { precision: 12, scale: 1 }).notNull(),
  driverEmployeeId: uuid("driver_employee_id"),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const fleetSettings = pgTable("fleet_settings", {
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  reminderDays: smallint("reminder_days").notNull().default(30),
  expenseAccountId: uuid("expense_account_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fleetReminderLog = pgTable("fleet_reminder_log", {
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  sentOn: date("sent_on").notNull(),
});
