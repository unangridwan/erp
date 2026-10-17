import { boolean, date, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

// FK di database berbentuk komposit (tenant_id, id); di sini cukup dideklarasikan kolomnya.

export const PTKP_STATUSES = ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"] as const;

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  managerId: uuid("manager_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const jobPositions = pgTable("job_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeNumber: text("employee_number").notNull(),
  name: text("name").notNull(),
  departmentId: uuid("department_id"),
  jobId: uuid("job_id"),
  managerId: uuid("manager_id"),
  userId: uuid("user_id"),
  workEmail: text("work_email"),
  workPhone: text("work_phone"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  nikEnc: text("nik_enc"),
  npwpEnc: text("npwp_enc"),
  bankAccountEnc: text("bank_account_enc"),
  birthDate: date("birth_date"),
  gender: text("gender", { enum: ["male", "female"] }),
  ptkpStatus: text("ptkp_status", { enum: PTKP_STATUSES }).notNull().default("TK/0"),
  bpjsKesNo: text("bpjs_kes_no"),
  bpjsTkNo: text("bpjs_tk_no"),
  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  joinDate: date("join_date").notNull(),
  resignDate: date("resign_date"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const salaryComponents = pgTable("salary_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["allowance", "deduction"] }).notNull(),
  fixed: boolean("fixed").notNull().default(false),
  taxable: boolean("taxable").notNull().default(true),
  accountId: uuid("account_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  name: text("name").notNull(),
  contractType: text("contract_type", { enum: ["pkwt", "pkwtt"] })
    .notNull()
    .default("pkwtt"),
  dateStart: date("date_start").notNull(),
  dateEnd: date("date_end"),
  wage: numeric("wage", { precision: 20, scale: 2 }).notNull(),
  state: text("state", { enum: ["draft", "running", "closed", "cancel"] })
    .notNull()
    .default("draft"),
  note: text("note"),
  ...audit,
});

export const contractAllowances = pgTable("contract_allowances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  contractId: uuid("contract_id").notNull(),
  componentId: uuid("component_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
});

export const publicHolidays = pgTable("public_holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  date: date("date").notNull(),
  name: text("name").notNull(),
  ...audit,
});

export const leaveTypes = pgTable("leave_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  paid: boolean("paid").notNull().default(true),
  requiresAllocation: boolean("requires_allocation").notNull().default(true),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const leaveAllocations = pgTable("leave_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  leaveTypeId: uuid("leave_type_id").notNull(),
  days: numeric("days", { precision: 6, scale: 2 }).notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  note: text("note"),
  ...audit,
});

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  leaveTypeId: uuid("leave_type_id").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  days: numeric("days", { precision: 6, scale: 2 }).notNull(),
  reason: text("reason"),
  state: text("state", { enum: ["confirm", "approved", "refused", "cancel"] })
    .notNull()
    .default("confirm"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  ...audit,
});

export const attendances = pgTable("attendances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true }).notNull(),
  checkOut: timestamp("check_out", { withTimezone: true }),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  source: text("source", { enum: ["web", "manual"] })
    .notNull()
    .default("web"),
  createdAt: audit.createdAt,
});

export const overtimes = pgTable("overtimes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  date: date("date").notNull(),
  hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
  dayType: text("day_type", { enum: ["workday", "rest_day"] })
    .notNull()
    .default("workday"),
  description: text("description"),
  payslipId: uuid("payslip_id"),
  ...audit,
});

export const payrollSettings = pgTable("payroll_settings", {
  companyId: uuid("company_id").primaryKey(),
  tenantId: tenantId(),
  jkkRate: numeric("jkk_rate", { precision: 5, scale: 2 }).notNull().default("0.24"),
  kesWageCap: numeric("kes_wage_cap", { precision: 20, scale: 2 }).notNull().default("12000000"),
  jpWageCap: numeric("jp_wage_cap", { precision: 20, scale: 2 }).notNull().default("10547400"),
  salaryExpenseAccountId: uuid("salary_expense_account_id").notNull(),
  bpjsExpenseAccountId: uuid("bpjs_expense_account_id").notNull(),
  salaryPayableAccountId: uuid("salary_payable_account_id").notNull(),
  pph21PayableAccountId: uuid("pph21_payable_account_id").notNull(),
  bpjsPayableAccountId: uuid("bpjs_payable_account_id").notNull(),
  journalId: uuid("journal_id").notNull(),
  updatedAt: audit.updatedAt,
});

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  paymentDate: date("payment_date").notNull(),
  state: text("state", { enum: ["draft", "done", "paid", "cancel"] })
    .notNull()
    .default("draft"),
  accountMoveId: uuid("account_move_id"),
  paymentMoveId: uuid("payment_move_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const payslips = pgTable("payslips", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  runId: uuid("run_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  contractId: uuid("contract_id").notNull(),
  ptkpStatus: text("ptkp_status", { enum: PTKP_STATUSES }).notNull(),
  hasNpwp: boolean("has_npwp").notNull(),
  terCategory: text("ter_category").notNull(),
  terRate: numeric("ter_rate", { precision: 5, scale: 2 }),
  isFinal: boolean("is_final").notNull().default(false),
  workingDays: integer("working_days").notNull().default(0),
  unpaidDays: numeric("unpaid_days", { precision: 6, scale: 2 }).notNull().default("0"),
  earnings: numeric("earnings", { precision: 20, scale: 2 }).notNull().default("0"),
  gross: numeric("gross", { precision: 20, scale: 2 }).notNull().default("0"),
  pph21: numeric("pph21", { precision: 20, scale: 2 }).notNull().default("0"),
  employeeBpjs: numeric("employee_bpjs", { precision: 20, scale: 2 }).notNull().default("0"),
  employerBpjs: numeric("employer_bpjs", { precision: 20, scale: 2 }).notNull().default("0"),
  employeePension: numeric("employee_pension", { precision: 20, scale: 2 }).notNull().default("0"),
  deductions: numeric("deductions", { precision: 20, scale: 2 }).notNull().default("0"),
  net: numeric("net", { precision: 20, scale: 2 }).notNull().default("0"),
  annual: jsonb("annual"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  ...audit,
});

export const payslipLines = pgTable("payslip_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  payslipId: uuid("payslip_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  componentId: uuid("component_id"),
});

export const payslipInputs = pgTable("payslip_inputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  payslipId: uuid("payslip_id").notNull(),
  componentId: uuid("component_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  description: text("description"),
});
