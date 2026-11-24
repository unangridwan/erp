import { boolean, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

/** Laporan kustom tersimpan: dataset HR/Payroll + konfigurasi kolom, filter, kelompok, agregasi, grafik. */
export const savedReports = pgTable("saved_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  dataset: text("dataset").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  visibility: text("visibility", { enum: ["private", "shared"] })
    .notNull()
    .default("private"),
  ...audit,
});

/** Jadwal kirim laporan via email. */
export const reportSchedules = pgTable("report_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  reportId: uuid("report_id").notNull(),
  frequency: text("frequency", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  hour: smallint("hour").notNull().default(7),
  weekday: smallint("weekday"),
  monthday: smallint("monthday"),
  format: text("format", { enum: ["xlsx", "csv", "pdf"] })
    .notNull()
    .default("xlsx"),
  recipients: text("recipients").array().notNull(),
  active: boolean("active").notNull().default(true),
  lastPeriod: text("last_period"),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  ...audit,
});

/** Riwayat pengiriman laporan terjadwal. */
export const reportDeliveries = pgTable("report_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  scheduleId: uuid("schedule_id").notNull(),
  period: text("period").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  rows: integer("rows"),
  recipients: text("recipients").array().notNull().default([]),
  error: text("error"),
  manual: boolean("manual").notNull().default(false),
});

/** Dashboard BI kustom: widget KPI/grafik/tabel dari laporan tersimpan atau konfigurasi dataset. */
export const dashboards = pgTable("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  visibility: text("visibility", { enum: ["private", "shared"] })
    .notNull()
    .default("private"),
  widgets: jsonb("widgets").$type<Record<string, unknown>[]>().notNull().default([]),
  /** Dokumen BI v2 (halaman, visual, filter); null = dashboard lama berbasis `widgets`. */
  document: jsonb("document").$type<Record<string, unknown>>(),
  ...audit,
});

/** Dashboard yang disematkan di Beranda (ref = id atau "builtin:<kunci>"). */
export const dashboardPins = pgTable("dashboard_pins", {
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id").notNull(),
  ref: text("ref").notNull(),
  sequence: integer("sequence").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Alur bisnis: SLA (hari) & departemen penanggung jawab per tahap proses (o2c, p2p, mfg, h2p). */
export const flowStageSettings = pgTable("flow_stage_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  process: text("process", { enum: ["o2c", "p2p", "mfg", "h2p"] }).notNull(),
  stage: text("stage").notNull(),
  slaDays: integer("sla_days"),
  departmentId: uuid("department_id"),
  ...audit,
});
