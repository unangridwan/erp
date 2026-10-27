import { boolean, date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

/** Proyek dari aplikasi terhubung (salinan untuk ditampilkan di ERP; sumber data tetap di aplikasi asal). */
export const externalProjects = pgTable("external_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  clientId: uuid("client_id").notNull(),
  externalId: text("external_id").notNull(),
  code: text("code"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: ["active", "on_hold", "done", "cancelled"] })
    .notNull()
    .default("active"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  managerEmployeeId: uuid("manager_employee_id"),
  url: text("url"),
  ...audit,
});

export const externalProjectMembers = pgTable("external_project_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  projectId: uuid("project_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  role: text("role"),
  allocation: numeric("allocation", { precision: 5, scale: 2 }),
  startDate: date("start_date"),
  endDate: date("end_date"),
});

export const externalTasks = pgTable("external_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  clientId: uuid("client_id").notNull(),
  projectId: uuid("project_id").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["todo", "in_progress", "review", "done", "cancelled"] })
    .notNull()
    .default("todo"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
    .notNull()
    .default("normal"),
  assigneeEmployeeId: uuid("assignee_employee_id"),
  dueDate: date("due_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  url: text("url"),
  ...audit,
});

export const externalTimesheets = pgTable("external_timesheets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  clientId: uuid("client_id").notNull(),
  projectId: uuid("project_id").notNull(),
  taskId: uuid("task_id"),
  employeeId: uuid("employee_id").notNull(),
  externalId: text("external_id").notNull(),
  date: date("date").notNull(),
  hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
  description: text("description"),
  approved: boolean("approved").notNull().default(false),
  ...audit,
});
