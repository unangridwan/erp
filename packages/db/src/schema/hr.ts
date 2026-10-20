import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

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

/** Golongan upah (struktur & skala upah PP 36/2021). */
export const salaryGrades = pgTable("salary_grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  minWage: numeric("min_wage", { precision: 20, scale: 2 }).notNull(),
  maxWage: numeric("max_wage", { precision: 20, scale: 2 }).notNull(),
  sequence: integer("sequence").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const jobPositions = pgTable("job_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  gradeId: uuid("grade_id"),
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
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  /** Jadwal kerja bawaan (dapat diganti per rentang tanggal lewat penugasan shift). */
  scheduleId: uuid("schedule_id"),
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
  /** monthly = gaji bulanan; daily = upah per hari kerja; piece = tarif per satuan hasil kerja (borongan). */
  wageType: text("wage_type", { enum: ["monthly", "daily", "piece"] })
    .notNull()
    .default("monthly"),
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
  approvalStep: smallint("approval_step").notNull().default(1),
  approvalLevels: smallint("approval_levels").notNull().default(1),
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
  state: text("state", { enum: ["confirm", "approved", "refused"] })
    .notNull()
    .default("approved"),
  approvalStep: smallint("approval_step").notNull().default(1),
  approvalLevels: smallint("approval_levels").notNull().default(0),
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
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  employeeLoanAccountId: uuid("employee_loan_account_id"),
  leaveApprovalLevels: smallint("leave_approval_levels").notNull().default(1),
  overtimeApprovalLevels: smallint("overtime_approval_levels").notNull().default(0),
  casualFullBpjsMonths: smallint("casual_full_bpjs_months").notNull().default(3),
  expenseApprovalLevels: smallint("expense_approval_levels").notNull().default(1),
  thrComponentId: uuid("thr_component_id"),
  retroComponentId: uuid("retro_component_id"),
  /** Rekening perusahaan yang didebet untuk transfer gaji (file unggah bank). */
  transferSourceAccount: text("transfer_source_account"),
  /** Kode perusahaan/corporate ID di internet banking bisnis. */
  transferCompanyCode: text("transfer_company_code"),
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
  /** Dasar upah iuran BPJS bulan ini. */
  bpjsWage: numeric("bpjs_wage", { precision: 20, scale: 2 }).notNull().default("0"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  emailError: text("email_error"),
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
  loanId: uuid("loan_id"),
  expenseClaimId: uuid("expense_claim_id"),
});

export const payslipInputs = pgTable("payslip_inputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  payslipId: uuid("payslip_id").notNull(),
  componentId: uuid("component_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  description: text("description"),
  /** manual = diisi pengguna; thr/retro = dihitung otomatis (rincian di detail). */
  source: text("source", { enum: ["manual", "thr", "retro"] })
    .notNull()
    .default("manual"),
  detail: jsonb("detail"),
});

export const workSchedules = pgTable("work_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  toleranceMinutes: integer("tolerance_minutes").notNull().default(0),
  penaltyPerMinute: numeric("penalty_per_minute", { precision: 18, scale: 2 }).notNull().default("0"),
  penaltyPerOccurrence: numeric("penalty_per_occurrence", { precision: 18, scale: 2 }).notNull().default("0"),
  workDays: smallint("work_days").array().notNull().default([1, 2, 3, 4, 5]),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const shiftAssignments = pgTable("shift_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  scheduleId: uuid("schedule_id").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  ...audit,
});

/** Jejak persetujuan berjenjang (cuti & lembur). */
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  resModel: text("res_model", { enum: ["leave_request", "overtime", "expense_claim"] }).notNull(),
  resId: uuid("res_id").notNull(),
  step: smallint("step").notNull(),
  userId: uuid("user_id"),
  decision: text("decision", { enum: ["approved", "refused"] }).notNull(),
  note: text("note"),
  createdAt: audit.createdAt,
});

export const employeeLoans = pgTable("employee_loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  name: text("name").notNull(),
  principal: numeric("principal", { precision: 20, scale: 2 }).notNull(),
  installment: numeric("installment", { precision: 20, scale: 2 }).notNull(),
  startPeriod: text("start_period").notNull(),
  state: text("state", { enum: ["draft", "running", "done", "cancel"] })
    .notNull()
    .default("draft"),
  disbursementDate: date("disbursement_date"),
  disbursementMoveId: uuid("disbursement_move_id"),
  note: text("note"),
  createdBy: uuid("created_by"),
  ...audit,
});

/** Hasil kerja borongan (satuan) per tanggal. */
export const workEntries = pgTable("work_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  date: date("date").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  description: text("description"),
  payslipId: uuid("payslip_id"),
  ...audit,
});

export const severances = pgTable("severances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  reason: text("reason").notNull(),
  endDate: date("end_date").notNull(),
  monthlyWage: numeric("monthly_wage", { precision: 20, scale: 2 }).notNull(),
  unusedLeaveDays: numeric("unused_leave_days", { precision: 6, scale: 2 }).notNull().default("0"),
  otherRights: numeric("other_rights", { precision: 20, scale: 2 }).notNull().default("0"),
  separationPay: numeric("separation_pay", { precision: 20, scale: 2 }).notNull().default("0"),
  result: jsonb("result").notNull(),
  gross: numeric("gross", { precision: 20, scale: 2 }).notNull(),
  tax: numeric("tax", { precision: 20, scale: 2 }).notNull(),
  net: numeric("net", { precision: 20, scale: 2 }).notNull(),
  state: text("state", { enum: ["draft", "posted", "cancel"] })
    .notNull()
    .default("draft"),
  moveId: uuid("move_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  accountId: uuid("account_id").notNull(),
  /** Plafon per karyawan per tahun kalender (null = tanpa plafon). */
  annualLimit: numeric("annual_limit", { precision: 20, scale: 2 }),
  /** Objek PPh 21 bila dibayar lewat slip gaji. */
  taxable: boolean("taxable").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const EXPENSE_CLAIM_STATES = ["draft", "confirm", "approved", "refused", "paid", "cancel"] as const;

export const expenseClaims = pgTable("expense_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  name: text("name").notNull(),
  date: date("date").notNull(),
  description: text("description"),
  state: text("state", { enum: EXPENSE_CLAIM_STATES }).notNull().default("draft"),
  approvalStep: smallint("approval_step").notNull().default(1),
  approvalLevels: smallint("approval_levels").notNull().default(1),
  payMethod: text("pay_method", { enum: ["payslip", "cash"] })
    .notNull()
    .default("payslip"),
  total: numeric("total", { precision: 20, scale: 2 }).notNull().default("0"),
  payslipId: uuid("payslip_id"),
  moveId: uuid("move_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const expenseClaimLines = pgTable("expense_claim_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  claimId: uuid("claim_id").notNull(),
  categoryId: uuid("category_id").notNull(),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  note: text("note"),
  attachment: bytea("attachment"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
});

export const employeeChangeRequests = pgTable("employee_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  /** Nilai baru per field; nomor rekening disimpan terenkripsi (`bankAccountEnc`). */
  changes: jsonb("changes").$type<Record<string, string | null>>().notNull(),
  note: text("note"),
  state: text("state", { enum: ["confirm", "approved", "refused"] })
    .notNull()
    .default("confirm"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdBy: uuid("created_by"),
  ...audit,
});
